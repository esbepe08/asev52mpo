// Move validation (geometry/connectivity), word detection and score calculation for the LOCAL game.
// The rules themselves live in rules.js, which the online server also runs, so local and online play can never disagree
// about what a move is worth or how a game is settled. This file only binds them to the local game state.
import { S } from './state.js';
import { analyzeMove } from './rules.js';

export { wordStr, scoreWords, bonusMinutes, finalScore } from './rules.js';

// Validates the pending move. Returns {err} or {words, isNew}.
export const analyze = () => analyzeMove(S.board, S.move);
