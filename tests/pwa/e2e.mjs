// Real-browser PWA checks (Playwright + Chromium): service worker on a sub-path, offline launch, match persistence, updates, install UI.
//   node pwa/e2e.mjs        (from tests/; needs playwright-core and a Chromium: set CHROME_PATH to use your own Chrome)
// localhost counts as a secure context, so service workers run without HTTPS. Real HTTPS on GitHub Pages is NOT exercised here.
import fs from 'fs'; import os from 'os'; import path from 'path'; import { execFileSync } from 'child_process'; import { fileURLToPath } from 'url'; import { createRequire } from 'module';
import { serve } from './serve.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright-core'); } catch { pw = require('playwright'); }
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL:', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await pw.chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const PRECACHE = new Function('return ' + /const PRECACHE = (\[[\s\S]*?\]);/.exec(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'))[1])();

// ---------- helpers ----------
async function open(ctx, url, init) {
  const page = await ctx.newPage(); page.problems = []; page.sw = 0;
  if (init) await page.addInitScript(init);
  page.on('console', m => { if (m.type() === 'error') page.problems.push('console: ' + m.text()); });
  page.on('pageerror', e => page.problems.push('pageerror: ' + e.message));
  page.on('requestfailed', r => page.problems.push('requestfailed: ' + r.url()));
  page.on('response', r => { if (r.fromServiceWorker()) page.sw++; if (r.status() >= 400 && !/favicon\.ico/.test(r.url())) page.problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(url); await page.waitForSelector('#coverPlay'); return page;
}
const ready = page => page.evaluate(async () => { const r = await navigator.serviceWorker.ready; while (r.active.state !== 'activated') await new Promise(x => setTimeout(x, 50)); return r.active.state; });
// Edit localStorage from a plain (non-app) page of the same origin, so the app's own pagehide save cannot overwrite the edit.
async function tamper(ctx, S, value) { const p = await ctx.newPage(); await p.goto(S.base + 'manifest.webmanifest'); await p.evaluate(v => localStorage.setItem('scrabble.match', v), value); await p.close(); }
async function finishDraw(page) {   // local play now opens with the first-turn draw: play it out (a tie starts a new one)
  await page.waitForSelector('#drawOv:not([hidden])', { timeout: 2000 }).catch(() => {});   // the close callback may open it a tick after the dialog closes
  for (let i = 0; i < 8; i++) {
    if (await page.evaluate(() => document.getElementById('drawOv').hidden)) return;
    for (const id of ['#drawB0', '#drawB1']) {   // by id: the visible set shrinks as soon as a card is drawn
      const b = page.locator(id);
      if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
    }
    await page.waitForFunction(() => document.getElementById('drawOv').hidden, { timeout: 6000 }).catch(() => {});
  }
}
async function startGame(page, mode = 'basic', minutes = '25') {
  await page.click('#coverPlay'); await page.click(`#mf button[value="${mode}"]`); await page.click(`#sf button[value="${minutes}"]`);
  await page.click('#dF button[value="ok"]'); await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  await finishDraw(page);
}
async function move(page, cells) {   // current player places non-blank rack tiles on the given [r,c] cells, then scores
  const cur = await page.evaluate(() => [...document.querySelectorAll('.panel')].findIndex(p => p.classList.contains('on')));  const ids = await page.$$eval(`#pn${cur} .rack .tile:not(.blank)`, (els, n) => els.slice(0, n).map(e => e.dataset.id), cells.length);
  for (let i = 0; i < cells.length; i++) { await page.click(`#pn${cur} .tile[data-id="${ids[i]}"]`); await page.click(`.sq[data-r="${cells[i][0]}"][data-c="${cells[i][1]}"]`); }
  await page.click('#bSubmit'); await sleep(350);   // persistence is debounced by 250 ms
}
const current = page => page.evaluate(() => [...document.querySelectorAll('.panel')].findIndex(p => p.classList.contains('on')));
const snap = page => page.evaluate(() => ({  board: [...document.querySelectorAll('#board .tile')].map(t => `${t.closest('.sq').dataset.r},${t.closest('.sq').dataset.c}:${t.dataset.id}:${t.querySelector('b').textContent}`).join('|'),
  racks: [0, 1].map(i => [...document.querySelectorAll(`#rk${i} .tile`)].map(t => t.dataset.id).join()).join('|'),
  scores: [0, 1].map(i => document.querySelector('#sc' + i).textContent).join(), bag: document.querySelector('#bagInfo').textContent,
  hist: document.querySelectorAll('#hList .hi').length, cur: [...document.querySelectorAll('.panel')].findIndex(p => p.classList.contains('on'))
}));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const saved = page => page.evaluate(() => localStorage.getItem('scrabble.match'));

// =====================================================================================================
console.log('--- A. GitHub-Pages-style sub-path (/some-repo/), offline launch, persistence');
{
  const S = await serve(root, '/some-repo/'), ctx = await browser.newContext();
  const page = await open(ctx, S.base);
  ok(await ready(page) === 'activated', 'service worker activates under /some-repo/');
  const info = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { scope: r.scope, script: r.active.scriptURL, caches: await caches.keys() }; });
  ok(info.scope === S.base && info.script === S.base + 'sw.js', `scope is the sub-path (${info.scope})`);
  ok(info.caches.length === 1 && /^arabic-scrabble-shell-[0-9a-f]{12}$/.test(info.caches[0]), 'one versioned shell cache: ' + info.caches);
  const cached = await page.evaluate(async () => (await (await caches.open((await caches.keys())[0])).keys()).map(r => r.url));
  ok(PRECACHE.every(p => cached.includes(S.base + p)) && cached.length === PRECACHE.length, `all ${PRECACHE.length} precached files are in the cache`);
  await page.waitForFunction(() => /جاهزة للعمل دون إنترنت/.test(document.querySelector('#pwaStatus').textContent));
  ok(true);
  // Chrome's own manifest + installability checks
  const cdp = await ctx.newCDPSession(page);
  const mf = await cdp.send('Page.getAppManifest'), ie = await cdp.send('Page.getInstallabilityErrors');
  ok(mf.errors.length === 0, 'Chrome reports no manifest errors: ' + JSON.stringify(mf.errors));
  const installErrors = ie.installabilityErrors.filter(e => e.errorId !== 'in-incognito');   // a Playwright context is incognito by design; not a manifest defect
  ok(installErrors.length === 0, 'Chrome reports no installability errors: ' + JSON.stringify(installErrors));
  const man = JSON.parse(mf.data);
  ok(new URL(man.start_url, mf.url).href === S.base && new URL(man.scope, mf.url).href === S.base, 'start_url and scope resolve to the sub-path');
  ok(mf.url === S.base + 'manifest.webmanifest', 'manifest URL is under the sub-path');
  const icons = await page.evaluate(async () => Promise.all([...document.querySelectorAll('link[rel~=icon],link[rel=apple-touch-icon]')].map(async l => { const r = await fetch(l.href); return [l.getAttribute('href'), r.status, r.headers.get('content-type')]; })));
  ok(icons.length === 2 && icons.every(i => i[1] === 200 && i[2] === 'image/png'), 'favicon and apple-touch-icon resolve: ' + JSON.stringify(icons));
  ok(page.problems.length === 0, 'no console errors / failed requests online: ' + page.problems.join('; '));

  // real outage: the server stops answering
  await S.down();
  const off = await open(ctx, S.base);
  ok(off.sw > 0 && await off.evaluate(() => !!navigator.serviceWorker.controller), 'offline: page is served by the service worker');
  await off.evaluate(() => document.fonts.ready);
  ok(await off.evaluate(() => document.fonts.check('700 20px ScrabbleMix', 'ع') && document.fonts.check('700 20px ScrabbleMix', 'A')), 'offline: bundled Arabic and Latin fonts are available');
  const off2 = await off.evaluate(async () => (await Promise.all(['assets/fonts/Amiri-Bold.woff2', 'css/style.css', 'js/main.js', 'assets/icons/icon-512.png'].map(u => fetch(u).then(async r => { await r.arrayBuffer(); return r.status; })))));   // bodies are read: an abandoned body is reported as aborted on navigation
  ok(off2.every(s => s === 200), 'offline: css, js, fonts, icons all 200');
  const nav = await off.goto(S.base + '?utm=x'); ok(nav.status() === 200 && await off.locator('#coverPlay').isVisible(), 'offline: navigation with a query string still opens the game');
  ok(off.problems.length === 0, 'offline: no console errors or failed requests: ' + off.problems.join('; '));
  const miss = await off.evaluate(() => fetch('assets/not-there.png').then(async r => { await r.text(); return r.status; }));
  ok(miss === 503, `offline: an uncached file gets an honest 503, not a fake success (got ${miss})`);

  // play offline, then reload offline: persistence
  await startGame(off); await move(off, [[7, 7], [7, 8]]);
  const before = await snap(off);
  ok(before.hist === 1 && before.scores.split(',').some(s => s !== '0'), 'offline: a move scores (' + before.scores + ')');
  const doc = JSON.parse(await saved(off));
  ok(doc && doc.v === 1 && doc.hist.length === 1 && doc.minutes === 25 && doc.mode === 'basic', 'match saved to localStorage');
  ok(!('theme' in doc) && !JSON.stringify(doc).includes('scrabble.'), 'match document holds no settings');
  await off.reload(); await off.waitForSelector('#coverPlay');
  ok(await saved(off) !== null, 'saved match survives until the player decides (start-up game did not overwrite it)');
  await off.click('#coverPlay'); await off.waitForSelector('#dlg[open]');
  ok(/مباراة غير مكتملة/.test(await off.textContent('#dT')), 'resume prompt appears');
  await off.click('#dF button[value="ok"]'); await sleep(300);
  const after = await snap(off);
  ok(same(before, after), 'resume restores board, racks, scores, bag, history and turn exactly\n  before ' + JSON.stringify(before) + '\n  after  ' + JSON.stringify(after));
  ok(await off.evaluate(() => !document.querySelector('#bUndo').disabled && !document.querySelector('#bJudge').disabled), 'undo and tahkim are available after resume');
  // keep playing after resume: second move, tahkim verdict, undo
  await move(off, [[8, 8]]); ok((await snap(off)).hist === 2, 'play continues after resume');
  await off.click('#bJudge'); await off.waitForSelector('#jd[open]'); await off.click('#jB [data-a="yes"]'); await sleep(200);
  ok(await off.evaluate(() => /صحيح/.test(document.querySelector('#hList').textContent)), 'tahkim works after resume');
  await off.reload(); await off.click('#coverPlay'); await off.click('#dF button[value="ok"]'); await sleep(300);
  ok(await off.evaluate(() => /صحيح/.test(document.querySelector('#hList').textContent)), 'tahkim verdict also survives a reload');

  // pausing while hidden
  const clock = () => off.evaluate(async () => { const { S } = await import('./js/state.js'); return S.players.map(p => Math.round(p.ms)); });
  const c0 = await clock();
  await off.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(1800);
  await off.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
  const c1 = await clock(), lost = c0.map((v, i) => v - c1[i]);
  ok(Math.max(...lost) < 900, `clocks do not run while the app is hidden (lost ${lost} ms over 1800 ms hidden)`);
  await sleep(1100); const c2 = await clock(); ok(Math.max(...c1.map((v, i) => v - c2[i])) > 700, 'clocks run again when visible');

  // a new game replaces the saved slot only when it really starts; corrupted / tampered saves are ignored
  await off.reload(); await off.click('#coverPlay'); await off.click('#dlg button[value=""]');   // "مباراة جديدة"
  await off.waitForSelector('#md[open]'); ok(await saved(off) !== null, 'choosing "new game" at the prompt does not delete the saved match yet');
  await off.reload(); await off.click('#coverPlay'); await off.waitForSelector('#dlg[open]'); ok(true);
  await off.click('#dlg button[value=""]'); await off.click('#mf button[value="expanded"]'); await off.click('#sf button[value="10"]'); await off.click('#dF button[value="ok"]'); await sleep(400);
  await finishDraw(off);   // a brand-new game starts with the first-turn draw
  ok(await saved(off) === null, 'starting a new game clears the old saved match');
  const good = (await (async () => { await move(off, [[7, 7], [7, 8]]); return saved(off); })());
  const tampered = [
    ['garbage', '{{{not json'], ['wrong format', JSON.stringify({ v: 99 })],
    ['duplicate tile id', (() => { const d = JSON.parse(good); d.racks[0][0] = d.racks[1][0]; return JSON.stringify(d); })()],
    ['html in a word', (() => { const d = JSON.parse(good); d.hist[0].words[0].w = '<img src=x onerror=alert(1)>'; return JSON.stringify(d); })()],
    ['clock above the game length', (() => { const d = JSON.parse(good); d.times[0] = 1e12; return JSON.stringify(d); })()]
  ];
  await off.close();
  for (const [name, val] of tampered) {
    await tamper(ctx, S, val); const t = await open(ctx, S.base);
    await t.click('#coverPlay'); await t.waitForSelector('#md[open]', { timeout: 3000 }).catch(() => {});
    ok(await t.evaluate(() => document.querySelector('#md').open && !document.querySelector('#dlg').open), `tampered save (${name}) is ignored: normal new-game flow`);
    ok(await saved(t) === null, `tampered save (${name}) is discarded`);
    ok(t.problems.length === 0, `tampered save (${name}) causes no console errors: ` + t.problems.join('; '));
    await t.close();
  }
  await S.up(); await ctx.close(); S.srv.close();
}

