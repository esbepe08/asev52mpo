-- v5.1: pause, undo with the opponent's approval, and live preview of tentative tiles.
--
-- 1. games.ext holds the small PUBLIC extras the new features need (see supabase/functions/_shared/core/engine.js, "ext"):
--      live    boolean            the host allows live preview of the tiles being tried
--      pause   null | object      both clocks are stopped (who, since, until)
--      pauses  [n0, n1]           pauses used by each seat
--      undo    null | object      the last mover's request to take a move back (state, who, move number)
--    It carries no private data (racks, bag and the undo snapshot stay in player_racks / game_private), so the existing read policy on games is enough.
alter table public.games add column if not exists ext jsonb not null default '{}'::jsonb;

-- 2. create_game_tx stores the initial ext; commit_action writes it with the rest of the patch.
create or replace function public.create_game_tx(p_game jsonb, p_player jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.games (id, room_code, host_player_id, status, tile_mode, validator_mode, minutes, round, revision, board, tahkim, bag_count, ext)
    values ((p_game->>'id')::uuid, p_game->>'room_code', (p_game->>'host_player_id')::uuid, 'lobby',
            coalesce(p_game->>'tile_mode', 'expanded'), 'off', coalesce((p_game->>'minutes')::integer, 25),
            1, 1, coalesce(p_game->'board', '[]'::jsonb), '{"state":"none"}'::jsonb, 0, coalesce(p_game->'ext', '{}'::jsonb));
  exception when unique_violation then
    raise exception 'ROOM_CODE_TAKEN' using errcode = 'P0001';
  end;
  insert into public.game_players (game_id, player_id, seat, nickname, score, tile_count, ms_left, ready, connection_state)
  values ((p_game->>'id')::uuid, (p_player->>'player_id')::uuid, 0, p_player->>'nickname', 0, 0, (p_player->>'ms_left')::bigint, true, 'online');
  insert into public.player_racks (game_id, player_id, tiles) values ((p_game->>'id')::uuid, (p_player->>'player_id')::uuid, '[]'::jsonb);
  insert into public.game_private (game_id, bag, undo) values ((p_game->>'id')::uuid, '[]'::jsonb, null);
end $$;
revoke all on function public.create_game_tx(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_game_tx(jsonb, jsonb) to service_role;

create or replace function public.commit_action(
  p_game_id uuid, p_expected_revision bigint, p_client_action_id uuid, p_player_id uuid, p_patch jsonb, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g    public.games;
  g2   public.games;
  prev jsonb;
  rec  jsonb;
  rd   int;
begin
  select * into g from public.games where id = p_game_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;

  if p_client_action_id is not null then
    select result into prev from public.game_actions where game_id = p_game_id and client_action_id = p_client_action_id;
    if found then return jsonb_build_object('duplicate', true, 'result', prev); end if;
  end if;

  if g.revision <> p_expected_revision then raise exception 'STALE_REVISION' using errcode = 'P0001'; end if;

  -- seats
  if p_patch->'add_player' is not null and jsonb_typeof(p_patch->'add_player') = 'object' then
    rec := p_patch->'add_player';
    begin
      insert into public.game_players (game_id, player_id, seat, nickname, score, tile_count, ms_left, ready, connection_state)
      values (p_game_id, (rec->>'player_id')::uuid, (rec->>'seat')::smallint, rec->>'nickname', 0, 0, (rec->>'ms_left')::bigint, coalesce((rec->>'ready')::boolean, false), 'online');
    exception when unique_violation then
      raise exception 'SEAT_TAKEN' using errcode = 'P0001';
    end;
    insert into public.player_racks (game_id, player_id, tiles) values (p_game_id, (rec->>'player_id')::uuid, '[]'::jsonb);
  end if;
  if p_patch->>'remove_player' is not null then
    delete from public.player_racks where game_id = p_game_id and player_id = (p_patch->>'remove_player')::uuid;
    delete from public.game_players where game_id = p_game_id and player_id = (p_patch->>'remove_player')::uuid;
  end if;

  -- game row: merge the patch over the current row; only listed columns can ever change
  g2 := jsonb_populate_record(null::public.games, to_jsonb(g) || coalesce(p_patch->'game', '{}'::jsonb));
  update public.games set
    status = g2.status, tile_mode = g2.tile_mode, validator_mode = g2.validator_mode, minutes = g2.minutes, round = g2.round,
    current_seat = g2.current_seat, current_player_id = g2.current_player_id, board = g2.board, clock_started = g2.clock_started,
    turn_started_at = g2.turn_started_at, turn_deadline_at = g2.turn_deadline_at, tahkim = g2.tahkim, tahkim_available = g2.tahkim_available, ext = coalesce(g2.ext, '{}'::jsonb),
    bag_count = g2.bag_count, rematch_seats = g2.rematch_seats, winner_player_id = g2.winner_player_id, winner_seat = g2.winner_seat,
    result = g2.result, started_at = g2.started_at, finished_at = g2.finished_at,
    last_event = p_patch->>'event', revision = g.revision + 1, updated_at = now()
  where id = p_game_id;

  for rec in select * from jsonb_array_elements(coalesce(p_patch->'players', '[]'::jsonb)) loop
    update public.game_players set
      score      = coalesce((rec->>'score')::integer, score),
      tile_count = coalesce((rec->>'tile_count')::smallint, tile_count),
      ms_left    = coalesce((rec->>'ms_left')::bigint, ms_left),
      ready      = coalesce((rec->>'ready')::boolean, ready)
    where game_id = p_game_id and player_id = (rec->>'player_id')::uuid;
  end loop;

  for rec in select * from jsonb_array_elements(coalesce(p_patch->'racks', '[]'::jsonb)) loop
    insert into public.player_racks (game_id, player_id, tiles) values (p_game_id, (rec->>'player_id')::uuid, rec->'tiles')
    on conflict (game_id, player_id) do update set tiles = excluded.tiles;
  end loop;

  if p_patch->'private' is not null and jsonb_typeof(p_patch->'private') = 'object' then
    update public.game_private set
      bag  = case when p_patch->'private' ? 'bag'  then p_patch->'private'->'bag'  else bag  end,
      undo = case when p_patch->'private' ? 'undo' then nullif(p_patch->'private'->'undo', 'null'::jsonb) else undo end
    where game_id = p_game_id;
  end if;

  select * into g2 from public.games where id = p_game_id;

  if p_patch->'move' is not null and jsonb_typeof(p_patch->'move') = 'object' then
    rec := p_patch->'move';
    insert into public.game_moves (game_id, round, player_id, seat, turn_number, action_type, placements, formed_words, score_delta, validation_result, bingo, swap_count, revision)
    values (p_game_id, g2.round, (rec->>'player_id')::uuid, (rec->>'seat')::smallint, (rec->>'turn_number')::integer, rec->>'action_type',
            coalesce(rec->'placements', '[]'::jsonb), coalesce(rec->'formed_words', '[]'::jsonb), coalesce((rec->>'score_delta')::integer, 0),
            coalesce(rec->>'validation_result', 'skipped'), coalesce((rec->>'bingo')::boolean, false), coalesce((rec->>'swap_count')::smallint, 0), g2.revision);
  end if;
  if p_patch->'move_update' is not null and jsonb_typeof(p_patch->'move_update') = 'object' then
    rec := p_patch->'move_update';
    update public.game_moves set tahkim_status = rec->>'tahkim_status', penalty = coalesce((rec->>'penalty')::integer, 0)
    where game_id = p_game_id and round = g2.round and turn_number = (rec->>'turn_number')::integer;
  end if;

  if p_client_action_id is not null then
    insert into public.game_actions (game_id, client_action_id, player_id, result) values (p_game_id, p_client_action_id, p_player_id, p_result);
  end if;

  return jsonb_build_object('revision', g2.revision);
end $$;
revoke all on function public.commit_action(uuid, bigint, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.commit_action(uuid, bigint, uuid, uuid, jsonb, jsonb) to service_role;

-- 3. Live preview: the player on turn broadcasts the tiles being tried ("draft" events) to the other member over the private channel.
--    Members may therefore SEND broadcasts on their own game's channel (before, only the server could). This is safe by design: a broadcast is only a hint.
--    A browser reacts to a revision announcement by fetching an authoritative snapshot and to a draft by drawing dashed tiles; it never changes game state,
--    and the client validates and bounds every draft it receives (js/online/draft.js). Presence tracking keeps its own policy.
drop policy if exists "members send drafts" on realtime.messages;
create policy "members send drafts" on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'game:%'
    and public.eas_is_member(((regexp_match((select realtime.topic()), '^game:([0-9a-f-]{36})$'))[1])::uuid)
  );
