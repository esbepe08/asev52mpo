// js/names.js: cleaning, duplicates, defaults, escaping, storage. Pure module: no DOM, only localStorage (faked here).
const mem = new Map();
globalThis.localStorage = { getItem: k => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
const root = new URL('../../js/', import.meta.url);
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };
const N = await import(new URL('names.js', root)); const { NAMES } = await import(new URL('config.js', root));

ok(N.nameOf(0) === NAMES[0] && N.nameOf(1) === NAMES[1] && !N.isCustom(0), 'defaults');
ok(N.cleanName('  Ali   Baba ') === 'Ali Baba', 'whitespace collapsed');
ok(N.cleanName('a\u202Eb\u2066c\u200Bd\u0007e') === 'abcd e', 'direction overrides, zero-width and control characters removed');
ok(N.cleanName('x'.repeat(40)).length === 16, 'length capped at 16');
ok(N.cleanName('سَلْمَى'.repeat(6)) === 'سَلْمَى'.repeat(6).slice(0, [...N.cleanName('سَلْمَى'.repeat(6))].length) && !/^[\u064B-\u0652]/.test(N.cleanName('سَلْمَى'.repeat(6))), 'cap never leaves a mark without its letter');
ok(N.cleanName(null) === '' && N.cleanName(5) === '', 'non-strings are empty');
ok(N.esc('<a href="x">&\'') === '&lt;a href=&quot;x&quot;&gt;&amp;&#39;', 'escape');
let calls = 0; const off = N.onNamesChange(() => calls++);
let r = N.setName(0, 'Layla');
ok(r.changed && !r.dup && N.nameOf(0) === 'Layla' && calls === 1, 'rename notifies');
ok(N.setName(0, 'Layla').changed === false && calls === 1, 'same name: no change, no notification');
r = N.setName(1, ' LAYLA ');
ok(r.dup && !r.changed && N.nameOf(1) === NAMES[1], 'duplicate refused (case-insensitive)');
r = N.setName(1, NAMES[0]);
ok(!r.dup, 'the other player may take a default name nobody uses now');
N.setName(1, '');
ok(N.nameOf(1) === NAMES[1], 'empty = default');
ok(JSON.stringify(JSON.parse(mem.get('scrabble.names'))) === JSON.stringify({ v: 1, n: ['Layla', null] }), 'only overrides are stored');
ok(N.nameHtml(0) === '<bdi>Layla</bdi>' && N.nameIso(0) === '\u2068Layla\u2069' && N.nameIso(1) === NAMES[1], 'html isolated, plain text isolated only when custom');
N.setName(0, '<b>x</b>'); ok(N.nameHtml(0) === '<bdi>&lt;b&gt;x&lt;/b&gt;</bdi>', 'html-escaped on output');
N.setName(0, ''); ok(!mem.has('scrabble.names'), 'back to defaults removes the key');
off();
// loading
mem.set('scrabble.names', JSON.stringify({ v: 1, n: ['ليلى', 'نور'] })); N.loadNames();
ok(N.nameOf(0) === 'ليلى' && N.nameOf(1) === 'نور', 'load');
for (const bad of ['garbage', '{"v":2,"n":["a","b"]}', '{"v":1,"n":["a"]}', '{"v":1,"n":["x","X"]}', '{"v":1,"n":[1,{}]}']) {
  N.setName(0, ''); N.setName(1, ''); mem.set('scrabble.names', bad); N.loadNames();
  ok(N.nameOf(0) === NAMES[0] && N.nameOf(1) === NAMES[1], 'invalid stored value ignored: ' + bad);
}
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
