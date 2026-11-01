# Arabic Scrabble Integrated Version

A two-player, local Arabic Scrabble game that runs entirely in the browser.

This project evolved from the original repository, [DAXEI08/update-version](https://github.com/DAXEI08/update-version), and merges its two Arabic tile-set variants into one shared game engine, with a selectable visual theme system on top.

> **One game engine, one ruleset, two tile sets, multiple visual themes.**

## Online play (Supabase)

Two players on two devices can play the same match: **ONLINE** on the cover → nickname → create a room (a 6-character code and a share link) or join with a code. The server (a Supabase Edge Function plus Postgres) is the referee: it deals the tiles, checks legality, scores, keeps the clock and settles the end; the page only draws what the server says and sends requests. Local play is unchanged and never loads the online code.

- **One client, two transports.** The online layer is an adapter (`js/online/`) over the same UI and rules as local play. `js/rules.js` is the single definition of legality, scoring and the final score, and is mirrored into the Edge Function by `node tools/sync-edge-shared.mjs`, so a local game and an online game can never disagree.
- **Words are judged by the players**, exactly as locally: Tahkim (صحيح / خطأ) is the only word judgment. There is no dictionary on the server or in the browser.
- **Lobby:** full-screen steps with a waiting room (both seats, ready state, host rules). A `?room=CODE` link opens the join screen with the code filled in.
- **During a match:** a bar shows connection state, whose ruling or return is awaited, and the resign/leave button. The last move's tiles carry a small corner mark and the scored words light up on both screens. The result card is the same one local play shows, filled from the server's settlement, with a rematch request that is also visible on the card.
- **Disconnections:** a heartbeat every 20 s keeps the server informed. If the player the match is waiting for stays silent for 3 minutes, the other player gets a countdown and then a button to end the match in their favour (the server re-checks).
- **Setup:** `docs/ONLINE_MULTIPLAYER_SETUP.md` (from zero) and `docs/ONLINE_ARCHITECTURE.md` (design, state split, security). The six SQL migrations (`20261024000001`…`20261102000006`) create everything; `20261101000005` adds pause/undo/live and `20261102000006` adds the first-turn draw.

## v5.2: first-turn draw, unlimited undo, rack display, pause card, live switch
- **First-turn draw (both modes).** Each player draws one tile; the higher value starts and a tie draws again, as in real Scrabble. Local play shows two face-down cards and reveals both together after both players have drawn; online the server runs the draw (`status: drawing`), keeps the pending values private, and deals the racks only after both are in. A rematch draws again. Animations are one card flip and one glow on the winner; reduce motion shows the values without animation. Settings → **اللعب → سحب البداية (محلي)** can turn the local draw off.
- **Unlimited undo (local).** One snapshot per committed action (move, pass, swap) is kept, so Undo can be pressed again and again — player 1 moves, player 2 moves, then two undos take both back. The stack is saved with the match (old saves still load). Online is unchanged: undo is a request the opponent approves, and the mover can withdraw it.
- **A visible undo request (online).** The opponent gets a dedicated banner at the top of the screen (mover, score, **موافقة / رفض**), independent of every dialog and rebuilt after a refresh. It cannot be hidden behind the board or another window.
- **Rack display (local).** Settings → **اللعب → عرض الرفوف**: both racks always visible (default), or only the rack of the player whose turn it is. The waiting tray keeps its box (nothing moves) but its tiles are hidden and the tray is inert.
- **Pause, both modes.** One full-screen pause card: who paused, how long the game has been stopped, and the resume action. Online it also counts down the other player's wait; local play gets its own **إيقاف مؤقت** button (unlimited, one shared screen). Board and racks are hidden while paused, so a pause cannot be used to think for free.
- **Live draft switch (online).** The match bar has an eye switch for the live preview of tentative tiles. It is on by default (when the host allows it), remembered per device, and instantly shows the opponent's current draft when switched back on. Drafts now travel over both a broadcast and the player's presence, so a missing realtime broadcast policy can no longer make the feature look dead. The waiting room states the current rule and disables its buttons while saving.
- **Migration:** `supabase/migrations/20261102000006_eas_v5_2_first_turn_draw.sql` (status `drawing`, private pending draw, updated commit/cleanup). Details in `docs/V5_2_BUILD_REPORT.md`.

## v5.1: pause, undo with approval, live preview, word rules, diagnostics
- **Undo with the opponent's approval** (online). The player who has just moved can press *Undo* to ask; the other player gets Accept / Decline. Accepting restores board, racks, bag and scores and gives the turn back (clocks are kept; the responder's thinking time is charged). A decline is final for that move; withdrawing, or the opponent playing / passing / swapping / challenging, cancels the request. The move stays in the history, marked void. Tahkim is unchanged and still the way to rule on a word.
- **Pause** (online). Either player can stop both clocks: 2 pauses each, 3 minutes at most (`PAUSES_EACH`, `PAUSE_MS` in `js/config.js`); the other player can resume once the time is up, and any action after it resumes automatically. Board and racks are hidden while paused, so a pause cannot be used to think for free.
- **Live preview.** The player on turn's tentative tiles appear to the opponent as dashed ghost tiles (a broadcast "draft": squares and letters only, bound to the revision, validated and bounded on receipt, never read by the server). The host can switch it off in the waiting room (rule *عرض القطع التي تجرّبها للخصم مباشرةً*).
- **Word rules** (`js/wordrules.js`): the rules of which words may be played, in Arabic with an Indonesian line per rule, in **Settings → قواعد الكلمات**, one tap away inside every **Tahkim** dialog, and in the **waiting room** (so both players agree before starting).
- **Setup errors say what to fix**: anonymous sign-ins off, wrong key, unreachable/paused project, function not deployed, missing migration, library failed to load. `pwa-check.html` (Settings → التطبيق) checks install conditions, the service worker and cache, and the Supabase project and function.
- **Parity tests** (`tests/online/parity.mjs`): the server's shared modules are byte-identical to `js/`; random positions through `submit_move` give the same validity, error text, words and score as `js/rules.js` and as an independent scorer; every tile is accounted for after every action of random whole games; the end-of-game settlement equals `settleEnd`.