// =====================================================================================================
console.log('--- B. domain-root deployment (/)');
{
  const S = await serve(root, '/'), ctx = await browser.newContext(), page = await open(ctx, S.base);
  ok(await ready(page) === 'activated', 'service worker activates at the root');
  ok(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope) === S.base, 'scope is the root');
  await S.down(); const off = await open(ctx, S.base); ok(off.sw > 0 && off.problems.length === 0, 'offline launch works at the root: ' + off.problems.join('; '));
  await S.up(); await ctx.close(); S.srv.close();
}

// =====================================================================================================
console.log('--- C. updates: a failed deploy never goes live, a good one waits for the player');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrabble-pwa-')), keep = p => !/node_modules|\.git/.test(p);
  const v1 = path.join(tmp, 'v1'), v2 = path.join(tmp, 'v2'), v3 = path.join(tmp, 'v3');
  for (const d of [v1, v2, v3]) fs.cpSync(root, d, { recursive: true, filter: keep });
  fs.appendFileSync(path.join(v2, 'js/config.js'), '\n// v2-marker\n'); fs.appendFileSync(path.join(v3, 'js/config.js'), '\n// v3-marker\n');
  for (const d of [v1, v2, v3]) execFileSync('node', ['tools/stamp-sw.mjs'], { cwd: d, stdio: 'pipe' });
  const S = await serve(v1, '/repo/'), ctx = await browser.newContext(), page = await open(ctx, S.base);
  await ready(page); await startGame(page); await move(page, [[7, 7], [7, 8]]); const played = await snap(page);
  const marker = (p, m) => p.evaluate(async m => (await (await fetch('js/config.js')).text()).includes(m), m);
  const reg = p => p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return { active: r.active?.scriptURL, installing: !!r.installing, waiting: !!r.waiting, caches: await caches.keys() }; });
  const v1Caches = (await reg(page)).caches;

  S.state.root = v3; S.state.deny.add('css/pwa.css');   // a deploy where one precached file is missing
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()).catch(() => {})); await sleep(1500);
  const r3 = await reg(page);
  ok(!r3.waiting && !r3.installing && same(r3.caches, v1Caches), 'failed install: no waiting worker and no leftover caches: ' + JSON.stringify(r3.caches));
  ok(await page.locator('#pwaUpdate').isHidden(), 'failed install: no update offered');
  await S.down(); await page.reload(); await page.waitForSelector('#coverPlay');
  ok(!(await marker(page, 'v3-marker')) && await page.evaluate(() => getComputedStyle(document.querySelector('#coverPlay')).display !== 'none'), 'failed install: the old version keeps serving, fully');
  await S.up(); S.state.deny.clear();

  S.state.root = v2;   // the good deploy
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update())); await page.waitForSelector('#pwaUpdate:not([hidden])', { timeout: 8000 });
  ok(true); ok(!(await marker(page, 'v2-marker')), 'update waits: the running page still uses version 1');
  const rw = await reg(page); ok(rw.waiting && rw.caches.length === 2, 'new version installed and waiting alongside the old cache');
  const nav = page.waitForEvent('framenavigated'); await page.click('#pwaUpdateGo'); await nav; await page.waitForSelector('#coverPlay');
  ok(await marker(page, 'v2-marker'), 'after applying: version 2 is served');
  const ra = await reg(page); ok(ra.caches.length === 1 && !same(ra.caches, v1Caches), 'old cache removed, only the new one remains: ' + ra.caches);
  ok(await page.locator('#pwaUpdate').isHidden(), 'update bar gone after update');
  await page.click('#coverPlay'); await page.waitForSelector('#dlg[open]'); await page.click('#dF button[value="ok"]'); await sleep(300);
  ok(same(played, await snap(page)), 'the match in progress survives an update');
  await ctx.close(); S.srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
}

