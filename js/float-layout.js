// Floating engine, part 5 of 7: layout policy. The default geometry (derived from the live viewport, the Classic/Duel preferences and the rendered modules), applying it
// together with the saved overrides, and resetting one module. Precedence: saved override for this orientation > default.
import { M, HUGE, GRIP_EDGE, ws, things, saved, savePopups, saveWS, html, orient, gid, toolsMin, clamp, inWs } from './float-core.js';
import { area, limits, setSize, setPos, applyGeom } from './float-geom.js';
import { clearFit, fitContent } from './float-fit.js';
import { syncTools } from './float-tools.js';

// ---------- default geometry: from the live viewport, the Classic/Duel preferences and the rendered modules ----------
function defaults(o) {
  const a = area(), d = html().dataset, T = things, g = {};
  const left = d.swap === 'true' ? 'p1' : 'p0', right = left === 'p0' ? 'p1' : 'p0';
  const histOn = d.hist === 'docked' && !T.hist.el.classList.contains('history-hidden');
  const dock = d.pdock || 'bottom';
  const anchor = (h, top, bot) => dock === 'top' ? top : dock === 'middle' ? top + (bot - top - h) / 2 : bot - h;
  const measure = (t, w) => { clearFit(t); t.el.style.removeProperty('height'); t.el.style.width = w + 'px'; return t.el.offsetHeight; };   // natural height: every module is re-applied right after
  setSize(T.board, Math.min(a.w, a.h) - 80);   // measure the board's chrome (padding + bag) near its final size, not at the CSS default width
  const bl = limits(T.board), extra = bl.extra, dMin = Math.min(240, Math.min(a.w, a.h - extra));   // the default board never starts smaller than 240px unless the screen forces it
  // Minimized Game Tools: same slot, but the layout is computed with the button's real footprint and filed under its own key.
  const fin = () => { if (toolsMin() && g.tools) { g.toolsMin = { x: g.tools.x, y: g.tools.y }; delete g.tools; } return g; };
  if (o === 'landscape') {
    // board centred and as tall as the screen allows; player panels hug it on both sides; controls under the right panel
    const s = clamp(Math.min(a.h - extra - GRIP_EDGE, a.w - 2 * 176 - 2 * M), dMin, HUGE);
    // A panel is sized from the board: seven rack tiles about one board cell wide (+ padding). Small boards keep the 300px floor of the original layout.
    const pMax = limits(T.p0).maxW, pCap = Math.min(pMax, Math.max(300, Math.round(0.58 * s + 24)));
    const colW = clamp((a.w - s) / 2 - M, 168, pCap), pw = clamp(colW, 160, pCap);
    if (a.w - s > Math.min(Math.round(0.32 * s), 360) + pCap + 4 * M + 80) {
      // Wide profile (shape decides, not a resolution): the free width beside the board holds a controls column plus a panel column, so the row becomes Board | Controls | Players.
      // (It used to ask for two whole panel columns, one each side; with the board now exactly the board, with no frame around it, that test flipped on ultrawide screens that had always been wide.)
      const cw = clamp(Math.round(0.32 * s), 168, Math.min(limits(T.ctrls).maxW, 360)), hp = measure(T[left], pw), hq = measure(T[right], pw), hc = measure(T.ctrls, cw), ht = measure(T.tools, cw);
      const total = s + M + cw + M + pw, x0 = Math.max(a.x0, a.x0 + (a.w - total) / 2), bh = s + extra, stackH = hp + M + hq;
      const yP = clamp(a.y0 + (bh - stackH) / 2, a.y0, Math.max(a.y0, a.y1 - stackH));
      g.board = { x: x0, y: a.y0, s };
      const yC = clamp(a.y0 + (bh - (hc + M + ht)) / 2, a.y0, Math.max(a.y0, a.y1 - hc - M - ht));   // Turn Controls over Game Tools, centred on the board
      g.ctrls = { x: x0 + s + M, y: yC, w: cw }; g.tools = { x: x0 + s + M, y: yC + hc + M, w: cw };
      g[left] = { x: x0 + s + M + cw + M, y: yP, w: pw }; g[right] = { x: x0 + s + M + cw + M, y: yP + hp + M, w: pw };
      const below = yP + stackH + M, room = a.y1 - below, wid = clamp(pw, 200, Math.min(limits(T.hist).maxW, a.w));
      g.hist = room >= 160 ? { x: g[left].x, y: below, w: wid, h: clamp(Math.min(room, 560), 160, a.h) }
        : { x: Math.max(a.x0, g[left].x), y: a.y0, w: wid, h: clamp(Math.min(a.h, 560), 160, a.h) };
      return fin();
    }
    const bx = a.x0 + (a.w - s) / 2, lx = Math.max(a.x0, bx - M - pw), rx = Math.min(a.x1 - pw, bx + s + M);
    // each side column is a player panel plus one control module: Turn Controls under the right panel, Game Tools under the left one
    const hp = measure(T[left], pw); measure(T[right], pw); const hc = measure(T.ctrls, pw), ht = measure(T.tools, pw);
    const yR = anchor(hp + M + hc, a.y0, a.y1), yL = anchor(hp + M + ht, a.y0, a.y1);
    g.board = { x: bx, y: a.y0, s };
    g[right] = { x: rx, y: yR, w: pw }; g[left] = { x: lx, y: yL, w: pw };
    g.ctrls = { x: rx, y: yR + hp + M, w: pw }; g.tools = { x: lx, y: yL + hp + M, w: pw };
    const wid = clamp(colW, 200, Math.min(560, a.w)), below = yL + hp + M + ht + M, room = a.y1 - below;
    g.hist = room >= 160 ? { x: Math.max(a.x0, lx + pw - wid), y: below, w: wid, h: clamp(Math.min(room, 560), 160, a.h) }
      : { x: Math.max(a.x0, lx), y: a.y0, w: wid, h: clamp(Math.min(a.h, 560), 160, a.h) };
  } else {
    // board on top at full width, the two panels side by side under it, controls under them
    const pw = Math.floor((a.w - M) / 2);
    // controls: Turn Controls and Game Tools share one row (about 3:2) while it is wide enough, else they stack; Turn Controls start on the reading side
    const rtl = getComputedStyle(document.body).direction === 'rtl', row = a.w >= 300;
    const mw = toolsMin() ? T.tools.el.offsetWidth : 0;   // minimized: Turn Controls take the row, the tools button sits at its end
    const tw = row ? (mw ? a.w - M - mw : Math.round((a.w - M) * 0.58)) : a.w, uw = mw || (row ? a.w - M - tw : a.w);
    const hp = measure(T[left], pw); measure(T[right], pw); const hc = measure(T.ctrls, tw), ht = measure(T.tools, uw);
    const rowH = row ? Math.max(hc, ht) : hc + M + ht;
    const s = clamp(Math.min(a.w - GRIP_EDGE, a.h - extra - M - hp - M - rowH - (histOn ? 150 + M : 0)), dMin, HUGE);
    const yP = a.y0 + s + extra + M, yC = yP + hp + M, below = yC + rowH + M;
    g.board = { x: a.x0 + (a.w - s) / 2, y: a.y0, s };
    g[left] = { x: a.x0, y: yP, w: pw }; g[right] = { x: a.x1 - pw, y: yP, w: pw };
    if (row) { g.ctrls = { x: rtl ? a.x1 - tw : a.x0, y: yC, w: tw }; g.tools = { x: rtl ? a.x0 : a.x1 - uw, y: yC, w: uw }; }
    else { g.ctrls = { x: a.x0, y: yC, w: a.w }; g.tools = { x: a.x0, y: yC + hc + M, w: a.w }; }
    const wid = clamp(Math.min(a.w, 380), 200, a.w);
    g.hist = histOn && a.y1 - below >= 150 ? { x: a.x0, y: below, w: a.w, h: Math.min(a.y1 - below, 560) }
      : { x: a.x0 + (a.w - wid) / 2, y: a.y0, w: wid, h: clamp(Math.min(a.h, 560, 0.7 * innerHeight), 160, a.h) };
  }
  return fin();
}

