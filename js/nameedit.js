// Editing player names, two ways to the same store (js/names.js):
//   in place   on the player panel: press and hold the name (0.5 s, a line fills under it), double-click it, or focus it and press Enter / F2 / Space.
//              Enter or leaving the field keeps the name, Esc discards the change. The clock of the player on turn is frozen while the field is open.
//   Settings   two fields under "اللاعبون", applied as you type so the panels behind the bottom sheet show the result at once.
// Empty = the default name. A name already taken by the other player is refused. Pure UI: no rule, score or clock is read or changed other than the freeze above.
import { $, S, app } from './state.js';
import { tick } from './game.js';
import { warn } from './ui.js';
import { NAMES } from './config.js';
import { nameOf, isCustom, setName, onNamesChange, esc, MAX_NAME } from './names.js';
import { haptic } from './haptics.js';

const HOLD_MS = 500, SLOP = 10, ORD = ['الأول', 'الثاني'];
const DUP = 'هذا الاسم مستخدم للّاعب الآخر.';
let edit = null, held = false;

// ---------- the clock stands still while a name is being typed (same pattern as js/persist.js) ----------
function freeze() { if (S.board && !S.ended && !S.paused) { tick(); if (!S.ended) { S.paused = true; held = true; } } }
function thaw() {
  if (!held) return; held = false;
  if (S.ended || [...document.querySelectorAll('dialog')].some(d => d.open)) return;   // something else owns the pause now
  S.paused = false; S.last = performance.now();
}

// ---------- in place ----------
function begin(span) {
  if (edit || app.net) return;   // online, names belong to the room (the server), not to this device
  const i = +span.closest('.panel').id.slice(2), cs = getComputedStyle(span), box = span.getBoundingClientRect();
  const input = document.createElement('input');
  Object.assign(input, { type: 'text', className: 'pnameEdit', value: nameOf(i), maxLength: MAX_NAME * 2, placeholder: NAMES[i], autocomplete: 'off', spellcheck: false });
  input.dir = 'rtl'; input.enterKeyHint = 'done'; input.autocapitalize = 'words';
  input.setAttribute('aria-label', `اسم اللاعب ${ORD[i]}`);
  input.style.fontSize = cs.fontSize; input.style.height = box.height + 'px';   // same type and same row height as the label it replaces: nothing around it moves
  span.hidden = true; span.after(input);
  edit = { i, span, input, done: false };
  freeze(); haptic('tick');
  input.focus({ preventScroll: true }); input.select();
  input.addEventListener('keydown', e => {
    e.stopPropagation();   // typing must never reach the board / drawer shortcuts
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); finish(true, true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false, true); }
  });
  input.addEventListener('blur', () => finish(true, false));
}
function finish(keep, refocus) {
  if (!edit || edit.done) return;
  const { i, span, input } = edit; edit.done = true; edit = null;
  const res = keep ? setName(i, input.value) : null;
  input.remove(); span.hidden = false;
  thaw();
  if (res?.dup) warn(DUP);
  if (refocus) span.focus({ preventScroll: true });
}

function bindName(span) {
  let t = 0, x = 0, y = 0;
  const cancel = () => { clearTimeout(t); t = 0; span.classList.remove('pressing'); };
  span.addEventListener('pointerdown', e => {
    if (edit || !e.isPrimary || e.button > 0) return;
    x = e.clientX; y = e.clientY; span.classList.add('pressing');
    t = setTimeout(() => { cancel(); begin(span); }, HOLD_MS);
  });
  span.addEventListener('pointermove', e => { if (t && Math.hypot(e.clientX - x, e.clientY - y) > SLOP) cancel(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) span.addEventListener(ev, cancel);
  span.addEventListener('contextmenu', e => e.preventDefault());   // a long press must not open the browser's menu over the field
  span.addEventListener('dblclick', e => { e.preventDefault(); cancel(); begin(span); });
  span.addEventListener('keydown', e => {
    if (e.target !== span || !['Enter', 'F2', ' '].includes(e.key)) return;
    e.preventDefault(); begin(span);
  });
}

// ---------- Settings ----------
function buildFields() {
  const box = $('#nmB'); if (!box) return;
  box.innerHTML = [0, 1].map(i => `<div class="segRow"><label class="setRowHead" for="nm${i}">اسم اللاعب ${ORD[i]}</label>`
    + `<input class="nmField" id="nm${i}" data-i="${i}" type="text" dir="rtl" maxlength="${MAX_NAME * 2}" autocomplete="off" spellcheck="false" enterkeyhint="done" placeholder="${esc(NAMES[i])}"></div>`).join('')
    + '<p class="setNote" id="nmNote" role="status">اترك الحقل فارغًا للعودة إلى الاسم الأصلي.</p>';
  const note = $('#nmNote'), idle = note.textContent, fields = [...box.querySelectorAll('.nmField')];
  const show = i => { fields[i].value = isCustom(i) ? nameOf(i) : ''; };
  fields.forEach((f, i) => {
    show(i);
    f.addEventListener('input', () => {   // live: the panels behind the sheet follow every keystroke
      const r = setName(i, f.value);
      f.setAttribute('aria-invalid', String(r.dup)); note.textContent = r.dup ? DUP : idle;
    });
    f.addEventListener('change', () => { show(i); f.removeAttribute('aria-invalid'); note.textContent = idle; });   // settle on what was actually kept
  });
  onNamesChange(() => fields.forEach((f, i) => { if (document.activeElement !== f) show(i); }));   // a rename made on a panel shows up here too
}

export function initNameEdit() {
  document.querySelectorAll('#players .pname').forEach(bindName);
  buildFields();
}
