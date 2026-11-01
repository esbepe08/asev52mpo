// Word flash: when a move is scored, every word it formed (the new word and each word it crossed) lights up letter by letter in reading order,
// so both players see exactly what was counted. Pure presentation: it only toggles a class and a delay on existing board squares.
// There is no overlay to position: the board is a grid of 225 squares in document order, so a square is board.children[r * SIZE + c], and the
// highlight scales, moves and rotates with the board for free (Floating Workspace included).
// Reading order comes straight from the data: words are lists of squares with growing column (horizontal: the board is RTL, so that is right to left) or growing row
// (vertical: top to bottom). The animation itself is transform-free: one opacity pulse on the square's ::after (css/style.css, .wf).
import { SIZE } from './config.js';

const STEP = 0.085, WORD_GAP = 0.2, DURATION = 0.8, HOLD_REDUCED = 1.4;   // seconds
let active = [], timer = 0;

export function clearFlash() {
  clearTimeout(timer); timer = 0;
  for (const el of active) { el.classList.remove('wf'); el.style.removeProperty('--wd'); }
  active = [];
}

// words: [[{r, c, …}, …], …] exactly as scoring.js analyze() returns them.
export function flashWords(words) {
  clearFlash();
  const board = document.getElementById('board');
  if (!board || !Array.isArray(words)) return;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;   // no sequence under reduced motion: one static highlight, held briefly
  const at = new Map();   // square -> delay; a square shared by two words (a crossing) lights up with whichever word reaches it first
  words.forEach((w, wi) => w.forEach(({ r, c }, i) => {
    const el = board.children[r * SIZE + c];
    if (!el) return;
    const d = reduced ? 0 : wi * WORD_GAP + i * STEP;
    at.set(el, Math.min(d, at.get(el) ?? Infinity));
  }));
  let end = 0;
  for (const [el, d] of at) { el.style.setProperty('--wd', d.toFixed(3) + 's'); el.classList.add('wf'); active.push(el); end = Math.max(end, d); }
  if (active.length) timer = setTimeout(clearFlash, ((reduced ? HOLD_REDUCED : end + DURATION) + 0.15) * 1000);
}
