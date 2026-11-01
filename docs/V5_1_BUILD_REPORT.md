# v5.1 build report

Base: eas-online v5. Ideas adopted from a comparison with another online build (live draft tiles, undo with approval, pause/resume, specific setup errors, parity testing, a PWA diagnostic page); the visual-style idea was deliberately left out.

## Design decisions
| Topic | Decision | Why |
|---|---|---|
| State | One new jsonb column `games.ext` (`live`, `pause`, `pauses`, `undo`) | Public extras only; no change to the privacy model (racks, bag and the undo snapshot stay in private tables). Public snapshot field is `undo_req`, so the existing guard "no `undo` key in the public game" still holds. |
| Undo | Mover asks, player on turn answers; revision-pinned; decline is final per move | Cannot be used to probe the opponent repeatedly; every other action is an implicit decline, so nobody can be blocked by an unanswered request. |
| Pause | 2 each, 3 min, hidden board; expiry resumes by itself on the next action | A pause cannot freeze a lost position or be used to study. |
| Live preview | Browser-to-browser broadcast, host option, default on | Costs the server nothing. Trade-off: it shows the tiles you are trying. Receivers validate everything (`js/online/draft.js`), and a forged draft can only draw ghost tiles. |
| Word rules placement | Settings (reference) + inside the Tahkim dialog (decision point) + waiting room (agreement) | Rules are needed where words are judged, not only where preferences live. |

## Verification (this sandbox)
- Server suites: rooms 38, game 62, security 39, network 33, endgame 41, abandon 25, **pause-undo 58, parity 10, draft 26, explain 15**: all pass.
- Real browsers, two players through the real server core: **72/72** (new groups: undo accept/decline, pause, live ghost tiles); local play 10/10; PWA static 351, PWA e2e 92, theme contrast 0 failures, floating modules 51.
- Not run here: suites that need `jsdom` / `@sparticuz/chromium` (not installed in the sandbox; they fail identically on the untouched v5), and nothing was run against a real Supabase project. Run `supabase db push`, deploy the function, then play two devices once.
- One outdated assertion was corrected (`tests/logic/endgame.mjs`: game end reasons now include resign and abandon).