// =====================================================================================================
console.log('--- D. install UI');
{
  const S = await serve(root, '/app/'), BLOCK_REAL = () => window.addEventListener('beforeinstallprompt', e => { if (!e.synthetic) e.stopImmediatePropagation(); }, true);
  const fire = p => p.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.synthetic = true; e.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; return Promise.resolve(); }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
  const vis = (p, s) => p.evaluate(s => { const el = document.querySelector(s); return !el.hidden && getComputedStyle(el).display !== 'none'; }, s);

  let ctx = await browser.newContext(), page = await open(ctx, S.base, BLOCK_REAL);
  ok(!(await vis(page, '#pwaBar')) && !(await vis(page, '#pwaInstall')), 'no install button while the browser offers no install');
  ok(await page.evaluate(() => !document.querySelector('#pwaHint').hidden), 'Settings explains where to find install in the browser menu instead of faking a button');
  await fire(page);
  ok(await vis(page, '#pwaBar') && (await page.textContent('#pwaBarGo')) === 'تثبيت', 'prompt captured: cover shows the install suggestion');
  ok(await page.evaluate(() => !document.querySelector('#pwaInstall').hidden), 'prompt captured: Settings gets the install button');
  await page.click('#pwaBarGo'); await sleep(100);
  ok(await page.evaluate(() => window.__prompted) === 1, 'the button calls the captured prompt()');
  ok(!(await vis(page, '#pwaBar')) && !(await vis(page, '#pwaInstall')), 'a used prompt cannot be reused: buttons hide');
  await fire(page); await page.evaluate(() => window.dispatchEvent(new Event('appinstalled'))); await sleep(50);
  ok(!(await vis(page, '#pwaBar')) && /تطبيق مثبّت/.test(await page.textContent('#pwaStatus')), 'appinstalled hides the UI and updates the status');
  await ctx.close();

  ctx = await browser.newContext(); page = await open(ctx, S.base, BLOCK_REAL); await fire(page);
  await page.click('#pwaBarX'); ok(!(await vis(page, '#pwaBar')), 'dismiss hides the suggestion');
  const p2 = await open(ctx, S.base, BLOCK_REAL); await fire(p2);
  ok(!(await vis(p2, '#pwaBar')), 'a dismissed suggestion does not come back on the next visit');
  ok(await p2.evaluate(() => !document.querySelector('#pwaInstall').hidden), '…but Settings still offers install');
  await ctx.close();

  const IOS = v => `Object.defineProperty(navigator, 'standalone', { value: ${v}, configurable: true })`;   // a string: closures are not serialised into the page
  ctx = await browser.newContext(); page = await open(ctx, S.base, IOS(false));
  ok(await vis(page, '#pwaBar') && (await page.textContent('#pwaBarGo')) === 'طريقة التثبيت', 'iOS (not installed): cover offers the Add to Home Screen guide');
  await page.click('#pwaBarGo'); await page.waitForSelector('#pd[open]');
  const guide = await page.textContent('#pd');
  ok(await page.locator('#pd li').count() === 5 && ['مشاركة', 'Share', 'إضافة إلى الشاشة الرئيسية', 'Add to Home Screen', 'فتح كتطبيق ويب', 'Open as Web App', 'Safari'].every(t => guide.includes(t)), 'iOS guide covers Share → Add to Home Screen → Open as Web App');
  ok(!/لا يمكن|تم التثبيت|مثبّت بالفعل/.test(guide), 'the guide never claims the app is already installed');
  await page.click('#pd button'); await ctx.close();
  ctx = await browser.newContext(); page = await open(ctx, S.base, IOS(true));
  ok(!(await vis(page, '#pwaBar')) && !(await vis(page, '#pwaInstall')), 'iOS Home Screen app: no install UI');
  ctx = await browser.newContext(); page = await open(ctx, S.base, BLOCK_REAL);
  ok(await page.evaluate(() => !('standalone' in navigator)), 'Chromium: iOS path is not taken (capability check, no UA sniffing)');
  await ctx.close(); S.srv.close();
}

