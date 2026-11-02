// Game Tools minimize / restore: a genuinely small footprint, draggable and clamped, default by screen size, user choice preserved.
import { launch, openGame, closeGame } from './lib.mjs';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const b = await launch();
const settle = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const rect = (p, s) => p.$eval(s, e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const drag = async (p, from, dx, dy) => { const r = await rect(p, from); const x = r.x + r.w / 2, y = r.y + r.h / 2; await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 }); await p.mouse.move(x + dx, y + dy, { steps: 4 }); await p.mouse.up(); await settle(p); };
const WSKEY = 'scrabble.floatWorkspace.v2';
const mk = (extra = {}) => ({ 'scrabble.layout': '{}', [WSKEY]: JSON.stringify({ v: 2, enabled: true, portrait: {}, landscape: {}, ...extra }) });
const hit = (a, c) => Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x) > 2 && Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y) > 2;
const mobile = (w, h) => ({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true }), desk = (w, h) => ({ width: w, height: h, deviceScaleFactor: 1 });
const info = p => p.evaluate(() => { const t = document.querySelector('#tools'), r = t.getBoundingClientRect(), tg = document.querySelector('#toolsToggle');
  return { min: t.dataset.min, x: r.x, y: r.y, w: r.width, h: r.height, inView: r.x >= -0.5 && r.y >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
    btns: ['bJudge', 'bLog', 'bFs', 'bSettings', 'bNew'].map(i => getComputedStyle(document.getElementById(i)).display !== 'none'), turnShown: ['bSubmit', 'bPass'].every(i => getComputedStyle(document.getElementById(i)).display !== 'none'),
    exp: tg?.getAttribute('aria-expanded'), label: tg?.getAttribute('aria-label'), z: +getComputedStyle(t).zIndex, zc: +getComputedStyle(document.querySelector('.ctrls:not(#tools)')).zIndex, grip: !!t.querySelector('.flGrip') && getComputedStyle(t.querySelector('.flGrip')).display !== 'none' }; });
const others = async p => { const o = {}; for (const [k, s] of [['board', '.boardWrap'], ['p0', '#pn0'], ['p1', '#pn1'], ['ctrls', '.ctrls:not(#tools)']]) o[k] = await rect(p, s); return o; };
const store = p => p.evaluate(k => JSON.parse(localStorage.getItem(k)), WSKEY);

// ---- defaults by screen size (no explicit choice) ----
for (const [name, vp, expectMin] of [['phone portrait 390x844', mobile(390, 844), true], ['phone portrait 360x640', mobile(360, 640), true], ['phone landscape 844x390', mobile(844, 390), true], ['tablet 768x1024', desk(768, 1024), false], ['tablet 1024x768', desk(1024, 768), false], ['laptop 1366x768', desk(1366, 768), false], ['full HD 1920x1080', desk(1920, 1080), false], ['ultrawide 2560x1080', desk(2560, 1080), false]]) {
  console.log('\n# ' + name);
  const { page: p, errors } = await openGame(b, vp, { storage: mk() }); await settle(p); await settle(p);
  const i = await info(p), o = await others(p);
  ok((i.min === 'true') === expectMin, `default state follows the screen: ${i.min}`);
  ok(i.inView, 'Game Tools inside the viewport ' + JSON.stringify([i.x, i.y, i.w, i.h]));
  if (expectMin) {
    ok(i.w >= 44 && i.w <= 56 && i.h >= 44 && i.h <= 56, `minimized footprint is one small button (${i.w.toFixed(0)}x${i.h.toFixed(0)})`);
    ok(i.btns.every(v => !v) && i.turnShown, 'tool buttons are out of the layout; Turn Controls still shown');
    ok(i.exp === 'false' && i.label === 'أدوات اللعبة' && !i.grip, 'toggle: aria-expanded=false, named, no resize grip');
    ok(Object.entries(o).every(([, r]) => !hit(r, i)), 'minimized button overlaps no other module');
    ok(i.z > i.zc, 'sits above Turn Controls (hierarchy kept)');
    ok(o.ctrls.w > 0.7 * vp.width || vp.width > vp.height, 'portrait: Turn Controls take the freed width (' + o.ctrls.w.toFixed(0) + ')');
  } else {
    ok(i.btns.every(Boolean) && i.w >= 112 && i.exp === 'true' && i.label === 'طي أدوات اللعبة', 'expanded: all five tools visible, collapse button labelled');
  }
  const st = await store(p); ok(st.tools === undefined, 'no explicit choice stored until the user makes one');
  ok(errors.length === 0, 'no page errors ' + errors.slice(0, 2));
  await closeGame(p);
}

