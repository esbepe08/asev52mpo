// Parity: the online server must agree, move for move, with the rules the local game uses (js/rules.js).
//   1. the server's copies of config / modes / rules are byte-identical to js/ (apart from the generated banner)
//   2. random positions through the REAL server pipeline (submit_move) vs js/rules.js directly: validity, error text, words, score, bingo
//   3. a second, independent scorer written from the premium-square table alone agrees with scoreWords
//   4. random whole games: every tile is accounted for after every action (board + racks + bag never changes, no duplicate id)
//   5. the end-of-game settlement the server writes equals settleEnd computed from the same racks, clocks and scores
// Usage: node tests/online/parity.mjs [games] [seed]
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { makeWorld, suite, mulberry32 } from './lib.mjs';
import { analyzeMove, scoreWords, settleEnd } from '../../js/rules.js';
import { LAYOUT, SIZE, RACK, BINGO } from '../../js/config.js';
import { TILE_MODES } from '../../js/modes.js';
const { ok, group, done } = suite('parity: server vs local rules, conservation, settlement');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAMES = +process.argv[2] || 24, SEED = +process.argv[3] || 20261101;

group('the server runs byte-identical copies of the shared modules');
for (const f of ['config.js', 'modes.js', 'rules.js']) {
  const mine = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
  const theirs = fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/game', f), 'utf8').replace(/^\/\/ GENERATED[^\n]*\n/, '');
  ok(mine === theirs, `${f} is identical in js/ and in the Edge Function bundle`);
}

// An independent scorer: premium codes 1 DL, 2 TL, 3 DW, 4 TW, 5 centre (DW). Blank tiles are worth 0 and premium squares only count under NEW tiles.
function scoreIndependently(words, isNew, placed) {
  let total = 0;
  for (const w of words) {
    let s = 0, m = 1;
    for (const { r, c, t } of w) {
      let v = t.blank ? 0 : t.v;
      if (isNew(r, c)) { const k = LAYOUT[r][c]; v *= k === 1 ? 2 : k === 2 ? 3 : 1; m *= k === 3 || k === 5 ? 2 : k === 4 ? 3 : 1; }
      s += v;
    }
    total += s * m;
  }
  return total + (placed === RACK ? BINGO : 0);
}

const TOTAL = { expanded: TILE_MODES.expanded.tiles.reduce((s, [, , n]) => s + n, 0), basic: TILE_MODES.basic.tiles.reduce((s, [, , n]) => s + n, 0) };
const stats = { moves: 0, legal: 0, illegal: 0, multi: 0, bingo: 0, premium: 0, steps: 0 };

function inventory(w) {
  const { game, racks, priv } = w.server();
  const ids = [];
  for (const row of game.board) for (const t of row) if (t) ids.push(t.id);
  for (const rack of Object.values(racks)) for (const t of rack) if (t) ids.push(t.id);
  for (const t of priv.bag) ids.push(t.id);
  return ids;
}

function randomPlacements(rng, board, rack, mode) {
  const tiles = rack.filter(Boolean), n = 1 + Math.floor(rng() * tiles.length);
  const picked = [...tiles].sort(() => rng() - 0.5).slice(0, n), alpha = [...TILE_MODES[mode].alpha];
  const empty = board.flat().every(c => !c), horiz = rng() < 0.5;
  let line, start;
  if (empty) { line = 7; start = 7 - Math.floor(rng() * n); start = Math.max(0, Math.min(start, SIZE - n)); }
  else {
    const occ = []; board.forEach((row, r) => row.forEach((c, k) => c && occ.push([r, k])));
    const [r0, c0] = occ[Math.floor(rng() * occ.length)], off = Math.floor(rng() * 3) - 1;
    line = Math.max(0, Math.min(SIZE - 1, (horiz ? r0 : c0) + off)); start = Math.max(0, Math.min(SIZE - 1, (horiz ? c0 : r0) - Math.floor(rng() * n)));
  }
  const at = i => horiz ? [line, i] : [i, line], pl = [];
  for (let i = start, k = 0; i < SIZE && k < picked.length; i++) {
    const [r, c] = at(i); if (board[r][c]) continue;
    const t = picked[k++]; pl.push({ tileId: t.id, row: r, col: c, ...(t.blank ? { as: alpha[Math.floor(rng() * alpha.length)] } : {}) });
  }
  if (rng() < 0.12 && pl.length > 1) { pl[1] = { ...pl[1], row: Math.floor(rng() * SIZE), col: Math.floor(rng() * SIZE) }; }   // sometimes break the line
  return pl;
}

// What js/rules.js says about a set of placements on the server's public board.
function expected(board, rack, pl) {
  const B = board.map(r => r.map(t => t && { ...t })), move = [];
  for (const p of pl) {
    const src = rack.find(t => t && t.id === p.tileId); if (!src || B[p.row][p.col]) return { skip: true };
    const t = { id: src.id, l: src.l, v: src.v, blank: src.blank, as: src.blank ? p.as : null };
    B[p.row][p.col] = t; move.push({ t, r: p.row, c: p.col });
  }
  const a = analyzeMove(B, move);
  if (a.err) return { err: a.err };
  const sc = scoreWords(a.words, a.isNew, move.length);
  return { sc, words: a.words, isNew: a.isNew, placed: move.length };
}

