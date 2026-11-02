// Turn Controls + Game Tools: two independent floating modules (Floating Workspace only). The structured default layout stays ONE button group.
import { launch, openGame, closeGame, VIEWPORTS } from './lib.mjs';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const b = await launch();
const settle = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const rect = (p, s) => p.$eval(s, e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const drag = async (p, from, dx, dy) => { const r = await rect(p, from); const x = r.x + r.w / 2, y = r.y + r.h / 2; await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx / 2, y + dy / 2, { steps: 3 }); await p.mouse.move(x + dx, y + dy, { steps: 3 }); await p.mouse.up(); await settle(p); };
const WSKEY = 'scrabble.floatWorkspace.v2';
const ON = { 'scrabble.layout': '{}', [WSKEY]: JSON.stringify({ v: 2, enabled: true, tools: 'open', portrait: {}, landscape: {} }) };
const OFF = { 'scrabble.layout': '{}' };
const ids = (p, s) => p.$$eval(s + ' > .btn', n => n.map(x => x.id));
const HOME = ['bSubmit', 'bCancel', 'bSwap', 'bPass', 'bPause', 'bUndo', 'bNew', 'bJudge', 'bLog', 'bFs', 'bSettings'];
const TURN = ['bSubmit', 'bCancel', 'bSwap', 'bPass', 'bPause', 'bUndo'], TOOLS = ['bJudge', 'bLog', 'bFs', 'bSettings', 'bNew'];
const same = (a, c) => JSON.stringify(a) === JSON.stringify(c);
const hit = (a, c) => Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x) > 2 && Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y) > 2;
const setFloat = async (p, on) => { await p.evaluate(() => document.querySelector('#bSettings').click()); await p.click(`#lyB button[data-k="float"][data-v="${on ? 'on' : 'off'}"]`); await p.evaluate(() => document.querySelector('#ad').close()); await settle(p); };

// ---- structured default: one group, exactly as before ----
{
  const { page: p } = await openGame(b, VIEWPORTS['desktop 1366x768'], { storage: OFF });
  ok(same(await ids(p, '.ctrls'), HOME), 'default layout: .ctrls holds all eleven buttons in the original order ' + JSON.stringify(await ids(p, '.ctrls')));
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('#tools')).display === 'none' && getComputedStyle(document.querySelector('#bFs')).display === 'none' && document.querySelectorAll('.ctrls').length === 1), 'default layout: #tools and the fullscreen button are not shown, only one .ctrls');
  // round trip: ON then OFF restores the exact DOM order and removes the module
  await setFloat(p, true);
  ok(same(await ids(p, '.ctrls:not(#tools)'), TURN) && same(await ids(p, '#tools'), TOOLS), 'ON: Turn Controls hold ' + TURN + ' and Game Tools hold ' + TOOLS);
  ok(await p.evaluate(() => document.querySelector('#tools').classList.contains('ctrls') && getComputedStyle(document.querySelector('#tools')).display !== 'none'), 'ON: Game Tools is a visible button rack');
  ok(await p.evaluate(() => document.querySelector('#bJudge').closest('#tools') && document.querySelector('#bSubmit').closest('.ctrls:not(#tools)') && !document.querySelector('#bLog').closest('.boardWrap')), 'ON: every button belongs to exactly one module');
  await setFloat(p, false);
  ok(same(await ids(p, '.ctrls'), HOME), 'OFF: original order restored exactly ' + JSON.stringify(await ids(p, '.ctrls')));
  ok(await p.evaluate(() => !document.querySelector('#tools').classList.contains('ctrls') && document.querySelector('#tools').children.length === 0 && getComputedStyle(document.querySelector('#tools')).display === 'none' && !document.querySelector('#tools').getAttribute('style')), 'OFF: Game Tools is empty, hidden and carries no inline geometry');
  await setFloat(p, true); await setFloat(p, false);
  ok(same(await ids(p, '.ctrls'), HOME), 'repeated ON/OFF keeps the order');
  await closeGame(p);
}