// ---- phone: restore, anchored, persisted ----
{
  console.log('\n# phone: expand / collapse / persistence');
  const vp = mobile(390, 844), { page: p, errors } = await openGame(b, vp, { storage: mk() }); await settle(p); await settle(p);
  const m0 = await info(p), o0 = await others(p);
  await p.click('#toolsToggle'); await settle(p); await settle(p);
  const e1 = await info(p), o1 = await others(p);
  ok(e1.min === 'false' && e1.btns.every(Boolean) && e1.w >= 112 && e1.inView, 'tap on the button restores the full Game Tools inside the viewport ' + JSON.stringify([e1.x, e1.y, e1.w, e1.h]));
  ok(!hit(e1, o1.ctrls), 'restored Game Tools does not cover Turn Controls ' + JSON.stringify([e1.y + e1.h, o1.ctrls.y]));
  ok(Math.abs(o1.ctrls.x - o0.ctrls.x) + Math.abs(o1.ctrls.y - o0.ctrls.y) + Math.abs(o1.ctrls.w - o0.ctrls.w) < 1.5, 'Turn Controls did not move or resize');
  const cornerSame = Math.abs((e1.x + e1.w) - (m0.x + m0.w)) < 2 || Math.abs(e1.x - m0.x) < 2;   // grew from the button's side
  ok(cornerSame, 'it grew out of the button (same horizontal edge)');
  ok((await store(p)).tools === 'open', 'explicit choice stored: open');
  const stored = JSON.stringify(await store(p)), eRect = e1;
  await closeGame(p);
  { const { page: q } = await openGame(b, vp, { storage: { 'scrabble.layout': '{}', [WSKEY]: stored } }); await settle(q); await settle(q);
    const r = await info(q); ok(r.min === 'false' && Math.abs(r.x - eRect.x) < 1.5 && Math.abs(r.w - eRect.w) < 1.5, 'restart: the user\'s open state and geometry are preserved even on a phone');
    await q.click('#toolsToggle'); await settle(q); await settle(q);
    const c = await info(q); ok(c.min === 'true' && c.w <= 56 && c.h <= 56 && c.inView && c.exp === 'false', 'collapse button shrinks it back to the small button');
    ok((await store(q)).tools === 'min', 'explicit choice stored: min');
    const st2 = JSON.stringify(await store(q)); await closeGame(q);
    const { page: r2 } = await openGame(b, vp, { storage: { 'scrabble.layout': '{}', [WSKEY]: st2 } }); await settle(r2); await settle(r2);
    ok((await info(r2)).min === 'true', 'restart: minimized state preserved'); await closeGame(r2); }
  ok(errors.length === 0, 'no errors ' + errors.slice(0, 2));
}

