// Gameplay operations: clock, move transaction, turn flow, pass/swap/undo, end of game.
import { MIN_BAG_SWAP, REASONS } from './config.js';
import { $, S, app, shuffle, inMove, cur, refill, pushHist, snapshot, restore, createState, profile, bagCount, pushUndo, popUndo } from './state.js';
import { analyze, scoreWords, finalScore } from './scoring.js';
import { notice, warn, fail, showResult, render, tickUI, renderControls, chooseMode, openBlankPicker, buildBlankPicker, bagNote } from './ui.js';
import { nameOf, nameIso, nameHtml } from './names.js';
import { flashWords, clearFlash } from './flash.js';
import { haptic } from './haptics.js';
import { showPause, updatePause, hidePause, isPauseOpen, mmss } from './pause.js';

// ---------- Clock (timestamp based; driven by a single interval in main.js) ----------
export function tick() {
  if (app.net) return app.net.tick();   // online the clock is the server's: this only displays it
  if (S.ended) return;
  const now = performance.now(), p = cur();
  if (S.pause) { S.last = now; paintPause(now); return; }   // keep the banner's "stopped for" counter moving, nothing else
  if (S.paused || !S.started) { S.last = now; return; }
  p.ms = Math.max(0, p.ms - (now - S.last)); S.last = now;
  if (p.ms === 0) { endGame('time'); return; }
  tickUI();
}
function setTurn(i) { tick(); if (S.ended) return false; S.cur = i; S.last = performance.now(); return true; }

// ---------- Pause (local play) ----------
// Same idea as the online pause, without a limit: both players share one screen, so anyone may stop the clock for a break.
// S.pause is the explicit, user-requested pause (the banner); S.paused also covers dialogs and a hidden tab and shows no banner.
export function pauseGame() {
  if (app.net) return app.net.pauseClick();
  if (S.ended || !S.board || S.pause) return;
  tick(); if (S.ended) return;   // charge the time up to the click before freezing
  S.pause = { at: performance.now(), by: S.cur };
  S.paused = true; S.last = performance.now();
  renderControls(); paintPause();
  notice('أُوقفت اللعبة مؤقتًا — الساعة متوقفة');
}
export function resumeGame() {
  if (app.net) return app.net.pauseClick();
  if (!S.pause) return;
  S.pause = null; S.paused = false; S.last = performance.now();
  hidePause(); renderControls();
  notice('استُؤنفت اللعبة');
}
// The banner is redrawn once a second while paused; showPause() is only called on the transition.
export function paintPause(now = performance.now()) {
  if (app.net || !S.pause) return;
  const ms = Math.max(0, now - S.pause.at);
  const by = S.pause.by == null ? '' : nameIso(S.pause.by);
  if (!isPauseOpen()) {
    showPause({
      title: 'اللعبة متوقفة مؤقتًا',
      msg: by ? `أوقف ${by} اللعبة. الساعتان متوقفتان حتى الاستئناف.` : 'الساعتان متوقفتان حتى الاستئناف.',
      clock: 'مدة التوقف ' + mmss(ms),
      btn: 'استئناف اللعبة', disabled: false,
      hint: 'لا يمكن اللعب أثناء الإيقاف. يمكنك الإيقاف والاستئناف كما تشاء.',
      resume: resumeGame
    });
    return;
  }
  updatePause({ clock: 'مدة التوقف ' + mmss(ms), btn: 'استئناف اللعبة', disabled: false });
}

export function newGame(min = app.minutes, mode = app.mode) {
  createState(min, mode);
  hidePause();   // a new game always starts un-paused
  clearFlash();
  buildBlankPicker();
  notice(`لعبة جديدة · ${profile().labelAr} · ${app.minutes} دقيقة`);
  render();
}

// ---------- Move transaction ----------
export function place(t, r, c) {
  if (app.net && !app.net.canPlay()) return false;
  if (S.ended || S.swap || S.pause || S.board[r][c]) return false;
  let e = inMove(t);
  if (e) { S.board[e.r][e.c] = null; e.r = r; e.c = c; }
  else {
    const slot = cur().rack.indexOf(t);
    if (slot < 0) return false;
    cur().rack[slot] = null; e = {t, r, c, slot}; S.move.push(e);
  }
  S.board[r][c] = t; S.land = t; S.pick = null;
  // A blank tile must be given a letter before the move can continue (clock paused meanwhile).
  if (t.blank && !t.as) { S.pending = e; S.paused = true; render(); openBlankPicker(); return true; }
  render(); return true;
}
export function unplace(e) {
  S.board[e.r][e.c] = null;
  if (e.t.blank) e.t.as = null;
  const rack = cur().rack;
  const i = rack[e.slot] ? rack.indexOf(null) : e.slot;
  rack[i] = e.t;
  S.move = S.move.filter(x => x !== e);
}
export function cancelMove() {
  [...S.move].forEach(unplace);
  S.pick = null;
}

