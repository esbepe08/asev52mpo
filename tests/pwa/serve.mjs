// Static server for the PWA tests. Differences from layout/serve.mjs: serves under an optional sub-path prefix (like
// https://user.github.io/repo/), sends GitHub-Pages-like caching headers, redirects /repo to /repo/, knows the PWA MIME
// types, and its root can be swapped at runtime to simulate a new deployment.
import http from 'http'; import fs from 'fs'; import path from 'path';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml' };
export function serve(root, prefix = '/') {
  const state = { root, deny: new Set(), hits: new Map() };
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (prefix !== '/' && u === prefix.slice(0, -1)) { res.writeHead(301, { Location: prefix }); return res.end(); }
    if (!u.startsWith(prefix)) { res.writeHead(404); return res.end('not found'); }
    const rel = u.slice(prefix.length) || 'index.html';
    state.hits.set(rel, (state.hits.get(rel) || 0) + 1);
    const f = path.join(state.root, rel);
    if (state.deny.has(rel) || !f.startsWith(state.root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => {
    const port = srv.address().port;
    // down()/up() = a real network outage: the port refuses connections (Playwright's setOffline does not reach service-worker fetches).
    const down = () => new Promise(res => { srv.closeAllConnections(); srv.close(() => res()); });
    const up = () => new Promise(res => srv.listen(port, '127.0.0.1', res));
    r({ srv, state, down, up, origin: `http://127.0.0.1:${port}`, base: `http://127.0.0.1:${port}${prefix}` });
  }));
}
