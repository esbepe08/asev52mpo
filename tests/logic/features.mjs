// Offline features added in v5.2, in jsdom against the real modules:
//   - unlimited Undo (a stack of snapshots, one per committed action: move, pass, swap)
//   - the pause card and the frozen clock (local play)
//   - the rack display preference (always visible / the player on turn only)
// The first-turn draw lives in draw.mjs: it is timed, so it gets its own file.
import { boot, SRC } from './harness.mjs';
boot();   // install the jsdom globals before any game module is imported
const { S, app, cur, BY } = await import(`${SRC}/js/state.js`);
const { buildDom, render } = await import(`${SRC}/js/ui.js`);
const { initInput } = await import(`${SRC}/js/input.js`);
const G = await import(`${SRC}/js/game.js`);
const J = await import(`${SRC}/js/judge.js`);
const { serialise, validate, restoreMatch } = await import(`${SRC}/js/persist.js`);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const group = n => console.log('\n# ' + n);
const $ = s => document.querySelector(s);
const allTiles = () => Object.values(BY);
const byLetter = (l, blank = false) => allTiles().find(t => blank ? t.blank : t.l === l);

buildDom(); initInput();

function start(mode = 'expanded', mins = 25) {
  G.newGame(mins, mode);
  app.firstRun = false;
  S.paused = false; S.started = true;   // a running match: tick() may move the clock
  S.last = performance.now();
  return S;
}
// Put a tile from anywhere (bag or a rack) into the current player's rack slot.
function give(tile, slot = 0) {
  const rk = cur().rack, old = rk[slot];
  for (const arr of [S.bag, S.players[0].rack, S.players[1].rack]) { const i = arr.indexOf(tile); if (i >= 0) arr[i] = old; }
  rk[slot] = tile;
}

group('unlimited undo: one step per committed action, pressable again and again');
{
  start();
  const a = byLetter('ا'), l = byLetter('ل'), m = byLetter('م');
  give(a, 0); give(l, 1); give(m, 2);
  G.place(a, 7, 6); G.place(l, 7, 7); G.place(m, 7, 8); G.submit();
  ok(S.hist.length === 1 && S.players[0].score > 0, 'player 1 committed a move');
  G.pass();   // player 2's action (a pass is a committed action too)
  ok(S.hist.length === 2 && S.cur === 0, 'player 2 passed');
  ok(S.undos.length === 2 && S.undo === S.undos[1], 'the stack holds one snapshot per action; the button is enabled');
  G.undo();
  ok(S.hist.length === 1 && S.players[0].score > 0 && S.cur === 1, 'first undo: player 2\'s pass is taken back, turn back to player 2');
  ok(S.undo === S.undos[0] && S.undos.length === 1, 'the button is enabled AGAIN for the move before it');
  G.undo();
  ok(S.hist.length === 0 && S.players[0].score === 0 && S.board.flat().every(t => !t), 'second undo: player 1\'s move is taken back, board empty');
  ok(S.undo === null && S.undos.length === 0, 'nothing left: the button is disabled');
  ok(S.cur === 0, 'the turn is player 1\'s again');
  ok(S.bag.length === 101 - 14, 'the bag is back to its dealt size: ' + S.bag.length);
  ok(cur().rack.filter(Boolean).length === 7, 'the rack is full again');
}

group('undo history is saved and restored');
{
  start();
  G.pass(); G.pass(); G.pass();
  ok(S.undos.length === 3, 'three passes -> three undo steps');
  const d = JSON.parse(JSON.stringify(serialise()));
  ok(validate(d) && Array.isArray(d.undos) && d.undos.length === 3, 'the save carries the stack and validates');
  const n = S.undos.length;
  restoreMatch(d);
  ok(S.undos.length === n && S.undo === S.undos[n - 1], 'restoring rebuilds the same stack');
  const legacy = { ...d }; delete legacy.undos;   // a save from before the stack
  ok(validate(legacy), 'a save from before the stack (only `undo`) is still valid');
  restoreMatch(legacy);
  ok(S.undos.length === 1 && S.undo === S.undos[0], 'and becomes a one-step stack');
}

group('judging an invalid move consumes the move\'s step, not the whole history');
{
  start();
  const a = byLetter('ا'), l = byLetter('ل');
  give(a, 0); give(l, 1);
  G.place(a, 7, 6); G.place(l, 7, 7); G.submit();
  ok(S.undos.length === 1, 'one step after the move');
  J.openJudge();
  J.onJudgeClick({ target: $('[data-a="no"]') });
  ok(S.undos.length === 0 && S.undo === null && S.board.flat().every(t => !t), 'a ✖ ruling removes the move AND its step');
}

group('pause: the card appears, the clock freezes, resume works');
{
  start();
  G.pauseGame();
  const before = S.players[S.cur].ms;
  ok(!!S.pause && S.paused === true, 'pause state set');
  ok(!$('#pauseOv').hidden && $('#pauseT').textContent.includes('متوقفة'), 'the prominent card is shown');
  ok(document.documentElement.dataset.paused === 'true', 'the board is marked paused (CSS hides it)');
  ok($('#bPause .lbl').textContent === 'استئناف', 'the control now says resume');
  await new Promise(r => setTimeout(r, 120)); G.tick();
  ok(S.players[S.cur].ms === before, 'the clock did not move while paused: ' + S.players[S.cur].ms + ' vs ' + before);
  ok($('#pauseClock').textContent.includes('مدة التوقف'), 'the card counts the stopped time: ' + $('#pauseClock').textContent);
  $('#pauseResume').click();
  ok(!S.pause && S.paused === false && $('#pauseOv').hidden, 'resume clears the card and the pause');
  ok(!document.documentElement.dataset.paused, 'and un-marks the board');
  await new Promise(r => setTimeout(r, 40)); G.tick();
  ok(S.players[S.cur].ms < before, 'the clock moves again');
}

group('rack display: always visible / only the player on turn');
{
  start();
  document.documentElement.dataset.racks = 'always';
  S.cur = 1; render();
  ok($('#rk0').dataset.rackHidden === 'false' && $('#rk1').dataset.rackHidden === 'false' && !$('#rk0').hasAttribute('inert'), 'always: both racks readable and usable');
  document.documentElement.dataset.racks = 'turn';
  S.cur = 1; render();
  ok($('#rk0').dataset.rackHidden === 'true' && $('#rk0').hasAttribute('inert'), 'turn: the waiting rack is hidden and inert');
  ok($('#rk1').dataset.rackHidden === 'false' && !$('#rk1').hasAttribute('inert'), 'turn: the rack of the player on turn is visible');
  S.cur = 0; render();
  ok($('#rk1').dataset.rackHidden === 'true' && $('#rk0').dataset.rackHidden === 'false', 'it follows the turn');
  S.ended = true; render();
  ok($('#rk0').dataset.rackHidden === 'false' && $('#rk1').dataset.rackHidden === 'false', 'at the end both racks are shown');
  S.ended = false; delete document.documentElement.dataset.racks; render();
}

group('the pause button is wired through the normal controls');
{
  start();
  $('#bPause').click();
  ok(!!S.pause && !$('#pauseOv').hidden, 'clicking #bPause pauses');
  $('#bPause').click();
  ok(!S.pause && $('#pauseOv').hidden, 'clicking it again resumes');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
