// Floating Workspace scales from available space (CSS viewport) and from each module's own width. No resolution is special-cased here: the matrix below
// only samples shapes, and every assertion is a relation (fits, grows with the viewport, follows its own width, stays bounded), never an exact size.
import { launch, openGame, closeGame } from './lib.mjs';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const b = await launch();
const settle = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const rect = (p, s) => p.$eval(s, e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const drag = async (p, from, dx, dy) => { const r = await rect(p, from); const x = r.x + r.w / 2, y = r.y + r.h / 2; await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx / 2, y + dy / 2, { steps: 3 }); await p.mouse.move(x + dx, y + dy, { steps: 3 }); await p.mouse.up(); await settle(p); };
const WSKEY = 'scrabble.floatWorkspace.v2';
const ON = { 'scrabble.layout': '{}', [WSKEY]: JSON.stringify({ v: 2, enabled: true, tools: 'open', portrait: {}, landscape: {} }) };
const MODS = ['.boardWrap', '#pn0', '#pn1', '.ctrls', '#tools'];
const outOfView = async p => { const [W, H] = await p.evaluate(() => [innerWidth, innerHeight]); for (const s of MODS) { const r = await rect(p, s); if (r.x < -0.5 || r.y < -0.5 || r.x + r.w > W + 0.5 || r.y + r.h > H + 0.5) return `${s} ${JSON.stringify(r)} in ${W}x${H}`; } return ''; };
const hit = (a, c) => Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x) > 2 && Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y) > 2;
const cols = p => p.$eval('.ctrls', e => getComputedStyle(e).gridTemplateColumns.split(' ').length);
const slotInfo = p => p.evaluate(() => { const s = document.querySelector('#rk0 .slot').getBoundingClientRect(), t = document.querySelector('#rk0 .tile b'), pn = document.querySelector('#pn0').getBoundingClientRect(), rk = document.querySelector('#rk0').getBoundingClientRect();
  return { slot: s.width, sq: Math.abs(s.width - s.height) < 0.6, font: t ? parseFloat(getComputedStyle(t).fontSize) : 0, inside: rk.right <= pn.right + 0.5 && rk.left >= pn.left - 0.5, pname: parseFloat(getComputedStyle(document.querySelector('#pn0 .pname')).fontSize), bh: Math.min(...[...document.querySelectorAll('.ctrls .btn')].filter(x => getComputedStyle(x).display !== 'none').map(x => x.getBoundingClientRect().height)) }; });
const MATRIX = [[360, 800], [390, 844], [844, 390], [768, 1024], [1024, 768], [1280, 720], [1366, 768], [1440, 900], [1600, 900], [1920, 1080], [2560, 1440], [2560, 1080], [3440, 1440]];
const max = {};   // viewport -> widest player / controls reachable by dragging the grips

