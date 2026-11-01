// Floating engine, part 1 of 7: shared state and registry. The persisted state (popup positions, workspace geometry, Game Tools state), the module table
// (DEFS), the registry of live things, and the z-order. Everything else in js/float-*.js builds on this file; it imports nothing of the engine itself.
//   float-core.js    state, registry, z-order            float-fit.js     vertical fit: content adapts to a pinned height
//   float-geom.js    viewport, limits, size/pos, persist  float-tools.js   Game Tools: dock, minimize, restore
//   float-layout.js  default geometry, refresh            float-input.js   move handles, resize grips, wheel
//   float-popups.js  settings / dialogue / drawer, lock   float.js         public API + Floating Workspace on/off
// Pure UI: no game state is read or written here.
import { nameOf } from './names.js';

const LEGACY = 'scrabble.float', WSKEY = 'scrabble.floatWorkspace.v2';
export const M = 8;   // margin kept free around the usable area (px)
const ORI = ['portrait', 'landscape'];
export const html = () => document.documentElement;
const read = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

// ---------- persisted state ----------
export const saved = read(LEGACY) || {};                                  // popups: { id: [x, y] } (the dialogue adds a third value: its chosen width)
export const ws = { enabled: false, tools: 'auto', portrait: {}, landscape: {} };      // workspace: per orientation { id: {x, y, s | w, h?} }; tools: 'auto' | 'open' | 'min' (Game Tools state)
{
  const s = read(WSKEY);
  if (s && s.v === 2) {
    ws.enabled = s.enabled === true;
    if (s.tools === 'open' || s.tools === 'min') ws.tools = s.tools;   // only an explicit user choice is stored; 'auto' follows the screen
    for (const o of ORI) for (const [id, g] of Object.entries(s[o] || {}))
      if (g && typeof g === 'object' && Object.values(g).every(Number.isFinite)) ws[o][id] = g;
  }
}
export const saveWS = () => write(WSKEY, { v: 2, enabled: ws.enabled, ...(ws.tools !== 'auto' && { tools: ws.tools }), portrait: ws.portrait, landscape: ws.landscape });

// Game Tools can be minimized to a single small button. Until the user chooses, the state follows the screen: compact screens (shortest side under COMPACT CSS px, so
// phones in either orientation and small windows) start minimized; larger ones start expanded. An explicit choice is kept. Each state keeps its own saved geometry
// ('tools' = expanded, 'toolsMin' = the button), so neither overwrites the other.
const COMPACT = 600;
export const toolsMin = () => ws.tools === 'min' || (ws.tools !== 'open' && Math.min(innerWidth, innerHeight) < COMPACT);
export const gid = t => t.id === 'tools' && toolsMin() ? 'toolsMin' : t.id;
export const savePopups = () => write(LEGACY, saved);

export const orient = () => innerWidth > innerHeight ? 'landscape' : 'portrait';
export const HUGE = 20000, GRIP_EDGE = 3;   // GRIP_EDGE: the board's grip glyph reaches 3px past the area margin when the board is flush with the corner

// ---------- module table ----------
// axes: 's' = square (board, 1:1), 'x' = width only, 'xy' = both.
// flex: an 'xy' module whose height is OPTIONAL. Until the player drags vertically its height follows the content (exactly as before); once a height is set (pinned) the
// content adapts to the box: a rack re-flows into rows of square tiles, buttons re-flow into the roomiest grid (see fitContent). Double-click on a handle un-pins it.
export const DEFS = {
  board: { sel: '.boardWrap', axes: 's', label: 'اللوح' },
  p0: { sel: '#pn0', axes: 'xy', flex: true, get label() { return nameOf(0); } },   // the players' labels follow their names (see relabel)
  p1: { sel: '#pn1', axes: 'xy', flex: true, get label() { return nameOf(1); } },
  ctrls: { sel: '.ctrls', axes: 'xy', flex: true, label: 'أزرار الدور' },          // Turn Controls
  tools: { sel: '#tools', axes: 'xy', flex: true, label: 'أدوات اللعبة' },        // Game Tools
  hist: { axes: 'xy', label: 'سجل الكلمات' },
  dlg: { axes: 'x', label: 'النافذة', popup: true }   // popup geometry [x, y, w] in scrabble.float; resizable in every mode
};
export const things = {};   // id -> { id, el, def, isPopup, canMove(), canResize(), place() }
// z-index bands (bounded and deterministic, never an ever-growing counter). STRICT HIERARCHY, lowest to highest:
//   Board 10  <  player panels 20-2x (+ the docked word log)  <  Turn Controls 30  <  Game Tools 32  <  popups 40+ (settings, open word-log drawer)  <  dialogue 50
//   <  native modal dialogs (top layer)  <  PWA notices.
// THE BOARD IS THE BASE LAYER OF THE FLOATING WORKSPACE, and the two control modules sit on fixed rungs above it: interacting with any module (click, drag, resize,
// tile placement) re-ranks only the player panels among themselves, so the board can never be lifted over a control and a control can never be buried by a rack.
const BASE = { board: 10, mod: 20, turn: 30, tools: 32, pop: 40, dlg: 50 };
export const order = { mod: [], pop: [], dlg: [] };
const FIXED = { ctrls: BASE.turn, tools: BASE.tools };   // modules that never change rung
export const inWs = t => ws.enabled && !!t.def && !t.def.popup;
// The word log is a foreground module while docked, but an on-demand overlay in drawer mode: then it belongs with the popups.
const bandOf = t => t.id === 'dlg' ? 'dlg' : t.id === 'hist' && html().dataset.hist === 'drawer' ? 'pop' : inWs(t) ? 'mod' : 'pop';
export function raise(t) {
  if (typeof t === 'string') t = things[t];
  if (!t) return;
  if (t.id === 'board') { if (inWs(t)) t.el.style.zIndex = BASE.board; return; }   // never promoted: see above
  if (FIXED[t.id]) { if (inWs(t)) t.el.style.zIndex = FIXED[t.id]; return; }
  for (const b of Object.values(order)) { const i = b.indexOf(t); if (i >= 0) b.splice(i, 1); }
  const k = bandOf(t); order[k].push(t);
  order[k].forEach((x, i) => { x.el.style.zIndex = BASE[k] + i; });   // ranks inside a band: bounded, never an ever-growing counter
}
