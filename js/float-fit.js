// Floating engine, part 3 of 7: vertical fit. Player panels, Turn Controls and Game Tools are resizable on both axes; until a height is pinned they simply follow their
// content. Once pinned (data-vfit), the content adapts to the box: see fitRack and fitButtons. Reads the DOM it fits; knows nothing about positions or storage.
import { html, inWs, toolsMin } from './float-core.js';

const STICKY = 1.06;   // hysteresis: a new row/column count must beat the one in use by 6% to replace it, so the layout never flickers between two near-equal choices while resizing
const memo = new WeakMap();   // fitted element (rack, or button module) -> the row/column count in use; forgotten when the height is un-pinned

// ---------- vertical fit (player panels, Turn Controls, Game Tools) ----------
export const pinned = t => !!t.def?.flex && !!t.el.style.height;

// Take the fit off (attribute + inline sizes) but remember the layout in use; naturalHeight() needs this, and resizing must not lose its hysteresis.
function release(t) {
  const el = t.el; el.removeAttribute('data-vfit');
  el.style.removeProperty('--cc'); el.style.removeProperty('--bu');
  const rk = el.querySelector('.rack');
  if (!rk) return;
  for (const p of ['--ts', 'padding', 'gap', 'grid-template-columns', 'grid-auto-rows']) rk.style.removeProperty(p);
  for (const sl of rk.children) { sl.style.removeProperty('grid-row'); sl.style.removeProperty('grid-column'); }
}
export function clearFit(t) {   // fully un-fitted: nothing inline, nothing remembered
  if (!t.def?.flex) return;
  release(t); memo.delete(t.el); const rk = t.el.querySelector('.rack'); if (rk) memo.delete(rk);
}
export function fitContent(t) {
  if (!t.def?.flex) return;
  const on = inWs(t) && pinned(t) && !(t.id === 'tools' && toolsMin());
  if (!on) { if (t.el.hasAttribute('data-vfit') || memo.has(t.el)) clearFit(t); return; }
  if (!t.el.hasAttribute('data-vfit')) t.el.setAttribute('data-vfit', '');
  if (t.el.querySelector('.rack')) fitRack(t); else fitButtons(t);
}
// Back to "height follows the content" (the module stays where it is, at its current width).
export function unpin(t) { t.el.style.removeProperty('height'); fitContent(t); }
// The height the module would have if it followed its content at its CURRENT width: measured by lifting the fit and the pinned height for a moment, then putting both back.
// Resizing uses it to snap a nearly-automatic height back to automatic.
export function naturalHeight(t) {
  const el = t.el, was = el.style.height;
  if (!was) return el.offsetHeight;
  release(t); el.style.removeProperty('height');
  const n = el.offsetHeight;
  el.style.height = was; fitContent(t);
  return n;
}

// Rack: the n slots are laid out in r balanced rows (7 -> 7 | 4+3 | 3+2+2 | 2+2+2+1 | 1x7); r is whichever gives the biggest SQUARE tile in the tray, and rows with fewer
// tiles are centred (the grid has two half-columns per tile, a short row starts half a tile in per missing tile). The tray itself fills the panel; type scales with the tile (--ts).
function fitRack(t) {
  const rk = t.el.querySelector('.rack'), slots = rk ? [...rk.children].filter(n => n.classList.contains('slot')) : [], n = slots.length;
  if (!n) return;
  const W = rk.clientWidth, H = rk.clientHeight;
  if (W < 8 || H < 8) return;
  const p = Math.max(3, 0.018 * Math.max(W, H)), g = p * 0.67;
  const sizeFor = r => { const c = Math.ceil(n / r); return Math.min((W - 2 * p - g * (c - 1)) / c, (H - 2 * p - g * (r - 1)) / r); };
  let r = 1, best = sizeFor(1);
  for (let k = 2; k <= n; k++) { const s = sizeFor(k); if (s > best + 0.5) { r = k; best = s; } }
  const prev = memo.get(rk);
  if (prev >= 1 && prev <= n && sizeFor(prev) * STICKY >= best) r = prev;   // keep the layout in use unless the new one is clearly better
  memo.set(rk, r);
  const c = Math.ceil(n / r), s = Math.max(g + 4, sizeFor(r)), base = Math.floor(n / r), extra = n % r;
  rk.style.setProperty('--ts', s.toFixed(2) + 'px');
  rk.style.padding = p.toFixed(2) + 'px'; rk.style.gap = g.toFixed(2) + 'px';
  rk.style.gridTemplateColumns = `repeat(${2 * c}, ${((s - g) / 2).toFixed(2)}px)`; rk.style.gridAutoRows = s.toFixed(2) + 'px';
  let i = 0;
  for (let row = 0; row < r; row++) {
    const cnt = base + (row < extra ? 1 : 0);
    for (let j = 0; j < cnt; j++, i++) { slots[i].style.gridRow = String(row + 1); slots[i].style.gridColumn = `${c - cnt + 1 + 2 * j} / span 2`; }
  }
}
// Buttons: pick the column count whose cells come closest to (or beyond) the button's natural size on BOTH axes, then let every row share the height; all cells stay equal
// and a short last row is centred. --bu = how much bigger/smaller than natural the cells are; type and icons follow it, so the box decides the button size.
function fitButtons(t) {
  const el = t.el, cs = getComputedStyle(el), f = k => parseFloat(cs[k]) || 0;
  const btns = [...el.children].filter(b => b.classList.contains('btn') && getComputedStyle(b).display !== 'none'), n = btns.length;
  if (!n) return;
  const W = el.clientWidth - f('paddingLeft') - f('paddingRight'), H = el.clientHeight - f('paddingTop') - f('paddingBottom'), g = f('columnGap');
  if (W < 8 || H < 8) return;
  const nw = { icon: 44, iconlabel: 64, text: 84 }[html().dataset.bstyle] || 44, nh = parseFloat(cs.getPropertyValue('--b-h')) || 46;
  const score = c => { const r = Math.ceil(n / c); return Math.min(((W - g * (c - 1)) / c) / nw, ((H - g * (r - 1)) / r) / nh); };
  let c = 1, best = score(1);
  for (let k = 2; k <= n; k++) { const sc = score(k); if (sc > best * 1.02) { c = k; best = sc; } }
  const prev = memo.get(el);
  if (prev >= 1 && prev <= n && score(prev) * STICKY >= best) { c = prev; best = score(prev); }
  memo.set(el, c);
  el.style.setProperty('--cc', String(c)); el.style.setProperty('--bu', Math.max(0.3, best).toFixed(3));
}
