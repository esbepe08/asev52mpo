// The first-turn draw in local play: two cards, the higher value starts, a tie draws again, and the drawn tiles go back to the bag.
// jsdom + real timers (the animation is a short sequence of setTimeouts).
import { boot, SRC } from './harness.mjs';
boot({ 'scrabble.draw': 'on' });
const { S, app, BY } = await import(`${SRC}/js/state.js`);
const { buildDom } = await import(`${SRC}/js/ui.js`);
const { initInput } = await import(`${SRC}/js/input.js`);
const D = await import(`${SRC}/js/draw.js`);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const group = n => console.log('\n# ' + n);
const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rackIds = () => S.players.map(p => p.rack.map(t => t && t.id).join(',')).join('|');
const bagCount = () => S.bag.length;
// Arrange the top two tiles of the bag: the first pop is seat 0's draw, the second is seat 1's.
function rig(v0, v1) {
  const t0 = S.bag.find(t => !t.blank && t.v === v0), t1 = S.bag.find(t => !t.blank && t.v === v1 && t !== t0);
  S.bag = S.bag.filter(t => t !== t0 && t !== t1);
  S.bag.push(t1, t0);
}

buildDom(); initInput();
app.firstRun = false;

group('two cards, both face down until both players have drawn');
{
  D.startLocalDraw(25, 'expanded');
  ok(!$('#drawOv').hidden && D.isDrawOpen(), 'the draw overlay opens');
  ok(S.paused === true, 'the clock does not run during the draw');
  ok(document.querySelector('.app').inert === true, 'the game behind is inert');
  ok(S.players.every(p => p.rack.filter(Boolean).length === 7), 'the racks are already dealt (they are not touched by the draw)');
  ok(bagCount() === 101 - 14, 'the bag is 101 - 14');
  const racks = rackIds();
  ok(document.querySelectorAll('#drawSeats .drawSeat').length === 2 && $('#drawB0') && $('#drawB1'), 'one card and one button per player');
  rig(10, 1);
  $('#drawB0').click();
  ok($('#drawT0').dataset.state === 'down' && $('#drawT0').classList.contains('mark'), 'the first tile stays face down and is marked as drawn');
  ok($('#drawN0').textContent.includes('بانتظار'), 'its note says it is waiting for the opponent');
  ok($('#drawT1').dataset.state === 'down', 'the second card is still down');
  $('#drawB1').click();
  await sleep(1300);   // 420 ms to the flip + 560 ms to mark the winner + the result line
  ok($('#drawT0').dataset.state === 'up' && $('#drawT1').dataset.state === 'up', 'both cards are revealed');
  ok($('#drawS0').classList.contains('win') && $('#drawS1').classList.contains('lose'), 'the higher tile is marked as the winner');
  ok($('#drawResult').textContent.length > 0, 'the result names the starting player');
  await sleep(2400);   // the winner is held on screen before play starts
  ok($('#drawOv').hidden && !D.isDrawOpen(), 'the overlay closes by itself');
  ok(S.paused === false && document.querySelector('.app').inert === false, 'play is enabled again');
  ok(S.cur === 0 && S.draw && S.draw.first === 0, 'the higher draw starts: ' + S.cur);
  ok(rackIds() === racks, 'the racks are exactly the same after the draw');
  ok(bagCount() === 101 - 14, 'the two drawn tiles went back into the bag: ' + bagCount());
}

group('a tie: nobody starts, both draw again');
{
  D.startLocalDraw(25, 'expanded');
  rig(1, 1);
  $('#drawB0').click(); $('#drawB1').click();
  await sleep(1300);
  ok($('#drawResult').textContent.includes('تعادل'), 'the tie is announced: ' + $('#drawResult').textContent);
  await sleep(2000);
  ok(!$('#drawOv').hidden, 'the overlay stays open for the redraw');
  ok($('#drawT0').dataset.state === 'down' && $('#drawT1').dataset.state === 'down', 'both cards are face down again');
  ok($('#drawB0').hidden === false && $('#drawB1').hidden === false, 'both can draw again');
  ok(bagCount() === 101 - 14, 'the tied tiles went back to the bag');
  rig(10, 2);
  $('#drawB0').click(); $('#drawB1').click();
  await sleep(3400);
  ok($('#drawOv').hidden && S.cur === 0 && S.draw.first === 0, 'the redraw decides it: seat 0 starts');
}

group('the Settings switch can turn the local draw off');
{
  localStorage.setItem('scrabble.draw', 'off');
  D.startLocalDraw(25, 'basic');
  ok($('#drawOv').hidden && !D.isDrawOpen(), 'no draw overlay');
  ok(S.paused === false && S.cur === 0 && S.bag.length === 84 - 14, 'the game starts directly');
  localStorage.removeItem('scrabble.draw');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
