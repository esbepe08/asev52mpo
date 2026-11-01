// Floating engine, part 7 of 7 (with float.js): popups and the input lock. Settings (#ad), the gameplay dialogue (#dlg) and the word-log drawer (#hist) are movable
// popups remembered per device; the lock keeps the game behind a dialogue frozen however the dialogue looks.
import { DEFS, ws, things, saved, savePopups, saveWS, orient, inWs, raise } from './float-core.js';
import { area, setSize, setPos } from './float-geom.js';
import { refreshWorkspace } from './float-layout.js';
import { bindHandle } from './float-input.js';

// ---------- popups: settings, gameplay dialogue, word-log drawer ----------
const isFixed = t => getComputedStyle(t.el).position === 'fixed' && !t.el.classList.contains('dlgModal');
// opts.def: DEFS entry that makes this popup resizable: 'hist' only while Floating Workspace is ON, 'dlg' always
export function makeFloating(el, id, handle, defPos, opts = {}) {
  const t = things[id] = { id, el, handle, def: opts.def ? DEFS[opts.def] : null, isPopup: true };
  t.canMove = () => isFixed(t);
  t.canResize = () => !!t.def && (t.def.popup || ws.enabled) && isFixed(t);   // the dialogue never needs the workspace
  t.place = () => {
    if (inWs(t)) return refreshWorkspace();
    if (t.def?.popup) { const w = saved[id]?.[2]; if (w) setSize(t, w); else el.style.removeProperty('width'); }   // width first: the default spot depends on it
    const p = saved[id] || defPos(el); setPos(t, p[0], p[1]);
  };
  handle.classList.add('floatHandle'); handle.tabIndex = 0;
  handle.title = 'اسحب لتحريك النافذة · مزدوج النقر لإعادة الموضع';
  el.addEventListener('pointerdown', () => raise(t), true);
  bindHandle(t, handle);
}
export function showFloat(id) { const t = things[id]; if (t) { t.place(); raise(t); } }
// Default spot for the gameplay dialogue: the free corner/edge that hides the least of the board, the racks and the controls.
export function autoPos(el) {
  const a = area(), w = el.offsetWidth, h = el.offsetHeight;
  const rects = [['#board', 4], ['.panel.on .rack', 5], ['.rack', 2], ['.ctrls', 2.5], ['.panel', 1]]
    .flatMap(([s, k]) => [...document.querySelectorAll(s)].map(n => [n.getBoundingClientRect(), k])).filter(([r]) => r.width && r.height);
  const xs = [a.x0, (a.x0 + a.x1 - w) / 2, a.x1 - w], ys = [a.y0, (a.y0 + a.y1 - h) / 2, a.y1 - h];
  const tries = orient() === 'portrait' ? [[1, 0], [1, 2], [0, 0], [2, 0], [0, 2], [2, 2], [0, 1], [2, 1], [1, 1]]
    : [[0, 0], [2, 0], [0, 2], [2, 2], [0, 1], [2, 1], [1, 0], [1, 2], [1, 1]];
  let best = null;
  for (const [i, j] of tries) {
    const x = xs[i], y = ys[j]; let sc = 0;
    for (const [r, k] of rects) sc += k * Math.max(0, Math.min(x + w, r.right) - Math.max(x, r.left)) * Math.max(0, Math.min(y + h, r.bottom) - Math.max(y, r.top));
    if (!best || sc < best.sc - 1) best = { sc, x, y };
  }
  return [best.x, best.y];
}
// Resets popup positions and workspace geometry only; theme, layout, game state and history are not touched.
export function resetFloats() {
  for (const k of Object.keys(saved)) delete saved[k]; savePopups(); ws.portrait = {}; ws.landscape = {}; saveWS();
  if (ws.enabled) refreshWorkspace();
  for (const t of Object.values(things)) if (t.isPopup && !inWs(t) && t.canMove() && (t.id === 'net' ? !t.el.hidden : t.el.matches('[open],.open'))) { if (t.id === 'dlg') t.el.style.removeProperty('width'); t.place(); }
}

// ---------- input lock: how a dialogue looks never decides whether the game behind it can be touched ----------
const locks = new Set();
function applyLocks() {
  document.querySelectorAll('.app > *').forEach(n => { n.inert = locks.has('dlg') || (locks.has('settings') && n.id !== 'hist'); });
}
export function lockGame(reason, on) { if (on) locks.add(reason); else locks.delete(reason); applyLocks(); }
// While the settings window floats (non-modal) the game behind it stays frozen, exactly as the old modal did.
export const gameInert = on => lockGame('settings', on);