// =====================================================================================================
console.log('--- E. persistence of an unsubmitted move and of blank tiles');
{
  const S = await serve(root, '/g/'), ctx = await browser.newContext(), page = await open(ctx, S.base);
  await startGame(page);
  const cur0 = await current(page);   // the first-turn draw decides who starts
  // unsubmitted move: two tiles on the board, not scored yet
  const ids = await page.$$eval(`#pn${cur0} .rack .tile:not(.blank)`, els => els.slice(0, 2).map(e => e.dataset.id));
  for (let i = 0; i < 2; i++) { await page.click(`#pn${cur0} .tile[data-id="${ids[i]}"]`); await page.click(`.sq[data-r="7"][data-c="${7 + i}"]`); }
  const mid = await snap(page); await sleep(350);
  await page.reload(); await page.click('#coverPlay'); await page.waitForSelector('#dlg[open]'); await page.click('#dF button[value="ok"]'); await sleep(300);
  const back = await snap(page);
  ok(same(mid, back) && back.board.split('|').length === 2, 'an unsubmitted move comes back exactly as it was');
  ok(await page.evaluate(() => document.querySelectorAll('#board .tile.cur').length === 2), 'restored tiles are still pending (can be moved), not locked');
  await page.click('#bSubmit'); await sleep(300); ok((await snap(page)).hist === 1, 'the restored move can be scored');

  // force a blank tile into player 2's rack (test-only state surgery), play it with a letter, reload
  await page.evaluate(async () => {
    const { S, BY } = await import('./js/state.js'), { render } = await import('./js/ui.js');
    const blank = Object.values(BY).find(t => t.blank && !S.board.flat().includes(t));
    const where = t => { const bi = S.bag.indexOf(t); if (bi >= 0) return [S.bag, bi]; for (const p of S.players) { const ri = p.rack.indexOf(t); if (ri >= 0) return [p.rack, ri]; } };
    const rack = S.players[S.cur].rack, [la, li] = where(blank), other = rack[0];
    la[li] = other; rack[0] = blank; render();
  });
  const cur1 = 1 - cur0;   // after the scored move it is the other player's turn
  await page.click(`#pn${cur1} .rack .tile.blank`); await page.click('.sq[data-r="8"][data-c="7"]');
  await page.waitForSelector('#bd[open]'); await page.click('#bf button[value="ب"]'); await sleep(200);
  // reload while a SECOND blank-free tile is only half-placed is covered above; here: the blank has its letter
  const t2 = await page.$$eval(`#pn${cur1} .rack .tile:not(.blank)`, els => els[0].dataset.id);
  await page.click(`#pn${cur1} .tile[data-id="${t2}"]`); await page.click('.sq[data-r="9"][data-c="7"]'); await page.click('#bSubmit'); await sleep(350);
  const withBlank = await snap(page);
  ok(await page.evaluate(() => [...document.querySelectorAll('#board .tile.blank b')].map(b => b.textContent).join() === 'ب'), 'blank tile shows its chosen letter');
  await page.reload(); await page.click('#coverPlay'); await page.waitForSelector('#dlg[open]'); await page.click('#dF button[value="ok"]'); await sleep(300);
  ok(same(withBlank, await snap(page)), 'game with a played blank restores exactly');
  ok(await page.evaluate(() => [...document.querySelectorAll('#board .tile.blank b')].map(b => b.textContent).join() === 'ب'), 'restored blank keeps its letter and its 0 value');
  ok(await page.evaluate(() => [...document.querySelectorAll('#board .tile.blank i')].every(i => i.textContent === '0')), 'blank is still worth 0');

  // a blank dropped but still waiting for its letter (picker open) when the app goes away: saved as "not placed yet"
  await page.evaluate(async () => {
    const { S, BY } = await import('./js/state.js'), { render } = await import('./js/ui.js');
    const blank = Object.values(BY).find(t => t.blank && !t.as && !S.board.flat().includes(t));
    const where = t => { const bi = S.bag.indexOf(t); if (bi >= 0) return [S.bag, bi]; for (const p of S.players) { const ri = p.rack.indexOf(t); if (ri >= 0) return [p.rack, ri]; } };
    const rack = S.players[S.cur].rack, [la, li] = where(blank), other = rack[0]; la[li] = other; rack[0] = blank; render();
  });
  await page.click(`#pn${cur0} .rack .tile.blank`); await page.click('.sq[data-r="9"][data-c="8"]'); await page.waitForSelector('#bd[open]');
  const doc = JSON.parse(await page.evaluate(async () => { const { serialise } = await import('./js/persist.js'); return JSON.stringify(serialise()); }));
  const valid = await page.evaluate(async d => (await import('./js/persist.js')).validate(d), doc);
  ok(valid && doc.board[9][8] === null && doc.move.length === 0 && doc.racks[0].every(id => id !== null), 'a blank awaiting its letter is saved as still in the rack, and the document validates');
  ok(page.problems.length === 0, 'no console errors: ' + page.problems.join('; '));
  await ctx.close(); S.srv.close();
}

