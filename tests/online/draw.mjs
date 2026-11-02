// The first-turn draw online: who starts is decided by one drawn tile each, the values stay private until both have drawn, and a tie
// draws again. The server owns all of it (engine.drawFirstTile + snapshot.drawOf).
import { makeWorld, suite } from './lib.mjs';
const { ok, group, done } = suite('online first-turn draw');

// Arrange the top of the bag so the next draw has a known value (the bag itself is the server's private state).
const top = (w, v) => { const bag = w.server().priv.bag; const i = bag.findIndex(t => t && (t.blank ? 0 : t.v) === v); const [t] = bag.splice(i < 0 ? 0 : i, 1); bag.push(t); };

group('start: the lobby hands over to the draw, not to play');
{
  const w = makeWorld(); await w.room();
  const s = await w.call('A', 'start_game'); await w.call('B', 'snapshot');
  const g = s.snapshot.game;
  ok(s.ok && g.status === 'drawing', 'the host starts a first-turn draw (status drawing)');
  ok(g.current_seat === null && g.clock_started === false && g.clock_running === false, 'no turn and no clock yet');
  ok(g.bag_count === 101 && s.snapshot.me.rack.length === 7 && s.snapshot.me.rack.every(t => t === null), 'the full bag is still there and the racks are empty');
  ok(g.draw && g.draw.mine === null && g.draw.theirs === null && !g.draw.done, 'nobody has drawn yet');
  const misA = await w.call('A', 'pass_turn'); ok(!misA.ok && misA.code === 'WRONG_STATUS', 'no pass before the draw');
  const misB = await w.call('B', 'submit_move', { placements: [] }); ok(!misB.ok && misB.code === 'WRONG_STATUS', 'no move before the draw');
}

group('one draw: yours only, the opponent is still hidden');
{
  const w = makeWorld(); await w.room(); await w.call('A', 'start_game'); await w.call('B', 'snapshot');
  top(w, 8);   // A draws ط/ظ/ع
  const a = await w.call('A', 'draw_first_tile');
  ok(a.ok && a.snapshot.game.status === 'drawing', 'the first draw does not start the game');
  ok(a.snapshot.game.draw.mine && a.snapshot.game.draw.mine.v === 8, 'A sees its own tile at once');
  ok(a.snapshot.game.draw.theirs === null, "A cannot see B's tile before B draws");
  const b = await w.call('B', 'snapshot');
  ok(b.snapshot.game.draw.mine === null && b.snapshot.game.draw.theirs === null, "B sees neither tile (not even A's)");
  const publicJson = JSON.stringify(a.snapshot);
  ok(!/"draw":\{"by"/.test(publicJson) && !publicJson.includes('"theirs":{"l"'), 'the private draw object never reaches a snapshot');
  ok(w.server().priv.draw && w.server().priv.draw.by[0].v === 8, 'the server keeps the drawn value in game_private.draw');
  ok(!w.server().game.ext.draw, 'and NOT in the public games.ext yet');
  const dup = await w.call('A', 'draw_first_tile');
  ok(!dup.ok && dup.code === 'ALREADY_DRAWN', 'a player cannot draw twice');
  const stale = await w.raw('B', { action: 'draw_first_tile', game_id: w.gameId, client_action_id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', base_revision: 1 });
  ok(!stale.ok && stale.code === 'STALE_STATE', 'the draw is revision-pinned');
}

group('both draws: the higher value starts, both are revealed');
{
  const w = makeWorld(); await w.room(); await w.call('A', 'start_game'); await w.call('B', 'snapshot');
  top(w, 10); await w.call('A', 'draw_first_tile');
  await w.call('B', 'snapshot');
  top(w, 1); const b = await w.call('B', 'draw_first_tile');
  ok(b.ok && b.snapshot.game.status === 'active', 'the second draw starts play');
  const A = (await w.call('A', 'snapshot')).snapshot, B = (await w.call('B', 'snapshot')).snapshot;
  ok(A.game.current_seat === 0 && B.game.current_seat === 0, 'the higher tile (seat 0) starts');
  ok(A.game.draw.done && A.game.draw.first === 0 && A.game.draw.mine.v === 10 && A.game.draw.theirs.v === 1, 'A sees the full result');
  ok(B.game.draw.mine.v === 1 && B.game.draw.theirs.v === 10, 'B sees the same pair, from its own side');
  ok(A.me.rack.filter(Boolean).length === 7 && B.me.rack.filter(Boolean).length === 7, 'both racks are dealt after the draw');
  ok(A.game.bag_count === 101 - 14, 'the drawn tiles went back: the bag keeps its full count before the racks');
  const all = [...A.me.rack, ...B.me.rack].map(t => t.id);
  ok(new Set(all).size === 14, 'the two drawn tiles are not duplicated into the racks');
  const s = await w.call('A', 'submit_move', { placements: [] });
  ok(!s.ok, 'the starter can now play (an empty move is refused by the rules, not by the status): ' + s.code);
}

group('a tie: nobody starts, both draw again');
{
  const w = makeWorld(); await w.room(); await w.call('A', 'start_game'); await w.call('B', 'snapshot');
  top(w, 4); await w.call('A', 'draw_first_tile');
  await w.call('B', 'snapshot');
  top(w, 4); const tie = await w.call('B', 'draw_first_tile');
  ok(tie.ok && tie.snapshot.game.status === 'drawing' && tie.snapshot.game.draw.tries === 1, 'equal values: still drawing, one try recorded');
  const A = (await w.call('A', 'snapshot')).snapshot;
  ok(A.game.draw.mine === null && A.game.draw.theirs === null && !A.game.draw.done, 'the tie reveals nothing and resets both cards');
  top(w, 10); await w.call('A', 'draw_first_tile');
  await w.call('B', 'snapshot');
  top(w, 2); const win = await w.call('B', 'draw_first_tile');
  ok(win.ok && win.snapshot.game.status === 'active' && win.snapshot.game.draw.tries === 1 && win.snapshot.game.current_seat === 0, 'the redraw decides it');
}

group('leaving during the draw closes the match');
{
  const w = makeWorld(); await w.room(); await w.call('A', 'start_game'); await w.call('B', 'snapshot');
  const out = await w.call('B', 'leave_room');
  ok(out.ok && out.snapshot && out.snapshot.game.status === 'abandoned', 'a player can leave a drawing room');
  const A = await w.call('A', 'snapshot');
  ok(A.ok && A.snapshot.game.status === 'abandoned', 'the room is abandoned for the other player too');
  ok(w.server().priv.draw === null && !w.server().game.ext.draw, 'no draw state is left behind');
}

group('the draw result disappears once play has started');
{
  const w = await makeWorld(); await w.start();
  ok(w.snap.A.game.draw && w.snap.A.game.draw.done, 'the started game carries the draw result');
  ok((await w.call('A', 'pass_turn')).ok, 'a pass is the first action');
  const after = (await w.call('B', 'snapshot')).snapshot;
  ok(after.game.draw === null, 'and the draw result is cleared, so a reconnect does not replay the animation');
}

done();