## Features

- Two-player local Arabic Scrabble on the classic 15×15 board
- **First-turn draw**: each player draws a tile, the highest value starts (a tie draws again), with a short card animation
- **Expanded** and **Basic** tile modes (chosen when a game starts)
- Selectable visual themes, applied instantly and remembered on the device
- Per-player timer (the clock starts after the first move)
- **Unlimited undo** of the last committed action in local play (moves, passes and swaps)
- **Pause** in local play with a prominent full-screen card; the clock is frozen and the board hidden
- **Rack display**: both racks always visible, or only the player on turn's rack
- Tile swap
- **Unlimited pass**: there is no pass or skip limit
- Human **tahkim** (judging): the challenger rules the last move **✔ صحيح** or **✖ خطأ**
- Move history with words, scores, bingos, passes, swaps and tahkim verdicts, with a show/hide toggle (إخفاء السجل / إظهار السجل) that never moves the racks, buttons or board
- Blank tiles (always worth 0)
- **Player names**: rename either player (press and hold, double-click or Enter on the name; or Settings → اللاعبون). Saved on the device
- **Word flash**: the words a move just scored light up letter by letter in reading order
- **Touch vibration** on phones and tablets, with an off switch in Settings; **fullscreen** from Settings in every layout
- Responsive layout for desktop, tablet and mobile, portrait and landscape
- Optional **Floating Workspace**: move and resize the board, player panels, controls and word log directly (no size sliders in Settings)
- **Installable, offline-capable PWA** (Android, iPhone/iPad, desktop) and **automatic match recovery** after a refresh, close or suspension (see "PWA" below)

There is no automatic dictionary: word validity is decided only by the players through tahkim.

## Modes

Both modes use the same engine, gameplay, board, scoring, timer, tahkim, UI, and features. **The only difference is the tile distribution and the blank-tile alphabet.**

| Mode | Arabic label | Tiles | Blank tile can become |
|---|---|---|---|
| Expanded | الحروف الموسعة | the 28 basic letters plus `أ إ آ ء ؤ ئ ة ى` (101 tiles incl. 2 blanks) | any of those 36 letters |
| Basic | الحروف الأساسية | the 28 basic letters only (84 tiles incl. 2 blanks) | only the 28 basic letters |

- The mode is picked at game setup: **PLAY → tile mode → duration → confirmation → first-turn draw → game**. It cannot change while a game is running; **New game** goes back through mode selection.
- The first player is not fixed: after the confirmation each player draws one tile (the highest value starts; a tie draws again). The drawn tiles go back into the bag, and the racks are dealt after the draw.
- Tiles are never normalised (`أ` stays `أ`, `ة` stays `ة`, …). The letter `ه` is stored as plain `ه`; the `هـ` face on the tile is display-only (`FACE` in `config.js`).
- Both tile sets, their values and counts, and the blank alphabets live in `js/modes.js` as plain data. The engine just reads `TILE_MODES[app.mode]`.

## Themes

Themes only change presentation. They never affect the mode, tile distribution, scoring, timer, tahkim, board coordinates, placement, game state, history or layout. Choose one in **الإعدادات → المظهر**; it applies immediately without reloading and never resets the game.

| Theme | Arabic | Character |
|---|---|---|
| Classic | كلاسيكي | wood tones, cream tiles, dark green lettering (default) |
| Dark | داكن | charcoal panels, high-contrast light tiles, amber accents |
| Emerald | زمردي | emerald green, cream and gold |
| Desert | صحراوي | a light theme: sand, terracotta, warm brown, ivory, muted gold |

The selected theme is stored in `localStorage` under `scrabble.theme`. If the value is missing, unreadable, or not a known theme id, the game falls back to Classic. Interface dimensions are stored separately under `scrabble.dims`, so resetting one never affects the other.

### How themes work

`js/themes.js` only sets `<html data-theme="id">`. All colours are CSS custom properties defined once per theme in `css/themes.css`; there is no per-element styling from JavaScript and no duplicated stylesheet. To add a theme, add a block in `themes.css` that defines every token, and an entry in `THEMES` in `themes.js`.

## Tile effects and result screen

