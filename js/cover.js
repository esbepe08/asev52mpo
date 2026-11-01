// Cover screen: the title is spelled out in game tiles (standard Scrabble letter values), then Play starts the setup flow.
const TITLE = ['ARABIC', 'SCRABBLE'];
const VALUE = {A: 1, R: 1, B: 3, I: 1, C: 3, S: 1, L: 1, E: 1};

function buildTitle(el) {
  let i = 0;
  el.innerHTML = TITLE.map(w => `<span class="cw" aria-hidden="true">${[...w].map(ch =>
    `<span class="cl" data-v="${VALUE[ch] ?? 1}" style="--i:${i++}">${ch}</span>`).join('')}</span>`).join('');
}

// The cover is dismissed by the match itself when an online game opens (js/online/session.js).
export function hideCover() {
  const cover = document.getElementById('cover');
  if (cover.hidden || cover.classList.contains('out')) return;   // already gone: do not touch the DOM again
  cover.classList.add('out'); document.querySelector('.app').inert = false; document.body.classList.remove('coverOn');
  setTimeout(() => { cover.hidden = true; }, 420);
}

// onOnline is optional: the online code is only downloaded when the player asks for it, so local play never loads it.
export function showCover(onPlay, onOnline) {
  const cover = document.getElementById('cover'), app = document.querySelector('.app'), play = document.getElementById('coverPlay'), online = document.getElementById('coverOnline');
  if (online) online.hidden = !onOnline;
  buildTitle(document.getElementById('coverTitle'));
  document.body.classList.add('coverOn'); app.inert = true; cover.hidden = false;

  play.addEventListener('click', () => {
    play.disabled = true; if (online) online.disabled = true; cover.classList.add('out'); app.inert = false; document.body.classList.remove('coverOn');
    onPlay();
    setTimeout(() => { cover.hidden = true; }, 420);
  }, {once: true});
  if (online && onOnline) online.addEventListener('click', onOnline);
  play.focus({preventScroll: true});
}
