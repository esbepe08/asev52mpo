// Test server for the browser end-to-end run: serves the site AND stands in for Supabase.
// The REAL server core (supabase/functions/_shared/core) runs here on the in-memory store, so two real browsers play each other
// through exactly the code that runs in the Edge Function. /__api = the eas-game function, /__events = the realtime channel (polled).
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { MemoryStore } from '../online/memory-store.mjs';
import { handleRequest } from '../../supabase/functions/_shared/core/service.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const store = new MemoryStore(), seen = new Map(), drafts = [];   // drafts: the stand-in for broadcast events (never stored by the real server)   // seen: "game|user" -> last poll time (presence)
const deps = { now: () => Date.now(), rng: Math.random, uuid: () => crypto.randomUUID(), log: () => {} };
const body = req => new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => r(b)); });
// A deterministic first-turn draw for the browser run: the FIRST player to draw gets the highest tile and starts, so the scripted match
// always has A on turn. (The real server draws from the shuffled bag; only the test server arranges the top of it.)
function arrangeDraw(gameId, value = 10) {
  const bag = store.peek(gameId)?.priv?.bag; if (!Array.isArray(bag)) return;
  const i = bag.findIndex(t => t && (t.blank ? 0 : t.v) === value);
  const [t] = bag.splice(i < 0 ? 0 : i, 1); bag.push(t);
}
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__api' && req.method === 'POST') {
    const { user, body: b } = JSON.parse(await body(req));
    const out = await handleRequest(store, user, b, deps);
    if (out?.ok && out.snapshot) {
      const g = out.snapshot.game;
      if ((b.action === 'start_game' || b.action === 'rematch') && g.status === 'drawing') arrangeDraw(g.id, 10);
      else if (b.action === 'draw_first_tile' && g.status === 'drawing') arrangeDraw(g.id, 1);   // one has drawn: the next is the low tile
    }
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(out));
  }
  if (u.pathname === '/__draft' && req.method === 'POST') { const d = JSON.parse(await body(req)); drafts.push(d); res.writeHead(204); return res.end(); }
  if (u.pathname === '/__events') {
    const game = u.searchParams.get('game'), user = u.searchParams.get('user'), since = +u.searchParams.get('since') || 0;
    seen.set(game + '|' + user, Date.now());
    const events = store.events.map((e, i) => ({ ...e, i })).filter(e => e.game_id === game && e.i >= since);
    const presence = [...seen].filter(([k, t]) => k.startsWith(game + '|') && Date.now() - t < 2500).map(([k]) => k.split('|')[1]);
    const ds = +u.searchParams.get('ds') || 0, dr = drafts.map((d, i) => ({ ...d, i })).filter(d => d.game === game && d.user !== user && d.i >= ds);
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ events, next: store.events.length, presence, drafts: dr.map(d => d.payload), dnext: drafts.length }));
  }
  let p = path.join(root, decodeURIComponent(u.pathname)); if (u.pathname.endsWith('/')) p = path.join(p, 'index.html');
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(p).pipe(res);
});
srv.listen(+process.env.PORT || 8765, () => console.log('ready'));
