import { makeWorld, suite, across } from './lib.mjs';
import { PAUSE_MS, PAUSES_EACH } from '../../supabase/functions/_shared/game/config.js';
const { ok, group, done } = suite('online pause, undo with approval, live setting');
const SEC = 1000;

// A plays مدرس on the centre row (the clock starts); B is now on turn and A is waiting.
async function afterFirstMove(settings = {}) {
  const w = await makeWorld(); await w.start(settings);
  w.giveRack('A', [...'مدرسةيا']); await w.call('A', 'snapshot');
  const pre = w.snap.A.me.rack.filter(Boolean).map(t => t.id);
  const r = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'مدرس') });
  await w.call('B', 'snapshot');
  return { w, r, pre };
}

group('live preview setting');
{
  const w = makeWorld(); await w.room();
  ok(w.snap.A.game.live === true, 'live preview is on by default');
  const guest = await w.call('B', 'update_settings', { settings: { live: false } });
  ok(!guest.ok && guest.code === 'NOT_HOST', 'a guest cannot change it');
  const bad = await w.call('A', 'update_settings', { settings: { live: 'no' } });
  ok(!bad.ok && bad.code === 'BAD_REQUEST', 'only a boolean is accepted');
  const off = await w.call('A', 'update_settings', { settings: { live: false } });
  ok(off.ok && off.snapshot.game.live === false, 'the host can switch it off');
  const created = makeWorld(); await created.room({ live: false });
  ok(created.snap.A.game.live === false, 'it can be chosen when the room is created');
}

group('undo: request, who may answer, accept');
{
  const { w, r, pre } = await afterFirstMove();
  ok(r.ok && w.snap.A.game.tahkim_available, 'the first move is on the board');
  const boardBefore = JSON.stringify(w.snap.A.board), idsBefore = pre;
  const noOne = await w.call('B', 'request_undo');
  ok(!noOne.ok && noOne.code === 'NO_UNDO', 'the player on turn cannot ask (it is not their move)');
  const q = await w.call('A', 'request_undo');
  ok(q.ok && q.snapshot.game.undo_req.state === 'pending' && q.snapshot.game.undo_req.by === 0, 'the mover can ask');
  ok((await w.call('B', 'snapshot')).snapshot.game.undo_req.state === 'pending', 'the opponent sees the pending request');
  const dup = await w.call('A', 'request_undo');
  ok(!dup.ok && dup.code === 'UNDO_PENDING', 'asking twice is refused');
  const self = await w.call('A', 'respond_undo', { accept: true });
  ok(!self.ok && self.code === 'NO_UNDO', 'the requester cannot answer their own request');
  const bad = await w.call('B', 'respond_undo', { accept: 'yes' });
  ok(!bad.ok && bad.code === 'BAD_REQUEST', 'accept must be a boolean');
  const stale = await w.raw('B', { action: 'respond_undo', game_id: w.gameId, client_action_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', base_revision: 1, accept: true });
  ok(!stale.ok && stale.code === 'STALE_STATE', 'a stale answer is refused (revision pinned)');
  const pause = await w.call('B', 'pause_game');
  ok(!pause.ok && pause.code === 'UNDO_PENDING', 'cannot pause while a request waits');
  w.clock.t += 7 * SEC;
  const acc = await w.call('B', 'respond_undo', { accept: true });
  ok(acc.ok, 'the opponent accepts');
  const A = (await w.call('A', 'snapshot')).snapshot, B = (await w.call('B', 'snapshot')).snapshot;
  ok(A.game.current_seat === 0 && B.game.current_seat === 0, 'the turn is back with the mover');
  ok(JSON.stringify(A.board) !== boardBefore && A.board.flat().every(c => c === null), 'the board is empty again');
  ok(A.me.rack.filter(Boolean).length === 7 && A.players.every(p => p.score === 0), 'rack refilled to the old state, scores restored');
  ok(A.me.rack.filter(Boolean).map(t => t.id).sort().join() === [...idsBefore].sort().join(), 'the very same tiles are back on the rack');
  ok(A.game.undo_req === null && A.game.tahkim_available === false, 'request cleared, nothing left to undo');
  ok(A.moves.length === 1 && A.moves[0].st === 'void', 'the move stays in the history, marked void');
  ok(A.game.clock_started === false && A.game.clock_running === false, 'the clock is back to "not started" (it was the first move)');
  ok(A.game.bag_count === 101 - 14, 'the bag is restored: ' + A.game.bag_count);
  const again = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'مدرس') });
  ok(again.ok, 'the mover can play again after the undo');
  const all = [...A.me.rack, ...B.me.rack].filter(Boolean).map(t => t.id);
  ok(new Set(all).size === all.length, 'no tile id is duplicated');
}

