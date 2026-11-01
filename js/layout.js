// Layout preferences (device-only, like the theme): they only set data-attributes on <html>; css/style.css does the rest.
// Nothing here touches game state, scoring, board coordinates or the timer.
//   data-layout="classic|duel"   classic = original arrangement; duel = player panels flank the board, buttons underneath
//   data-swap="true"             duel only: player 1 on the right instead of the left
//   data-pdock="top|middle|bottom"  duel only: vertical position of the player panels beside the board
//   data-bstyle="icon|iconlabel|text"  control buttons: icons only (label stays for screen readers + tooltip), icon over label, or the original text
//   data-hist="drawer|docked"    drawer = word log hidden until asked for (default); docked = always in the layout (old behaviour)
//   data-binfo="off|on"          the info bar under the board (mode · bag count): hidden by default so the board gets the room (the count lives on the swap button,
//                               in the word log and in the endgame toasts; the bar stays in the page for screen readers); on = the bar is shown again
//   data-racks="always|turn"     local play only: both racks always visible, or only the rack of the player whose turn it is (the other tray stays,
//                               empty and locked, so nothing moves when the turn changes)
//   data-floating="true"        optional Floating Workspace (js/float.js, css/float.css): a presentation layer that lets the board, player panels,
//                               controls and word log be moved and resized. Default OFF; absent = this file's layout is authoritative.
import { $, S } from './state.js';
import { applyHistMode } from './histview.js';
import { makeFloating, resetFloats, gameInert, autoPos, isFloating, setFloating, refresh } from './float.js';
import { render } from './ui.js';
import { drawEnabled, setDrawEnabled } from './draw.js';

const KEY = 'scrabble.layout';
const DEF = { layout: 'classic', p1: 'left', pdock: 'bottom', bstyle: 'icon', hist: 'drawer', binfo: 'off', racks: 'always' };
const LAYOUT_ROWS = [
  ['layout', 'التخطيط', [['classic', 'كلاسيكي'], ['duel', 'مواجهة']]],
  ['p1', 'موضع اللاعب الأول', [['left', 'يسار'], ['right', 'يمين']]],
  ['pdock', 'ارتفاع لوحات اللاعبين', [['top', 'أعلى'], ['middle', 'وسط'], ['bottom', 'أسفل']]],
  ['bstyle', 'أزرار التحكم', [['icon', 'أيقونات'], ['iconlabel', 'أيقونة + نص'], ['text', 'نص فقط']]],
  ['hist', 'سجل الكلمات', [['drawer', 'عائم عند الطلب'], ['docked', 'مثبّت']]],
  ['binfo', 'شريط معلومات اللوح', [['off', 'مخفي'], ['on', 'ظاهر']]],
  ['float', 'الوضع العائم', [['off', 'إيقاف'], ['on', 'تشغيل']]]   // not part of `pref`: on/off lives with the workspace geometry (float.js)
];
// Local-play preferences: they never reach the online game (the opponent's rack is already hidden and the server decides the first turn).
const PLAY_ROWS = [
  ['racks', 'عرض الرفوف (محلي)', [['always', 'دائمًا ظاهرة'], ['turn', 'رفّ صاحب الدور فقط']]],
  ['draw', 'سحب البداية (محلي)', [['on', 'مفعّل'], ['off', 'إيقاف']]]   // draw a tile each to decide who starts
];
const ROWS = [...LAYOUT_ROWS, ...PLAY_ROWS];
const ok = (k, v) => ROWS.find(r => r[0] === k)[2].some(o => o[0] === v);
const val = k => k === 'float' ? (isFloating() ? 'on' : 'off') : k === 'draw' ? (drawEnabled() ? 'on' : 'off') : pref[k];

let pref = { ...DEF };

