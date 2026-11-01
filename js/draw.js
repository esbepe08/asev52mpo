// First-turn draw ("who starts?"), like a real Scrabble game: each player draws one tile, the highest value starts, a tie draws again.
//
// Two callers share this one overlay:
//   local  (startLocalDraw)  both players are on this screen: each presses their own card, the tiles stay face down until BOTH have drawn,
//                            then they flip and the higher one starts. The two tiles go back into the bag, so the racks keep the same deal.
//   online (syncDraw)        the SERVER gives each player a tile and hides the opponent's until both have drawn (session.js/engine.js).
//                            The client only animates what the snapshot says; it never decides the winner.
//
// Presentation only: no rule, score or clock lives here. Animations are the flip of one card and a single glow on the winner; with
// reduced motion the values simply appear.
import { $, S, shuffle } from './state.js';
import { FACE, GLYPH } from './config.js';
import { nameOf, nameIso } from './names.js';
import { haptic } from './haptics.js';
import { notice, render } from './ui.js';
import { newGame } from './game.js';

const DRAW = 'scrabble.draw';   // device preference: the local draw is on unless switched off in Settings
let timer = 0, closeTimer = 0, local = null, online = null, announced = '', onDrawCb = null, ui = null, focusPending = false;

export const drawEnabled = () => { try { return localStorage.getItem(DRAW) !== 'off'; } catch { return true; } };
export function setDrawEnabled(on) { try { on ? localStorage.removeItem(DRAW) : localStorage.setItem(DRAW, 'off'); } catch { /* storage unavailable */ } }

const el = () => $('#drawOv');
export const isDrawOpen = () => { const e = el(); return !!e && !e.hidden; };

function clearTimer() { clearTimeout(timer); timer = 0; }
const later = (ms, fn) => { clearTimer(); timer = setTimeout(fn, ms); };

const value = t => (t && !t.blank ? t.v : 0);
const face = t => (t ? (t.blank ? '؟' : (FACE[t.l] || t.l)) : '');

// ---------- DOM ----------
function build(names) {
  const seats = $('#drawSeats');
  seats.innerHTML = [0, 1].map(i => `
    <div class="drawSeat" id="drawS${i}" data-seat="${i}">
      <span class="drawWho"><bdi>${names[i]}</bdi></span>
      <div class="drawTile" id="drawT${i}" data-state="down" role="img" aria-label="قطعة لم تُكشف بعد">
        <div class="drawInner">
          <div class="drawFace drawBack" aria-hidden="true"><span>?</span></div>
          <div class="drawFace drawFront" aria-hidden="true"><b></b><i></i></div>
        </div>
      </div>
      <p class="drawNote" id="drawN${i}"></p>
      <button type="button" class="btn drawBtn" id="drawB${i}" data-seat="${i}">اسحب قطعة</button>
    </div>`).join('');
  seats.querySelectorAll('.drawBtn').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.seat;
    if (local) return drawLocal(i);
    if (online && i === online.seat && onDrawCb && !online.mine && !online.done) onDrawCb();
  }));
  ui = { seats: [$('#drawS0'), $('#drawS1')], tiles: [$('#drawT0'), $('#drawT1')], notes: [$('#drawN0'), $('#drawN1')], btns: [$('#drawB0'), $('#drawB1')] };
}

function open(info) {
  const ov = el(); if (!ov) return;
  build(info.names);
  ov.hidden = false;
  focusPending = true;   // the caller renders the cards next; the first draw button then takes focus once
  document.body.classList.add('drawOn');
  document.querySelector('.app').inert = true;
  $('#drawM').textContent = info.msg || 'كل لاعب يسحب قطعة. الأعلى نقاطًا يبدأ المباراة.';
  $('#drawHint').textContent = info.hint || '';
  const r = $('#drawResult'); r.textContent = ''; r.className = 'drawResult';
}

function close() {
  clearTimer(); clearTimeout(closeTimer); closeTimer = 0;
  local = null; online = null; onDrawCb = null; focusPending = false;
  const ov = el(); if (!ov || ov.hidden) return;
  ov.hidden = true; document.body.classList.remove('drawOn');
  const app = document.querySelector('.app'); if (app) app.inert = false;
}