- **Touch highlight, not a permanent glow.** A picked tile flickers (a 1 Hz colour pulse on its ring). It does so on every device, including when the OS asks to reduce motion: it is feedback, involves no movement, and `prefers-reduced-motion` still switches off every other animation and transition. Once placed, a tile has no glow and no coloured outline: an unscored (pending) tile is told apart by a golden tint and a lifted shadow, a scored one by plain ivory and a tight shadow. `tests/contrast.py` checks that the tint stays clearly different from a scored tile and that letters stay readable on it.
- **Dynamic cast shadow.** Every tile on the board casts a shadow from its square (`.sq.has::before`, sized in container units so it scales with the board). It reacts to state: tight and dark at rest, shifted down and softer while the tile is pending (it "hovers"), and it converges from far and faint when a tile lands (`.fall`). Only `transform` and `opacity` are animated, so nothing is repainted; reduced-motion users get none of the animation.
- **Game length** is a single row of five choices (number over "دقيقة"); the length in use is outlined.
- **End of game** shows a centred announcement: the reason, the winner (or a draw), and one score card per player with the tile deduction and time bonus. The winner's card is outlined; a compact variant is used on short landscape screens so nothing scrolls.

## History toggle

The history panel has a small button in its corner: **إخفاء السجل** (hide) / **إظهار السجل** (show).

- **Strict layout stability.** The panel keeps its exact size, grid area and border width. Hiding only makes its surface and contents invisible (the `history-hidden` class); the element is never removed or `display:none`, and no grid rule changes. The racks, player panels, buttons and board stay exactly where they are in portrait and landscape.
- **The history keeps recording** while hidden, and shows the latest entries immediately when revealed.
- The button is a native `<button>` (Enter / Space) with `aria-expanded`; it stays visible and clickable while the content is hidden.
- The choice is a device preference stored in `localStorage` under `scrabble.historyVisible` (default: visible; a missing, invalid or unreadable value means visible). It is separate from `scrabble.theme` and `scrabble.dims`.
- Known limit: with the history text set to its maximum (160%) in a very narrow history column in tight landscape layouts, the title can wrap under the button.

## Messages, dialogue and Floating Workspace

Architecture in one line each: the **default layout** is stable, responsive CSS (nothing in Settings resizes it); **messages** always float; the **gameplay dialogue** is always floating and adjustable; **Floating Workspace** (الوضع العائم) is the only place where users move and resize the major modules, by direct manipulation. Settings only choose behaviour and presentation (theme, layout, button style, history mode, the workspace on/off switch); the old الأبعاد sliders are gone and a stale `scrabble.dims` value is deleted at start-up so it can never shrink the default board.

**Always on, with the workspace OFF or ON** (`css/float.css`, parts 1a/1b)
- `#toast` is a fixed top-centre overlay (safe-area aware, wraps, theme colours, no pointer events). It owns no layout row and takes no space while empty, so a message can never push the board, panels, controls or history.
- In-game confirmations (new game, undo, resume prompt after the match has started) use `#dlg` as a light floating panel (~92 % opaque, restrained blur) placed on the free corner/edge that hides the least of the board, racks and controls. It is draggable by its title, **width-resizable** with its corner grip (260 px to 560 px or the viewport, height follows the content), kept inside the viewport, Esc closes it, double-click on the title resets it. Its geometry `[x, y, w]` lives in `scrabble.float`; width is stored only once the user has chosen one. The game behind stays frozen (`lockGame('dlg')` makes `.app` inert and the clock is paused). The end-of-game result and every setup dialog (cover, mode, duration, blank letter, install help, judge) remain conventional modals.
- Layers: workspace modules 10-19 < settings / open word log 30+ < toast 45 < dialogue 50 < native modals (top layer) < PWA notices.

**Floating Workspace**, OFF by default. While OFF nothing is floating: no handles, no inline geometry, the Classic/Duel layouts and history drawer/docked modes are authoritative. Turning it ON sets `<html data-floating="true">` (all its rules are scoped to that attribute) and lets you move and resize **the board** (always 1:1, real width through `--float-board-size`, never `transform: scale`), **each player panel**, **the controls** (one palette, buttons reflow) and **the word log**.