// ---------- Actions ----------
export function submit() {
  if (S.ended || S.swap || S.pause) return;
  const a = analyze();
  if (a.err) return fail(a.err);
  if (app.net) return app.net.submit();   // online: the server re-checks, scores and commits; the check above was only a courtesy
  const r = scoreWords(a.words, a.isNew, S.move.length), pts = r.total, p = cur();
  pushUndo(snapshot());   // one step per committed action: Undo can then be used again for the move before it
  pushHist({p: S.cur, type: 'move', words: r.list, total: pts, bingo: r.bingo});
  p.score += pts; S.move = []; S.pick = null; S.pop = S.cur;
  const had = S.bag.length;
  refill(p);
  notice(`${nameIso(S.cur)}: +${pts} نقطة${bagNote(had, S.bag.length)}`);
  haptic(r.bingo ? 'bingo' : 'score');
  if (!p.rack.some(Boolean)) endGame('rack'); else nextTurn(true);
  flashWords(a.words);   // after the render: the words just scored light up in reading order (js/flash.js)
}
export function nextTurn(scored) {
  if (!setTurn(1 - S.cur)) return;
  if (scored && !S.started) { S.started = true; S.last = performance.now(); }
  S.sel.clear(); S.pick = null; render();
}
export function undo() {
  if (app.net) return;   // online there is no local undo: the mover asks the opponent (session.js)
  const u = S.undos.length ? S.undos[S.undos.length - 1] : null;
  if (!u || S.ended || S.swap || S.move.length || S.pause) return;
  tick(); if (S.ended) return;
  clearFlash();   // the move being taken back must not keep lighting up
  popUndo(); restore(u); S.hist.pop(); S.hv++;
  notice(S.undos.length ? 'تم التراجع خطوة — يمكنك التراجع مرة أخرى' : 'تم التراجع عن الحركة الأخيرة'); render();
}
export function pass() {
  if (S.ended || S.swap || S.move.length || S.pause) return;
  if (app.net) return app.net.pass();
  pushUndo(snapshot());   // a pass is a committed action too: it can be taken back like a move
  pushHist({p: S.cur, type: 'pass'});   // passing is unlimited
  notice(`${nameIso(S.cur)} مرّر الدور`); nextTurn();
}
export function startSwap() {
  if (S.ended || S.move.length || S.pause) return;
  if (app.net && !app.net.guard()) return;
  S.swap = true; S.sel.clear(); S.pick = null; notice('اختر القطع للتبديل.'); render();
}
export function cancelSwapOrMove() {
  if (S.ended) return;
  if (S.swap) { S.swap = false; S.sel.clear(); } else cancelMove();
  render();
}
export function doSwap() {
  if (S.pause) return;
  if (!S.sel.size) return fail('حدد قطعة واحدة على الأقل للتبديل.');
  if (bagCount() < MIN_BAG_SWAP) return fail(`لا يمكن التبديل: في الكيس ${bagCount()} قطع فقط (الحد الأدنى ${MIN_BAG_SWAP}).`);
  if (app.net) return app.net.swap([...S.sel].map(t => t.id));
  const rack = cur().rack, idx = rack.map((t, i) => t && S.sel.has(t) ? i : -1).filter(i => i >= 0);
  pushUndo(snapshot());   // a swap is a committed action too
  const drawn = S.bag.splice(0, idx.length), old = idx.map(i => rack[i]);
  idx.forEach((i, k) => { rack[i] = drawn[k]; });
  S.bag.push(...old); shuffle(S.bag);
  S.swap = false; S.sel.clear(); pushHist({p: S.cur, type: 'swap', cnt: idx.length});   // swapping is unlimited too
  notice(`تم تبديل ${idx.length} قطع`); nextTurn();
}
export function endGame(reason) {
  if (S.ended) return;
  S.ended = true;
  S.pause = null; hidePause();
  if (S.pending) { S.pending = null; $('#bd').close(); }
  if (app.judge) { app.judge = null; $('#jd').close(); }
  cancelMove(); S.swap = false; S.sel.clear(); S.pick = null;
  // S.cur is the player the ending concerns: whose clock ran out, or who just used the last tile (the turn has not passed yet).
  const why = REASONS[reason](nameHtml(S.cur));
  const rows = S.players.map((p, i) => {
    const f = finalScore(p.score, p.ms, p.rack.reduce((s, t) => s + (t ? t.v : 0), 0));
    p.score = f.total;
    return {name: nameOf(i), ...f, score: f.total};
  });
  const [a, b] = [rows[0].score, rows[1].score];
  render();
  showResult({reason: why, rows, winner: a === b ? -1 : a > b ? 0 : 1}, chooseMode);
}
