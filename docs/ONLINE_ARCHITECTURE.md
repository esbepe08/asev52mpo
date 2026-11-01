# Online architecture

```
  Browser A ──┐                                                   ┌── Browser B
   UI (existing)                                                  │   UI (existing)
   js/online/session.js  (adapter: renders snapshots, sends actions)
        │  action (JSON)                       ▲ snapshot (JSON, caller's view only)
        ▼                                      │
  ┌──────────────────────── Edge Function eas-game (service role, Deno) ────────────────────────┐
  │ service.js  load state → engine.js (pure rules) → patch → store.commit → snapshot.js        │
  │ shares js/rules.js (legality, score, final settlement) · config · modes with the local game │
  └───────────────────────────────┬─────────────────────────────────────────────────────────────┘
                                  ▼  commit_action() — one SQL transaction, row lock, revision compare-and-set
                         Postgres (RLS on)  ──trigger──▶  realtime.send('game:<id>', {revision,status,event})
                                                                   │ private Broadcast channel
                              Browser A ◀────────── notification ──┴────────▶ Browser B   (then: fetch snapshot)
```
`DATABASE = truth, REALTIME = notification.` A missed event never corrupts a client: the next action, the next event, a tab becoming visible, a reconnect or the 20 s heartbeat (which reports the current revision) all lead to an authoritative snapshot.

## State split
| Class | What | Stored in | Who can read |
|---|---|---|---|
| Public | board, scores, whose turn, tile **counts**, bag **size**, clock fields, Tahkim state, move history, rules, revision, result | `games`, `game_players`, `game_moves` | the two players (RLS + snapshot) |
| Private | each player's rack (7 slots, tile ids + letters) | `player_racks` | its owner only (RLS `player_id = auth.uid()`; snapshot includes only the caller's rack) |
| Server-only | tile bag (order = the future), pre-move undo snapshot for Tahkim, pending first-turn draw (until both have drawn), idempotency keys | `game_private`, `game_actions` | nobody except the Edge Function (RLS on, no policies, no grants) |

`snapshot.js` is the only function that turns server state into client data. Tests assert that a player's snapshot/responses contain none of the opponent's tile ids and none of the bag's.
Every physical tile has a random opaque id (`idFactory`), not a letter or a sequence number, and moves are submitted as tile ids: a client cannot invent a tile, play the opponent's tile, or draw from the bag.

## Authoritative actions (`engine.js`, all pure; `service.js` does the I/O)
`create_room, join_room, set_ready, update_settings, leave_room, start_game, draw_first_tile, submit_move, pass_turn, swap_tiles, request_tahkim, cancel_tahkim, resolve_tahkim, resign_game, claim_timeout, claim_abandon, rematch, snapshot, reconnect, heartbeat`.
`submit_move` is the only way to score. The server: checks membership, status, turn and revision → maps tile ids to the caller's rack → checks cells and blank letters → `analyzeMove` (shared geometry/connection rules) → `scoreWords` (shared) → removes tiles, refills from the bag, updates scores, history and clock → one atomic commit. Anything extra in the payload (score, rack, status…) is ignored.

## First-turn draw (who starts)
`start_game` (and a successful rematch) puts the game in status **`drawing`**: a fresh bag, empty racks, no turn, the clock not started. Each player sends `draw_first_tile` once; the server draws a tile, records its value in `game_private.draw` and **keeps it out of every public row and snapshot** until both have drawn. The caller's own value is returned in `snapshot.game.draw.mine` at once; `theirs` is `null` until both are in. When the second draw arrives: equal values reset both cards, increment `tries` and stay `drawing` (`DRAW_TIE`); otherwise the higher value starts, both values are revealed in the public `games.ext.draw`, the racks are dealt and the status becomes `active` (`GAME_STARTED`). The drawn tiles are immediately put back into the bag, so the racks are dealt from the full set. The first committed action clears `ext.draw`, so a reconnect does not replay the animation.

## Revision and idempotency
* `games.revision` starts at 1 and is bumped exactly once per committed action (inside `commit_action`, which holds the game row lock).
* Gameplay actions carry `base_revision`; a mismatch → `STALE_STATE` + the fresh snapshot (client re-syncs, keeps its unsent tile preview if still valid).
* Every mutation carries `client_action_id` (UUID). `game_actions(game_id, client_action_id)` is checked first and again under the lock; a replay answers with the current state and changes nothing. The client reuses the same id when it retries after a network failure.
* Presence/reconnect never bump the revision (they are not game state), so they cannot make a pending action stale.