**Vertical fit (player panels, Turn Controls, Game Tools).** These modules resize on both axes. Until the height is dragged it simply follows the content, exactly as before. Once it is set (the module is *pinned*, `data-vfit`), the content adapts to the box: a **rack** re-flows into the row count that gives the biggest square tiles (7 / 4+3 / 3+2+2 / 2+2+2+1 / 1×7, short rows centred) and its tray fills the panel; **buttons** re-flow into the column count with the roomiest cells, every cell the same size (the confirm ✓ button is one ordinary cell), and type and icons scale with the cell. Keyboard: on the grip, ←/→ change the width, ↑/↓ the height. Dragging the height back to within 10 px of the automatic height snaps it back to automatic (a light haptic tick on touch devices); **Home** on the grip does the same from the keyboard; double-click on a handle un-pins the height *and* restores the default position. The row/column choice is sticky (a new layout must be 6% better to replace the one in use), so nothing flickers while you resize. A stored height is only written once pinned (`h` in `scrabble.floatWorkspace.v2`); older saved layouts keep working.
- **Move** by dragging the top edge of a module; the strip is invisible (no lines, no icon), it only shows a move cursor and a focus ring. **Resize** with the small corner grip. Dragging tiles, pressing buttons or scrolling the log never moves a module. Keyboard: arrow keys on a focused strip move (Shift = bigger), `+` / `-` resize, arrow keys on a focused grip resize, double-click resets one module.
- **Geometry** is saved per orientation in `scrabble.floatWorkspace.v2` (`{v:2, enabled, portrait:{…}, landscape:{…}}`). Only user overrides are stored; the rest is computed from the viewport, the Classic/Duel/swap/panel-height preferences and the rendered modules, so rotation and window resizing re-clamp (safe-area aware) without erasing the arrangement. Nothing is written during a drag. **إعادة ضبط العناصر العائمة** deletes the overrides and the popup positions; theme, scores, clocks, history and layout are untouched. Turning the mode OFF removes the attribute, handles and inline geometry at once: no reload, no restart.
- **Primary action**: `#bSubmit` is a checkmark only in every button style (the words احتساب / تأكيد التبديل (n) remain in its `aria-label` and tooltip).
- Code: `js/float.js` (one engine for popups and modules), `js/layout.js`, `js/ui.js` (`ask()`, input lock), `css/float.css`. Game rules, scoring, clocks and board input are untouched.
- Tests: `tests/layout/floating.mjs`.

## Player names, word flash, touch feedback

**Player names** (`js/names.js`, `js/nameedit.js`). A name is a device preference, like the theme and the layout: it changes how a player is *shown* (panels, rack label, history, toasts, tahkim dialogue, result, resume prompt), never a rule, score or clock. It is not stored inside a saved match.
- In place: **press and hold** the name for half a second (a line fills under it), **double-click** it, or focus it and press **Enter / F2 / Space**. Enter or leaving the field keeps the name, **Esc** discards. The field takes over the label's exact row, so nothing around it moves. The clock of the player on turn is frozen while the field is open.
- In Settings (**اللاعبون**): two fields applied as you type, so the panels behind the sheet follow. This route is also the most reliable on touch (see limitations).
- Rules: up to 16 characters (counted as user-perceived characters, so Arabic marks are never cut off a letter); empty = the original name; a name already used by the other player (ignoring case and Arabic marks) is refused; control, zero-width and direction-override characters are removed. Names go through `esc()` wherever they enter HTML and are wrapped in `<bdi>` / direction isolates so a Latin name never scrambles the Arabic around it.
- Stored as `scrabble.names = {v:1, n:[name|null, name|null]}`: only overrides; missing, corrupted or duplicate values fall back to the defaults.

**Word flash** (`js/flash.js`, `.sq.wf` in `css/style.css`). After a scored move, every word it formed (the new word and each word it crossed) flashes square by square. There is no overlay to position: a board square is `#board.children[r * 15 + c]`, so the highlight scales and moves with the board (Floating Workspace included). Reading order comes from the data (horizontal words run right to left because the board is RTL, vertical words top to bottom); a square shared by two words lights up with the first one to reach it. One opacity pulse on the square's `::after`; Undo and a tahkim ✖ stop it. With *reduce motion* the words are simply held highlighted for about a second, with no sequence.

**Turn dot**. The player on turn has a small green dot before the name (fixed size, so it never changes a panel or rack), breathing softly; still with reduce motion.

**Touch vibration** (`js/haptics.js`). A short tick on every touch/pen press of a button, tile, square or rack slot; distinct patterns for a scored move, a bingo, a refused move or hint, and the end of the game. Nothing happens for a mouse or before the first touch. Android browsers use `navigator.vibrate`; iPhone/iPad Safari has no Vibration API, so a best-effort switch-control haptic (iOS 18+) gives a single tick there where supported. The switch (الاهتزاز عند اللمس) appears in Settings only on touch devices. Stored as `scrabble.haptics` (`off` when switched off).

**Fullscreen**. The Game Tools button still exists in the Floating Workspace; Settings → التطبيق now also has a **ملء الشاشة** button, so the default layout can enter fullscreen too. Both hide themselves where the API does not exist (iPhone Safari) or the app already runs fullscreen.

## Layout (الإعدادات → التخطيط)

Device preferences stored in `localStorage` under `scrabble.layout`; they only set `data-layout`, `data-swap` and `data-hist` on `<html>` (`js/layout.js`).

