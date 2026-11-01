# Online multiplayer: setup from zero

You need: a free [Supabase](https://supabase.com) account, your existing Vercel project, Node 20+ on your computer, and the repository checked out.
Nothing below is optional unless it says so. Local play keeps working before, during and after this setup.

> Not verified against a live Supabase project: this repository was developed and tested without access to one (see
> `ONLINE_IMPLEMENTATION_REPORT.md`, "Known limitations"). Follow step 11 in order the first time; section 12 lists what to check if something fails.

## 1. Create the Supabase project
1. supabase.com → **New project**. Pick a region near your players, set a database password (store it in a password manager; the game never needs it).
2. Wait until the project is ready.

## 2. Project URL
**Project Settings → API → Project URL**, e.g. `https://abcdefghijklmno.supabase.co`. This is `SUPABASE_URL`. The part before `.supabase.co` is the **project ref**.

## 3. Public key
Same page → **Project API keys** → the key labelled **anon / public** (or **publishable** in the newer UI). This is `SUPABASE_ANON_KEY`.
Do **not** use `service_role` / `secret`. (`tools/write-env.mjs` refuses to build if it recognises a service-role key.)

## 4. Anonymous sign-ins (players never register)
**Authentication → Sign In / Providers → Anonymous Sign-Ins → enable.**
Recommended: **Authentication → Attack Protection → enable CAPTCHA** so bots cannot mass-create anonymous users.

## 5. Install the CLI and link the project
```bash
npm install -g supabase            # or: npx supabase ...
supabase login
supabase link --project-ref YOUR_PROJECT_REF     # asks for the database password from step 1
```

## 6. Apply the migrations (tables, constraints, RLS, functions, realtime trigger)
```bash
supabase db push
```
This runs, in order, `supabase/migrations/20261024000001_eas_online_schema.sql`, `…02_eas_online_security.sql`, `…03_eas_online_functions.sql`, `…04_eas_v5_no_validator_abandon.sql`, `…05_eas_v5_1_pause_undo_live.sql` (adds `games.ext`, the pause / undo / live-preview state, and lets room members send the live-preview broadcasts) and `…06_eas_v5_2_first_turn_draw.sql` (adds the `drawing` status, the private pending draw in `game_private.draw`, the updated commit function and the drawing cleanup).
Everything (tables, indexes, RLS policies, the commit/create functions, the realtime trigger, the cleanup function) is in those files; there is nothing to click in the dashboard.

## 7. Row Level Security
Already enabled by migration 02 on all six tables. Verify: **Table Editor → each table → "RLS enabled"** is shown, and **Authentication → Policies** lists:
`members read their game`, `members read game players`, `members read game moves`, `owner reads own rack` (public schema) and
`members receive game channel`, `members track presence`, `members send drafts` (realtime schema; the last one only lets members of a game broadcast on that game's channel: it carries the live preview of tentative tiles, which is a hint and never changes game state). `members track presence` is also the fallback transport for the live preview, so it must exist; `members send drafts` adds the fast path and is optional (without it the preview still works over presence). `game_private` and `game_actions` must have **no** policies — the pending first-turn draw lives in `game_private.draw` for exactly that reason.

## 8. Realtime
1. **Realtime → Settings**: make sure **"Allow public access"** is **OFF** (so only authorised private channels work; the game uses private channels `game:<id>`).
2. Nothing else: the migration installs a trigger that calls `realtime.send(...)` after each committed revision, and the RLS policies above authorise members.

## 9. Deploy the Edge Function and set its secret
```bash
supabase secrets set ALLOWED_ORIGIN=https://YOUR-SITE.vercel.app
supabase functions deploy eas-game
```
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the function by Supabase itself. You never copy the service-role key anywhere.
There is **no dictionary** to host: words are judged by the players (Tahkim), so the function needs no `ASSET_BASE_URL` and no site assets.
The function code imports `supabase/functions/_shared/game/*`, a generated mirror of `js/config.js`, `js/modes.js` and `js/rules.js`. After changing any of
those three, run `node tools/sync-edge-shared.mjs` and redeploy the function (the test-suite fails if the mirror is stale).

## 10. Vercel
1. Vercel → your project → **Settings → Environment Variables**: add `SUPABASE_URL` and `SUPABASE_ANON_KEY` (Production + Preview). Nothing else.
2. **Settings → Build & Development**: Framework Preset **Other**; Build Command `node tools/write-env.mjs && node tools/stamp-sw.mjs`; Output Directory `.` (the repository's `vercel.json` already says this).
3. **Deployments → Redeploy** (env variables only apply to new builds).

## 11. Test with two devices
1. Device A (phone, mobile data): open the site → **ONLINE** → nickname → **إنشاء غرفة**. Note the 6-character code.
2. Device B (laptop, home Wi-Fi: a different network is fine): open the site → **ONLINE** → nickname → type the code → **انضمام**.
3. B presses **أنا جاهز**; A presses **ابدأ المباراة** (A can also use **مشاركة رابط**). Each device shows only its own tiles.
4. Play a few moves, one pass, one swap. Refresh A's page mid-game: it returns to the same match. Switch B to airplane mode for ten seconds: A sees B as "غير متصل", B recovers by itself.
5. Abandon claim: close B's tab while it is B's turn. A sees "بانتظار عودته…" with a countdown; after 3 minutes the button **إنهاء المباراة والفوز** becomes active and ends the match in A's favour.
6. Share link variant: `https://YOUR-SITE.vercel.app/?room=K7Q4P2` opens the join screen with the code filled in.

Optional, recommended: **Database → Extensions → pg_cron → enable**, then run migration 03's last block once more (or `select cron.schedule('eas-cleanup-stale-games','17 * * * *','select public.eas_cleanup_stale_games()');`) to clean up stale rooms hourly.

## 12. Upgrading an existing project to this build
`supabase db push` applies migration `20261031000004_eas_v5_no_validator_abandon.sql` (turns the legacy `validator_mode` column off for every room, new rooms default to off). Then redeploy the function (`supabase functions deploy eas-game`) and redeploy the site. You may delete the old `ASSET_BASE_URL` secret (`supabase secrets unset ASSET_BASE_URL`). Do not deploy the new site before the function: the new page sends `heartbeat`, which an old function answers with `BAD_REQUEST` (harmless, but the abandon claim needs the new function).

## 12b. Upgrading from v5 to v5.1 (pause, undo with approval, live preview)
Order matters: **1.** `supabase db push` (migration `…05_eas_v5_1_pause_undo_live.sql`), **2.** `supabase functions deploy eas-game`, **3.** deploy the site. The new page asks for `games.ext` fields that only the new function writes; an old page keeps working with the new function (it just does not show the new buttons). If the migration was skipped, creating a room answers *"قاعدة البيانات غير جاهزة…"* instead of a generic error. The page `pwa-check.html` (also linked from Settings → التطبيق) tests the install conditions, the Supabase URL/key and whether the function is deployed.

## 12c. Upgrading from v5.1 to v5.2 (first-turn draw)
Order matters: **1.** `supabase db push` (migration `…06_eas_v5_2_first_turn_draw.sql`), **2.** `supabase functions deploy eas-game`, **3.** deploy the site. `start_game` now answers **`status: drawing`** and both players must press **اسحب** once before the racks are dealt. An old function with the new page fails at start (DB_NOT_READY / BAD_REQUEST); a new function with an old page starts a game the old page does not know how to draw, so update all three together. Rooms left in `drawing` are cleaned up like stale lobbies after 2 hours.

## 13. Common problems
| Symptom | Cause / fix |
|---|---|
| "اللعب عبر الإنترنت غير مُهيَّأ" | Vercel env vars missing or you did not redeploy after adding them. Check `js/online/env.js` in the deployed site is non-empty. |
| A specific message (anonymous sign-ins off / wrong key / function not deployed / project paused) | Since v5.1 the lobby names the exact cause and shows the technical line under it (see `explain()` in `js/online/supabase-backend.js`). Older message: |
| "تعذّر الاتصال بخدمة اللعب" right away | Anonymous sign-ins disabled (step 4), wrong URL/key, or the function is not deployed (`supabase functions list`). Open the browser console → Network → look at the `auth/v1/signup` and `functions/v1/eas-game` calls. |
| CORS error on `eas-game` | `ALLOWED_ORIGIN` does not equal the exact site origin (no trailing slash). Re-run `supabase secrets set …` and redeploy. |
| Room created but the other player's join never appears live | Realtime private channel not authorised: re-apply migration 02; confirm the two `realtime.messages` policies exist; confirm "Allow public access" is OFF and the project's Realtime is enabled. The game still works: every 20 seconds the heartbeat notices a newer revision and fetches it, only slower. |
| "قاعدة البيانات غير جاهزة" | A migration is missing: run `supabase db push` against the right project (`supabase link`). Since v5.2 this is also what starting a match says without migration 06. |
| Live preview (dashed tiles) never appears, everything else works | The host switched "عرض القطع" off in the waiting room, or the player turned off the eye switch on the match bar. If both are on and it still fails: check that the `members track presence` policy exists (the fallback transport) and, for the faster broadcast path, migration 05's `members send drafts`. |
| The draw never finishes / no “من يبدأ” screen after the host starts | Migration 06 is missing (the room stays `lobby`), or the page is an old cached version: reload once and check the update bar. |
| One player sees the other's drawn tile before both have drawn | Impossible by design: the pending values are in `game_private.draw`, not in the public snapshot; verify no custom query exposes `game_private`. |
| `ROOM_CODE_TAKEN` / `STALE_REVISION` in logs | Normal and handled (retry / resync). |
| "الجلسة منتهية" | The browser's anonymous identity was lost (site data cleared). The old seat cannot be reclaimed; start a new room. |
| Everything works locally, nothing online after deploy | `supabase db push` not run, or run against the wrong project (`supabase link` again). |

## Stale rooms: what happens
Lobby or first-turn draw idle > 2 h → abandoned. Active/Tahkim idle > 24 h → abandoned. Finished/abandoned > 7 days → deleted with all its rows. Runs hourly if pg_cron is enabled; otherwise call `select public.eas_cleanup_stale_games();` from the SQL editor now and then (or never: it only saves space).
Anonymous auth users are not deleted by this; Supabase documents periodic cleanup of old anonymous users.
