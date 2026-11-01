// Single source of mutable game state plus small state-related helpers. No DOM rendering.
import { SIZE, RACK, DEFAULT_MINUTES, DEFAULT_MODE, UNDO_MAX } from './config.js';
import { TILE_MODES } from './modes.js';

export const $ = s => document.querySelector(s);

// Tile id -> tile (identity registry; tiles are only created in createGame)
export const BY = {};

// The single game-state object. It is mutated in place (never reassigned) so every module
// that imported it always sees the current game.
export const S = {};

// Session-level (not per-game) state shared across modules.
// app.mode only changes inside createState, so the tile mode can never change while a game is active.
export const app = {
  minutes: DEFAULT_MINUTES,
  mode: DEFAULT_MODE,   // id of the active tile mode (see modes.js)
  pendingMode: null,    // mode picked in the setup flow, applied only when the game actually starts
  firstRun: true,
  judge: null,   // active judge session or null
  gameId: 0,     // bumps on every new game; lets the history renderer detect a fresh game
  net: null      // online session (js/online/session.js) while playing online, otherwise null: local play never touches it
};

// The bag's size: local play owns the bag; online only the server does, and the page just knows its size.
export const bagCount = () => (app.net ? S.bagCount : S.bag.length);
export const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const fmt = ms => { const s = Math.ceil(ms / 1000); return String(s / 60 | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
export const inMove = t => S.move.find(e => e.t === t);
export const cur = () => S.players[S.cur];
export const refill = p => { for (let i = 0; i < RACK && S.bag.length; i++) if (!p.rack[i]) p.rack[i] = S.bag.pop(); };
export const pushHist = h => { S.hist.push({n: S.hist.length + 1, ...h}); S.hv++; };

export const profile = () => TILE_MODES[app.mode];

// Build a fresh game state in place for the given tile mode.
export function createState(min, mode = app.mode) {
  app.minutes = min;
  app.mode = TILE_MODES[mode] ? mode : DEFAULT_MODE;
  app.gameId++;
  let id = 0; const bag = [];
  for (const k in BY) delete BY[k];
  for (const [l, v, n] of profile().tiles) for (let i = 0; i < n; i++) { const t = {id: ++id, l, v, blank: !l, as: null}; BY[id] = t; bag.push(t); }
  shuffle(bag);
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, {
    board: Array.from({length: SIZE}, () => Array(SIZE).fill(null)), bag,
    players: [0, 1].map(() => ({rack: Array(RACK).fill(null), score: 0, ms: min * 60000})),
    cur: 0, move: [], undo: null, undos: [], swap: false, sel: new Set(), pick: null, drag: null, pending: null, pause: null, draw: null,
    ended: false, hist: [], hv: 0, started: false, paused: false, last: performance.now(), land: null, pop: null
  });
  S.players.forEach(refill);
}

// Pre-move snapshot used by undo and judge rulings.
export function snapshot() {
  const mv = new Set(S.move.map(e => e.t));
  const racks = S.players.map(p => p.rack.map(t => t ? t.id : null));
  S.move.forEach(e => { racks[S.cur][e.slot] = e.t.id; });
  return {board: S.board.map(r => r.map(t => t && !mv.has(t) ? t.id : null)), racks, bag: S.bag.map(t => t.id),
    scores: S.players.map(p => p.score), cur: S.cur, started: S.started, times: S.players.map(p => p.ms)};
}

// ---------- Local undo history ----------
// One snapshot per COMMITTED action (a scored move, a pass, a swap), newest last. S.undo stays "is there anything to take back"
// (the top of the stack), so every caller that only asks that question is unchanged; Undo itself pops one step and leaves the rest,
// which is what makes it repeatable (player 1 moves, player 2 moves, undo, undo again).
export function pushUndo(u) {
  S.undos.push(u);
  if (S.undos.length > UNDO_MAX) S.undos.shift();
  S.undo = u;
}
export function popUndo() {
  const u = S.undos.pop() || null;
  S.undo = S.undos.length ? S.undos[S.undos.length - 1] : null;
  return u;
}
export function topUndo() { return S.undos.length ? S.undos[S.undos.length - 1] : null; }
export function setUndoStack(list) {
  S.undos = Array.isArray(list) ? list.slice(-UNDO_MAX) : [];
  S.undo = topUndo();
}

// Restore a pre-move snapshot; keepTime leaves the clocks as they are (used by judge rulings).
// The undo stack is NOT touched here: the caller decides whether the restored step is consumed (Undo), voided (Tahkim ✖) or kept.
export function restore(u, keepTime) {
  S.board = u.board.map(r => r.map(id => id && BY[id]));
  S.players.forEach((p, i) => { p.rack = u.racks[i].map(id => id && BY[id]); p.score = u.scores[i]; if (!keepTime) p.ms = u.times[i]; });
  S.bag = u.bag.map(id => BY[id]);
  [...S.bag, ...S.players.flatMap(p => p.rack)].forEach(t => { if (t && t.blank) t.as = null; });
  S.cur = u.cur; S.started = u.started; S.last = performance.now(); S.pick = null; S.sel.clear();
}