// =====================================================================================================
console.log('--- F. touch feedback: the picked tile flickers (also with "reduce motion" on), a placed tile has no ring and no glow');
for (const motion of ['no-preference', 'reduce']) {
  const S = await serve(root, '/g2/'), ctx = await browser.newContext({ reducedMotion: motion }), page = await open(ctx, S.base);
  await startGame(page);
  await page.click('.panel.on .rack .tile:not(.blank)');
  const sample = () => page.$eval('.tile.pick', e => { const c = getComputedStyle(e); return { anim: c.animationName, shadow: c.boxShadow }; });
  const seen = new Set(); for (let i = 0; i < 6; i++) { seen.add((await sample()).shadow); await sleep(250); }
  ok((await sample()).anim === 'blink' && seen.size > 1, `[${motion}] picked tile flickers: animation "${(await sample()).anim}", ${seen.size} distinct shadows over 1.5 s`);
  await page.click('.sq[data-r="7"][data-c="7"]'); await sleep(450);
  ok(await page.$$eval('.tile.pick', n => n.length) === 0, `[${motion}] nothing stays in the picked state after placing`);
  const placed = await page.$eval('#board .tile.cur', e => { const c = getComputedStyle(e); return { anim: c.animationName, shadow: c.boxShadow }; });
  // computed layers look like "rgba(...) x y blur spread [inset]": a glow has blur, a ring has a spread of 2px or more
  const layers = placed.shadow.split(/,(?![^(]*\))/).map(l => l.replace(/rgba?\([^)]*\)/g, '').trim().split(/\s+/)).map(t => ({ blur: parseFloat(t[2]), spread: parseFloat(t[3]) }));
  ok(placed.anim !== 'blink' && layers.every(l => l.blur === 0 && l.spread <= 1), `[${motion}] placed tile has no glow and no ring (shadow: ${placed.shadow})`);
  ok(page.problems.length === 0, `[${motion}] no console errors: ` + page.problems.join('; '));
  await ctx.close(); S.srv.close();
}

await browser.close();
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
