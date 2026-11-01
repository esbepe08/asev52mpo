// The pause banner, shared by local play and online play. One full-screen card, so a pause is impossible to miss:
// a large pause glyph, who stopped the game, how long it has been stopped, and the one action that matters (resume).
// Presentation only: it never changes a clock or a rule. The caller owns the state (S.pause locally, game.pause online)
// and passes the resume handler in; this module owns the DOM and the countdown text.
import { $ } from './state.js';

let onResume = null, open = false;

export const mmss = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(s / 60 | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};

function bind() {
  const b = $('#pauseResume');
  if (!b || b._bound) return;
  b._bound = true;
  b.addEventListener('click', () => { if (onResume) onResume(); });
  // The card is modal in behaviour: one action, and the keyboard stays on it (Tab cannot wander into the frozen game behind).
  $('#pauseOv').addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); try { b.focus(); } catch { /* focus refused */ } }
    else if (e.key === 'Escape' && !b.disabled && onResume) { e.preventDefault(); onResume(); }
  });
}

// opts: { title, msg, clock, btn, disabled, hint, resume }
export function showPause(opts = {}) {
  const el = $('#pauseOv'); if (!el) return;
  bind();
  open = true;
  if (el.hidden) el.hidden = false;
  const set = (id, t) => { const n = $(id); if (n && n.textContent !== t) n.textContent = t; };
  set('#pauseT', opts.title || 'اللعبة متوقفة مؤقتًا');
  set('#pauseM', opts.msg || '');
  set('#pauseClock', opts.clock || '');
  const b = $('#pauseResume');
  set('#pauseResume', opts.btn || 'استئناف اللعبة');
  if (b) b.disabled = !!opts.disabled;
  set('#pauseHint', opts.hint || '');
  if (typeof opts.resume === 'function') onResume = opts.resume;
  document.documentElement.dataset.paused = 'true';
  // Move focus to the one action, once: a keyboard or screen-reader user lands on "resume", not on the board behind.
  if (!el._focused && b && !b.disabled) { try { b.focus({ preventScroll: true }); } catch { /* focus refused */ } el._focused = true; }
}

// Update only the moving parts (countdown), so the banner does not re-announce itself every second.
export function updatePause(opts = {}) {
  if (!open) return;
  if (opts.clock !== undefined) { const n = $('#pauseClock'); if (n && n.textContent !== opts.clock) n.textContent = opts.clock; }
  if (opts.btn !== undefined) { const n = $('#pauseResume'); if (n && n.textContent !== opts.btn) n.textContent = opts.btn; }
  if (opts.disabled !== undefined) { const n = $('#pauseResume'); if (n) n.disabled = !!opts.disabled; }
  if (opts.hint !== undefined) { const n = $('#pauseHint'); if (n && n.textContent !== opts.hint) n.textContent = opts.hint; }
}

export function hidePause() {
  const el = $('#pauseOv'); if (!el) return;
  open = false; el.hidden = true; el._focused = false; onResume = null;
  delete document.documentElement.dataset.paused;
}

export const isPauseOpen = () => open;