group('undo: decline, cancel, implicit decline, Tahkim');
{
  const { w } = await afterFirstMove();
  await w.call('A', 'request_undo'); await w.call('B', 'snapshot');
  const no = await w.call('B', 'respond_undo', { accept: false });
  ok(no.ok && no.snapshot.game.undo_req.state === 'declined', 'the opponent declines');
  ok(no.snapshot.game.current_seat === 1 && no.snapshot.board.flat().some(Boolean), 'a decline changes nothing on the board');
  await w.call('A', 'snapshot');
  const again = await w.call('A', 'request_undo');
  ok(!again.ok && again.code === 'UNDO_DECLINED', 'the same move cannot be asked for again');
}
{
  const { w } = await afterFirstMove();
  await w.call('A', 'request_undo');
  const c = await w.call('A', 'cancel_undo');
  ok(c.ok && c.snapshot.game.undo_req === null, 'the requester can withdraw');
  await w.call('B', 'snapshot');
  const notMine = await w.call('B', 'cancel_undo');
  ok(!notMine.ok && notMine.code === 'NO_UNDO', 'nothing to withdraw any more');
  ok((await w.call('A', 'request_undo')).ok, 'after withdrawing the move can be asked for again');
}
{
  const { w } = await afterFirstMove();
  await w.call('A', 'request_undo'); await w.call('B', 'snapshot');
  const p = await w.call('B', 'pass_turn');
  ok(p.ok && p.snapshot.game.undo_req === null, 'acting on the move is an implicit decline');
  await w.call('A', 'snapshot');
  const late = await w.call('A', 'request_undo');
  ok(!late.ok, 'the move can no longer be taken back once the opponent has played (' + late.code + ')');
}
{
  const { w } = await afterFirstMove();
  await w.call('A', 'request_undo'); await w.call('B', 'snapshot');
  const t = await w.call('B', 'request_tahkim');
  ok(t.ok && t.snapshot.game.undo_req === null && t.snapshot.game.status === 'tahkim_pending', 'a Tahkim request replaces the undo request');
  await w.call('A', 'snapshot');
  const u = await w.call('A', 'request_undo');
  ok(!u.ok, 'no undo while a ruling is pending (' + u.code + ')');
}
{
  const w = makeWorld(); await w.start();
  const r = await w.call('A', 'request_undo');
  ok(!r.ok && r.code === 'NO_UNDO', 'nothing to undo before any move');
}

