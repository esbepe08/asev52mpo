// Active-match persistence (separate from the PWA's offline asset cache): the running game is written to localStorage so a
// refresh, a closed app or a suspended phone does not lose the match. It never changes rules, scoring or state shape:
// it only reads S/app to serialise, and on restore rebuilds the game through the same createState() used for a new game.
//   scrabble.match   one JSON document; absent when there is nothing worth resuming (no move yet, or the game has ended).
// Settings (theme, layout, dimensions, floating windows) live under their own keys and are never touched here.
import { SIZE, RACK, UNDO_MAX } from './config.js';
import { TILE_MODES } from './modes.js';
import { S, app, BY, createState } from './state.js';
import { tick } from './game.js';
import { render, ask, notice, buildBlankPicker, chooseMode } from './ui.js';
import { nameIso } from './names.js';

const KEY = 'scrabble.match', FORMAT = 1;
// Set to false to keep the clocks running while the app is in the background (they are paused by default; see lifecycle below).
export const PAUSE_CLOCK_WHEN_HIDDEN = true;

// ---------- Validation: a saved match is only used if it is completely self-consistent ----------
const tileList = mode => TILE_MODES[mode].tiles.flatMap(([l, v, n]) => Array.from({length: n}, () => ({l, v})));   // id = index + 1, exactly as createState numbers them
const signature = mode => { let h = 2166136261; for (const [l, v, n] of TILE_MODES[mode].tiles) for (const ch of `${l}|${v}|${n};`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h; };
const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
const grid = g => Array.isArray(g) && g.length === SIZE && g.every(r => Array.isArray(r) && r.length === SIZE);

// board + racks + bag must contain every tile id exactly once
function partition(board, racks, bag, n) {
  if (!grid(board) || !Array.isArray(racks) || racks.length !== 2 || !Array.isArray(bag)) return false;
  if (racks.some(r => !Array.isArray(r) || r.length !== RACK)) return false;
  const seen = new Set();
  const take = id => { if (id === null) return true; if (!isInt(id, 1, n) || seen.has(id)) return false; seen.add(id); return true; };
  if (!board.every(r => r.every(take)) || !racks.every(r => r.every(take)) || bag.includes(null) || !bag.every(take)) return false;
  return seen.size === n;
}
const validUndo = (u, n) => !!u && typeof u === 'object' && partition(u.board, u.racks, u.bag, n)
  && Array.isArray(u.scores) && u.scores.length === 2 && u.scores.every(s => isInt(s, 0, 1e6))
  && Array.isArray(u.times) && u.times.length === 2 && u.times.every(t => Number.isFinite(t) && t >= 0)
  && isInt(u.cur, 0, 1) && typeof u.started === 'boolean';
// The local undo stack (v1 saves have only the single `undo`; they are still accepted and restored as a one-step stack).
const validUndos = (list, n) => Array.isArray(list) && list.length <= UNDO_MAX && list.every(u => validUndo(u, n));
// History entries are rendered with innerHTML, so words are restricted to Arabic letters (the only thing a real game can produce).
const validHist = h => Array.isArray(h) && h.length < 5000 && h.every(e => e && isInt(e.n, 1, 1e5) && isInt(e.p, 0, 1) && (
  e.type === 'pass' ||
  e.type === 'swap' && isInt(e.cnt, 0, RACK) ||
  e.type === 'move' && Number.isFinite(e.total) && Array.isArray(e.words) && e.words.every(w => w && typeof w.w === 'string' && /^[\u0600-\u06FF]+$/.test(w.w) && Number.isFinite(w.pts))
    && (e.st === undefined || e.st === 'ok' || e.st === 'void') && (e.pen === undefined || Number.isFinite(e.pen)) && (e.bingo === undefined || typeof e.bingo === 'boolean')));

export function validate(d) {
  try {
    if (!d || d.v !== FORMAT || !Object.hasOwn(TILE_MODES, d.mode) || d.sig !== signature(d.mode)) return false;
    const tiles = tileList(d.mode), n = tiles.length;
    if (!isInt(d.minutes, 1, 600) || !partition(d.board, d.racks, d.bag, n)) return false;
    if (!isInt(d.cur, 0, 1) || typeof d.started !== 'boolean') return false;
    if (!Array.isArray(d.scores) || d.scores.length !== 2 || !d.scores.every(s => isInt(s, 0, 1e6))) return false;
    if (!Array.isArray(d.times) || d.times.length !== 2 || !d.times.every(t => Number.isFinite(t) && t > 0 && t <= d.minutes * 60000)) return false;
    if (!validHist(d.hist)) return false;
    const undos = d.undos === undefined ? (d.undo == null ? [] : [d.undo]) : d.undos;   // saves from before the stack have only `undo`
    if (!validUndos(undos, n)) return false;
    if (d.undo !== undefined && d.undo !== null && !validUndo(d.undo, n)) return false;
    const alpha = [...TILE_MODES[d.mode].alpha], onBoard = new Set(d.board.flat().filter(Boolean));
    // every tile of the unsubmitted move sits on the board where it says, and its rack slot is empty
    const used = new Set();
    for (const m of d.move) {
      if (!m || !isInt(m.r, 0, SIZE - 1) || !isInt(m.c, 0, SIZE - 1) || !isInt(m.slot, 0, RACK - 1) || d.board[m.r][m.c] !== m.t || used.has(m.t) || d.racks[d.cur][m.slot] !== null) return false;
      used.add(m.t);
    }
    // blank tiles on the board carry a letter of the active mode; nothing else may carry one
    if (!d.blanks || typeof d.blanks !== 'object') return false;
    for (const id of onBoard) if (!tiles[id - 1].l && !alpha.includes(d.blanks[id])) return false;
    for (const [id, L] of Object.entries(d.blanks)) if (!onBoard.has(+id) || tiles[id - 1]?.l || !alpha.includes(L)) return false;
    return Array.isArray(d.move);
  } catch { return false; }
}

// ---------- Serialise / restore ----------
export function serialise() {
  // A blank that was just dropped and is still waiting for its letter counts as not placed yet.
  const loose = new Set(S.move.filter(e => e.t.blank && !e.t.as).map(e => e.t));
  const board = S.board.map(r => r.map(t => t && !loose.has(t) ? t.id : null));
  const racks = S.players.map(p => p.rack.map(t => t ? t.id : null));
  S.move.filter(e => loose.has(e.t)).forEach(e => { const r = racks[S.cur]; r[r[e.slot] === null ? e.slot : r.indexOf(null)] = e.t.id; });
  const blanks = {}; S.board.flat().forEach(t => { if (t && t.blank && t.as && !loose.has(t)) blanks[t.id] = t.as; });
  return {
    v: FORMAT, savedAt: Date.now(), mode: app.mode, sig: signature(app.mode), minutes: app.minutes,
    board, bag: S.bag.map(t => t.id), racks, blanks,
    scores: S.players.map(p => p.score), times: S.players.map(p => Math.max(1, Math.round(p.ms))),
    cur: S.cur, started: S.started,
    move: S.move.filter(e => !loose.has(e.t)).map(e => ({t: e.t.id, r: e.r, c: e.c, slot: e.slot})),
    undo: S.undo, undos: S.undos, hist: S.hist
  };
}

// Rebuild the game from a validated document. createState() makes the same tile registry (ids) a new game would; we then overwrite the state in place.
export function restoreMatch(d) {
  createState(d.minutes, d.mode);
  buildBlankPicker();
  const at = id => id === null ? null : BY[id];
  for (const [id, L] of Object.entries(d.blanks)) BY[id].as = L;
  S.board = d.board.map(r => r.map(at));
  S.bag = d.bag.map(at);
  S.players.forEach((p, i) => { p.rack = d.racks[i].map(at); p.score = d.scores[i]; p.ms = d.times[i]; });
  S.cur = d.cur; S.started = d.started; S.undos = (d.undos ?? (d.undo ? [d.undo] : [])).slice(-UNDO_MAX); S.undo = S.undos[S.undos.length - 1] || null;
  S.hist = d.hist; S.hv = d.hist.length;
  S.move = d.move.map(m => ({t: BY[m.t], r: m.r, c: m.c, slot: m.slot}));
  S.paused = false; S.last = performance.now();
  app.firstRun = false; app.pendingMode = null;
}

// ---------- Storage (every access guarded: storage may be unavailable, full or corrupted) ----------
export function loadSaved() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { return null; }
  if (raw === null) return null;
  try { const d = JSON.parse(raw); if (validate(d)) return d; } catch { /* fall through */ }
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }   // corrupted or from an incompatible version: treat as absent
  return null;
}

