import { boot, choose, ROOT, SRC } from './harness.mjs';
const w = boot();
const imp = f => import(`${SRC}/js/${f}`);
const { initThemes, loadTheme, setTheme, THEMES } = await imp('themes.js');
const { buildDom, chooseMode } = await imp('ui.js');
const { initInput } = await imp('input.js');
const G = await imp('game.js');
const ST = await imp('state.js');
const { TILE_MODES, EXPANDED_TILES, BASIC_TILES } = await imp('modes.js');
const C = await imp('config.js');
const { S, app, BY, cur, snapshot } = ST;
const { openJudge, onJudgeClick } = await imp('judge.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const group = n => console.log('\n# ' + n);

initThemes(); buildDom(); initInput(); G.newGame(); S.paused = true;

const EXT = [...'أإآءؤئةى'];
const allTiles = () => Object.values(BY);
const bagTotal = () => allTiles().length;
const startViaFlow = (mode, mins) => {
  chooseMode(); ok(document.querySelector('#md').open, 'mode dialog opens');
  choose('#md', mode);
  ok(document.querySelector('#sd').open, 'duration dialog follows mode');
  choose('#sd', String(mins));
  ok(document.querySelector('#dlg').open, 'confirmation follows duration');
  choose('#dlg', 'ok');
};

group('startup + mode flow');
ok(app.mode === 'expanded', 'default mode expanded');
ok(app.firstRun === true, 'firstRun flag set');
chooseMode();
ok(document.querySelector('#mCancel').hidden === true, 'first prompt cannot be cancelled (button hidden)');
choose('#md', 'basic');
ok(app.mode === 'expanded' && app.pendingMode === 'basic', 'mode NOT applied before the game starts');
choose('#sd', 'back'); ok(document.querySelector('#md').open, 'duration "back" returns to mode dialog');
choose('#md', 'expanded'); choose('#sd', '25'); choose('#dlg', ''); // confirmation "back"
ok(document.querySelector('#sd').open, 'confirmation "back" returns to duration');
choose('#sd', '25'); choose('#dlg', 'ok');
ok(app.mode === 'expanded' && app.pendingMode === null && app.firstRun === false, 'expanded started');

group('Expanded mode');
let letters = new Set(allTiles().filter(t => !t.blank).map(t => t.l));
ok(bagTotal() === 101, 'expanded bag has 101 tiles, got ' + bagTotal());
ok(EXT.every(l => letters.has(l)), 'all extended letters present');
const cnt = l => allTiles().filter(t => t.l === l).length;
ok(cnt('أ') === 4 && cnt('ة') === 3 && cnt('ؤ') === 1 && cnt('ا') === 8, 'frequencies match the spec');
ok(allTiles().filter(t => t.blank).length === 2, 'two blanks');
ok(allTiles().every(t => t.l !== 'هـ'), 'canonical ه internally');
const picker = () => [...document.querySelectorAll('#bf .btn')].map(b => b.value).join('');
ok(picker() === TILE_MODES.expanded.alpha, 'expanded blank picker == EXPANDED_ALPHA');
ok(EXT.every(l => picker().includes(l)), 'expanded picker includes extended letters');
ok(document.querySelector('#bagInfo').textContent === `الحروف الموسعة · الكيس: ${S.bag.length}`, 'mode indicator: ' + document.querySelector('#bagInfo').textContent);

group('Basic mode');
startViaFlow('basic', 15) ;
ok(app.mode === 'basic', 'basic started'); ok(S.players[0].rack.length === 7, 'racks dealt');
letters = new Set(allTiles().filter(t => !t.blank).map(t => t.l));
ok(bagTotal() === 84, 'basic bag has 84 tiles, got ' + bagTotal());
ok(!EXT.some(l => letters.has(l)), 'NO extended letter in basic tiles');
ok(picker() === TILE_MODES.basic.alpha && !EXT.some(l => picker().includes(l)), 'basic blank picker excludes extended letters');
ok(document.querySelector('#bagInfo').textContent.startsWith('الحروف الأساسية · الكيس:'), 'basic indicator');
ok(S.players[0].ms === 15 * 60000 && S.players[1].ms === 15 * 60000 && app.minutes === 15, 'duration applied');

group('cancelling setup keeps the running game and its mode');
const before = S.bag.length, gid = app.gameId;
chooseMode(); ok(S.paused === true, 'paused during setup'); choose('#md', 'expanded'); ok(app.mode === 'basic', 'mode unchanged while picking');
choose('#sd', ''); ok(app.mode === 'basic' && app.pendingMode === null && S.paused === false, 'cancel at duration: mode kept, resumed');
ok(app.gameId === gid && S.bag.length === before, 'game untouched');
chooseMode(); choose('#md', ''); ok(app.mode === 'basic' && S.paused === false, 'cancel at mode dialog: resumed');

group('new game button goes through mode selection');
document.querySelector('#bNew').click();
ok(document.querySelector('#dlg').open, 'new game asks for confirmation'); choose('#dlg', 'ok');
ok(document.querySelector('#md').open, 'after confirmation: mode dialog (not silently reusing the mode)');
choose('#md', 'expanded'); choose('#sd', '25'); choose('#dlg', 'ok');
ok(app.mode === 'expanded' && bagTotal() === 101, 'new game switched to expanded after choosing it');

group('scoring + blank + undo + tahkim (both modes)');
for (const mode of ['expanded', 'basic']) {
  startViaFlow(mode, 25);
  const take = (l, blank = false) => { const t = allTiles().find(x => blank ? x.blank : (x.l === l)); return t; };
  const put = (tile, slot) => {                              // force a tile into the current rack
    const rk = cur().rack; const old = rk[slot];
    const holder = S.bag.includes(tile) ? S.bag : [...S.players[0].rack, ...S.players[1].rack].length && null;
    // remove `tile` from wherever it is, put `old` there
    for (const arr of [S.bag, S.players[0].rack, S.players[1].rack]) { const i = arr.indexOf(tile); if (i >= 0) arr[i] = old; }
    rk[slot] = tile;
  };
  const a = take('ا'), l2 = take('ل'), bl = take('', true);
  put(a, 0); put(l2, 1); put(bl, 2);
  const mover = S.cur;
  G.place(a, 7, 6); G.place(l2, 7, 7); G.place(bl, 7, 8);
  ok(S.pending && document.querySelector('#bd').open, `[${mode}] blank asks for a letter`);
  choose('#bd', 'م');
  ok(bl.as === 'م', `[${mode}] blank became م`);
  G.submit();
  const e = S.hist[S.hist.length - 1];
  // expected: (1 + 1 + 0) * word multipliers on row 7, cols 6..8 ; letter premiums apply to new tiles
  let sum = 0, wm = 1; [[a, 6], [l2, 7], [bl, 8]].forEach(([t, c]) => { const k = C.LAYOUT[7][c]; let v = t.blank ? 0 : t.v; if (k === 1) v *= 2; if (k === 2) v *= 3; if (k === 3 || k === 5) wm *= 2; if (k === 4) wm *= 3; sum += v; });
  ok(e.total === sum * wm, `[${mode}] score ${e.total} == expected ${sum * wm} (blank = 0)`);
  ok(S.players[mover].score === sum * wm, `[${mode}] player score updated`);
  ok(bl.as === 'م', `[${mode}] committed blank keeps its letter`);
  G.undo();
  ok(bl.as === null && S.players[mover].rack.includes(bl), `[${mode}] undo: blank reset + back in rack`);
  ok(S.cur === mover && S.players[mover].score === 0 && S.hist.length === 0, `[${mode}] undo restored turn/score/history`);
  // cancel move resets blank too
  G.place(a, 7, 7); G.place(bl, 7, 8); choose('#bd', 'ن'); ok(bl.as === 'ن', 'blank set'); G.cancelMove?.();
  document.querySelector('#bCancel').click();
  ok(bl.as === null && S.move.length === 0 && S.players[mover].rack.includes(bl), `[${mode}] cancel move: blank reset`);
  // picker dismissed => blank returns to rack
  G.place(bl, 7, 7); choose('#bd', ''); ok(bl.as === null && S.move.length === 0, `[${mode}] dismissed picker returns blank`);
  // defensive: a letter outside the mode alphabet is rejected
  G.place(bl, 7, 7); choose('#bd', mode === 'basic' ? 'أ' : 'Z'); ok(bl.as === null && S.move.length === 0, `[${mode}] out-of-alphabet blank letter rejected`);

  // tahkim: verdict خطأ restores snapshot; صحيح keeps + penalty
  G.place(a, 7, 6); G.place(l2, 7, 7); G.place(bl, 7, 8); choose('#bd', 'م'); G.submit();
  const challenger = S.cur;
  openJudge(); ok(document.querySelector('#jd').open, `[${mode}] judge dialog opens`);
  ok(document.querySelector('#jB').textContent.includes('✔ صحيح') && document.querySelector('#jB').textContent.includes('✖ خطأ'), `[${mode}] verdict buttons ✔ صحيح / ✖ خطأ`);
  ok(!/غير صحيح/.test(document.querySelector('#jB').textContent), `[${mode}] no "غير صحيحة" wording`);
  onJudgeClick({ target: document.querySelector('[data-a="no"]') });
  ok(bl.as === null && S.players[mover].rack.includes(bl) && S.players[mover].score === 0, `[${mode}] خطأ: move reverted, blank reset`);
  ok(S.cur === challenger, `[${mode}] خطأ: turn passes to challenger`);
  ok(S.hist[S.hist.length - 1].st === 'void', `[${mode}] history void`);
  ok(/✖ خطأ/.test(document.querySelector('#hList').textContent), `[${mode}] history shows ✖ خطأ`);
  // now the challenger plays; then the mover challenges and the verdict is صحيح
  const c0 = S.players[challenger].rack.filter(Boolean)[0], c1 = S.players[challenger].rack.filter(Boolean)[1];
  G.place(c0, 7, 7); G.place(c1, 7, 8); if (c0.blank) choose('#bd', 'ا'); if (c1.blank) choose('#bd', 'ا');
  G.submit(); const scoreAfter = S.players[challenger].score;
  openJudge(); onJudgeClick({ target: document.querySelector('[data-a="yes"]') });
  const he = S.hist[S.hist.length - 1];
  ok(he.st === 'ok' && S.players[challenger].score === scoreAfter && S.players[mover].score === 0 - he.pen + 0, `[${mode}] صحيح: move kept, penalty ${he.pen} on challenger (mover)`);
  ok(/✔ صحيح/.test(document.querySelector('#hList').textContent), `[${mode}] history shows ✔ صحيح`);

  // swap + blank swap
  S.undo = null; S.swap = false;
  const rk = cur().rack; const blk = rk.find(t => t && t.blank) || (put(bl, 0), bl);
  G.startSwap(); S.sel.clear(); S.sel.add(cur().rack[0]); G.doSwap();
  ok(S.swap === false && S.hist[S.hist.length - 1].type === 'swap', `[${mode}] swap works`);
  ok(allTiles().filter(t => t.blank).every(t => t.as === null || S.board.flat().includes(t)), `[${mode}] no stale blank letters off-board`);
}

group('pass / swap unlimited');
startViaFlow('basic', 25);
for (let i = 0; i < 60; i++) { if (i % 15 === 7) { G.startSwap(); S.sel.clear(); S.sel.add(cur().rack[0]); G.doSwap(); } else G.pass(); }
ok(S.ended === false, 'no game over after 60 passes/swaps'); ok(S.hist.length === 60, 'all 60 recorded');
ok(!('idle' in S) && !('idle' in snapshot()), 'no idle counter anywhere');
G.pass(); G.pass(); ok(!S.ended, 'still not ended');

group('theme system');
ok(document.documentElement.dataset.theme === 'classic', 'default theme classic');
const stateBefore = JSON.stringify({ b: S.board.map(r => r.map(t => t && t.id)), r: S.players.map(p => p.rack.map(t => t && t.id)), t: S.players.map(p => p.ms), cur: S.cur, mode: app.mode, hist: S.hist.length });
const gid2 = app.gameId;
for (const id of ['dark', 'emerald', 'desert', 'classic']) {
  document.querySelector(`#thB .thOpt[data-theme="${id}"]`).click();
  ok(document.documentElement.dataset.theme === id, 'applied ' + id);
  ok(w.localStorage.getItem('scrabble.theme') === id, 'persisted ' + id);
  ok(document.querySelector('#thB .thOpt[aria-pressed="true"]').dataset.theme === id, 'selector shows ' + id);
}
ok(JSON.stringify({ b: S.board.map(r => r.map(t => t && t.id)), r: S.players.map(p => p.rack.map(t => t && t.id)), t: S.players.map(p => p.ms), cur: S.cur, mode: app.mode, hist: S.hist.length }) === stateBefore && app.gameId === gid2, 'theme changes leave game state untouched');
ok(!JSON.stringify(snapshot()).includes('theme'), 'snapshots contain no theme data');
ok(![...document.querySelectorAll('#hList *')].some(n => /theme/i.test(n.className)), 'history has no theme info');
setTheme('desert'); startViaFlow('expanded', 25); ok(document.documentElement.dataset.theme === 'desert', 'theme survives new game');
setTheme('bogus'); ok(document.documentElement.dataset.theme === 'desert', 'setTheme ignores invalid id');
ok(Object.keys(THEMES).join() === 'classic,dark,emerald,desert', 'four themes');

group('board tile state (cast shadow classes), duration picker, end-of-game result');
{
  const UI = await imp('ui.js');
  startViaFlow('expanded', 25); S.paused = true;
  const sqAt = (r, c) => document.querySelector(`#board .sq[data-r="${r}"][data-c="${c}"]`);
  const has = (el, ...cls) => cls.every(c => el.classList.contains(c));
  const [t1, t2, t3] = cur().rack.filter(t => t && !t.blank);
  // a tile just placed: owns a shadow (has), is unscored (mv), raised (up) and landing (fall)
  G.place(t1, 7, 7);
  ok(has(sqAt(7, 7), 'has', 'mv', 'up', 'fall'), 'placed tile square: has + mv + up + fall, got ' + sqAt(7, 7).className);
  ok(sqAt(7, 7).querySelector('.tile').classList.contains('cur'), 'pending tile keeps its .cur marker (ring + tint, no glow)');
  ok(!has(sqAt(0, 1), 'has') && !sqAt(0, 1).querySelector('.tile'), 'empty square owns no shadow');
  // the next render drops the one-shot states, the pending state stays
  G.place(t2, 7, 8);
  ok(has(sqAt(7, 7), 'has', 'mv') && !has(sqAt(7, 7), 'up') && !has(sqAt(7, 7), 'fall'), 'previous tile settles: mv stays, up/fall are gone, got ' + sqAt(7, 7).className);
  ok(has(sqAt(7, 8), 'has', 'mv', 'up', 'fall'), 'newest tile lands');
  // picking a pending tile raises its square above the neighbours (z-index) without touching mv
  S.pick = t1; UI.render();
  ok(has(sqAt(7, 7), 'has', 'mv', 'up') && !has(sqAt(7, 8), 'up'), 'picked pending tile is the only raised one');
  S.pick = null;
  // scoring the move: shadow stays, pending state and ring go
  G.submit();
  ok(has(sqAt(7, 7), 'has') && !has(sqAt(7, 7), 'mv') && !sqAt(7, 7).querySelector('.tile').classList.contains('cur'), 'scored tile: still casts, no longer pending, got ' + sqAt(7, 7).className);
  ok(has(sqAt(7, 8), 'has') && !has(sqAt(7, 8), 'mv'), 'every tile of the scored move settles');

  // duration picker: one button per length (number over unit), only the length in use is marked
  const sf = document.querySelector('#sf');
  ok(sf.children.length === C.DURATIONS.length && [...sf.children].every((b, i) => +b.value === C.DURATIONS[i] && b.querySelector('b').textContent === String(C.DURATIONS[i]) && b.querySelector('span')?.textContent === 'دقيقة'), 'duration picker: one button per length (number + unit)');
  app.minutes = 40; chooseMode(); choose('#md', 'basic');
  ok([...sf.children].filter(b => b.getAttribute('aria-current') === 'true').map(b => b.value).join() === '40', 'duration picker marks only the length in use (40)');
  app.minutes = 10; choose('#sd', 'back'); choose('#md', 'basic');
  ok([...sf.children].filter(b => b.getAttribute('aria-current') === 'true').map(b => b.value).join() === '10', 'mark follows the current length when reopened (10)');
  choose('#sd', '25'); choose('#dlg', 'ok');

  // end of game: structured, centred result
  const dlg = document.querySelector('#dlg'), q = s => dlg.querySelector(s);
  const fresh = () => { S.ended = false; S.paused = true; S.players.forEach(p => { p.rack = p.rack.map(() => null); p.ms = 0; }); };
  fresh(); const left = S.bag.pop(); S.players[1].rack[0] = left; S.players[0].ms = 3 * 60000;
  S.players[0].score = 50; S.players[1].score = 30;
  G.endGame('rack');
  ok(dlg.open && dlg.classList.contains('result'), 'end of game opens the dialog in its result layout');
  ok(q('.resWhy').textContent === C.REASONS.rack(q('.resWhy bdi').textContent), 'reason line names the player who used every tile: ' + q('.resWhy').textContent);
  ok(q('.resWin').textContent.includes('الفائز: اللاعب الأول') && !q('.resWin').classList.contains('draw') && !!q('.resWin svg'), 'winner line names the winner (with trophy)');
  const cards = [...dlg.querySelectorAll('.resCard')];
  ok(cards.length === 2 && has(cards[0], 'win') && !has(cards[1], 'win'), 'two player cards, only the winner outlined');
  ok(cards[0].querySelector('.resScore').textContent === '56' && cards[1].querySelector('.resScore').textContent === String(30 - left.v), `scores shown after deduction + time bonus: ${cards.map(c => c.querySelector('.resScore').textContent)}`);
  ok(cards[0].textContent.includes('+6') && cards[0].textContent.includes('النقاط') && cards[1].textContent.includes('خصم ' + left.v), 'cards show the score, the time bonus (3 min x 2) and the deduction');
  choose('#dlg', '');
  fresh(); S.players[0].score = 40; S.players[1].score = 40;
  G.endGame('time');
  ok(q('.resWin').classList.contains('draw') && q('.resWin').textContent === 'تعادل!' && !dlg.querySelector('.resCard.win'), 'draw: "تعادل!" and nobody outlined');
  ok(q('.resWhy').textContent === C.REASONS.time(q('.resWhy bdi').textContent), 'reason line for time-out names the player');
  choose('#dlg', '');
  // an ordinary confirmation afterwards must not inherit the result layout
  UI.ask('عنوان', 'نص عادي', 'موافق', () => {});
  ok(!dlg.classList.contains('result') && document.querySelector('#dM').textContent === 'نص عادي' && !q('.res'), 'plain ask() after a result: no result layout, plain text');
  choose('#dlg', '');
}

group('theme persistence / invalid values');
for (const [label, store, expect] of [['saved dark', { 'scrabble.theme': 'dark' }, 'dark'], ['empty', {}, 'classic'], ['invalid', { 'scrabble.theme': 'neon' }, 'classic'], ['proto key', { 'scrabble.theme': 'toString' }, 'classic'], ['corrupted json', { 'scrabble.theme': '{"x":' }, 'classic']]) {
  boot(store); const m = await import(`${SRC}/js/themes.js?${label}`);
  ok(m.loadTheme() === expect, `${label} -> ${expect}`);
}
boot({}); Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('denied'); }, configurable: true });
{ const m = await import(`${SRC}/js/themes.js?nostorage`); ok(m.loadTheme() === 'classic', 'unavailable storage -> classic'); m.applyTheme('emerald'); ok(document.documentElement.dataset.theme === 'emerald', 'applyTheme works without storage'); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
