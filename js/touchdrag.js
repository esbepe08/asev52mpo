// Touch / pen drag and drop for tiles. A mouse keeps the browser's native drag and drop (js/input.js); on a phone the native one is unreliable (it needs a long press and
// shows a faint system ghost), so touch and pen use pointer events here. A tap is untouched (the click flow in input.js selects the tile); a drag begins once the finger has
// moved DRAG_START px. While dragging, a larger copy of the tile floats just above the fingertip so the hand never hides the target, and the square (or rack slot) under
// the copy is outlined when the tile may land there. Releasing drops it, releasing anywhere else puts it back. No game rule lives here: the drop targets are judged by the
// same canDropOn* functions the mouse path uses, and the result goes through the same place / unplace.
import { S, BY, inMove } from './state.js';
import { haptic } from './haptics.js';

const DRAG_START = 8;     // px of finger travel before a press becomes a drag
const MIN_GHOST = 44;     // px: never smaller than a comfortable tile, even on a tiny board
const GHOST_K = 1.5;      // ghost size = board square x GHOST_K
const LIFT = 0.85;        // the ghost's centre sits LIFT x its size above the fingertip
const CLICK_QUIET = 450;  // ms: how long the click a browser may send for a finished drag is waited for (and swallowed)

let g = null;             // the gesture in progress: { id, el, t, x0, y0, started, ghost, size, x, y, over }
let lastKind = 'mouse', swallowClick = false, swallowTimer = 0, api = null;

// True when the pointer that is currently pressing is a finger or a pen. input.js uses it to stop the browser's own drag from also starting.
export const isTouchGesture = () => lastKind !== 'mouse';

const isTouch = e => e.pointerType === 'touch' || e.pointerType === 'pen';

function begin(e) {
  const { el } = g, sq = document.querySelector('#board > .sq'), src = el.getBoundingClientRect();
  g.size = Math.max(MIN_GHOST, (sq ? sq.getBoundingClientRect().width : 0) * GHOST_K);
  const ghost = el.cloneNode(true), k = g.size / (src.width || g.size);
  ghost.removeAttribute('id'); ghost.removeAttribute('tabindex'); ghost.removeAttribute('draggable');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.classList.remove('pick', 'land', 'dim', 'swp', 'dragging');
  ghost.classList.add('dragGhost');
  // The tile's type is sized by container units that do not exist outside its rack or board, so the copy gets the source's computed sizes, scaled.
  for (const n of ghost.querySelectorAll('b, i')) {
    const s = el.querySelector(n.tagName.toLowerCase());
    if (s) n.style.fontSize = parseFloat(getComputedStyle(s).fontSize) * k + 'px';
  }
  ghost.style.width = ghost.style.height = g.size + 'px';
  document.body.append(ghost);
  g.ghost = ghost; g.started = true;
  el.classList.add('dragging');
  S.pick = null;
  haptic('tick');
}

// The element under the ghost's centre (the ghost itself is pointer-events:none, so it never hides what is below).
function targetAt(x, y) {
  const hit = document.elementFromPoint(x, y);
  return { sq: hit?.closest?.('.sq') || null, sl: hit?.closest?.('.slot') || null };
}
const centre = () => [g.x, g.y - g.size * LIFT];

function move(x, y) {
  g.x = x; g.y = y;
  g.ghost.style.transform = `translate(${x - g.size / 2}px, ${y - g.size * LIFT - g.size / 2}px) scale(1.06)`;
  const [cx, cy] = centre(), { sq, sl } = targetAt(cx, cy);
  const validSq = api.canDropOnSquare(sq, g.t), validSl = !validSq && api.canDropOnSlot(sl, g.t), over = validSq ? sq : validSl ? sl : null;
  api.clearDropTargets();
  if (over) api.markDropTarget(over, true);
  if (over && over !== g.over) haptic('tick');   // a light tick each time the tile reaches a new place it can land
  g.over = over;
}

function finish(drop) {
  const t = g.t, { sq, sl } = drop ? targetAt(...centre()) : { sq: null, sl: null };
  g.ghost.remove(); g.el.classList.remove('dragging'); api.clearDropTargets();
  swallowClick = true; clearTimeout(swallowTimer); swallowTimer = setTimeout(() => { swallowClick = false; }, CLICK_QUIET); g = null;
  if (api.canDropOnSquare(sq, t)) return api.place(t, Number(sq.dataset.r), Number(sq.dataset.c));
  if (api.canDropOnSlot(sl, t)) { api.unplace(inMove(t)); return api.render(); }
  api.render();   // dropped nowhere useful: the tile simply goes back (render restores the source's look)
}

// deps: { canDropOnSquare, canDropOnSlot, markDropTarget, clearDropTargets, place, unplace, render } from input.js
export function initTouchDrag(deps) {
  api = deps;
  document.addEventListener('pointerdown', e => {
    lastKind = e.pointerType || 'mouse';
    swallowClick = false;   // a new press: the drag's own click (if any) has come and gone, so a quick next tap is never eaten
    if (g || !e.isPrimary || !isTouch(e)) return;
    const el = e.target.closest?.('.tile');
    if (!el || el.getAttribute('draggable') !== 'true' || el.classList.contains('dim')) return;   // same tiles the mouse path lets you drag
    const t = BY[el.dataset.id];
    if (!t || S.ended || S.swap) return;
    g = { id: e.pointerId, el, t, x0: e.clientX, y0: e.clientY, started: false, ghost: null, size: 0, x: e.clientX, y: e.clientY, over: null };
  }, true);

  document.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    if (!g.started) {
      if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < DRAG_START) return;
      begin(e);
    }
    e.preventDefault();
    move(e.clientX, e.clientY);
  }, { passive: false });

  const up = e => { if (g && e.pointerId === g.id) { if (g.started) finish(true); else g = null; } };
  const cancel = e => { if (g && e.pointerId === g.id) { if (g.started) finish(false); else g = null; } };
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', cancel, true);

  // The click a browser may still send for the finger that just dragged must not also select or place the tile.
  document.addEventListener('click', e => {
    if (swallowClick) { swallowClick = false; e.stopPropagation(); e.preventDefault(); }
  }, true);
}