- **التخطيط**: *كلاسيكي* (original) or *مواجهة* (player panels on either side of the board, buttons underneath). Short landscape phones always use the classic arrangement.
- **موضع اللاعب الأول**: left or right (duel only).
- **ارتفاع لوحات اللاعبين**: top / middle / bottom (default) position of the two panels beside the board (duel only). In duel on landscape screens (≥700×560) the board is sized from the real vertical overhead, so everything fits the viewport without scrolling.
- **أزرار التحكم**: icons only (default; labels remain for screen readers and as tooltips, تأكيد/احتساب keeps its text), icon over label, or the original text. Icons are inline SVG using `currentColor`, mirrored where direction matters (RTL). Icon-only mode needs one button row instead of two, which the duel board-size budget accounts for.
- **Floating windows** (`js/float.js`): the settings panel (non-modal, game frozen behind it) and the word-log drawer are draggable windows with identical behaviour: drag the title, or focus it and use the arrow keys (Shift = larger step); double-click the title or use *إعادة مواضع النوافذ العائمة* to reset. Positions are clamped to the viewport and remembered per device. Esc closes either window.
- **سجل الكلمات**: *عند الطلب* (default) keeps the log out of the layout and opens it as a drawer from a small icon button in the bottom corner of the board, on the end side of the bag counter (close with the same button or Esc; the label stays available to screen readers and as a tooltip); *مثبّت* keeps the original always-visible panel with its hide/show toggle.
- **شريط معلومات اللوح**: *مخفي* (default) or *ظاهر*. The line under the board (mode · bag count, e.g. «الحروف الموسّعة · الكيس: 84») no longer takes a row of the layout, so the board can use the room (about 28 px more height on height-limited screens). The information is not gone:
  - the **bag count is a badge on the swap button**, the one action it limits: muted while swapping is easy, accent when 7 or fewer tiles are left, struck through below 7 (swapping needs 7); the button's tooltip and accessible name carry the count and say when swapping is over;
  - the **mode and count are the first line of the word log**;
  - the move that takes the bag down to 7 or fewer says so in its toast («بقي 7 قطع في الكيس»), and so does the one that empties it («نفد الكيس»);
  - the bar itself stays in the page as text for screen readers (visually clipped, still in `#bagInfo`); choosing *ظاهر* brings it back, and then the badge, the log line and the toast notes are hidden so nothing is said twice.
  With the bar shown the layout is pixel-identical to before: the board-size formulas reserve its room through `--bagx` / `--bagxl` (97 + 28 = 125, 32 + 28 = 60, 9 + 21 = 30, 88 + 28 = 116), which are 0 when it is hidden.

### Settings → اللعب (local play)

