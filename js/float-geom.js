// Floating engine, part 2 of 7: geometry. The usable viewport (safe-area aware), the size limits of each module, applying a saved geometry (with proportional mapping
// to another viewport), reading what is on screen, and committing it to storage. No layout policy here (that is float-layout.js).
import { M, HUGE, GRIP_EDGE, ws, saved, saveWS, savePopups, toolsMin, gid, clamp, orient, inWs } from './float-core.js';
import { fitContent, clearFit } from './float-fit.js';

// ---------- viewport: safe-area aware, never relies on 100vh ----------
let probe;
export function area() {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.append(probe);
  }
  const c = getComputedStyle(probe), p = k => parseFloat(c[k]) || 0;
  const a = { x0: p('paddingLeft') + M, y0: p('paddingTop') + M, x1: innerWidth - p('paddingRight') - M, y1: innerHeight - p('paddingBottom') - M };
  a.w = Math.max(0, a.x1 - a.x0); a.h = Math.max(0, a.y1 - a.y0);
  return a;
}
// Popups are kept inside the screen. Workspace modules (loose = true) may be ANY size: one that fits stays fully inside, one that is larger than the screen can be panned
// so that every edge, and with it every handle, can be brought into view (the pan range flips: [right edge flush .. left edge flush]). e = room for hanging chrome.
const clampPos = (x, y, w, h, loose = false, e = 0) => {
  const a = area();
  if (!loose) return [clamp(x, a.x0, a.x1 - w), clamp(y, a.y0, a.y1 - h)];
  const rx = [a.x1 - w - e, a.x0], ry = [a.y1 - h - e, a.y0];
  return [clamp(x, Math.min(...rx), Math.max(...rx)), clamp(y, Math.min(...ry), Math.max(...ry))];
};

// FLOATING WORKSPACE HAS NO MAXIMUM SIZE. Every module can be made as large as the player wants (HUGE only guards the browser's own layout limits); the sole floor is a size
// at which the module is still a visible, grabbable thing. Content scales with the module (see setUnit and css/float.css), so any size stays proportionate.
// The gameplay dialogue is a popup in every mode, not a workspace module, and keeps its original range.
export function limits(t) {
  const a = area(), id = t.id;
  if (id === 'board') {
    const b = t.el.querySelector('.board'), extra = Math.max(0, t.el.offsetHeight - (b ? b.offsetHeight : 0));
    return { minW: 64, maxW: HUGE, extra };
  }
  if (id === 'hist') return { minW: 140, maxW: HUGE, minH: 90, maxH: HUGE };
  if (id === 'ctrls') return { minW: 72, maxW: HUGE, minH: 64, maxH: HUGE };
  if (id === 'tools') return { minW: 56, maxW: HUGE, minH: 64, maxH: HUGE };
  if (id === 'dlg') return { minW: 260, maxW: Math.min(a.w, 560) };
  return { minW: 96, maxW: HUGE, minH: 72, maxH: HUGE };   // player panels
}
// Proportional content: each module publishes --fu (its "float unit") from its own width; css/float.css multiplies type, padding, gaps and buttons by it.
// 1 = the original sizes. Above the reference width everything grows in step with the module; below the floor width everything shrinks in step, in between nothing
// changes, so a layout the player never touches looks exactly as before.
const UNIT = { p0: [160, 400], p1: [160, 400], ctrls: [100, 360], tools: [100, 360] };
function setUnit(t, w) {
  const u = UNIT[t.id]; if (!u || !inWs(t)) return;
  t.el.style.setProperty('--fu', (w < u[0] ? w / u[0] : w < u[1] ? 1 : w / u[1]).toFixed(3));
}

// ---------- applying geometry ----------
export function setSize(t, w, h) {
  const L = limits(t), el = t.el;
  if (t.def.axes === 's') { el.style.setProperty('--float-board-size', clamp(w, L.minW, L.maxW) + 'px'); return; }
  const cw = clamp(w, L.minW, L.maxW); el.style.width = cw + 'px'; setUnit(t, cw);
  if (t.def.axes === 'xy' && h != null) el.style.height = clamp(h, L.minH, L.maxH) + 'px';
  fitContent(t);
}
export function setPos(t, x, y) {
  const r = t.el.getBoundingClientRect(), [px, py] = clampPos(x, y, r.width, r.height, inWs(t), t.id === 'board' ? GRIP_EDGE : 0);
  t.el.style.left = px + 'px'; t.el.style.top = py + 'px';
}
export function geomOf(t) {   // what is on screen right now, in storable form (+ the area it was measured in, so another viewport can map it proportionally)
  const r = t.el.getBoundingClientRect(), a = area(), g = { x: r.left, y: r.top };
  if (t.def.axes === 's') g.s = r.width; else g.w = r.width;
  if (t.def.axes === 'xy' && (!t.def.flex || t.el.style.height)) g.h = r.height;   // a flex module stores a height only if the player pinned one
  g.bh = r.height; g.aw = a.w; g.ah = a.h;
  return g;
}
// Restore a saved geometry. Same area: exactly as saved. Different area (window resized, other screen, rotated back): the layout is mapped, not re-defaulted and not
// merely clamped: sizes scale uniformly by the limiting axis, and positions keep their share of the free space (a module that was flush right stays flush right,
// a centred one stays centred), then everything is clamped to this viewport's limits. The saved values themselves are never rewritten by a mere viewport change.
export function applyGeom(t, g) {
  const a = area(), mapped = g.aw > 0 && g.ah > 0 && (Math.abs(a.w - g.aw) > 1 || Math.abs(a.h - g.ah) > 1);
  const k = mapped ? Math.min(a.w / g.aw, a.h / g.ah) : 1;
  if ((g.s != null || g.w != null) && !(t.id === 'tools' && toolsMin())) {   // the minimized button has a fixed footprint
    let sz = (g.s ?? g.w) * k;
    // A record without the area it was saved in (older format) cannot be mapped, so it is shown within this screen; records that carry their area keep their proportions at any size.
    if (!(g.aw > 0 && g.ah > 0)) sz = Math.min(sz, t.def.axes === 's' ? Math.min(a.w, a.h - limits(t).extra) : a.w);
    if (t.def.flex && g.h == null) t.el.style.removeProperty('height');   // no stored height: the content decides again
    setSize(t, sz, g.h != null ? g.h * k : undefined);
  }
  if (!mapped) return setPos(t, g.x, g.y);
  const r = t.el.getBoundingClientRect(), w0 = g.s ?? g.w ?? r.width;
  const fx = clamp((g.x - a.x0) / Math.max(1, g.aw - w0), 0, 1), fy = clamp((g.y - a.y0) / Math.max(1, g.ah - (g.bh ?? r.height)), 0, 1);
  setPos(t, a.x0 + fx * Math.max(0, a.w - r.width), a.y0 + fy * Math.max(0, a.h - r.height));
}

// ---------- commit (only on pointerup / keyboard step, never while moving) ----------
export function commit(t, resized) {
  const r = t.el.getBoundingClientRect(), o = orient();
  if (ws.enabled && t.def && !t.def.popup) { ws[o][gid(t)] = geomOf(t); saveWS(); return; }
  const rec = [r.left, r.top];
  if (t.def?.popup && (resized || saved[t.id]?.[2])) rec.push(r.width);   // width is only remembered once the user has chosen one
  saved[t.id] = rec; savePopups();
}

export const clearInline = t => { clearFit(t); for (const p of ['left', 'top', 'width', 'height', 'z-index', '--float-board-size', '--fu']) t.el.style.removeProperty(p); };
