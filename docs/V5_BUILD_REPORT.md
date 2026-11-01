# v5 build report: v4.5 client + online layer

## What this build is
The v4.5 offline game (Floating Workspace, touch drag and drop, end-of-game rules, PWA) with the online multiplayer layer of `eas-online-mp` ported onto it, so there is **one client**. The server is the same authoritative design (Supabase Edge Function + Postgres + Realtime) with the changes below.

## Changes
| Area | Change |
|---|---|
| Rules | `js/rules.js` is the single definition of legality, scoring and the final score; `js/scoring.js` only binds it to local state. The server mirrors it (`tools/sync-edge-shared.mjs`, now `config`, `modes`, `rules`). |
| Final score | Online used `+1 point per minute, floor 0`; now identical to local: `score + 2 × minutes (nearest minute, :30 rounds down) − rack value`, no floor. |
| Words | Dictionary, validator, word policy and the "فحص الكلمات" host setting are gone (client and server). Tahkim is the only word judgment. The Edge Function no longer downloads 2.9 MB at cold start and no longer needs `ASSET_BASE_URL`. |
| Lobby | Full-screen flow instead of a modal: nickname → create / join (`?room=` link prefilled) → waiting room (seats, ready, host rules, copy / share link). |
| Match bar (revision) | The bar is one fixed-height row that never wraps (status line with ellipsis, colour dot, at most one contextual button, leave), and what it shows lags what is true: a bad state (reconnecting, opponent absent) must last 1.5 s before it is displayed, so presence blips no longer flash it. In the Floating Workspace it is a movable module: drag the grip, double-click resets, the position is remembered per device, leaving the workspace puts it back in the page flow. |
| Match | Network bar (connection, whose ruling or return is awaited, resign / exit, rematch); presence dot per player; last move marked by a corner dot; scored words light up on both screens; result card shared with local play, rematch request visible on the card. Undo, New game and the name editor are hidden online. |
| Disconnections | `heartbeat` action (20 s) + `claim_abandon` (3 min): the server measures silence, only the player who is not holding the match up can claim. |
| Render stability | DOM writes in `renderControls` / `renderPlayers` are guarded (no rewrite of unchanged values), for local and online. |
| Fix (also affects local) | The end-of-game card could appear off-screen on phones after an earlier floating confirm left inline coordinates on the shared `#dlg`; `ask()` now clears them for modals. |
| Schema | Migration `20261031000004`: legacy `validator_mode` forced to `off`, `create_game_tx` updated. No new tables or columns. |
| PWA | New files added to the precache; build command is `node tools/write-env.mjs && node tools/stamp-sw.mjs`. Supabase traffic is cross-origin and never touched by the service worker. |

## Verification done in this environment
* Server core on the in-memory store: rooms 38, game 62, security 39, network 33, endgame 41, abandon 25 checks pass.
* Two real Chromium browsers (desktop + touch phone) playing through the REAL server core (`tests/e2e/run.py`, 49 checks, including that the bar's box and everything below it stays identical across states, and that it can be dragged, reset and released in Floating Workspace): create / join by link, ready / start, private racks, move preview privacy, turn gating, score and last-move on both screens, Tahkim void, pass, swap, **finger drag online**, resign, identical result card, rematch from the card, no console errors.
* Local play regression in a real browser (`tests/e2e/local.py`, 10 checks): no online UI, undo, final-score rule, result card on screen.
* Existing v4.5 Floating Workspace suite (`tests/layout/float_modules.py`, 51 checks) and PWA static checks (331) pass.

## NOT verified here (needs your Supabase project)
* The real `supabase-backend.js` (supabase-js, anonymous auth, private Realtime channel), `store.ts` and the SQL (`commit_action`, RLS, the new migration) have not run: this environment has no network. The e2e uses a stand-in transport with the same contract; follow `ONLINE_MULTIPLAYER_SETUP.md` §11 on two real devices.
* The jsdom logic suites and the node-based layout suites need `npm install` (not available here); they were not run. The local-play browser regression above covers the paths this merge touched.
* The abandon countdown (3 min) is covered by server tests with a movable clock, not by a browser test.

## Known limitations / next steps
* Anonymous identity: clearing site data loses the seat (no account recovery yet).
* The Tahkim ruling dialog for the resolver is still the modal `#jd` (not yet a non-blocking sheet).
* No QR code for the room link (copy / native share only); Rewind (تراجع with opponent approval) is not part of this baseline.
* The online match uses the existing layouts (default / duel / Floating Workspace); a dedicated fixed online shell is a possible later step.
