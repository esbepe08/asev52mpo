// Floating Workspace stacking: the board is the permanent base layer. Racks and the control palette must stay above it, however the user
// interacts with the board, after a reset, after a restart with stale inline z-index values, and the word-log button must live in .ctrls.
import { launch, openGame, closeGame, VIEWPORTS } from './lib.mjs';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const b = await launch();
const settle = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const rect = (p, s) => p.$eval(s, e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const drag = async (p, from, dx, dy) => { const r = await rect(p, from); const x = r.x + r.w / 2, y = r.y + r.h / 2; await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 }); await p.mouse.move(x + dx, y + dy, { steps: 4 }); await p.mouse.up(); await settle(p); };
const WSKEY = 'scrabble.floatWorkspace.v2';
const ON = { 'scrabble.layout': '{}', [WSKEY]: JSON.stringify({ v: 2, enabled: true, tools: 'open', portrait: {}, landscape: {} }) };   // drawer history, workspace ON
const Z = p => p.evaluate(() => Object.fromEntries([['board', '.boardWrap'], ['p0', '#pn0'], ['p1', '#pn1'], ['ctrls', '.ctrls'], ['tools', '#tools'], ['hist', '#hist']].map(([k, s]) => [k, +getComputedStyle(document.querySelector(s)).zIndex])));
const above = (z, k) => z[k] > z.board;
// strict hierarchy: Board < player panels < Turn Controls < Game Tools
const hier = z => z.board < Math.min(z.p0, z.p1) && Math.max(z.p0, z.p1) < z.ctrls && z.ctrls < z.tools;
// the element painted at the centre of `sel` (viewport coords) belongs to `sel`?
const onTop = (p, sel) => p.evaluate(s => { const e = document.querySelector(s), r = e.getBoundingClientRect(), t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!t && e.contains(t); }, sel);
const notBoard = (p, sel) => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(), t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!t && !t.closest('.boardWrap'); }, sel);
const overlaps = async (p, sel) => { const a = await rect(p, sel), c = await rect(p, '.boardWrap'); return Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x) > 20 && Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y) > 20; };
// a real tile placement: pick a rack tile, click a board cell that is actually visible there, check it landed, then take it back
const placeTile = async p => {
  await p.evaluate(() => document.querySelector('.panel.on .slot .tile').click());
  const pt = await p.evaluate(() => { for (const c of document.querySelectorAll('#board .sq:not(.has)')) { const r = c.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2; if (x > 0 && y > 0 && x < innerWidth && y < innerHeight && document.elementFromPoint(x, y) === c) return { x, y, r: +c.dataset.r, c: +c.dataset.c }; } return null; });
  if (!pt) return false;
  await p.mouse.click(pt.x, pt.y); await settle(p);
  const landed = await p.evaluate(async (r, c) => (await import('/js/state.js')).S.board[r][c] !== null && !!(await import('/js/state.js')).S.board[r][c], pt.r, pt.c);
  await p.evaluate(async () => { const { cancelMove } = await import('/js/game.js'); const { render } = await import('/js/ui.js'); cancelMove(); render(); });
  return landed;
};
const interactWithBoard = async p => {   // every kind of board interaction the bug report mentions
  const bw = await rect(p, '.boardWrap');
  await p.mouse.click(bw.x + bw.w - 6, bw.y + bw.h / 2); await settle(p);     // empty board surface
  await p.evaluate(() => { const c = document.querySelector('#board .sq'); c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); c.click(); });
  const landed = await placeTile(p);
  await p.focus('.boardWrap .flMove'); await settle(p);                         // focus on the board's move strip
  return landed;
};

