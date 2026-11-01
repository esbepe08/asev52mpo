// What a player is allowed to see. This is the ONLY place server state becomes client-visible data, so the privacy rules are
// enforced here once: the board, scores, tile COUNTS, clock, Tahkim state and move history are public; the caller's own rack is
// included; the opponent's rack, the bag (only its size) and the undo snapshot are never included.
import { STATUS, clockRunning, seatOf, playerBySeat, idleMs, blockingSeat, extOf } from './engine.js';
import { PAUSES_EACH } from '../game/config.js';
import { fail } from './errors.js';

export function historyItem(m) {
  const it = { n: m.turn_number, p: m.seat, type: m.action_type, words: m.formed_words || [], total: m.score_delta, bingo: !!m.bingo };
  if (m.action_type === 'swap') it.cnt = m.swap_count;
  if (m.action_type === 'move') it.cells = (m.placements || []).map(x => [x.row, x.col]);   // where the move landed (the board is public; tile ids are not sent)
  if (m.tahkim_status) it.st = m.tahkim_status;
  if (m.penalty) it.pen = m.penalty;
  return it;
}

// The first-turn draw as THIS player may see it: your own tile as soon as you drew it, the opponent's only once both have drawn.
// While only one has drawn, the values live in the private game_private.draw; the public ext.draw exists only for a finished draw.
function drawOf(w, seat) {
  const pd = w.priv && w.priv.draw, xd = extOf(w.game).draw;
  const drawing = w.game.status === 'drawing';
  const by = (pd && pd.by) || (xd && xd.by);
  if (!by && !drawing) return null;
  const cells = by || [null, null];
  const both = !!(cells[0] && cells[1]);
  return {
    mine: cells[seat] || null,
    theirs: both ? cells[1 - seat] : null,
    done: !!xd,
    first: xd ? xd.first : null,
    tries: (pd ? pd.tries : xd ? xd.tries : 0) || 0
  };
}

export function buildSnapshot(w, userId, now) {
  const seat = seatOf(w, userId);
  if (seat < 0) fail('NOT_MEMBER');
  const g = w.game, me = playerBySeat(w, seat);
  return {
    server_now: now,
    game: {
      id: g.id, room_code: g.room_code, host_player_id: g.host_player_id, status: g.status, tile_mode: g.tile_mode, minutes: g.minutes,
      round: g.round, revision: g.revision, current_seat: g.current_seat, turn_started_at: g.turn_started_at, turn_deadline_at: g.turn_deadline_at, clock_running: clockRunning(g),
      clock_started: g.clock_started, tahkim: g.tahkim, tahkim_available: !!g.tahkim_available, bag_count: g.bag_count, result: g.result, winner_seat: g.winner_seat,
      rematch_seats: g.rematch_seats || [], started_at: g.started_at, finished_at: g.finished_at,
      live: extOf(g).live !== false,   // live preview of the tentative tiles: on unless the host switched it off
      pause: extOf(g).pause || null, pauses_left: [0, 1].map(i => Math.max(0, PAUSES_EACH - ((extOf(g).pauses || [0, 0])[i] || 0))),
      undo_req: extOf(g).undo || null,   // the mover's request to take a move back (public; NOT the private undo snapshot)
      draw: drawOf(w, seat)   // first-turn draw: own value, and the opponent's only after both drew
    },
    players: [...w.players].sort((a, b) => a.seat - b.seat).map(p => ({ player_id: p.player_id, seat: p.seat, nickname: p.nickname, score: p.score, tile_count: p.tile_count,
      ms_left: p.ms_left, ready: p.ready, connection_state: p.connection_state, idle_ms: idleMs(w, p.seat, now) })),
    waiting_seat: [STATUS.ACTIVE, STATUS.TAHKIM].includes(g.status) ? blockingSeat(g) : null,   // who the match is waiting for (the only seat that can be claimed against)
    board: g.board,
    moves: w.moves.map(historyItem),
    me: { player_id: userId, seat, rack: w.racks[me.player_id] || [] }
  };
}
