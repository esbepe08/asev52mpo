// End of game, pure logic (no DOM): the final score formula and the rules that must NOT change.
//   final = score + 2 x (minutes left, rounded to the nearest minute, exactly :30 rounds down) - value of the tiles left on the rack
// The clock shows whole seconds (rounded up), so the bonus follows what the player last saw. Run: node logic/endgame.mjs
import { bonusMinutes, finalScore } from '../../js/scoring.js';
import { TIME_BONUS_PER_MIN, REASONS } from '../../js/config.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const ms = (m, s = 0) => (m * 60 + s) * 1000;

console.log('# bonus minutes (nearest minute, :30 rounds down)');
for (const [m, s, want] of [[2, 30, 2], [2, 31, 3], [2, 29, 2], [0, 0, 0], [0, 29, 0], [0, 30, 0], [0, 31, 1], [1, 30, 1], [1, 31, 2], [3, 0, 3], [40, 0, 40]])
  ok(bonusMinutes(ms(m, s)) === want, `${m}:${String(s).padStart(2, '0')} left -> ${want} minute(s), got ${bonusMinutes(ms(m, s))}`);
ok(bonusMinutes(ms(2, 30) - 1) === 2 && bonusMinutes(ms(2, 30) + 1) === 3, 'a millisecond either side of 2:30 follows the displayed second (2:30 -> 2, 2:31 -> 3)');
ok(bonusMinutes(0) === 0 && bonusMinutes(-5) === 0, 'never negative');
ok(Object.is(bonusMinutes(0), 0), 'zero is +0, not -0 (it is printed)');

console.log('# final score');
ok(TIME_BONUS_PER_MIN === 2, 'two points per minute');
let f = finalScore(50, ms(2, 30), 0);
ok(f.mins === 2 && f.bonus === 4 && f.total === 54 && f.raw === 50 && f.ded === 0, 'the worked example: 50 + (2:30 -> 2) x 2 = 54');
f = finalScore(40, ms(3, 10), 7);
ok(f.total === 40 + 6 - 7 && f.ded === 7 && f.bonus === 6, 'remaining tile value is subtracted: 40 + 6 - 7 = 39');
f = finalScore(0, 0, 9);
ok(f.total === -9, 'no floor: the formula is applied as stated, so a total can be below zero');
ok(finalScore(10, ms(1), 0).total === 12 && finalScore(10, ms(0, 59), 0).total === 12, '1:00 and 0:59 both count as 1 minute');

console.log('# reasons name the player');
ok(REASONS.time('X') === 'انتهى وقت X' && REASONS.rack('X') === 'أنهى X جميع قطعه', 'both end reasons take the player name');
ok(Object.keys(REASONS).sort().join() === 'abandon,rack,resign,time', 'a game ends by time or rack, or when a player resigns or abandons it (passing never ends it)');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
