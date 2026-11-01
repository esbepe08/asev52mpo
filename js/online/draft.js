// Live preview of the tiles the player on turn is trying ("draft"). PURE: no DOM, no state, so it is unit-tested in Node (tests/online/draft.mjs).
//
// A draft is only a hint broadcast on the private game channel; it can never change the game (the server decides everything from submit_move).
// The sender announces the tiles' squares and letters, bound to the revision they were made on. The receiver treats every draft as untrusted input:
// it must name exactly the revision the receiver has, stay within the board and the rack size, use squares that are still empty, and carry short letters only.
import { SIZE, RACK } from '../config.js';

// A blank tile whose letter is not chosen yet has nothing to show, so it is left out rather than invalidating the whole draft.
export const encodeDraft = (rev, move) => ({ rev, c: move.map(e => [e.r, e.c, e.t.blank ? (e.t.as || '') : e.t.l]).filter(x => x[2]) });

// -> [{r, c, l}] (possibly empty: "nothing tried right now"), or null when the payload must be ignored.
export function decodeDraft(p, { rev, board }) {
  if (!p || typeof p !== 'object' || !Number.isInteger(p.rev) || p.rev !== rev) return null;
  if (!Array.isArray(p.c) || p.c.length > RACK) return null;
  const out = [], seen = new Set();
  for (const x of p.c) {
    if (!Array.isArray(x) || x.length !== 3) return null;
    const [r, c, l] = x;
    if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= SIZE || c >= SIZE) return null;
    if (typeof l !== 'string' || l.length < 1 || l.length > 2) return null;
    if (board && board[r] && board[r][c]) return null;   // that square is already taken in the receiver's board: the draft is for another position
    const k = r * SIZE + c; if (seen.has(k)) return null; seen.add(k);
    out.push({ r, c, l });
  }
  return out;
}