group('pause');
{
  const { w } = await afterFirstMove();
  const before = w.snap.B.players.find(p => p.seat === 1).ms_left;
  const p = await w.call('B', 'pause_game');
  ok(p.ok && p.snapshot.game.pause && p.snapshot.game.pause.by === 1, 'a player can pause');
  ok(p.snapshot.game.clock_running === false && p.snapshot.game.turn_deadline_at === null, 'the clock stops');
  ok(p.snapshot.game.pauses_left.join() === `${PAUSES_EACH},${PAUSES_EACH - 1}`, 'pauses left are public: ' + p.snapshot.game.pauses_left);
  w.giveRack('B', [...'كتابةيا']); await w.call('B', 'snapshot');
  const mv = await w.call('B', 'submit_move', { placements: across(w.snap.B, 'كتاب', 8, 7) });
  ok(!mv.ok && mv.code === 'PAUSED', 'nothing can be played while paused');
  ok((await w.call('B', 'pass_turn')).code === 'PAUSED' && (await w.call('B', 'swap_tiles', { tileIds: ['x'] })).code === 'PAUSED', 'pass and swap are refused too');
  ok((await w.call('A', 'pause_game')).code === 'PAUSED', 'cannot pause twice');
  w.clock.t += 90 * SEC;
  const early = await w.call('A', 'resume_game');
  ok(!early.ok && early.code === 'NOT_YOURS_TO_RESUME', 'the other player cannot resume before the time is up');
  ok((await w.call('A', 'claim_timeout')).code === 'NOT_EXPIRED', 'a paused clock cannot run out');
  const rs = await w.call('B', 'resume_game');
  ok(rs.ok && rs.snapshot.game.pause === null && rs.snapshot.game.clock_running === true, 'the pauser resumes at any time');
  ok(rs.snapshot.players.find(p => p.seat === 1).ms_left === before, 'the pause cost no time: ' + rs.snapshot.players.find(p => p.seat === 1).ms_left);
  ok((await w.call('B', 'resume_game')).code === 'NOT_PAUSED', 'resume when not paused is refused');
}
{
  const { w } = await afterFirstMove();
  for (let i = 0; i < PAUSES_EACH; i++) { ok((await w.call('B', 'pause_game')).ok, 'pause ' + (i + 1)); await w.call('B', 'resume_game'); }
  const over = await w.call('B', 'pause_game');
  ok(!over.ok && over.code === 'NO_PAUSES_LEFT', 'a player has a limited number of pauses');
  ok((await w.call('A', 'pause_game')).ok, 'the other player still has theirs');
}
group('pause: expiry resumes by itself');
{
  const { w } = await afterFirstMove();
  const before = w.snap.B.players.find(p => p.seat === 1).ms_left;
  await w.call('B', 'pause_game');
  w.clock.t += PAUSE_MS + 5 * SEC;
  const late = await w.call('A', 'resume_game');
  ok(late.ok && late.snapshot.game.pause === null, 'after the limit the other player may resume');
  ok(late.snapshot.players.find(p => p.seat === 1).ms_left === before, 'no time was charged for the pause');
}
{
  const { w } = await afterFirstMove();
  await w.call('B', 'pause_game');
  w.clock.t += PAUSE_MS + 5 * SEC;
  w.giveRack('B', [...'كتابةيا']); await w.call('B', 'snapshot');
  const mv = await w.call('B', 'submit_move', { placements: across(w.snap.B, 'كتاب', 8, 7) });
  ok(mv.ok === true || mv.code !== 'PAUSED', 'an expired pause never blocks the next action (' + (mv.code || 'ok') + ')');
  ok(w.snap.B.game.pause === null, 'and it is cleared');
}
{
  const { w } = await afterFirstMove();
  await w.call('B', 'pause_game'); await w.call('A', 'snapshot');
  const q = await w.call('A', 'request_undo');
  ok(!q.ok && q.code === 'PAUSED', 'no undo request while paused');
  const rg = await w.call('B', 'resign_game');
  ok(rg.ok && rg.snapshot.game.status === 'finished' && rg.snapshot.game.pause === null, 'resigning while paused works and clears it');
}
group('rematch resets pause and undo state');
{
  const { w } = await afterFirstMove();
  await w.call('B', 'pause_game'); await w.call('B', 'resume_game');
  await w.call('B', 'resign_game'); await w.call('A', 'rematch'); const r = await w.call('B', 'rematch');
  ok(r.ok && r.snapshot.game.status === 'drawing' && r.snapshot.game.pauses_left.join() === `${PAUSES_EACH},${PAUSES_EACH}` && r.snapshot.game.undo_req === null, 'a new round starts with fresh pauses, no undo request, and a first-turn draw');
  await w.finishDraw(0);
  ok(w.snap.A.game.status === 'active' && w.snap.A.game.undo_req === null, 'after the draw the new round is playable');
}
done();