for (const [W, H] of MATRIX) {
  const name = `${W}x${H}`, vp = { width: W, height: H, deviceScaleFactor: W < 900 ? 2 : 1, isMobile: W < 900, hasTouch: W < 900 };
  const { page: p, errors } = await openGame(b, vp, { storage: ON }); await settle(p); await settle(p);
  ok(await outOfView(p) === '', `${name}: default geometry inside the viewport ${await outOfView(p)}`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no horizontal overflow`);
  const bw = await rect(p, '.boardWrap'), bd = await rect(p, '#board'), p0 = await rect(p, '#pn0'), p1 = await rect(p, '#pn1'), c0 = await rect(p, '.ctrls');
  const tl = await rect(p, '#tools');
  { const all = { board: bw, p0, p1, ctrls: c0, tools: tl }, ks = Object.keys(all); let bad = '';
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) if (hit(all[ks[i]], all[ks[j]])) bad += ks[i] + '/' + ks[j] + ' ';
    ok(bad === '', `${name}: no default module overlaps another ${bad}`); }
  ok(Math.abs(bd.w - bd.h) < 1 && bd.w >= 120, `${name}: board square (${bd.w.toFixed(0)})`);
  ok(await p.evaluate(() => { const c = document.querySelector('#board').children, a = c[0].getBoundingClientRect(), z = c[224].getBoundingClientRect(), bw = document.querySelector('#board').getBoundingClientRect().width; return Math.abs(a.width - a.height) < 0.6 && Math.abs(z.width - a.width) < 0.6 && a.width > bw / 15 * 0.8 && a.width < bw / 15; }), `${name}: cells square and about board/15`);
  ok(!hit(bw, p0) || W < 900 || H > W, `${name}: default panels do not hide the board (landscape/wide)`);
  const d = await slotInfo(p); const d0 = d;
  ok(d.sq && d.inside && d.font > 4 && d.font / d.slot > .35 && d.font / d.slot < .85, `${name}: rack slots square, glyph follows tile size (slot ${d.slot.toFixed(1)}, font ${d.font.toFixed(1)})`);
  if (W / H > 2.1 && W >= 2000) {   // wide shape: Board | Controls | Players, nothing overlapping, most of the width used
    ok(bw.x < c0.x && c0.x < p0.x && bw.x < tl.x && tl.x < p0.x && !hit(bw, c0) && !hit(c0, p0) && !hit(c0, p1) && !hit(p0, p1) && !hit(tl, p0) && !hit(tl, p1) && !hit(tl, bw), `${name}: wide profile is Board | Controls | Players without overlaps`);
    ok(bw.w + c0.w + p0.w > W * 0.5, `${name}: wide profile uses a substantial share of the width (${Math.round((bw.w + c0.w + p0.w) / W * 100)}%)`);
  } else if (W > H && W >= 1200) {
    const room = (W - bw.w) / 2 - 16;   // the free column beside the board
    ok(Math.max(p0.w, p1.w) >= Math.min(0.58 * bw.w + 24, room) - 3, `${name}: players use the free side column, sized from the board (${Math.max(p0.w, p1.w).toFixed(0)} of ${room.toFixed(0)}, board ${bw.w.toFixed(0)})`);
  }
  // limits are runtime: widest player and controls the user can reach
  await drag(p, '#pn0 .flGrip', 4000, 0); const pw = await rect(p, '#pn0'); await drag(p, '#tools .flMove', 0, -4000); await drag(p, '.ctrls .flMove', -4000, 0);   // tools sits on the higher rung: move it out of the way first
  await drag(p, '.ctrls .flGrip', 4000, 0);  const cw = await rect(p, '.ctrls');
  max[name] = { pw: pw.w, cw: cw.w, W };
  ok(pw.w > Math.max(W, 900) && cw.w > Math.max(W, 1000), `${name}: no ceilings: player and controls follow the drag past the screen and the old limits (player ${pw.w.toFixed(0)}, controls ${cw.w.toFixed(0)})`);
  const big = await slotInfo(p), nCols = await cols(p);
  ok(big.slot >= d0.slot - 0.5 && big.sq && big.inside, `${name}: wider panel gives bigger tiles, still square and inside (${d0.slot.toFixed(1)} -> ${big.slot.toFixed(1)})`);
  ok(big.font / big.slot > .35 && big.font / big.slot < .85, `${name}: glyph stays proportional at maximum width`);
  ok(big.pname > d0.pname && big.pname > 40, `${name}: header type keeps scaling in step with the panel, with no cap (${d0.pname.toFixed(1)} -> ${big.pname.toFixed(1)})`);
  ok(big.bh >= 30 && big.bh / cw.w < 0.2, `${name}: buttons stay proportionate to the module at any width (${big.bh.toFixed(0)}px)`);
  await drag(p, '.ctrls .flGrip', -4000, 0); const nn = await cols(p), cmin = await rect(p, '.ctrls');
  ok(nn <= nCols && nn >= 1, `${name}: controls use fewer columns when narrow (${nCols} -> ${nn})`);
  ok(await p.evaluate(() => ['.ctrls:not(#tools)', '#tools'].every(m => { const c = document.querySelector(m).getBoundingClientRect(); return [...document.querySelectorAll(m + ' > .btn')].filter(x => getComputedStyle(x).display !== 'none').every(x => { const r = x.getBoundingClientRect(); return r.right <= c.right + 1 && r.left >= c.left - 1 && r.width >= 30; }); })), `${name}: no button clipped in either control module`);
  ok(errors.length === 0, `${name}: no page errors ${errors.slice(0, 2)}`);
  await closeGame(p);
}
const M = n => max[n];
ok(M('1920x1080').pw > 520 && M('1920x1080').cw > 640, `Full HD allows players > 520 and controls > 640 (${M('1920x1080').pw.toFixed(0)} / ${M('1920x1080').cw.toFixed(0)})`);
ok(Object.values(max).every(m => m.pw > m.W && m.cw > m.W), 'on every viewport (phone to ultrawide) a player panel and the controls can be made wider than the screen');

// Saved geometry: clamped for display on a smaller window, NOT rewritten, and restored when the room returns; live window resizing and rotation never break it.
{
  const vp = { width: 1920, height: 1080, deviceScaleFactor: 1 };
  const saved = { v: 2, enabled: true, tools: 'open', portrait: {}, landscape: { board: { x: 40, y: 20, s: 700 }, p0: { x: 760, y: 30, w: 640 }, p1: { x: 760, y: 400, w: 600 }, ctrls: { x: 1000, y: 800, w: 700 } } };
  const { page: p, errors } = await openGame(b, vp, { storage: { 'scrabble.layout': '{}', [WSKEY]: JSON.stringify(saved) } }); await settle(p); await settle(p);
  const r0 = await rect(p, '#pn0'); ok(Math.abs(r0.w - 640) < 2 && Math.abs(r0.x - 760) < 2, 'saved geometry that fits is restored as it was');
  for (const [W, H] of [[1280, 720], [900, 600], [700, 1000], [1100, 800], [1920, 1080]]) {
    await p.setViewport({ ...vp, width: W, height: H }); await settle(p); await settle(p);
    ok(await outOfView(p) === '', `live resize to ${W}x${H}: modules inside ${await outOfView(p)}`);
    const st = await p.evaluate(k => JSON.parse(localStorage.getItem(k)), WSKEY);
    ok(st.landscape.p0 && st.landscape.p0.w === 640, `live resize to ${W}x${H}: stored geometry untouched`);
  }
  const r1 = await rect(p, '#pn0'); ok(Math.abs(r1.w - 640) < 2 && Math.abs(r1.x - 760) < 2, 'back on the large viewport the saved geometry returns');
  ok(errors.length === 0, 'no errors while resizing');
  await closeGame(p);
}
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
