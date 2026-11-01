-- v5: words are judged by the players (Tahkim) only, and a vanished opponent can be claimed against.
--
-- 1. validator_mode is a legacy column. Every new room is created with 'off'; rooms that existed before this migration are switched too,
--    so an old lobby can never ask the server for a dictionary that no longer exists.
alter table public.games alter column validator_mode set default 'off';
update public.games set validator_mode = 'off' where validator_mode <> 'off';

create or replace function public.create_game_tx(p_game jsonb, p_player jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.games (id, room_code, host_player_id, status, tile_mode, validator_mode, minutes, round, revision, board, tahkim, bag_count)
    values ((p_game->>'id')::uuid, p_game->>'room_code', (p_game->>'host_player_id')::uuid, 'lobby',
            coalesce(p_game->>'tile_mode', 'expanded'), 'off', coalesce((p_game->>'minutes')::integer, 25),
            1, 1, coalesce(p_game->'board', '[]'::jsonb), '{"state":"none"}'::jsonb, 0);
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

-- 2. Abandon claims read game_players.last_seen_at. It is refreshed by the Edge Function on every action and every heartbeat, and it never
--    touches games.revision, so heartbeats cannot make a pending move stale or wake the realtime trigger.
--    The column already exists (schema migration 1): nothing to add here.