function apply() {
  const d = document.documentElement.dataset;
  if (pref.layout === 'duel') d.layout = 'duel'; else delete d.layout;
  if (pref.layout === 'duel' && pref.p1 === 'right') d.swap = 'true'; else delete d.swap;
  d.pdock = pref.pdock;
  d.bstyle = pref.bstyle;
  d.hist = pref.hist;
  d.binfo = pref.binfo;
  applyHistMode(pref.hist);
  if (pref.racks === 'turn') d.racks = 'turn'; else delete d.racks;
  refresh();   // Floating Workspace ON: modules without a saved override follow the new defaults
}

function build() {
  const row = ([k, label, opts]) =>
    `<div class="segRow"><div class="setRowHead">${label}</div><div class="seg" role="group" aria-label="${label}">`
    + opts.map(([v, t]) => `<button type="button" class="btn" data-k="${k}" data-v="${v}" aria-pressed="${val(k) === v}"${(k === 'p1' || k === 'pdock') && pref.layout !== 'duel' ? ' disabled' : ''}>${t}</button>`).join('')
    + '</div></div>';
  $('#lyB').innerHTML = LAYOUT_ROWS.map(row).join('');
  const pb = $('#playB'); if (pb) pb.innerHTML = PLAY_ROWS.map(row).join('');
}

// Tooltip = current label (the labels change at runtime, e.g. swap mode), so icon-only buttons are never anonymous.
function syncTitles() {   // a button may carry a short note (the swap button: the bag count) in data-sub
  document.querySelectorAll('.ctrls .btn').forEach(b => { const l = b.querySelector('.lbl')?.textContent, t = l && (b.dataset.sub ? `${l} · ${b.dataset.sub}` : l); if (t && b.title !== t) b.title = t; });
}

export function initLayout() {
  try { localStorage.removeItem('scrabble.dims'); } catch { /* the old Dimensions sliders are gone: a saved value must never silently resize the default layout */ }
  const ad = $('#ad');
  makeFloating(ad, 'settings', $('#aT'), el => [(innerWidth - el.offsetWidth) / 2, innerHeight - el.offsetHeight - 8]);
  makeFloating($('#hist'), 'hist', document.querySelector('#hist h2'), () => [8, 8], { def: 'hist' });
  makeFloating($('#netBar'), 'net', $('#netGrip'), autoPos);   // online match bar: static in the page flow, a movable module (grip) while the Floating Workspace is ON
  makeFloating($('#dlg'), 'dlg', $('#dT'), autoPos, { def: 'dlg' });   // the in-game confirmation floats; see ask() in ui.js
  ad.addEventListener('close', () => gameInert(false));
  ad.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); ad.close(); } });   // non-modal dialogs ignore Esc natively
  $('#aClose').addEventListener('click', () => ad.close());
  $('#flReset').addEventListener('click', resetFloats);
  syncTitles();
  const mo = new MutationObserver(syncTitles);   // the turn controls and (in Floating Workspace) the game tools module
  for (const n of document.querySelectorAll('.ctrls, #tools')) mo.observe(n, { childList: true, characterData: true, subtree: true });
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === 'object') for (const k of Object.keys(DEF)) if (ok(k, s[k])) pref[k] = s[k];
  } catch { /* missing, corrupted or unavailable: defaults */ }
  apply(); build();
  const onRuleClick = e => {
    const b = e.target.closest('button[data-k]'); if (!b || b.disabled) return;
    if (b.dataset.k === 'float') { setFloating(b.dataset.v === 'on'); build(); return; }   // no reload, no game restart, layout prefs untouched
    if (b.dataset.k === 'draw') { setDrawEnabled(b.dataset.v === 'on'); build(); return; }   // a device preference, like the theme
    pref[b.dataset.k] = b.dataset.v;
    try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch { /* storage unavailable */ }
    apply(); build();
    if (b.dataset.k === 'racks' && S.board) render();   // the waiting player's tray is locked/unlocked at once, not only on the next turn
  };
  $('#lyB').addEventListener('click', onRuleClick);
  $('#playB')?.addEventListener('click', onRuleClick);
}