These never reach the online game (the opponent's rack is already hidden there, and the server decides the first turn).

- **عرض الرفوف**: *دائمًا ظاهرة* (default) or *رفّ صاحب الدور فقط*. In the second mode the waiting player's tray keeps its exact box — nothing moves when the turn passes — but its tiles are hidden and the tray is `inert` (not readable, focusable or clickable), with a line saying why. Stored as `racks` in `scrabble.layout`.
- **سحب البداية (محلي)**: on (default) or off. On = each player draws a tile before play to decide who starts; off = seat 0 starts directly. Stored separately under `scrabble.draw` (`off` only), like the haptics switch.

The local **إيقاف مؤقت** button sits with the turn controls (online has its own pause in the match bar, and the local button is hidden there). It uses the same full-screen card for both modes.

Note: `tests/layout/history-toggle*.mjs` exercise the docked log, so the test helper `openGame` presets `scrabble.layout` to `{"hist":"docked","binfo":"on"}` (the old layout, bar shown: it doubles as the proof above) and turns the first-turn draw off (`scrabble.draw: off`) so the geometry is deterministic; `layout/log-icon.mjs` covers the default drawer. The draw itself is covered by `logic/draw.mjs` and the two-browser run.

## PWA: install, offline play, match recovery

The game is an installable Progressive Web App. It is still plain static files: no build step, no backend, no framework.

### Two separate features (do not confuse them)

| Feature | What it stores | Where | Code |
|---|---|---|---|
| **Offline app cache** | the game's own files (HTML, CSS, JS, fonts, icons) | Cache Storage, filled by the service worker | `sw.js`, `js/pwa.js` |
| **Match recovery** | the running match (board, racks, bag, scores, clocks, history, undo) | `localStorage` key `scrabble.match` | `js/persist.js` |

Offline use is only promised after the first successful online visit has finished downloading the files: Settings → التطبيق shows "جاهزة للعمل دون إنترنت" only once the service worker has installed (its install step downloads every file or fails as a whole).

### Files

```
manifest.webmanifest      name, icons, display: standalone, start_url "./", scope "./"
sw.js                     service worker (precache list, versioned cache, fetch strategy)
js/pwa.js                 registration, update bar, install UI, offline status, theme-color sync
js/persist.js             match save / validate / restore, resume prompt, pause-while-hidden
css/pwa.css               install suggestion, update bar, iOS guide, standalone touch hardening
assets/icons/             icon-192, icon-512, maskable-512, apple-touch-icon (180), favicon-32 (PNG)
tools/stamp-sw.mjs        writes the cache version into sw.js (run before every deploy)
tools/make-icons.mjs      dev-only: re-renders the PNG icons from tools/icon-source.html
.nojekyll                 tells GitHub Pages not to run Jekyll over the files
```

`id` is deliberately omitted from the manifest: it then defaults to `start_url`, which is already unique per deployment path. A fixed `id` would be resolved against the origin and could collide with other apps on the same `github.io` host. Add `"id": "/your-repo/"` only if you want to pin the identity to one known URL.

### Caching strategy

All URLs are relative and resolved against the service worker's scope (`self.registration.scope`), so the same files work at a domain root and under `https://user.github.io/repo/`.

- **install**: every file in `PRECACHE` is fetched with `cache: 'reload'` (never from a stale HTTP cache) into one versioned cache `arabic-scrabble-shell-<hash>`. If any file fails, the install fails, the partial cache is deleted and the previous version keeps serving. A half-downloaded version can never go live.
- **activate**: all older `arabic-scrabble-*` caches are deleted and open pages are claimed.
- **fetch**: app files come from the versioned cache only, so versions are never mixed. Navigations to the game (also with a query string) get the cached `index.html`. Other same-origin GET requests are network-first with a runtime-cache fallback; failed or non-basic responses are never stored; an unavailable file answers 503 instead of a fake success. Other origins, non-GET and `Range` requests are not touched.
- **update**: a new worker installs in the background and *waits*. The game shows "يتوفر إصدار أحدث" with **تحديث الآن** / **لاحقًا**; only on agreement does the page tell the worker to take over and reload. A match in progress is saved continuously, so it is offered again after the reload. Updates are checked on load and when the app returns to the foreground (at most every 15 minutes).
- **version**: `VERSION` in `sw.js` is a content hash of every precached file, written by `node tools/stamp-sw.mjs`. Browsers only re-install the worker when `sw.js` changes, so **you must stamp after changing any game file** (`--check` fails when it is stale; `tests/pwa/static.mjs` runs that check).

### Match recovery

- Saved (debounced, ~250 ms after each change, and always when the app is hidden or closed): mode, clock lengths and remaining times, board, racks, bag, scores, whose turn, blank letters, the unsubmitted move, undo snapshot, history (including tahkim verdicts).
- Not saved: settings (they have their own keys and are never touched), an open dialog, an in-progress tile *swap* selection, a finished game, a game with no move yet.
- On start-up, **PLAY** offers *متابعة* / *مباراة جديدة* when a valid save exists. Choosing a new game does not delete the old match until the new game really starts.
- A save is used only if it is completely consistent (every tile exactly once, sane clocks, words made only of Arabic letters, current tile data). Anything else (corrupted, tampered, from an incompatible version) is discarded and the game starts normally. Storage that is unavailable or full simply means no recovery.
- **Clocks pause while the app is in the background** (screen locked, app switched, tab hidden) and resume when it returns, so a phone call does not cost a player their time. This is the one behaviour change; set `PAUSE_CLOCK_WHEN_HIDDEN = false` in `js/persist.js` to restore the old behaviour.
- Two windows playing at once on the same device would overwrite each other's save (last writer wins).

### Deploying to GitHub Pages

1. `node tools/stamp-sw.mjs` (needs Node 18+; only the version stamp, nothing is built) and commit the result.
2. Push to GitHub. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`, **Save**.
3. Open `https://<user>.github.io/<repo>/` (HTTPS is provided by GitHub). Wait for the status line in Settings to say the game is ready for offline use, then test with airplane mode.
4. Every later change: edit, `node tools/stamp-sw.mjs`, commit, push. Players get the update bar on their next visit.

If you add or remove a file the game loads, update `PRECACHE` in `sw.js` (the static test lists any shipped file that is missing from it). Vercel, Netlify and any other static host work the same way, at the root or under a path.

### Installing

- **Android (Chrome, Edge, Samsung Internet)**: open the site; use the **تثبيت** button on the start screen or **الإعدادات → التطبيق → تثبيت التطبيق**, or the browser menu **⋮ → Install app / Add to Home screen**. The in-game buttons only appear when the browser has offered installation.
- **Desktop Chrome / Edge**: same buttons, or the install icon in the address bar.
- **iPhone and iPad (Safari)**: iOS has no install prompt. Tap **Share** (square with an up arrow; bottom bar on iPhone, top of the screen on iPad, sometimes inside **⋯**) → **Add to Home Screen** (under **View More** on some versions) → leave **Open as Web App** on if it is shown → **Add**. The app opens full screen from the new icon. The start screen shows a **طريقة التثبيت** button with these steps only on iOS/iPadOS in a browser tab; it is detected through `navigator.standalone`, not the user agent. The installed iOS app keeps its own storage, separate from Safari.
- The suggestion on the start screen can be dismissed (it stays away for 30 days); the entry in Settings remains. Nothing claims the app is installed unless it is actually running as an installed app.

### Known limitations

- Install flows on real Android and iOS devices, real GitHub Pages HTTPS, and Safari service-worker behaviour were not tested by the author of this change; see the test notes below for what was.
- iOS may evict a website's storage after a period of non-use; an app added to the Home Screen is not subject to that, a Safari tab can be.
- Vibration and in-place name editing were verified in desktop Chromium (touch emulation, a stubbed `navigator.vibrate`), not on real phones. iOS Safari only opens the keyboard for a field focused directly from a tap, so after a long press on iPhone the field may need one more tap before the keyboard appears; Settings → اللاعبون always works. The iOS haptic is best-effort and iOS 18+ only.
- Offline caching covers the app itself; there is nothing online to sync, so no background sync or push is used.
- The online first-turn draw needs migration `20261102000006`. Without it, `start_game` answers "قاعدة البيانات غير جاهزة" (the new status and the private draw column do not exist). The live-preview broadcast path also needs migration `20261101000005`, but its presence path keeps drafts working without it.
- The local first-turn draw is a timed animation (about 4 s from the second card); the module suites run it with the draw switched off where a deterministic layout matters, and with real timers in `logic/draw.mjs`.

## Technology

HTML, CSS, vanilla JavaScript (ES Modules). No framework, no build step, no dependencies, no audio subsystem. Fonts (Amiri for Arabic, Tinos for Latin and digits) are bundled locally.

## Running

ES modules need to be served over HTTP (opening `index.html` from `file://` is blocked by browsers). From the project folder:

```sh
python3 -m http.server 8000
```

then open <http://localhost:8000>. Any static host (GitHub Pages, Netlify, …) works as-is.

## Folder structure

```
index.html
README.md

css/
  style.css       layout and components (colours come from theme tokens)
  cover.css       cover screen
  pwa.css         install suggestion, update bar, iOS guide
  themes.css      theme palettes (CSS custom properties)

js/
  config.js       global constants: board size, durations, premium layout, glyph/label maps
  modes.js        Expanded and Basic tile data, blank alphabets, mode metadata
  themes.js       theme metadata, load/save/apply, theme selector
  histview.js     history show/hide toggle and its saved preference
  state.js        game state, tile bag, undo stack, snapshots (tahkim)
  game.js         turns, placement, submit, unlimited undo, pause, swap, pass, game over
  scoring.js      word finding and scoring
  judge.js        tahkim
  ui.js           rendering and dialogs (including mode and duration selection, blank picker)
  input.js        click/tap, keyboard, drag and drop, buttons, dialog flow
  draw.js         first-turn draw: the two cards, the flip, the tie redraw (local + online)
  pause.js        the shared full-screen pause card (local + online)
  cover.js        cover screen (title in game tiles)
  main.js         start-up
  persist.js      match save / restore / resume prompt, pause-while-hidden
  names.js        player names: defaults, cleaning, duplicates, escaping, storage (no DOM)
  nameedit.js     editing names in place and in Settings
  flash.js        word flash after a scored move
  haptics.js      touch vibration and its Settings switch
  pwa.js          service-worker registration, update bar, install UI

tests/            dev-only tests (not needed to play; see "Tests")
  package.json
  run-all.mjs     runs every suite below
  contrast.py     WCAG contrast and distinctness audit of css/themes.css
  logic/
    harness.mjs   loads the real modules in jsdom
    engine.mjs    modes, scoring, blanks, undo, tahkim, pass, themes
    startup.mjs   real main.js start-up, cover, setup flow, Settings
    names.mjs     names store: cleaning, duplicates, escaping, storage, corrupted values
    features.mjs  unlimited undo stack, the pause card, the rack display preference
    draw.mjs      the timed local first-turn draw: both cards, a tie, the settings switch
    endgame.mjs   the final-score formula and rounding (pure Node)
  layout/
    lib.mjs       real-browser helpers (viewports, geometry, pixel checks)
    serve.mjs     tiny static server used by the tests
    baseline.mjs  regenerates baseline.json
    baseline.json reference layout of the docked history panel (see "Tests")
    history-toggle.mjs        bounding boxes before/after hide and show in 8 viewports
    history-toggle-extra.mjs  keyboard, persistence, obsolete scrabble.dims discarded, all themes
    feel.mjs                  names (in place + Settings), word flash, turn dot, haptics, fullscreen from Settings
    log-icon.mjs              default drawer: the word-log icon's size, corner, no overlap, open/close (2 layouts x 8 viewports)

manifest.webmanifest  PWA manifest
sw.js            service worker
tools/           stamp-sw.mjs (cache version), make-icons.mjs + icon-source.html (icon generator)

assets/
  icons/          PNG app icons
  fonts/
    Amiri-Regular.woff2
    Amiri-Bold.woff2
    Tinos-Regular.woff2
    Tinos-Bold.woff2
```

## Tests

Dev-only; the game itself has no dependencies. From the `tests/` folder:

```sh
npm install
npm test          # all suites; or: node run-all.mjs "extra.mjs b" to run one
```

Environment notes for this machine: set `CHROME_PATH` to an installed Chromium/Edge (the bundled `@sparticuz/chromium` is Linux-only), `PYTHON` to the Python executable and `PYTHONIOENCODING=utf-8` for the Python suites (Arabic output on a CP1252 console).

- `logic/*` run the real modules against jsdom (including the tile state classes behind the cast shadow, the duration picker and the end-of-game result). `logic/features.mjs` covers the unlimited undo stack, the pause card and the rack preference; `logic/draw.mjs` covers the timed local first-turn draw (both cards, a tie, the settings switch).
- `online/*` run the real Edge Function core on an in-memory store. `online/draw.mjs` covers the first-turn draw: who starts, the privacy of the pending values, a tie, leaving and the clear-after-play rule.
- `e2e/run.py` and `e2e/local.py` (Python Playwright; set `CHROME_PATH`) drive two real browsers through the real server core: the draw on start and on rematch, the undo banner accept/decline, the pause card on both screens, and the live-preview switch.
- `layout/*` drive a real Chromium (the Linux build bundled with `@sparticuz/chromium`; set `CHROME_PATH` to use your own Chrome) and compare the bounding boxes of the racks, buttons, panels, board and history before and after toggling, in portrait and landscape phone, tablet and desktop viewports. Hidden state is also checked pixel-wise, with a positive control showing that visible history would be detected.
- `pwa/static.mjs` (no browser): every theme defines every token, placed tiles have no glow, the landing shadow animates only transform/opacity; manifest and icons (real PNGs, sizes, alpha), relative-path rule, precache coverage of every shipped file and ES import, version stamp.
- `pwa/e2e.mjs` (Chromium via `playwright-core`; set `CHROME_PATH` for your own Chrome): service worker under a sub-path and at the root, Chrome's manifest/installability check, offline launch with the server actually stopped, match recovery (including an unsubmitted move, blanks, tampered saves), failed and successful updates, install UI (Android prompt, dismissal, iOS guide). It does **not** run on real devices or real HTTPS hosting.
- `layout/baseline.json` is the reference layout the docked history panel must match while visible (originally measured before the toggle existed; re-taken after the control buttons became icon-only and again after the pause button joined them). If you change the docked layout on purpose, regenerate it from a trusted checkout (see the comment in `baseline.mjs`).
- Known environment sensitivity: the pixel-residue check in `layout/history-toggle.mjs` can report a 1px full-width raster seam at the 360x640 viewport on some Chromium builds (it did on the build used while developing this change, with or without these edits). If it is the only failure, it is a screenshot artefact, not a layout regression.

## Credits

By esbepe. Evolved from [DAXEI08/update-version](https://github.com/DAXEI08/update-version).

## Floating Workspace: no size limits
In Floating Workspace every module (board, both player panels, Turn Controls, Game Tools, word log) has **no maximum size** and only a tiny floor (it can never collapse to nothing).
- Drag a module's corner grip, use the arrow keys / `+` `−` on it, or hold **Ctrl/⌘ and scroll** (or pinch on a trackpad) over it to resize around the pointer.
- Content is proportional: type, padding, buttons and tiles scale with the module (`--fu`, see `js/float.js` `setUnit` and `css/float.css`). Untouched layouts look exactly as before.
- A module larger than the screen can be panned by its strip until any edge (and its grips) is on screen; double-click the strip or grip to restore the default.
- Saved sizes keep their proportions on other window sizes. Classic/Duel layouts and the gameplay dialogue keep their original limits.

## How a game ends, and the final score

A game ends in exactly two ways: **(1)** a player's clock reaches zero (a move that was not submitted is discarded), or **(2)** a player uses every tile once the bag is empty.
**Passing and swapping are unlimited and never end the game**: a player who is ahead may keep passing to run the clock out. Words are judged by the players (tahkim); there is no dictionary.

> **Final score = score + 2 × (minutes left, rounded to the nearest minute) − value of the tiles still on the rack**

Minutes are taken from the clock as displayed (whole seconds, rounded up) and rounded to the nearest minute; exactly half a minute rounds **down**: 2:30 → 2 (bonus 4), 2:31 → 3 (bonus 6), 0:29 → 0.
There is no floor at zero: the formula is applied as stated. The result card shows each player's score, the time bonus with its working (minutes × 2) and the deduction, and names the player the ending concerns.
The rule lives in `js/config.js` (`TIME_BONUS_PER_MIN`, `REASONS`) and `js/scoring.js` (`bonusMinutes`, `finalScore`, pure and unit-tested); `js/game.js` `endGame` applies it; Settings → "نهاية اللعبة" states it to the players.

## Touch drag and drop

Mouse: the browser's native drag and drop. Touch and pen: `js/touchdrag.js` (pointer events). A tap still selects a tile and a second tap places it; a drag starts after 8 px. While dragging, a larger copy of the tile floats just above the fingertip so the hand never covers the target, the square or rack slot under the copy is outlined when the tile may land there, and releasing drops it (anywhere else puts it back). The drop targets are judged by the same functions as the mouse path, so the rules are identical. Tiles use `touch-action: none` so the browser never scrolls or zooms from them.

## Code map (`js/`)

`float.js` is the public API of the floating engine; the engine itself is split by responsibility, with no import cycles:
`float-core.js` (state, registry, z-order) → `float-fit.js` (vertical fit) → `float-geom.js` (viewport, limits, apply/commit) → `float-tools.js` (Game Tools) → `float-layout.js` (default geometry, refresh) → `float-input.js` (handles, grips, wheel) → `float-popups.js` (popups, input lock) → `float.js`.
Messages: `notice(msg)` for a result, `warn(msg)` for a refused action or a hint (`toast(msg, ok)` is the low-level form both use).

## Tests

`npm test` (in `tests/`) now also runs `logic/endgame.mjs` (pure Node: the final-score formula and rounding) and `layout/float_modules.py` (real Chromium through Playwright for Python: touch drag with synthetic touch events, vertical-fit behaviour, the end-of-game result card, and a pass through every floating-module path; it starts its own server). After changing any shipped file run `node tools/stamp-sw.mjs`, otherwise installed copies will not update.