export function refreshWorkspace() {
  if (!ws.enabled || !things.board) return;
  const o = orient(), mods = Object.values(things).filter(t => t.def && !t.def.popup);
  syncTools();
  const D = mods.some(t => !ws[o][gid(t)]) ? defaults(o) : null;   // overrides are only clamped for display, never rewritten
  for (const t of mods) applyGeom(t, ws[o][gid(t)] || D[gid(t)]);
  const bt = things.board, a = area(), over = bt.el.getBoundingClientRect().bottom - a.y1;   // display-only guard: wrapper chrome can differ by a few px from the estimate
  if (over > 0.5 && !ws[o].board) { const w = bt.el.getBoundingClientRect().width; setSize(bt, w - over); setPos(bt, parseFloat(bt.el.style.left) || a.x0, parseFloat(bt.el.style.top) || a.y0); }
  for (const t of mods) fitContent(t);
}
function reflowPopups() {
  for (const t of Object.values(things)) if (t.isPopup && !inWs(t) && t.canMove() && t.el.matches('[open],.open')) { const r = t.el.getBoundingClientRect(); setPos(t, r.left, r.top); }
}
export const schedule = (() => { let f = 0; return () => { if (f) return; f = requestAnimationFrame(() => { f = 0; refreshWorkspace(); reflowPopups(); }); }; })();

export function resetOne(t) {
  const o = orient();
  if (ws.enabled && t.def && !t.def.popup) { delete ws[o][gid(t)]; saveWS(); }
  if (inWs(t)) return refreshWorkspace();
  delete saved[t.id]; savePopups(); if (t.def && t.id === 'dlg') t.el.style.removeProperty('width'); t.place();
}
