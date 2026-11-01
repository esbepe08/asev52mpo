// Writes the cache VERSION into sw.js: a hash of every file listed in PRECACHE (path + bytes) and of the PRECACHE list itself.
//   node tools/stamp-sw.mjs           stamp sw.js (run before every deploy)
//   node tools/stamp-sw.mjs --check   exit 1 if sw.js is stale or lists a file that does not exist (used by tests/pwa/static.mjs)
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), swPath = path.join(root, 'sw.js');
const src = fs.readFileSync(swPath, 'utf8');
const list = new Function('return ' + /const PRECACHE = (\[[\s\S]*?\]);/.exec(src)[1])();
const missing = list.filter(p => !fs.existsSync(path.join(root, p)));
if (missing.length) { console.error('PRECACHE lists missing files:', missing.join(', ')); process.exit(1); }
const h = crypto.createHash('sha256');
for (const p of [...list].sort()) { h.update(p + '\0'); h.update(fs.readFileSync(path.join(root, p))); h.update('\0'); }
const version = h.digest('hex').slice(0, 12);
const next = src.replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`);
if (process.argv.includes('--check')) {
  if (next !== src) { console.error(`sw.js is stale: run "node tools/stamp-sw.mjs" (expected VERSION ${version}).`); process.exit(1); }
  console.log(`sw.js VERSION ${version} is current (${list.length} precached files).`); process.exit(0);
}
fs.writeFileSync(swPath, next); console.log(`sw.js VERSION = ${version} (${list.length} precached files)`);