function setCard(i, { up, tile, mark, note, canDraw, win, lose }) {
  const card = ui?.tiles[i], btn = ui?.btns[i], seat = ui?.seats[i], noteEl = ui?.notes[i];
  if (!card) return;
  if (tile && up) {
    const front = card.querySelector('.drawFront');
    const b = front.querySelector('b'), iEl = front.querySelector('i');
    const f = face(tile);
    b.textContent = f;
    b.style.transform = GLYPH[tile.l] ? `translate(${GLYPH[tile.l][0]}em,${GLYPH[tile.l][1]}em)` : '';
    iEl.textContent = String(value(tile));
    card.setAttribute('aria-label', `${f} قيمة ${value(tile)}`);
  }
  card.dataset.state = up ? 'up' : 'down';
  card.classList.toggle('mark', !!mark);
  seat.classList.toggle('win', !!win);
  seat.classList.toggle('lose', !!lose);
  noteEl.textContent = note || '';
  btn.hidden = !canDraw;
  btn.disabled = !canDraw;
}

function result(text, cls = '') {
  const r = $('#drawResult'); if (!r) return;
  r.textContent = text; r.className = 'drawResult ' + cls;
}

// ---------- Local play ----------
export function startLocalDraw(minutes, mode) {
  if (!drawEnabled()) { newGame(minutes, mode); return; }
  newGame(minutes, mode);           // racks are dealt now (the deal order is unchanged); the two draw tiles go back before play
  S.paused = true;
  local = { tiles: [null, null], tries: 0, busy: false };
  open({
    names: [nameOf(0), nameOf(1)],
    msg: 'كل لاعب يسحب قطعة. تبقى القطعتان مقلوبتين حتى يسحب اللاعبان، ثم تُكشفان معًا: الأعلى نقاطًا يبدأ.',
    hint: 'القطعتان تعودان إلى الكيس قبل بدء اللعب.'
  });
  for (const i of [0, 1]) setCard(i, { up: false, note: 'لم يسحب بعد', canDraw: true });
  focusPending = false;   // the local focus below is explicit (seat 0 draws first)
  later(80, () => ui?.btns[0]?.focus?.({ preventScroll: true }));
}

function returnTiles(tiles) {
  S.bag.push(...tiles);
  shuffle(S.bag);   // the two drawn tiles are back in the bag; the rack deal is untouched
}

function drawLocal(seat) {
  if (!local || local.busy || local.tiles[seat]) return;
  const t = S.bag.pop(); if (!t) return;
  local.tiles[seat] = t;
  haptic('tick');
  setCard(seat, { up: false, mark: true, note: 'تم السحب — بانتظار الخصم', canDraw: false });
  const other = 1 - seat;
  if (!local.tiles[other]) setCard(other, { up: false, note: 'دورك: اسحب قطعتك', canDraw: true });
  if (!local.tiles[0] || !local.tiles[1]) return;
  local.busy = true;
  later(420, revealLocal);
}

function revealLocal() {
  const [a, b] = local.tiles, va = value(a), vb = value(b);
  for (const i of [0, 1]) setCard(i, { up: true, tile: local.tiles[i], mark: false, note: '', canDraw: false });
  later(560, () => {
    if (va === vb) {
      for (const i of [0, 1]) setCard(i, { up: true, tile: local.tiles[i], note: 'تعادل', canDraw: false, lose: true });
      result(`تعادل ${va} – ${vb}: يُعاد السحب`, 'tie');
      haptic('bad');
      later(1700, () => {
        returnTiles(local.tiles); local.tiles = [null, null]; local.tries++; local.busy = false;
        for (const i of [0, 1]) setCard(i, { up: false, note: 'أعد السحب', canDraw: true, lose: false });
        result('اسحبا مرة أخرى — التعادل لا يحدد البداية', 'redo');
      });
      return;
    }
    const win = va > vb ? 0 : 1, lose = 1 - win;
    setCard(win, { up: true, tile: local.tiles[win], note: 'يبدأ المباراة', canDraw: false, win: true });
    setCard(lose, { up: true, tile: local.tiles[lose], note: 'يلعب ثانيًا', canDraw: false, lose: true });
    result(`${nameIso(win)} يبدأ المباراة (${Math.max(va, vb)} – ${Math.min(va, vb)})`, 'win');
    haptic('bingo');
    later(2300, () => finishLocal(win));
  });
}

