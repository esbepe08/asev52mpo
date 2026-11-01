// Floating engine, part 6 of 7: direct manipulation. The move handle and resize grip every module/popup gets (pointer + keyboard), the chrome that carries them, and
// Ctrl/Cmd + wheel zoom. Everything is committed once, on pointer-up / key step, never while moving.
import { onNamesChange } from './names.js';
import { haptic } from './haptics.js';
import { ws, things, clamp, raise } from './float-core.js';
import { area, setSize, setPos, commit } from './float-geom.js';
import { pinned, unpin, naturalHeight } from './float-fit.js';
import { resetOne } from './float-layout.js';

const VDRAG = 6, SNAP = 10;   // px: vertical travel before a drag pins the height / distance from the automatic height within which it snaps back to automatic

// ---------- pointer + keyboard behaviour shared by every move handle and resize grip ----------
const flag = (t, on) => t.el.classList.toggle('flActive', on);
export function bindHandle(t, h) {
  let drag = null, raf = 0;
  h.addEventListener('pointerdown', e => {
    if (e.button || !t.canMove()) return;
    const r = t.el.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    h.setPointerCapture(e.pointerId); e.preventDefault(); raise(t); flag(t, true);
  });
  h.addEventListener('pointermove', e => {
    if (!drag) return; drag.x = e.clientX - drag.dx; drag.y = e.clientY - drag.dy;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (drag) setPos(t, drag.x, drag.y); });
  });
  const end = () => {
    if (!drag) return; cancelAnimationFrame(raf); raf = 0;
    if (drag.x != null) setPos(t, drag.x, drag.y);
    drag = null; flag(t, false); commit(t);
  };
  h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
  h.addEventListener('dblclick', () => { if (t.canMove()) resetOne(t); });
  h.addEventListener('keydown', e => {
    if (!t.canMove() || e.altKey || e.ctrlKey || e.metaKey) return;
    const s = e.shiftKey ? 64 : 16, r = t.el.getBoundingClientRect();
    const mv = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[e.key];
    if (mv) { e.preventDefault(); setPos(t, r.left + mv[0], r.top + mv[1]); commit(t); return; }
    const grow = { '+': s, '=': s, '-': -s, _: -s }[e.key];   // keyboard resize that leaves the arrow keys to movement
    if (grow && t.canResize()) { e.preventDefault(); resizeBy(t, grow, t.def.flex && !pinned(t) ? null : grow); }
  });
  h.addEventListener('focus', () => raise(t));
}
function resizeBy(t, dw, dh) {
  const r = t.el.getBoundingClientRect(), a = area(), ax = t.def.axes;
  if (ax === 's') setSize(t, r.width + dw, 0);
  else if (t.def.popup) setSize(t, Math.min(r.width + dw, a.x1 - r.left));
  else setSize(t, r.width + dw, ax === 'xy' && dh != null ? r.height + dh : null);
  setPos(t, r.left, r.top); commit(t, true);
}
function bindGrip(t, g) {
  let rs = null, raf = 0;
  const apply = e => {
    const a = area(), r = t.el.getBoundingClientRect(), dx = e.clientX - rs.x, dy = e.clientY - rs.y, ax = t.def.axes;
    if (ax === 's') { const d = Math.abs(dx) >= Math.abs(dy) ? dx : dy; setSize(t, rs.w + d, 0); setPos(t, r.left, r.top); }   // no maximum: the board grows past the screen and is panned with its strip
    else if (t.def.popup) { setSize(t, rs.w + dx); setPos(t, r.left, r.top); }   // a popup against the right edge grows by sliding left instead of refusing
    else if (t.def.flex) {   // width always; height only once the player really drags vertically (then it is pinned and the content fits the box)
      if (!rs.v && (rs.pin || Math.abs(dy) > VDRAG)) { rs.v = true; rs.oy = rs.pin ? rs.y : e.clientY; }   // the height starts from where the drag became vertical: no jump
      if (!rs.v) setSize(t, rs.w + dx, null);
      else {
        setSize(t, rs.w + dx, rs.h + (e.clientY - rs.oy));
        // magnetic: close to the height the content would have anyway -> go back to automatic (and tick once, as a finger or a click would feel it)
        if (Math.abs(t.el.getBoundingClientRect().height - naturalHeight(t)) <= SNAP) { unpin(t); if (!rs.snapped) { rs.snapped = true; haptic('tick'); } }
        else rs.snapped = false;
      }
      setPos(t, r.left, r.top);
    } else { setSize(t, rs.w + dx, ax === 'xy' ? rs.h + dy : null); if (ax === 'x') setPos(t, r.left, r.top); }
  };
  g.addEventListener('pointerdown', e => {
    if (e.button || !t.canResize()) return;
    const r = t.el.getBoundingClientRect(); rs = { x: e.clientX, y: e.clientY, w: r.width, h: r.height, pin: pinned(t), v: false, oy: e.clientY, snapped: false };
    g.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation(); raise(t); flag(t, true);
  });
  g.addEventListener('pointermove', e => { if (rs && !raf) raf = requestAnimationFrame(() => { raf = 0; if (rs) apply(e); }); });
  const end = e => {
    if (!rs) return; cancelAnimationFrame(raf); raf = 0;
    if (e.type === 'pointerup') apply(e);
    rs = null; flag(t, false); commit(t, true);
  };
  g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
  g.addEventListener('keydown', e => {
    if (e.key === 'Home' && t.def.flex && t.canResize()) { e.preventDefault(); unpin(t); commit(t, true); return; }   // keyboard way back to automatic height
    const s = e.shiftKey ? 64 : 16, d = { ArrowRight: s, ArrowDown: s, ArrowLeft: -s, ArrowUp: -s }[e.key];
    if (!d || !t.canResize()) return;
    e.preventDefault();
    if (!t.def.flex) return resizeBy(t, d, d);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') resizeBy(t, d, null);   // horizontal keys: width only
    else resizeBy(t, 0, d);                                                       // vertical keys: height only (pins it)
  });
  g.addEventListener('dblclick', () => { if (t.canResize()) resetOne(t); });
}
const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10L10 20M20 16l-4 4"/></svg>';
export function addChrome(t) {
  if (t.chrome) return; t.chrome = [];
  if (!t.isPopup) {   // modules without a title bar get a slim move strip (word log and dialogue reuse their title)
    const h = document.createElement('button'); h.type = 'button'; h.className = 'flMove';
    t.el.prepend(h); bindHandle(t, h); t.chrome.push(h);
  }
  const g = document.createElement('button'); g.type = 'button'; g.className = 'flGrip'; g.innerHTML = GRIP;
  t.el.append(g); bindGrip(t, g); t.chrome.push(g);
  relabel(t);
}
// The handles' accessible names mention the module (for the players: the player's current name), so they are rewritten when a name changes.
function relabel(t) {
  for (const n of t.chrome || []) {
    if (n.classList.contains('flMove')) { n.setAttribute('aria-label', `تحريك ${t.def.label}: الأسهم للتحريك، + و − للحجم، نقر مزدوج لإعادة الضبط`); n.title = 'اسحب لتحريك ' + t.def.label; }
    else { n.setAttribute('aria-label', `تغيير حجم ${t.def.label}: الأسهم${t.def.flex ? '، Home للارتفاع التلقائي' : ''}`); n.title = 'اسحب لتغيير الحجم'; }
  }
}
onNamesChange(() => { for (const id of ['p0', 'p1']) if (things[id]) relabel(things[id]); });
export const removeChrome = t => { (t.chrome || []).forEach(n => n.remove()); t.chrome = null; };

// Ctrl/⌘ + wheel over a module (a trackpad pinch arrives the same way) resizes it around the pointer: the quickest way to size anything, at any scale.
// The module stays marked active until the wheel pauses, so the layout refresh never fights the gesture; the result is committed once.
export function bindWheel(t) {
  let timer = 0;
  t.el.addEventListener('wheel', e => {
    if (!ws.enabled || !(e.ctrlKey || e.metaKey) || !t.canResize()) return;
    e.preventDefault();
    const r = t.el.getBoundingClientRect(), f = Math.exp(-clamp(e.deltaY, -120, 120) * 0.0016);
    flag(t, true);
    setSize(t, r.width * f, t.def.axes === 'xy' && (!t.def.flex || pinned(t)) ? r.height * f : null);
    const n = t.el.getBoundingClientRect();
    setPos(t, e.clientX - (e.clientX - r.left) * (n.width / r.width), e.clientY - (e.clientY - r.top) * (n.height / r.height));
    clearTimeout(timer); timer = setTimeout(() => { flag(t, false); commit(t, true); }, 220);
  }, { passive: false });
}