for (const name of ['desktop 1366x768', 'portrait-phone 390x844', 'landscape-phone 844x390']) {
  console.log('\n# ' + name);
  const vp = VIEWPORTS[name];
  const { page: p, errors } = await openGame(b, vp, { storage: ON }); await settle(p); await settle(p);
  // defaults: separate, inside, not overlapping each other or the other modules
  const R = {}; for (const [k, s] of [['board', '.boardWrap'], ['p0', '#pn0'], ['p1', '#pn1'], ['ctrls', '.ctrls'], ['tools', '#tools']]) R[k] = await rect(p, s);
  const [W, H] = await p.evaluate(() => [innerWidth, innerHeight]);
  ok(Object.values(R).every(r => r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= W + 0.5 && r.y + r.h <= H + 0.5), 'defaults inside the viewport ' + JSON.stringify(R.tools));
  const ks = Object.keys(R); let bad = '';
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) if (hit(R[ks[i]], R[ks[j]])) bad += ks[i] + '/' + ks[j] + ' ';
  ok(bad === '', 'no default module overlaps another ' + bad);
  ok(R.tools.w >= 112 && R.ctrls.w >= 144, `both control modules have usable widths (${R.ctrls.w.toFixed(0)} / ${R.tools.w.toFixed(0)})`);
  const z = await p.evaluate(() => ['.boardWrap', '#pn0', '#pn1', '.ctrls', '#tools'].map(s => +getComputedStyle(document.querySelector(s)).zIndex));
  ok(z[0] < Math.min(z[1], z[2]) && Math.max(z[1], z[2]) < z[3] && z[3] < z[4], 'hierarchy Board < players < Turn Controls < Game Tools ' + z);

  // independence: moving or resizing one never touches the other
  const c0 = await rect(p, '.ctrls'), t0 = await rect(p, '#tools');
  await drag(p, '#tools .flMove', vp.width > 600 ? -25 : 0, -20); const t1 = await rect(p, '#tools'), c1 = await rect(p, '.ctrls');
  ok(Math.abs(t1.x - t0.x) + Math.abs(t1.y - t0.y) > 3 && Math.abs(c1.x - c0.x) + Math.abs(c1.y - c0.y) < 0.5, 'moving Game Tools leaves Turn Controls where it was');
  await drag(p, '#tools .flGrip', 60, 0); const t2 = await rect(p, '#tools'), c2 = await rect(p, '.ctrls');
  ok(Math.abs(t2.w - t1.w) > 3 && Math.abs(c2.w - c1.w) < 0.5, 'resizing Game Tools leaves Turn Controls alone');
  await drag(p, '.ctrls .flMove', 0, vp.height > 600 ? -20 : -10); const t3 = await rect(p, '#tools');
  ok(Math.abs(t3.x - t2.x) + Math.abs(t3.y - t2.y) + Math.abs(t3.w - t2.w) < 0.5, 'moving Turn Controls leaves Game Tools alone');
  const st = await p.evaluate(k => JSON.parse(localStorage.getItem(k)), WSKEY), o = await p.evaluate(() => innerWidth > innerHeight ? 'landscape' : 'portrait');
  ok(st[o].tools && st[o].ctrls && st[o].tools.w > 0 && st[o].tools.aw > 0 && st[o].tools.ah > 0 && st[o].tools.bh > 0, 'each module is saved on its own with the area it was saved in ' + JSON.stringify(st[o].tools));

  // restart: both come back where they were
  const stored = await p.evaluate(k => localStorage.getItem(k), WSKEY), before = { c: await rect(p, '.ctrls'), t: await rect(p, '#tools') };
  await closeGame(p);
  { const { page: q } = await openGame(b, vp, { storage: { 'scrabble.layout': '{}', [WSKEY]: stored } }); await settle(q); await settle(q);
    const after = { c: await rect(q, '.ctrls'), t: await rect(q, '#tools') };
    ok(Math.abs(after.c.x - before.c.x) < 1.5 && Math.abs(after.c.w - before.c.w) < 1.5 && Math.abs(after.t.x - before.t.x) < 1.5 && Math.abs(after.t.y - before.t.y) < 1.5 && Math.abs(after.t.w - before.t.w) < 1.5, 'restart restores both modules ' + JSON.stringify([before.t, after.t]));
    // the tool buttons really work from inside the floating module
    await q.evaluate(() => document.querySelector('#bSettings').click()); ok(await q.evaluate(() => document.querySelector('#ad').open), 'Settings opens from Game Tools');
    await q.evaluate(() => document.querySelector('#ad').close());
    await q.evaluate(() => document.querySelector('#bLog').click()); ok(await q.evaluate(() => document.querySelector('#bLog').getAttribute('aria-expanded') === 'true' && document.querySelector('#hist').classList.contains('open')), 'Word Log opens from Game Tools');
    await q.evaluate(() => document.querySelector('#bLog').click());
    await q.evaluate(() => document.querySelector('#bNew').click()); ok(await q.evaluate(() => { const d = document.querySelector('#dlg'); return !!d && (d.open || d.classList.contains('open') || getComputedStyle(d).display !== 'none'); }), 'New Game asks for confirmation from Game Tools');
    await closeGame(q); }
  ok(errors.length === 0, 'no page errors ' + errors.slice(0, 2));
}

