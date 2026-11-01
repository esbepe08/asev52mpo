# v5.2 build report

Base: eas-online v5.1. This round fixes the reported defects and adds the four requested behaviours: a working live draft, unlimited local undo and a visible online undo request, a rack display option, a real pause experience in both modes, and a first-turn draw that decides who starts.

## What was reported, what was actually wrong, what changed

| Report | Cause found | Change |
|---|---|---|
| "Live Draft Tiles" does nothing once a match starts | The feature had **no control in a match** (only a host switch in the waiting room), and its only transport was a client broadcast that needs the v5.1 realtime INSERT policy. Without that policy, or when one draft event was missed, nothing ever appeared. | Drafts now travel over **two transports**: the broadcast (fast path) and the player's **presence payload** (state path, already allowed by the original channel policy, and it also hands a late joiner the current draft). A **live switch on the match bar** turns it off/on for that player, is remembered per device, and instantly replays the opponent's current draft when switched back on. The waiting-room rule now states its current value, and its buttons disable while saving. |
| Undo is limited to one use offline | `S.undo` held exactly one snapshot, set on each move and cleared by the first undo. | `S.undos` is a stack: one snapshot per **committed action** (move, pass, swap). Undo pops one step, so it is pressable again and again until the history is empty. The stack is saved with the match and restored (old v1 saves with only `undo` still load as a one-step stack). Tahkim ✖ consumes only the voided move's step. |
| The opponent sees no undo request online | The request was shown only as a modal `#jd` dialog, which could be blocked by another open dialog, and it had no persistent, independent feedback. | The responder now gets a dedicated **top-of-screen banner** (`#undoReq`) with the mover's name, the move's score and **موافقة / رفض**, independent of every dialog and rebuilt from the snapshot after a refresh. The requester gets the bar status, the toast, and the "إلغاء طلب التراجع" button. |
| Rack display option | No such setting existed. | Settings → **اللعب → عرض الرفوف**: *دائمًا ظاهرة* (default) or *رفّ صاحب الدور فقط*. The waiting tray keeps its exact box (nothing moves), its tiles are hidden and the tray is `inert`; the label says why. Local play only. |
| Pause "more effectively, like tournaments"; no offline pause | Online only dimmed the board with a `⏸` glyph; there was no card and no offline control. | One shared **pause card** (`js/pause.js`): full-screen veil, big pause glyph, who paused and how long, a running "stopped for" counter, the resume action and a countdown for the other player. **Offline** gets a pause button (unlimited, a shared screen is not a tournament) with the same card; the clock is frozen and the board/racks are hidden. Online keeps the server's 2 × 3 min rule and both buttons (bar and card). |
| First-turn selection | The first player was fixed (`(round-1) % 2` online, seat 0 locally). | A real **draw**: each player draws one tile, the higher value starts, a tie draws again. **Offline**: two face-down cards, both drawn before either is revealed, a single flip animation and a glow on the winner. **Online**: the server deals the draw (`status: drawing`), keeps the pending values in `game_private.draw` (never public), reveals both only when both have drawn, then deals the racks and starts. Rematches draw too. Reduced motion shows the values without animation. |

## Design decisions

| Topic | Decision | Why |
|---|---|---|
| Draft transport | broadcast **and** presence | A draft is a hint; losing it must not look like a broken feature. Presence already exists, needs no new policy, and keeps the current draft for a reconnect or a re-enable. The receiver validates everything (`draft.js`), so either path is bounded input. |
| Draft switch | per player, remembered | The host's room rule is the agreement; the switch is courtesy for "stop showing my tiles". The room rule still gates it. |
| Local undo | a stack of full snapshots, cap 160 | Full snapshots are the existing format (validation already exists), and the cap is far above a real match. One step per committed action keeps the meaning of "Undo" stable for pass/swap too. |
| Online undo UI | a fixed banner, not a dialog | It cannot be hidden behind a dialog, it is visible while the board stays usable (acting on the board is a decline anyway), and it is rebuilt from the snapshot after a refresh. |
| Pause local | unlimited | Both players share the screen; there is no competitive abuse to prevent, unlike a remote opponent. |
| Draw privacy | `game_private.draw` while pending, `games.ext.draw` after both | `games` is readable by both members through RLS: the opponent's value must never be written there before both have drawn. Once both are in, the pair is public (it decides who starts). |
| Draw timing | racks dealt **after** the draw; the drawn tiles stay in the bag | Real Scrabble returns the two draw tiles before the racks are dealt. Keeping them in the bag preserves the full 101/84 distribution and the existing deal code. |
| Rematch | draws again | The same fairness rule for every new round; no inherited "alternating" assumption. |

## Server changes (migration `20261102000006_eas_v5_2_first_turn_draw.sql`)

1. `games.status` gains `drawing` (the CHECK is found and replaced, not guessed by name).
2. `game_private.draw` holds the pending draw; `commit_action` persists it.
3. `eas_cleanup_stale_games()` treats a stale `drawing` room like a stale lobby and clears the new public extras.
4. New action `draw_first_tile` (revision-pinned); `start_game` and a successful rematch now enter `drawing`.
5. `snapshot.game.draw = { mine, theirs, done, first, tries }` — `theirs` is `null` until both have drawn; `draw.done` disappears from snapshots after the first committed action.

## Verification

Environment: Windows, Edge 156 (Chromium) through `CHROME_PATH`, Python Playwright 1.64, jsdom 30 for the module suites. No real Supabase project was available: the server suites run the real Edge Function core on the in-memory store, and the browser runs use that same core behind a stand-in realtime channel.

- All online server suites (`rooms 38, game 62, security 39, network 33, endgame 42, abandon 25, pause-undo 59, parity 10, **draw 32**, draft 26, explain 15`).
- Two real browsers through the server core (**89/89**), including the draw on start and on rematch, the undo banner accept/decline **and its rebuild after a refresh**, the pause card on both screens, the live-preview switch, and the rematch draw.
- Local browser run 11/11; PWA static **370**, PWA e2e **92**, floating modules **51**, all layout suites (history 248, extra 83, log icon 509, layering 146, fluid 220, tools 69, collapse 84, feel 72), jsdom logic suites (engine 142, features 33, draw 25, startup 17, names 22, endgame 21).
- `tests/logic/harness.mjs` and a few helpers were repaired for Windows (`fileURLToPath`), hidden-page `requestAnimationFrame` (bring the page to front), and CP1252 consoles (`PYTHONIOENCODING`); these were test-infrastructure issues, not app behaviour.

Not verified here: a real Supabase deployment (apply migration 06, redeploy `eas-game`, then play two devices once), and real phones. The migration order and the checks to run are in `docs/ONLINE_MULTIPLAYER_SETUP.md` §12c.