function finishLocal(win) {
  returnTiles(local.tiles);
  S.draw = { tries: local.tries, first: win };
  S.cur = win; S.started = false; S.paused = false; S.last = performance.now();
  render();   // the board and panels show the winner's turn BEFORE the overlay goes away (no one-frame race for a tap)
  close();
  notice(`${nameIso(win)} يبدأ المباراة`);
}

// ---------- Online ----------
// snap.game.draw = { mine, theirs, done, first, tries } (see supabase/functions/_shared/core/snapshot.js). Called on every snapshot.
export function syncDraw(snap, drawTile) {
  const g = snap?.game, d = g?.draw;
  const key = g ? g.id + ':' + g.round : '';
  if (!d) { if (!g || g.status !== 'drawing') close(); return; }
  if (d.done && announced === key) { if (isDrawOpen()) { clearTimeout(closeTimer); closeTimer = setTimeout(close, 1200); } return; }
  if (drawTile) onDrawCb = drawTile;
  online = { seat: snap.me.seat, mine: d.mine, theirs: d.theirs, done: !!d.done, first: d.first, tries: d.tries || 0 };
  if (!isDrawOpen()) {
    open({
      names: [nameOf(0), nameOf(1)],
      msg: 'كل لاعب يسحب قطعة. يظهر لك سحبك فورًا، ويُكشف سحب الخصم عندما يسحب. الأعلى نقاطًا يبدأ.',
      hint: 'القطعتان تعودان إلى الكيس قبل توزيع الرفوف.'
    });
  }
  renderOnline(online, key);
}

function renderOnline(st, key) {
  const me = st.seat, opp = 1 - me;
  const showOpp = !!st.theirs;   // the server never reveals it before both have drawn
  setCard(me, { up: !!st.mine, tile: st.mine, note: st.done ? '' : st.mine ? 'بانتظار الخصم…' : 'دورك: اسحب قطعتك', canDraw: !st.mine && !st.done });
  setCard(opp, { up: showOpp, tile: st.theirs, note: st.done ? '' : st.mine ? 'بانتظار أن يسحب الخصم…' : 'بانتظار الخصم…', canDraw: false });
  if (focusPending) {
    focusPending = false;
    const b = ui?.btns[st.seat];
    if (b && !b.hidden) { try { b.focus({ preventScroll: true }); } catch { /* focus refused */ } }
  }
  if (st.done) {
    const win = st.first, lose = 1 - win;
    setCard(win, { up: true, tile: win === me ? st.mine : st.theirs, note: 'يبدأ المباراة', canDraw: false, win: true });
    setCard(lose, { up: true, tile: lose === me ? st.mine : st.theirs, note: 'يلعب ثانيًا', canDraw: false, lose: true });
    result(`${nameIso(win)} يبدأ المباراة`, 'win');
    if (announced !== key) { announced = key; haptic('bingo'); closeTimer = setTimeout(close, 2400); }
    return;
  }
  if (!st.mine && !st.theirs && st.tries > 0) {   // a tie: the server reset both draws
    result(`تعادل — أعد السحب (محاولة ${st.tries + 1})`, 'redo');
    setCard(me, { up: false, note: 'أعد السحب', canDraw: true });
    setCard(opp, { up: false, note: 'بانتظار الخصم…', canDraw: false });
    return;
  }
  if (st.mine && !st.theirs) { result('بانتظار سحب الخصم…', 'wait'); return; }
  if (!st.mine) { result('دورك: اسحب قطعة لتحديد من يبدأ', 'wait'); return; }
  result('يُكشف السحب عندما يسحب الخصم', 'wait');
}

// Called when a new game starts anywhere: never leave the overlay behind.
export function resetDraw() { announced = ''; close(); }
