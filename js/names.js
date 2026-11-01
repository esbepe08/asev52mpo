// Player names. A device preference like the theme and the layout, never part of the match: renaming a player changes how they are shown
// (panels, history, toasts, result), not a single rule, score or clock. The defaults live in config.js (NAMES); this module owns the names in
// use, their cleaning and their storage. No DOM and no game state, so every other module can import it without a cycle.
//   scrabble.names   {v:1, n:[name|null, name|null]}   only overrides are stored; null = the default name. Missing / corrupted / duplicate = defaults.
import { NAMES } from './config.js';

const KEY = 'scrabble.names', MAX = 16;
const names = [...NAMES], subs = new Set();

// Names end up in innerHTML, in toasts and in bidi text, so they are cleaned once on the way in (control and direction-forcing characters out,
// whitespace collapsed, length capped by user-perceived character so Arabic marks are never cut off a letter) and escaped on the way out.
const HIDDEN = /[\u061C\u200B\u200E\u200F\u2060\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const chars = s => seg ? Array.from(seg.segment(s), x => x.segment) : [...s];

export function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  return chars(raw.replace(HIDDEN, '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()).slice(0, MAX).join('').trim();
}
const same = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;   // ignores case and Arabic marks, so "Ali" and "ali" are one name

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);

export const MAX_NAME = MAX;
export const nameOf = i => names[i];
export const isCustom = i => names[i] !== NAMES[i];
// For innerHTML: escaped and isolated, so a Latin name never reorders the Arabic text around it.
export const nameHtml = i => `<bdi>${esc(names[i])}</bdi>`;
// For plain text (toasts, dialogue text): a custom name is wrapped in direction isolates; the default Arabic names stay exactly as they were.
export const nameIso = i => isCustom(i) ? `\u2068${names[i]}\u2069` : names[i];

const save = () => {
  try {
    if (names.every((n, i) => n === NAMES[i])) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ v: 1, n: names.map((n, i) => n === NAMES[i] ? null : n) }));
  } catch { /* storage unavailable: the names last for this visit */ }
};

export function loadNames() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (!s || s.v !== 1 || !Array.isArray(s.n) || s.n.length !== 2) return;
    const c = s.n.map((x, i) => cleanName(x) || NAMES[i]);
    if (!same(c[0], c[1])) { names[0] = c[0]; names[1] = c[1]; }
  } catch { /* missing or corrupted: defaults */ }
}

// Empty = back to the default name. Returns {name, dup, changed}; dup means the other player already has that name, and nothing was changed.
export function setName(i, raw) {
  const v = cleanName(raw) || NAMES[i];
  if (same(v, names[1 - i])) return { name: names[i], dup: true, changed: false };
  if (v === names[i]) return { name: v, dup: false, changed: false };
  names[i] = v; save(); subs.forEach(fn => fn());
  return { name: v, dup: false, changed: true };
}

// Online: the room decides the names. They are shown like any others but never saved, so they cannot overwrite this device's own names.
export function setRemoteNames(list) {
  let changed = false;
  list.forEach((raw, i) => { const v = cleanName(raw) || NAMES[i]; if (names[i] !== v) { names[i] = v; changed = true; } });
  if (changed) subs.forEach(fn => fn());
}

export const onNamesChange = fn => { subs.add(fn); return () => subs.delete(fn); };
