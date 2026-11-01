-- v5.2: the first-turn draw (who starts), mirrored from supabase/functions/_shared/core/engine.js.
--
-- 1. A new game status `drawing`, between the lobby and play: the host starts, each player draws one tile, the higher value starts and
--    only then are the racks dealt. The CHECK constraint is replaced (its name is whatever Postgres generated, so it is found, not guessed).
-- 2. game_private.draw holds the draw while only ONE player has drawn (the values must not be readable before both are in). Once both
--    have drawn, the revealed pair moves to the PUBLIC games.ext.draw and game_private.draw is cleared. commit_action persists both.
-- 3. Stale 'drawing' rooms are cleaned up like stale lobbies.

-- 1. status ---------------------------------------------------------------------------------------------------------------
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.games'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ~ 'status.*(lobby|active|finished)'
  loop
    execute format('alter table public.games drop constraint %I', c);
  end loop;
end $$;
alter table public.games add constraint games_status_check
  check (status in ('lobby', 'starting', 'drawing', 'active', 'tahkim_pending', 'finished', 'abandoned'));

-- 2. private draw state ----------------------------------------------------------------------------------------------------
alter table public.game_private add column if not exists draw jsonb;

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
      undo = case when p_patch->'private' ? 'undo' then nullif(p_patch->'private'->'undo', 'null'::jsonb) else undo end,
      draw = case when p_patch->'private' ? 'draw' then nullif(p_patch->'private'->'draw', 'null'::jsonb) else draw end
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

-- 3. cleanup: a room left in `drawing` is as stale as a lobby ---------------------------------------------------------------
create or replace function public.eas_cleanup_stale_games() returns jsonb language plpgsql security definer set search_path = public as $$
declare a1 int; a2 int; d int;
begin
  update public.games set status = 'abandoned', finished_at = coalesce(finished_at, now()), revision = revision + 1, last_event = 'GAME_ENDED', updated_at = now(), ext = coalesce(ext, '{}'::jsonb) || '{"draw":null,"pause":null,"undo":null}'::jsonb
   where status in ('lobby', 'drawing') and updated_at < now() - interval '2 hours';
  get diagnostics a1 = row_count;
  update public.games set status = 'abandoned', finished_at = coalesce(finished_at, now()), turn_started_at = null, turn_deadline_at = null, revision = revision + 1, last_event = 'GAME_ENDED', updated_at = now()
   where status in ('active', 'tahkim_pending', 'starting') and updated_at < now() - interval '24 hours';
  get diagnostics a2 = row_count;
  delete from public.games where status in ('finished', 'abandoned') and updated_at < now() - interval '7 days';
  get diagnostics d = row_count;
  return jsonb_build_object('abandoned_lobbies', a1, 'abandoned_games', a2, 'deleted', d);
end $$;
revoke all on function public.eas_cleanup_stale_games() from public, anon, authenticated;
grant execute on function public.eas_cleanup_stale_games() to service_role;