// ---- desktop: footprint, drag, clamp, keyboard ----
{
  console.log('\n# desktop: footprint, drag, clamp, keyboard');
  const vp = desk(1366, 768), { page: p, errors } = await openGame(b, vp, { storage: mk() }); await settle(p); await settle(p);
  const open = await info(p); ok(open.min === 'false', 'desktop starts expanded');
  await p.click('#toolsToggle'); await settle(p); await settle(p);
  const min = await info(p), st = await store(p), o = await p.evaluate(() => innerWidth > innerHeight ? 'landscape' : 'portrait');
  ok(min.min === 'true' && min.w * min.h < 0.15 * open.w * open.h, `footprint genuinely shrinks (${(min.w * min.h).toFixed(0)} vs ${(open.w * open.h).toFixed(0)} px²)`);
  ok(st.tools === 'min' && st[o].tools && st[o].toolsMin && st[o].tools.w >= 112, 'expanded geometry kept and the button has its own saved geometry');
  const near = Math.abs(min.x - open.x) < 2 || Math.abs((min.x + min.w) - (open.x + open.w)) < 2;
  ok(near, 'collapsed into the nearest corner of the module');
  // drag the minimized button: it moves, does not toggle, stays clamped
  const b0 = await rect(p, '#tools'); await drag(p, '#toolsToggle', -120, -90); const b1 = await info(p);
  ok(Math.abs(b1.x - b0.x) + Math.abs(b1.y - b0.y) > 60 && b1.min === 'true', 'minimized button is draggable and a drag does not restore it');
  { const r = await rect(p, '#toolsToggle'); await p.mouse.move(r.x + r.w / 2, r.y + r.h / 2); await p.mouse.down(); await p.mouse.move(vp.width - 1, vp.height - 1, { steps: 8 }); await p.mouse.up(); await settle(p); }   // pointer released at the very corner of the window: the 48px button must be pulled back inside
  const b2 = await info(p);
  ok(b2.inView && b2.x + b2.w > vp.width - 20 && b2.y + b2.h > vp.height - 20, 'dragged far past the corner: clamped inside the viewport ' + JSON.stringify(b2));
  { const r = await rect(p, '#toolsToggle'); await p.mouse.move(r.x + r.w / 2, r.y + r.h / 2); await p.mouse.down(); await p.mouse.move(1, 1, { steps: 8 }); await p.mouse.up(); await settle(p); }
  { const i2 = await info(p); ok(i2.inView && i2.x < 20 && i2.y < 20, 'and the opposite corner ' + JSON.stringify([i2.x, i2.y])); }
  const st2 = await store(p); ok(st2[o].toolsMin.x === (await info(p)).x || Math.abs(st2[o].toolsMin.x - (await info(p)).x) < 1, 'dragged position saved under its own key');
  // keyboard: arrows move it, Enter restores
  await p.focus('#toolsToggle'); const k0 = await rect(p, '#tools'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowDown'); await settle(p); const k1 = await rect(p, '#tools');
  ok(k1.x > k0.x && k1.y > k0.y, 'arrow keys move the minimized button');
  await p.keyboard.press('Enter'); await settle(p); await settle(p); const k2 = await info(p);
  ok(k2.min === 'false' && k2.btns.every(Boolean) && k2.inView, 'Enter restores it, still inside the viewport');
  // window resizing keeps everything inside; explicit choice survives
  await p.click('#toolsToggle'); await settle(p);
  for (const [W, H] of [[900, 600], [1920, 1080], [700, 900], [1366, 768]]) { await p.setViewport({ ...vp, width: W, height: H }); await settle(p); await settle(p);
    const r = await info(p); ok(r.inView && r.min === 'true', `window ${W}x${H}: minimized, inside the viewport`); }
  ok(errors.length === 0, 'no errors ' + errors.slice(0, 2));
  await closeGame(p);
}

// ---- auto state follows the window size until the user chooses ----
{
  console.log('\n# auto follows the window');
  const { page: p } = await openGame(b, desk(1366, 768), { storage: mk() }); await settle(p); await settle(p);
  ok((await info(p)).min === 'false', 'large window: expanded');
  await p.setViewport(desk(500, 700)); await settle(p); await settle(p);
  ok((await info(p)).min === 'true' && (await info(p)).inView, 'window shrunk to phone size: minimizes by itself');
  await p.setViewport(desk(1366, 768)); await settle(p); await settle(p);
  ok((await info(p)).min === 'false', 'window grown again: expands again');
  await closeGame(p);
}

// ---- leaving the workspace while minimized restores the structured group ----
{
  const { page: p } = await openGame(b, mobile(390, 844), { storage: mk() }); await settle(p); await settle(p);
  await p.evaluate(() => document.querySelector('#bSettings').click()); await p.click('#lyB button[data-k="float"][data-v="off"]'); await p.evaluate(() => document.querySelector('#ad').close()); await settle(p);
  ok(await p.evaluate(() => { const t = document.querySelector('#tools'); return !document.querySelector('#toolsToggle') && t.dataset.min === undefined && t.children.length === 0 && getComputedStyle(t).display === 'none' && ['bSubmit', 'bCancel', 'bSwap', 'bPass', 'bPause', 'bUndo', 'bNew', 'bJudge', 'bLog', 'bFs', 'bSettings'].join() === [...document.querySelectorAll('.ctrls > .btn')].map(x => x.id).join(); }), 'OFF while minimized: one group, original order, no toggle left behind');
  await closeGame(p);
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