## Realtime
Private channel `game:<game id>`; policies on `realtime.messages` allow only members to receive and to track presence. Since v5.1 members may also publish **one** thing on their own game's channel: the live-preview `draft` (a hint; the server never reads it). Since v5.2 the same draft is also carried in the player's presence payload, so the preview still works if the `members send drafts` policy is missing. Server events (from `games.last_event`): `PLAYER_JOINED, PLAYER_LEFT, PLAYER_READY, SETTINGS_UPDATED, GAME_STARTED, GAME_DRAWING, DRAW_TILE, DRAW_TIE, MOVE_COMMITTED, PASS_COMMITTED, SWAP_COMMITTED, TAHKIM_REQUESTED, TAHKIM_RESOLVED, UNDO_REQUESTED, UNDO_ACCEPTED, UNDO_DECLINED, UNDO_CANCELLED, GAME_PAUSED, GAME_RESUMED, GAME_ENDED, REMATCH_REQUESTED`. All carry only `{revision,status,event}`. `MOVE_REJECTED` is the synchronous `ok:false` answer to the sender (a rejection is not public). Presence marks who is connected ("● متصل" / "○ غير متصل").
Client network states: `CONNECTING, CONNECTED, RECONNECTING, OFFLINE, SYNCING`.

## Timer
No browser counter is authoritative. `players.ms_left` is the time left when the clock was last settled; `games.turn_started_at` / `turn_deadline_at` are server timestamps. The page shows `ms_left − (serverNow − turn_started_at)` where `serverNow = Date.now() + (snapshot.server_now − Date.now() at fetch)` (clock-skew correction), so a reload reconstructs it exactly. Same rules as local play: the clock starts after the first scored move; thinking time is charged to the player on turn; the clock stops while Tahkim is pending. Time-out is decided by the server: any action after the deadline ends the game (`TIME_UP`), and either page may send `claim_timeout`, which the server only honours if its own clock agrees.

## Words: no dictionary
The server never judges a word. `submit_move` checks geometry, connection, ownership and blank letters, scores the move and commits it. Whether a word is valid is decided
by the players: the player now on turn may challenge the previous move (Tahkim) and rule it صحيح or خطأ. This is identical to local play, and it is why the Edge Function
has no dictionary to download (cold starts are fast) and why `game_moves.validation_result` is always `skipped`. The legacy column `games.validator_mode` stays in the schema
(always `off`) so old rows and migrations remain valid.

## Presence, heartbeat and the abandon claim
`game_players.last_seen_at` is the server's only evidence that a player is there. Every committed action and a `heartbeat` (every 20 s while the page is visible) refresh it;
neither touches `games.revision`. The heartbeat answers with the current revision (a missed realtime event is noticed without a download) and with `opp_idle_ms`.
The match is always *waiting for* one seat: the player on turn, or the resolver while Tahkim is pending (`snapshot.waiting_seat`). If that seat has been silent for `ABANDON_MS`
(3 minutes, `js/config.js`), the **other** player may send `claim_abandon`; the server re-checks its own `last_seen_at`, ends the match with reason `abandon`
(scores unadjusted, winner = claimant) and names the absent player as `loser_seat`. A browser cannot claim early, and nobody can claim against a player who is not holding the match up.

## Tahkim
`none → pending → resolved_valid | resolved_invalid → none` (next committed action). Status becomes `tahkim_pending`, which blocks every other action (`TAHKIM_PENDING`) and stops the clock. The challenger is the player on turn (as in the local game); the **resolver** is stored in `tahkim.resolver_seat`, today equal to the challenger. A referee/teacher role later means: a role column in `game_players`, a nullable seat, and `resolver_seat` pointing at that player; no state-machine change.
`valid` → challenger pays `min(5, score)`, the move stands. `invalid` → board, racks, bag and scores are restored from `game_private.undo` (clocks kept), the mover loses the turn.

## Reconnection and refresh
The anonymous Supabase session persists in the browser. On load the page calls `reconnect` (no game id needed): the server finds the player's open game and returns board, scores, own rack, turn, deadline, Tahkim state, history and revision; the page re-subscribes. Matches finished in the last 30 minutes can still be viewed; a finished match is not auto-resumed.

## Game end
Reasons: rack emptied, time, resignation, abandonment. Settlement is `rules.settleEnd` (shared with local play): final = score + 2 × minutes left (the clock shows whole seconds rounded up; the minutes are rounded to the nearest, exactly :30 rounds down, so 2:30 counts 2 and 2:31 counts 3) − value of the tiles left on the rack; no floor; highest score wins, equal = tie. Resignation and abandonment adjust nothing. Passing is unlimited in this game, so (as locally) there is no pass-based ending. Rematch: both players ask → round + 1, brand-new bag/racks, fresh history, and a **new first-turn draw** decides who starts.

## Security model in one list
No service-role key in any browser file · RLS on every table, default deny · no client write grants · racks readable by owner only · bag/undo/pending draw/idempotency unreachable · private realtime channels with membership policies · server computes legality, words, score, draws, turn, clock, winner · nickname is display text only (identity = Supabase user id) · error messages never carry SQL/stack · logs never carry racks, bag order, tokens.
Residual, accepted risks: no per-user rate limiting (use Supabase's built-in auth rate limits + CAPTCHA); a disconnected player is only forfeited when the opponent chooses to claim after the 3-minute grace (their clock keeps running on their turn meanwhile); anonymous identity is lost if site data is cleared.