const worthSaving = () => !!S.board && !S.ended && (S.hist.length > 0 || S.move.length > 0 || S.started);
let timer = 0, armed = true, baseGameId = 0;

export function saveNow() {
  clearTimeout(timer);
  if (app.net) return;   // an online match lives on the server, never in this device's saved-match slot
  if (!armed && app.gameId !== baseGameId) armed = true;   // a new game has really started (or a match was restored): from now on we own the saved slot
  if (!armed) return;
  try {
    if (!worthSaving()) localStorage.removeItem(KEY);   // fresh or finished game: nothing to resume
    else localStorage.setItem(KEY, JSON.stringify(serialise()));
  } catch { /* storage full or unavailable: the game simply is not persisted */ }
}
// Called after every render(); coalesces bursts into one write.
export function schedule() { clearTimeout(timer); timer = setTimeout(saveNow, 250); }

// ---------- Start-up: offer to resume ----------
// `saved` is what loadSaved() returned before the fresh start-up game was created. Until the player decides, the saved slot is
// left strictly alone (armed = false), so closing the app at the prompt never destroys the match.
export function initPersistence(saved) {
  armed = !saved; baseGameId = app.gameId;
  // Pause the clock while the app is in the background, and always save when it goes away (backgrounded, locked, closed, navigated).
  let heldByUs = false;
  const anyDialog = () => [...document.querySelectorAll('dialog')].some(d => d.open);   // includes the non-modal settings window, which pauses the game itself
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (PAUSE_CLOCK_WHEN_HIDDEN && !app.net && S.board && !S.ended && !S.paused) { tick(); if (!S.ended) { S.paused = true; heldByUs = true; } }
      saveNow();
    } else if (heldByUs) {
      heldByUs = false;
      if (!anyDialog()) { S.paused = false; S.last = performance.now(); }
    }
  });
  addEventListener('pagehide', () => { if (!app.net && S.board && !S.ended && !S.paused) tick(); saveNow(); });
}

// Cover "PLAY": resume prompt if there is a saved match, otherwise straight to the normal new-game flow.
export function startFlow(saved) {
  if (!saved) return chooseMode();
  const mins = ms => Math.ceil(ms / 60000);
  const msg = `${TILE_MODES[saved.mode].labelAr} · ${saved.hist.length} حركة مسجّلة\n`
    + `${nameIso(0)}: ${saved.scores[0]} نقطة (${mins(saved.times[0])} د) · ${nameIso(1)}: ${saved.scores[1]} نقطة (${mins(saved.times[1])} د)\n\n`
    + 'هل تريد متابعتها؟ اختيار «مباراة جديدة» لا يحذفها إلا عند بدء اللعبة الجديدة فعلًا.';
  ask('مباراة غير مكتملة', msg, 'متابعة', () => { restoreMatch(saved); render(); notice('تمت استعادة المباراة المحفوظة'); }, chooseMode, 'btn main', 'مباراة جديدة');
}
