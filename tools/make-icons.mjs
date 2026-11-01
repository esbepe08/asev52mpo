// Dev-only: renders tools/icon-source.html to the PNG icons in assets/icons/ with a real browser (Playwright + Chromium).
//   node tools/make-icons.mjs        (needs `playwright` or `playwright-core` plus a Chromium; set CHROME_PATH to use your own)
// The generated PNGs are committed; the game itself needs none of this.
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { createRequire } from 'module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.join(root, 'assets/icons');
const require = createRequire(import.meta.url);
let pw; try { pw = require('playwright'); } catch { pw = require('playwright-core'); }
const TYPES = { '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}/tools/icon-source.html`;
const JOBS = [   // [file, px, shape]
  ['icon-192.png', 192, 'any'], ['icon-512.png', 512, 'any'], ['maskable-512.png', 512, 'full'],
  ['apple-touch-icon.png', 180, 'full'],   // iOS needs an opaque, full-bleed square and rounds it itself
  ['favicon-32.png', 32, 'any']
];
const browser = await pw.chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
for (const [file, px, shape] of JOBS) {
  const page = await browser.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 });
  await page.goto(`${base}?size=${px}&shape=${shape}`); await page.waitForSelector('body[data-ready="1"]');
  await page.screenshot({ path: path.join(out, file), omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } });
  await page.close(); console.log('wrote', file, px + 'px', shape);
}
await browser.close(); srv.close();
