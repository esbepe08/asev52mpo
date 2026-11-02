import { makeWorld, suite, across } from './lib.mjs';
import { ABANDON_MS } from '../../supabase/functions/_shared/game/config.js';
const { ok, group, done } = suite('online abandon claim + heartbeat');
const SEC = 1000;

group('snapshot tells who the match is waiting for, and how long they were silent');
{
}
{
  const w = makeWorld(); await w.start();
  w.clock.t += 40 * SEC;
  const B = (await w.call('B', 'snapshot')).snapshot;
  ok(B.waiting_seat === 0, 'on turn = seat 0 = the one being waited for');
  const a = B.players.find(p => p.seat === 0), b = B.players.find(p => p.seat === 1);
  ok(a.idle_ms >= 39 * SEC && a.idle_ms <= 41 * SEC, 'idle_ms of the silent player is about 40 s: ' + a.idle_ms);
  ok(typeof b.idle_ms === 'number', 'idle_ms is reported for every player');
}

group('too early / not the one being waited for / not a member');
{
  const w = makeWorld(); await w.start();
  w.clock.t += ABANDON_MS - 5 * SEC;
  const early = await w.call('B', 'claim_abandon');
  ok(!early.ok && early.code === 'NOT_ABANDONED', 'cannot claim before the grace period is over');
  w.clock.t += 6 * SEC;
  const me = await w.call('A', 'claim_abandon');
  ok(!me.ok && me.code === 'NOT_ABANDONED', 'the player being waited for cannot claim against the waiting player');
  const outsider = await w.raw('C', { action: 'claim_abandon', game_id: w.gameId, client_action_id: 'x', base_revision: 1 });
  ok(!outsider.ok, 'a non-member cannot claim (' + outsider.code + ')');
}

group('a claim after the grace period ends the match in favour of the claimant');
{
  const w = makeWorld(); await w.start();
  w.clock.t += ABANDON_MS + 1 * SEC;
  const r = await w.call('B', 'claim_abandon');
  const g = r.snapshot?.game;
  ok(r.ok && g.status === 'finished' && g.result.reason === 'abandon', 'finished with reason "abandon"');
  ok(g.winner_seat === 1 && g.result.loser_seat === 0, 'the claimant (seat 1) wins; the absent player (seat 0) is named as the loser');
  ok(g.result.lines.every(l => l.ded === 0 && l.bon === 0 && l.mins === 0), 'a forfeit adjusts no scores');
  const again = await w.call('B', 'claim_abandon'); ok(!again.ok && again.code === 'WRONG_STATUS', 'cannot claim twice');
}

group('a heartbeat proves presence and resets the countdown (and never changes the game)');
{
  const w = makeWorld(); await w.start();
  const rev = w.snap.A.game.revision;
  w.clock.t += 150 * SEC;
  const hb = await w.raw('A', { action: 'heartbeat', game_id: w.gameId });
  ok(hb.ok && hb.revision === rev && hb.status === 'active', 'heartbeat answers with the current revision and status');
  ok(hb.opp_idle_ms >= 149 * SEC && hb.opp_idle_ms <= 151 * SEC, 'heartbeat reports how long the opponent has been silent: ' + hb.opp_idle_ms);
  ok((await w.call('A', 'snapshot')).snapshot.game.revision === rev, 'a heartbeat does not bump the revision');
  w.clock.t += 100 * SEC;
  const early = await w.call('B', 'claim_abandon');
  ok(!early.ok && early.code === 'NOT_ABANDONED', 'only 100 s since the heartbeat: too early');
  w.clock.t += 100 * SEC;
  const late = await w.call('B', 'claim_abandon');
  ok(late.ok && late.snapshot.game.result.reason === 'abandon', 'then 200 s of silence: claim accepted');
  const nm = await w.raw('C', { action: 'heartbeat', game_id: w.gameId });
  ok(!nm.ok && nm.code === 'NOT_MEMBER', 'a non-member cannot heartbeat');
}

group('any real action also counts as presence');
{
  const w = makeWorld(); await w.start();
  w.clock.t += 170 * SEC;
  await w.call('A', 'pass_turn');                       // A acts (counts as presence); the match now waits for B
  await w.raw('B', { action: 'heartbeat', game_id: w.gameId });   // B is there too
  w.clock.t += 20 * SEC;
  const r = await w.call('A', 'claim_abandon');
  ok(!r.ok && r.code === 'NOT_ABANDONED', 'B was seen 20 s ago: no claim yet');
  const s = (await w.call('A', 'snapshot')).snapshot;
  ok(s.waiting_seat === 1, 'after the pass the match waits for seat 1');
  w.clock.t += ABANDON_MS;                              // B goes silent for good
  const c = await w.call('A', 'claim_abandon');
  ok(c.ok && c.snapshot.game.result.reason === 'abandon', 'once B has been silent long enough the claim works; A\'s own pass counted as presence, not a claim');
}

group('Tahkim pending: the player who must rule is the one waited for');
{
  const w = makeWorld(); await w.start();
  w.giveRack('A', [...'كتاب']); await w.call('A', 'snapshot');
  const mv = await w.call('A', 'submit_move', { placements: across(w.snap.A, 'كتاب') });
  ok(mv.ok, 'A plays a word');
  await w.call('B', 'snapshot');
  const t = await w.call('B', 'request_tahkim');
  ok(t.ok && t.snapshot.game.status === 'tahkim_pending', 'B challenges: Tahkim pending');
  ok(t.snapshot.waiting_seat === t.snapshot.game.tahkim.resolver_seat, 'waiting seat = resolver seat');
  w.clock.t += ABANDON_MS + 5 * SEC;
  const notMe = await w.call('B', 'claim_abandon');
  ok(!notMe.ok && notMe.code === 'NOT_ABANDONED', 'the resolver cannot claim against the other player (who is not holding anything up)');
  const claim = await w.call('A', 'claim_abandon');
  ok(claim.ok && claim.snapshot.game.result.reason === 'abandon' && claim.snapshot.game.winner_seat === w.seatOfUser('A'), 'A claims: the absent resolver loses');
}

group('not claimable outside a running match');
{
  const w = makeWorld(); await w.room();
  const r = await w.call('B', 'claim_abandon');
  ok(!r.ok && r.code === 'WRONG_STATUS', 'lobby: ' + r.code);
}
done();
