// Floating engine, part 4 of 7: Game Tools. The five tool buttons live in #tools while the workspace is ON (and in the Turn Controls group otherwise); the module can be
// minimized to a single button and restored, each state keeping its own saved geometry.
import { ws, things, toolsMin, gid, clamp, orient } from './float-core.js';
import { area, limits, setSize, setPos, geomOf, commit } from './float-geom.js';
import { fitContent } from './float-fit.js';

// Game Tools: the five tool buttons are moved into #tools while the workspace is ON and back, in their original order, when it is OFF. Same elements (listeners, ids,
// state intact), so the structured default layout is exactly the single group it always was.
const TOOL_IDS = ['bJudge', 'bLog', 'bFs', 'bSettings', 'bNew'];
let homeOrder = null;
export function dockTools(on) {
  const turn = document.querySelector('.ctrls:not(#tools)'), tools = document.getElementById('tools');
  if (!turn || !tools) return;
  if (on) {
    homeOrder ??= [...turn.querySelectorAll(':scope > .btn')].map(b => b.id);
    tools.classList.add('ctrls');   // it is a button rack like the other one: every .ctrls rule (grid, button styles, container sizing) applies
    for (const id of TOOL_IDS) { const b = document.getElementById(id); if (b) tools.append(b); }
    ensureToggle(tools);
  } else {
    document.getElementById('toolsToggle')?.remove();
    delete tools.dataset.min;
    tools.classList.remove('ctrls');
    for (const id of homeOrder || []) { const b = document.getElementById(id); if (b) turn.append(b); }
  }
}
// ---- Game Tools: minimize / restore ----
const ICON = { fold: 'M5 12h14', apps: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z' };
export function syncTools() {   // idempotent: touches the DOM only when something actually changed, so a refresh never invalidates styles for nothing
  const t = things.tools; if (!t) return;
  const min = toolsMin(), v = String(min);
  if (t.el.dataset.min !== v) t.el.dataset.min = v;
  const b = document.getElementById('toolsToggle'); if (!b) return;
  const txt = min ? 'أدوات اللعبة' : 'طي أدوات اللعبة', path = b.querySelector('path'), d = min ? ICON.apps : ICON.fold;
  if (b.getAttribute('aria-expanded') !== String(!min)) b.setAttribute('aria-expanded', String(!min));
  if (b.getAttribute('aria-label') !== txt) { b.setAttribute('aria-label', txt); b.title = txt; }
  if (path.getAttribute('d') !== d) path.setAttribute('d', d);
}
// Collapse/expand around the corner nearest to the module, so the module grows out of (or shrinks into) the spot the user tapped, then remember the result.
function setToolsMin(min) {
  const t = things.tools, o = orient(), a = area();
  if (!t || !ws.enabled || min === toolsMin()) return;
  const r = t.el.getBoundingClientRect(), right = r.left + r.width / 2 > (a.x0 + a.x1) / 2, bottom = r.top + r.height / 2 > (a.y0 + a.y1) / 2;
  // Toggling a secondary tool must not shift anything else: modules still following the computed defaults (which depend on this state, e.g. the board height in
  // portrait) are pinned where they are right now before the state changes.
  for (const m of Object.values(things)) if (m.def && !m.def.popup && !ws[o][gid(m)]) ws[o][gid(m)] = geomOf(m);
  if (min) ws[o].tools = geomOf(t);   // the expanded layout is kept, so restoring brings back the size the user had
  ws.tools = min ? 'min' : 'open'; syncTools(); fitContent(t);
  if (!min) { const sv = ws[o].tools; if (sv?.h == null) t.el.style.removeProperty('height'); setSize(t, sv?.w ?? clamp(Math.round(Math.min(a.w, a.h) * 0.62), 160, limits(t).maxW), sv?.h); }
  const n = t.el.getBoundingClientRect();
  let y = bottom ? r.bottom - n.height : r.top;
  const c = things.ctrls && things.ctrls.el.getBoundingClientRect();   // Turn Controls are the frequent controls: a restored module slides clear of them, away from the edge it grew from
  if (!min && c && n.left < c.right && n.left + n.width > c.left && y < c.bottom && y + n.height > c.top) y = bottom ? c.top - 8 - n.height : c.bottom + 8;
  setPos(t, right ? r.right - n.width : r.left, y);
  commit(t);   // files the geometry under the new state's key and persists the state
}
function ensureToggle(tools) {
  let b = document.getElementById('toolsToggle'); if (b) return b;
  b = document.createElement('button'); b.type = 'button'; b.id = 'toolsToggle'; b.className = 'toolsToggle'; b.setAttribute('aria-controls', 'tools');
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path/></svg>';
  tools.append(b); bindToolsToggle(things.tools, b); return b;
}
// Expanded: a plain collapse button. Minimized: the button IS the module, so the same element is also its drag handle (a short press toggles, a drag moves).
function bindToolsToggle(t, b) {
  let d = null, swallow = false;
  b.addEventListener('pointerdown', e => {
    if (e.button || !toolsMin()) return;
    const r = t.el.getBoundingClientRect(); d = { x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, moved: false };
    try { b.setPointerCapture(e.pointerId); } catch { /* not capturable: dragging just ends on release */ }
  });
  b.addEventListener('pointermove', e => {
    if (!d) return;
    if (!d.moved) { if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return; d.moved = true; t.el.classList.add('flActive'); }
    setPos(t, e.clientX - d.ox, e.clientY - d.oy);
  });
  const end = () => {
    if (!d) return; const moved = d.moved; d = null; t.el.classList.remove('flActive');
    if (moved) { swallow = true; setTimeout(() => { swallow = false; }, 0); commit(t); }   // the click that follows a drag must not toggle
  };
  b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
  b.addEventListener('click', () => { if (swallow) { swallow = false; return; } setToolsMin(!toolsMin()); });
  b.addEventListener('keydown', e => {
    if (!toolsMin() || !e.key.startsWith('Arrow')) return;
    e.preventDefault(); const step = e.shiftKey ? 48 : 12, r = t.el.getBoundingClientRect();
    setPos(t, r.left + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0), r.top + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0)); commit(t);
  });
}
