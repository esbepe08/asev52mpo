// Draws the opponent's tentative tiles as dashed "ghost" tiles. The only thing it writes is a data-ghost attribute on empty squares
// (the CSS in css/online.css draws it), so the board's own rendering and its cache are never touched.
import { SIZE, FACE } from '../config.js';

let painted = false;
export function paintGhosts(cells) {
  const kids = document.getElementById('board')?.children;
  if (!kids || (!painted && !(cells && cells.length))) return;
  const want = new Map((cells || []).map(g => [g.r * SIZE + g.c, FACE[g.l] || g.l]));
  for (let i = 0; i < kids.length; i++) {
    const el = kids[i], l = want.get(i);
    if (l === undefined) { if (el.dataset.ghost !== undefined) delete el.dataset.ghost; }
    else if (el.dataset.ghost !== l) el.dataset.ghost = l;
  }
  painted = want.size > 0;
}