group(`random positions through the server: ${GAMES} games`);
let badMove = 0, badScore = 0, badInv = 0, badEnd = 0;
for (let g = 0; g < GAMES; g++) {
  const rng = mulberry32(SEED + g), mode = g % 4 === 3 ? 'basic' : 'expanded';
  const w = makeWorld({ seed: SEED + g }); await w.start({ tile_mode: mode });
  const total = TOTAL[mode], steps = 40 + Math.floor(rng() * 40);
  for (let s = 0; s < steps; s++) {
    await w.call('A', 'snapshot'); await w.call('B', 'snapshot');   // both players are in sync, as the real client keeps them
    const k = w.who(w.snap.A.game.current_seat), snap = w.snap[k];
    if (!snap || snap.game.status !== 'active') break;
    const roll = rng();
    if (roll < 0.08) { await w.call(k, 'pass_turn'); }
    else if (roll < 0.14 && snap.game.bag_count >= 7) { const ids = snap.me.rack.filter(Boolean).slice(0, 1 + Math.floor(rng() * 3)).map(t => t.id); await w.call(k, 'swap_tiles', { tileIds: ids }); }
    else {
      const pl = randomPlacements(rng, snap.board, snap.me.rack, mode); if (!pl.length) continue;
      const exp = expected(snap.board, snap.me.rack, pl), r = await w.call(k, 'submit_move', { placements: pl }); stats.moves++;
      if (exp.skip) { if (r.ok) badMove++; }
      else if (exp.err) { stats.illegal++; if (r.ok || r.code !== 'MOVE_INVALID' || r.message !== exp.err) { badMove++; console.log('  mismatch (illegal):', exp.err, '|', r.code, r.message); } }
      else {
        stats.legal++; if (exp.words.length > 1) stats.multi++; if (exp.sc.bingo) stats.bingo++;
        if (pl.some(p => LAYOUT[p.row][p.col] > 0)) stats.premium++;
        const indep = scoreIndependently(exp.words, exp.isNew, exp.placed);
        if (!r.ok || r.result.score !== exp.sc.total || JSON.stringify(r.result.words) !== JSON.stringify(exp.sc.list)) { badMove++; console.log('  mismatch (legal):', JSON.stringify(exp.sc), '|', JSON.stringify(r.result)); }
        if (indep !== exp.sc.total) { badScore++; console.log('  independent scorer disagrees:', indep, exp.sc.total); }
      }
    }
    stats.steps++;
    const ids = inventory(w);
    if (ids.length !== total || new Set(ids).size !== ids.length) { badInv++; console.log(`  conservation broken (game ${g}, step ${s}): ${ids.length}/${total}, unique ${new Set(ids).size}`); break; }
  }
  // end of game by the clock: the settlement the server wrote must equal settleEnd on the same inputs
  const sv = w.server(); if (sv.game.status === 'active') {
    const seatPlayers = [0, 1].map(i => sv.players.find(p => p.seat === i));
    const before = seatPlayers.map(p => ({ score: p.score, rack: sv.racks[p.player_id].map(t => t && { ...t }), ms: p.ms_left }));
    w.clock.t += 60 * 60000;
    const k = w.who(sv.game.current_seat); await w.call(k, 'claim_timeout');
    const done2 = w.server(); if (done2.game.status === 'finished' && done2.game.result) {
      const ms = [0, 1].map(i => done2.players.find(p => p.seat === i).ms_left);
      const want = settleEnd(before.map((b, i) => ({ ...b, ms: ms[i] })));
      const got = done2.game.result.lines.map(({ seat, ...rest }) => rest);
      if (JSON.stringify(want) !== JSON.stringify(got)) { badEnd++; console.log('  settlement mismatch:', JSON.stringify(want), JSON.stringify(got)); }
      const wi = want[0].score === want[1].score ? null : want[0].score > want[1].score ? 0 : 1;
      if (wi !== done2.game.winner_seat) { badEnd++; console.log('  winner mismatch'); }
    } else badEnd++;
  }
}
ok(stats.legal >= GAMES * 3, `enough legal moves were exercised (${stats.legal})`);
ok(stats.illegal >= GAMES, `enough illegal moves were exercised (${stats.illegal})`);
ok(stats.multi > 0 && stats.premium > 0, `multi-word moves (${stats.multi}) and premium squares (${stats.premium}) were covered; bingos: ${stats.bingo}`);
ok(badMove === 0, 'validity, error text, words and score are identical to js/rules.js on every position');
ok(badScore === 0, 'an independent scorer written from the premium-square table agrees');
ok(badInv === 0, `every tile is accounted for after every one of ${stats.steps} actions`);
ok(badEnd === 0, 'the end-of-game settlement equals settleEnd on the same racks, clocks and scores');
console.log(`  (${stats.moves} move attempts: ${stats.legal} legal, ${stats.illegal} illegal, ${stats.multi} multi-word, ${stats.bingo} bingo)`);
done();
