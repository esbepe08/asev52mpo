import { suite } from './lib.mjs';
import { encodeDraft, decodeDraft } from '../../js/online/draft.js';
const { ok, group, done } = suite('live preview payloads (untrusted input)');
const empty = Array.from({ length: 15 }, () => Array(15).fill(null)), t = (l, blank = false) => ({ t: { l, blank, as: blank ? l : null } });
group('round trip');
{
  const p = encodeDraft(7, [{ r: 7, c: 7, ...t('م') }, { r: 7, c: 8, ...t('ب', true) }, { r: 7, c: 9, t: { l: '', blank: true, as: null } }]);
  ok(p.rev === 7 && p.c.length === 2, 'encoded (a blank without a chosen letter is left out)');
  const d = decodeDraft(JSON.parse(JSON.stringify(p)), { rev: 7, board: empty });
  ok(d && d.length === 2 && d[0].l === 'م', 'decoded after a JSON round trip');
  ok(JSON.stringify(decodeDraft({ rev: 7, c: [] }, { rev: 7, board: empty })) === '[]', 'an empty draft is valid: it clears the ghosts');
}
group('everything else is ignored');
const bad = [null, 'x', 5, {}, { rev: 6, c: [] }, { rev: '7', c: [] }, { rev: 7 }, { rev: 7, c: 'x' }, { rev: 7, c: Array(8).fill([0, 0, 'م']) },
  { rev: 7, c: [[0, 0]] }, { rev: 7, c: [[0, 0, 'م', 1]] }, { rev: 7, c: [[-1, 0, 'م']] }, { rev: 7, c: [[0, 15, 'م']] }, { rev: 7, c: [[1.5, 0, 'م']] },
  { rev: 7, c: [['0', 0, 'م']] }, { rev: 7, c: [[0, 0, 5]] }, { rev: 7, c: [[0, 0, '']] }, { rev: 7, c: [[0, 0, 'ممم']] }, { rev: 7, c: [[0, 0, 'م'], [0, 0, 'ب']] }, { rev: 7, c: [{ r: 0 }] }];
bad.forEach((p, i) => ok(decodeDraft(p, { rev: 7, board: empty }) === null, 'rejected #' + i + ': ' + JSON.stringify(p)));
const taken = empty.map(r => [...r]); taken[7][7] = { id: 'x' };
ok(decodeDraft({ rev: 7, c: [[7, 7, 'م']] }, { rev: 7, board: taken }) === null, 'a square that is already taken is rejected (the draft is for another position)');
ok(decodeDraft({ rev: 8, c: [[7, 7, 'م']] }, { rev: 7, board: empty }) === null, 'a draft for another revision is rejected');
ok(decodeDraft({ rev: 7, c: [[7, 7, '<img src=x onerror=1>']] }, { rev: 7, board: empty }) === null, 'long / markup-like letters are rejected');
done();