// ---- fullscreen toggle (the browser decides; here the API is stubbed) ----
{
  const { page: p } = await openGame(b, VIEWPORTS['desktop 1366x768'], { storage: ON }); await settle(p);
  ok(await p.evaluate(() => { const f = document.querySelector('#bFs'); return !f.hidden && getComputedStyle(f).display !== 'none' && f.closest('#tools') && f.getAttribute('aria-pressed') === 'false' && f.getAttribute('aria-label') === 'ملء الشاشة'; }), 'fullscreen button is in Game Tools, labelled, not pressed');
  await p.evaluate(() => { window.__calls = []; document.documentElement.requestFullscreen = () => { window.__calls.push('enter'); return Promise.resolve(); }; document.exitFullscreen = () => { window.__calls.push('exit'); return Promise.resolve(); }; });
  await p.$eval('#bFs', e => e.click()); await settle(p);
  ok(await p.evaluate(() => window.__calls.join() === 'enter'), 'click asks the browser for fullscreen');
  await p.evaluate(() => { Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.documentElement }); document.dispatchEvent(new Event('fullscreenchange')); }); await settle(p);
  ok(await p.evaluate(() => { const f = document.querySelector('#bFs'); return f.getAttribute('aria-pressed') === 'true' && f.getAttribute('aria-label') === 'إنهاء ملء الشاشة' && f.querySelector('.lbl').textContent === 'إنهاء ملء الشاشة'; }), 'button reflects the fullscreen state');
  await p.$eval('#bFs', e => e.click()); await settle(p);
  ok(await p.evaluate(() => window.__calls.join() === 'enter,exit'), 'second click leaves fullscreen');
  await closeGame(p);
}

// ---- proportional mapping of saved geometry between viewports ----
{
  const big = { width: 1920, height: 1080, deviceScaleFactor: 1 };
  const { page: p, errors } = await openGame(b, big, { storage: ON }); await settle(p); await settle(p);
  await drag(p, '#tools .flMove', -150, -120); await drag(p, '#tools .flGrip', 40, 0); await drag(p, '#pn0 .flMove', 60, -80);
  const st = await p.evaluate(k => JSON.parse(localStorage.getItem(k)), WSKEY).then(s => s.landscape), save = JSON.stringify(st);
  const r0 = { t: await rect(p, '#tools'), q: await rect(p, '#pn0'), b: await rect(p, '.boardWrap') };
  const area = await p.evaluate(() => ({ w: innerWidth - 16, h: innerHeight - 16 }));
  for (const [W, H] of [[1366, 768], [1024, 768], [1600, 1000], [2560, 1440]]) {
    await p.setViewport({ ...big, width: W, height: H }); await settle(p); await settle(p);
    const a = await p.evaluate(() => ({ w: innerWidth - 16, h: innerHeight - 16 })), k = Math.min(a.w / st.tools.aw, a.h / st.tools.ah);
    const t = await rect(p, '#tools'), lim = { lo: 112, hi: Math.min(a.w, 800, Math.max(480, .3 * a.w)) };
    const want = Math.min(Math.max(st.tools.w * k, lim.lo), lim.hi);
    ok(Math.abs(t.w - want) < 3, `${W}x${H}: Game Tools width follows the viewport scale (${t.w.toFixed(0)} ~ ${want.toFixed(0)}, k=${k.toFixed(2)})`);
    const fx0 = (st.tools.x - 8) / Math.max(1, st.tools.aw - st.tools.w), fx1 = (t.x - 8) / Math.max(1, a.w - t.w), fy0 = (st.tools.y - 8) / Math.max(1, st.tools.ah - st.tools.bh), fy1 = (t.y - 8) / Math.max(1, a.h - t.h);
    ok(Math.abs(fx0 - fx1) < 0.04 && Math.abs(fy0 - fy1) < 0.06, `${W}x${H}: Game Tools keeps its share of the free space (x ${fx0.toFixed(2)}->${fx1.toFixed(2)}, y ${fy0.toFixed(2)}->${fy1.toFixed(2)})`);
    ok(await p.evaluate(() => ['.boardWrap', '#pn0', '#pn1', '.ctrls', '#tools'].every(s => { const r = document.querySelector(s).getBoundingClientRect(); return r.x >= -0.5 && r.y >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5; })), `${W}x${H}: all modules inside the viewport`);
    ok(await p.evaluate((k, s) => JSON.stringify(JSON.parse(localStorage.getItem(k)).landscape) === s, WSKEY, save), `${W}x${H}: stored geometry untouched by the viewport change`);
  }
  await p.setViewport(big); await settle(p); await settle(p);
  const r1 = { t: await rect(p, '#tools'), q: await rect(p, '#pn0'), b: await rect(p, '.boardWrap') };
  ok(['t', 'q', 'b'].every(k => Math.abs(r1[k].x - r0[k].x) < 1.5 && Math.abs(r1[k].y - r0[k].y) < 1.5 && Math.abs(r1[k].w - r0[k].w) < 1.5), 'back on the original viewport every module returns exactly');
  ok(errors.length === 0, 'no errors while resizing ' + errors.slice(0, 2));
  await closeGame(p);
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