for (const name of ['desktop 1366x768', 'portrait-phone 390x844', 'landscape-phone 844x390']) {
  console.log('\n# ' + name);
  const vp = VIEWPORTS[name];
  const { page: p, errors } = await openGame(b, vp, { storage: ON }); await settle(p);
  ok(await p.evaluate(() => document.documentElement.dataset.floating === 'true'), 'workspace ON');

  // default: board lowest, and bounded layers
  let z = await Z(p);
  ok(hier(z), 'default: racks and controls above the board ' + JSON.stringify(z));
  ok(Object.values(z).every(v => Number.isFinite(v) && v < 100), 'z-indexes are small and bounded');

  // Test D first (the board is still reachable): it moves and resizes, and stays the bottom layer
  const b0 = await rect(p, '.boardWrap');
  await drag(p, '.boardWrap .flMove', vp.width > 600 ? -20 : 0, 10); const b1 = await rect(p, '.boardWrap');
  ok(Math.abs(b1.x - b0.x) + Math.abs(b1.y - b0.y) > 3, 'D: board still movable');
  await drag(p, '.boardWrap .flGrip', -30, -30); const b2 = await rect(p, '.boardWrap');
  ok(b2.w < b1.w - 5, 'D: board still resizable');
  z = await Z(p); ok(hier(z), 'D: still the lowest layer after moving/resizing it ' + JSON.stringify(z));
  await p.focus('.boardWrap .flMove'); const k0 = await rect(p, '.boardWrap'); await p.keyboard.press('ArrowDown'); await settle(p);
  ok((await rect(p, '.boardWrap')).y > k0.y, 'D: keyboard movement of the board still works');

  // Tests A/B/C: each movable module is dragged over the board, then the board is used
  for (const [label, sel, grip] of [['A: player 1', '#pn0', '#pn0 .flMove'], ['A: player 2', '#pn1', '#pn1 .flMove'], ['C: turn controls', '.ctrls', '.ctrls .flMove'], ['C: game tools', '#tools', '#tools .flMove']]) {
    const bd = await rect(p, '#board'), m = await rect(p, sel), g = await rect(p, grip);
    await drag(p, grip, bd.x + bd.w / 2 - (m.x + m.w / 2), bd.y + bd.h / 2 - (m.y + m.h / 2) + (g.y - m.y) * 0);   // centre of the module onto the centre of the board
    ok(await overlaps(p, sel), `${label}: now overlaps the board`);
    ok(await onTop(p, sel), `${label}: painted above the board after being dragged onto it`);
    const landed = await interactWithBoard(p);
    z = await Z(p);
    const key = sel === '#pn0' ? 'p0' : sel === '#pn1' ? 'p1' : sel === '#tools' ? 'tools' : 'ctrls';
    ok(z[key] > z.board, `${label}: board z-index (${z.board}) < module z-index (${z[key]}) after board interaction`);
    ok(hier(z), `${label}: every foreground module is above the board after board interaction`);
    ok(await onTop(p, sel), `${label}: still painted above the board after board interaction (recoverable)`);
    if (label.startsWith('A')) ok(landed, `${label}: a tile could be placed on a visible board cell (B)`);
    await drag(p, grip, 0, 0);   // and it can still be grabbed and dragged
  }
  // both racks fully on top of the board: recoverable
  { await drag(p, '#tools .flMove', -3000, 3000); await drag(p, '.ctrls .flMove', 3000, 3000);   // park both control modules in corners (tools first: it sits on the higher rung and may cover the other's handle)
    const bd = await rect(p, '#board');
    for (const [sel, grip, off] of [['#pn0', '#pn0 .flMove', -0.28], ['#pn1', '#pn1 .flMove', 0.28]]) { const m = await rect(p, sel); await drag(p, grip, bd.x + bd.w / 2 - (m.x + m.w / 2), bd.y + bd.h / 2 + off * bd.h - (m.y + m.h / 2)); }   // side by side vertically, so the two do not hide each other
    await interactWithBoard(p);
    ok(await notBoard(p, '#pn0') && await notBoard(p, '#pn1'), 'C: both racks entirely over the board stay on top and recoverable');
    const r0 = await rect(p, '#pn1'); await drag(p, '#pn1 .flMove', -40, 30); const r1 = await rect(p, '#pn1');
    ok(Math.abs(r1.x - r0.x) + Math.abs(r1.y - r0.y) > 3, 'C: a rack buried over the board can still be dragged out'); }

  // bounded ranking: hammering every module's handle many times never grows z-index
  for (let i = 0; i < 12; i++) for (const s of ['#pn0 .flMove', '#pn1 .flMove', '.ctrls .flMove', '#tools .flMove', '.boardWrap .flMove']) await p.$eval(s, e => e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0 })));
  z = await Z(p); ok(Object.values(z).every(v => v < 100) && hier(z), 'repeated interaction keeps z-indexes bounded and the board lowest ' + JSON.stringify(z));

  // the word-log button: location, behaviour inside the floating palette
  ok(await p.evaluate(() => document.querySelector('#bLog').closest('#tools') === document.querySelector('#tools') && !document.querySelector('.boardWrap #bLog') && document.querySelectorAll('#bLog').length === 1), 'E: #bLog is in the Game Tools module, not in .boardWrap, and unique');
  { await p.evaluate(() => document.querySelector('#bLog').scrollIntoView?.());
    const c0 = await rect(p, '.ctrls'), w0 = await rect(p, '.boardWrap'), tgt = await p.evaluate(() => { const r = document.querySelector('#bLog').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('#bLog') !== null]; });
    ok(tgt[2], 'F: #bLog is reachable (hit-testable) inside the floating controls');
    await p.mouse.click(tgt[0], tgt[1]); await settle(p);
    const c1 = await rect(p, '.ctrls'), w1 = await rect(p, '.boardWrap');
    ok(Math.abs(c1.x - c0.x) + Math.abs(c1.y - c0.y) < 0.5 && Math.abs(w1.x - w0.x) + Math.abs(w1.y - w0.y) < 0.5, 'F: clicking #bLog moves neither the controls nor the board');
    const st = () => p.evaluate(() => ({ open: document.querySelector('#hist').classList.contains('open'), exp: document.querySelector('#bLog').getAttribute('aria-expanded') }));
    ok(JSON.stringify(await st()) === '{"open":true,"exp":"true"}', 'F: click opens the history drawer in floating mode');
    z = await Z(p); ok(z.hist > z.tools && z.hist > z.ctrls && z.hist > z.p0 && z.hist > z.p1 && z.hist > z.board, 'F: open history drawer is above every gameplay module ' + JSON.stringify(z));
    ok(await p.evaluate(() => { const d = document.querySelector('#dlg'); return +getComputedStyle(d).zIndex > +getComputedStyle(document.querySelector('#hist')).zIndex; }), 'F: gameplay dialogue band stays above the history drawer');
    await p.$eval('#bLog', e => e.click()); ok(JSON.stringify(await st()) === '{"open":false,"exp":"false"}', 'F: second click closes it');
    ok(await p.evaluate(() => document.activeElement.id === 'bLog'), 'F: focus returns to #bLog');
    await p.$eval('#bLog', e => e.click()); await p.keyboard.press('Escape');
    ok(JSON.stringify(await st()) === '{"open":false,"exp":"false"}', 'F: Escape closes it'); ok(await p.evaluate(() => document.activeElement.id === 'bLog'), 'F: focus returns after Escape'); }

  // reset: geometry back to defaults and the old broken order cannot come back
  await p.evaluate(() => document.querySelector('#bSettings').click()); await p.click('#flReset'); await p.evaluate(() => document.querySelector('#ad').close()); await settle(p);
  z = await Z(p); ok(hier(z), 'reset: board still lowest ' + JSON.stringify(z));
  await interactWithBoard(p); z = await Z(p); ok(hier(z), 'reset: and stays lowest after board interaction');

  // stale inline z-index (e.g. from an old session) is normalised when the workspace is entered
  await p.evaluate(() => { document.querySelector('.boardWrap').style.zIndex = 999; document.querySelector('#pn0').style.zIndex = 1; document.querySelector('.ctrls').style.zIndex = 2; document.querySelector('#tools').style.zIndex = 1; });
  for (const on of [false, true]) { await p.evaluate(() => document.querySelector('#bSettings').click()); await p.click(`#lyB button[data-k="float"][data-v="${on ? 'on' : 'off'}"]`); await p.evaluate(() => document.querySelector('#ad').close()); await settle(p); }
  z = await Z(p); ok(hier(z) && z.board < 20, 'stale inline z-index is normalised on entering the workspace ' + JSON.stringify(z));
  ok(await p.evaluate(s => JSON.stringify(Object.keys(JSON.parse(localStorage.getItem(s)).landscape).concat(Object.keys(JSON.parse(localStorage.getItem(s)).portrait))).indexOf('z') < 0 && !/zIndex|z-index/.test(localStorage.getItem(s)), WSKEY), 'z-order is never persisted');

  // leaving: no inline layering left behind
  await p.evaluate(() => { document.querySelector('#bSettings').click(); }); await p.click('#lyB button[data-k="float"][data-v="off"]'); await p.evaluate(() => document.querySelector('#ad').close()); await settle(p);
  ok(await p.evaluate(() => ['.boardWrap', '#pn0', '#pn1', '.ctrls', '#tools', '#hist'].every(s => !document.querySelector(s).style.zIndex)), 'OFF: no inline z-index left');
  ok(errors.length === 0, 'no page errors: ' + errors.slice(0, 2));
  await closeGame(p);
}
// a restart with the workspace ON and saved geometry: order is right from the first paint
{
  const g = JSON.stringify({ v: 2, enabled: true, tools: 'open', portrait: {}, landscape: { board: { x: 300, y: 10, s: 520 }, p0: { x: 330, y: 200, w: 220 }, p1: { x: 340, y: 380, w: 220 }, ctrls: { x: 320, y: 560, w: 260 } } });
  const { page: p } = await openGame(b, VIEWPORTS['desktop 1366x768'], { storage: { 'scrabble.layout': '{}', [WSKEY]: g } }); await settle(p);
  const z = await Z(p); ok(hier(z), 'restart with saved overlapping geometry: board lowest ' + JSON.stringify(z));
  ok(await onTop(p, '#pn0') && await onTop(p, '#pn1'), 'restart: overlapping racks are painted above the board');
  await closeGame(p);
}
console.log(`\n${pass} passed, ${fail} failed`); await b.close(); process.exit(fail ? 1 : 0);
