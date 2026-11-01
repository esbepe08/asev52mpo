// Floating engine. One implementation of move / resize / clamp / raise / persist, used by two kinds of thing:
//   popups   Settings (#ad), the word-log drawer (#hist) and the gameplay dialogue (#dlg). Always movable and remembered per device.
//            The dialogue is also always resizable (width only), with or without Floating Workspace.
//   modules  Board, player panels, Turn Controls, Game Tools and word log: movable AND resizable (panels and control modules on BOTH axes), but only while "Floating Workspace" is ON.
//            Game Tools is the second half of the old button rack: while ON its buttons live in #tools (a separate module), and leaving restores one group.
// Architecture: the default layout is stable CSS (not adjustable from Settings); Floating Workspace is the optional direct-manipulation
// layer (it sets <html data-floating="true"> plus inline left/top/size); messages (toast, dialogue) float in every mode, independent of it.
// Turning the workspace off removes the attribute, handles and inline geometry, so the normal CSS layout is back at once.
// Precedence while ON:  saved override for this orientation  >  default derived from the viewport, the layout preference and the rendered modules.
// Storage: scrabble.float (popup positions, unchanged format) and scrabble.floatWorkspace.v2 (on/off + per-orientation geometry). Every saved module
// also remembers the area (aw, ah) and its own height (bh) it was saved in, so a different viewport maps the layout proportionally (see applyGeom).
// Pure UI: no game state is read or written here.
//
// Module map (all in js/): float-core.js (state, registry, z-order) · float-geom.js (viewport, limits, apply/commit) · float-fit.js (vertical fit) · float-tools.js (Game Tools)
// · float-layout.js (defaults, refresh) · float-input.js (handles, grips, wheel) · float-popups.js (popups, input lock). This file is the public API the rest of the app
// imports, plus the Floating Workspace on/off switch.
import { DEFS, ws, things, order, html, toolsMin, saveWS, raise } from './float-core.js';
import { clearInline } from './float-geom.js';
import { fitContent } from './float-fit.js';
import { dockTools } from './float-tools.js';
import { refreshWorkspace, schedule } from './float-layout.js';
import { addChrome, removeChrome, bindWheel } from './float-input.js';
import { showFloat } from './float-popups.js';
export { raise, refreshWorkspace };
export { makeFloating, showFloat, autoPos, resetFloats, lockGame, gameInert } from './float-popups.js';

// ---------- Floating Workspace on/off ----------
export const isFloating = () => ws.enabled;
// The online match bar is only a floating thing while it is shown and the workspace is ON; keep it on screen when the window changes.
const placeNet = () => { const n = things.net; if (n && ws.enabled && !n.el.hidden) n.place(); };
export const placeNetBar = placeNet;
export function initWorkspace() {   // after buildDom(): the player panels exist now
  for (const id of ['board', 'p0', 'p1', 'ctrls', 'tools']) {
    const el = document.querySelector(DEFS[id].sel);
    const t = things[id] = { id, el, def: DEFS[id], isPopup: false, canMove: () => ws.enabled, canResize: () => ws.enabled && !(id === 'tools' && toolsMin()) };
    if (id !== 'board') el.addEventListener('pointerdown', () => raise(t), true);   // board interaction never takes part in foreground ordering
    bindWheel(t);
  }
  // Content can change a module's height after layout (counter row, rack, labels, fonts): re-fit then, but never while the user is dragging one.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => { if (ws.enabled) for (const id of ['p0', 'p1', 'ctrls', 'tools']) fitContent(things[id]); if (ws.enabled && !document.querySelector('.flActive')) schedule(); });
    for (const id of ['board', 'p0', 'p1', 'ctrls', 'tools']) ro.observe(things[id].el);
    for (const id of ['p0', 'p1']) { const rk = things[id].el.querySelector('.rack'); if (rk) ro.observe(rk); }   // the tray's own box changes with the header
  }
  // The game redraws the racks' slots after every move: lay the fresh slots out again (a no-op unless the panel's height is pinned).
  if (typeof MutationObserver !== 'undefined') for (const id of ['p0', 'p1']) {
    const rk = things[id].el.querySelector('.rack'); if (rk) new MutationObserver(() => { if (ws.enabled) fitContent(things[id]); }).observe(rk, { childList: true });
  }
  if (things.dlg) addChrome(things.dlg);   // the dialogue's grip is permanent; the workspace modules get theirs only while ON
  addEventListener('resize', () => { schedule(); placeNet(); }); addEventListener('orientationchange', () => { schedule(); placeNet(); });
  document.fonts?.ready.then(schedule);
  if (ws.enabled) enter();
}

function enter() {
  html().dataset.floating = 'true';
  dockTools(true);
  for (const t of Object.values(things)) if (t.def) addChrome(t);
  for (const b of Object.values(order)) b.length = 0;
  for (const t of Object.values(things)) if (t.def && !t.def.popup) t.el.style.removeProperty('z-index');   // stale inline z-index never overrides the layering
  refreshWorkspace();
  for (const id of ['board', 'p0', 'p1', 'ctrls', 'tools']) raise(id);
  if (things.hist) raise('hist');
  placeNet();
}
function leave() {
  delete html().dataset.floating;
  for (const t of Object.values(things)) {
    if (!t.def) continue;
    if (t.def.popup) continue;   // the dialogue is independent of the workspace
    removeChrome(t); clearInline(t);
  }
  dockTools(false);
  { const n = things.net; if (n) for (const p of ['left', 'top', 'width', 'height', 'z-index']) n.el.style.removeProperty(p); }   // back into the page flow
  for (const b of Object.values(order)) b.length = 0;
  const h = things.hist; if (h && h.el.classList.contains('open')) showFloat('hist');   // drawer open: back to its remembered popup spot
}
export function setFloating(on) {
  on = !!on; if (on === ws.enabled) return;
  ws.enabled = on; saveWS();
  if (on) enter(); else leave();
}
// Layout preference / dimension change while ON: modules without an override follow the new defaults.
export const refresh = schedule;
