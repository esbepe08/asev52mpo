/* Service worker for Arabic Scrabble: makes the game start and play offline after one successful online visit.
 *
 * Design (see README "PWA" for the long version)
 *   - No build step. PRECACHE below is the explicit, complete list of files the game needs. Every URL is resolved against the
 *     worker's own scope (self.registration.scope), so the same files work at a domain root and under a GitHub Pages
 *     sub-path such as https://user.github.io/repo/. Nothing here assumes "/".
 *   - install : download every PRECACHE file (bypassing the HTTP cache) into ONE versioned cache. If any file fails, the whole
 *               install fails and the previous worker/cache keeps serving: a half-downloaded version can never go live.
 *   - activate: delete every older cache of this app, then take control of open pages.
 *   - fetch   : app files are served from the versioned cache only (never mixed with another version). Navigations to the app
 *               get the cached index.html. Anything else on our origin is network-first with a runtime-cache fallback;
 *               other origins and non-GET requests are never touched.
 *   - update  : a new worker waits (no skipWaiting on its own); js/pwa.js shows an "update" bar and sends SKIP_WAITING when the
 *               player agrees, so a running match is never swapped out underneath them.
 *
 * VERSION is a content hash of every PRECACHE file, written by `node tools/stamp-sw.mjs` (run it before each deploy;
 * `node tools/stamp-sw.mjs --check` fails when it is out of date, and tests/pwa/static.mjs runs that check). Because sw.js
 * itself then changes whenever any cached file changes, browsers reliably detect the new version.
 */
'use strict';

const VERSION = '77502d0c3e83';   // stamped by tools/stamp-sw.mjs
const PREFIX = 'arabic-scrabble-';
const SHELL = `${PREFIX}shell-${VERSION}`;
const RUNTIME = `${PREFIX}runtime-${VERSION}`;

// Paths are relative to this file (= the scope). Keep in sync with the repo: tests/pwa/static.mjs fails if a file under css/, js/ or assets/ is missing here.
const PRECACHE = [
  "index.html",
  "manifest.webmanifest",
  "css/themes.css",
  "css/style.css",
  "css/float.css",
  "css/cover.css",
  "css/pwa.css",
  "css/online.css",
  "js/main.js",
  "js/config.js",
  "js/modes.js",
  "js/state.js",
  "js/game.js",
  "js/scoring.js",
  "js/rules.js",
  "js/judge.js",
  "js/wordrules.js",
  "js/ui.js",
  "js/input.js",
  "js/pause.js",
  "js/draw.js",
  "js/themes.js",
  "js/touchdrag.js",
  "js/layout.js",
  "js/float.js",
  "js/float-core.js",
  "js/float-geom.js",
  "js/float-fit.js",
  "js/float-tools.js",
  "js/float-layout.js",
  "js/float-input.js",
  "js/float-popups.js",
  "js/fullscreen.js",
  "js/names.js",
  "js/nameedit.js",
  "js/flash.js",
  "js/haptics.js",
  "js/histview.js",
  "js/cover.js",
  "js/persist.js",
  "js/pwa.js",
  "js/online/env.js",
  "js/online/supabase-backend.js",
  "js/online/session.js",
  "js/online/draft.js",
  "js/online/ghost.js",
  "js/online/lobby.js",
  "assets/fonts/Amiri-Regular.woff2",
  "assets/fonts/Amiri-Bold.woff2",
  "assets/fonts/Tinos-Regular.woff2",
  "assets/fonts/Tinos-Bold.woff2",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/maskable-512.png",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/favicon-32.png"
];

const SCOPE = new URL(self.registration.scope);
const abs = p => new URL(p, SCOPE).href;
const SHELL_URLS = new Set(PRECACHE.map(abs));
const INDEX = abs('index.html');
const isAppPage = url => url.origin === SCOPE.origin && (url.pathname === SCOPE.pathname || url.pathname === SCOPE.pathname + 'index.html');

// A response that may be stored: a complete, successful, same-origin answer.
const storable = res => res && res.status === 200 && res.type === 'basic' && !/no-store/i.test(res.headers.get('Cache-Control') || '');
// A redirected response cannot be used to answer a navigation, so store a clean copy of it.
const clean = async res => (res.redirected ? new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers }) : res);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    try {
      await Promise.all(PRECACHE.map(async p => {
        const url = abs(p);
        const res = await fetch(new Request(url, { cache: 'reload' }));   // never fill the cache from a stale HTTP-cache copy
        if (!res.ok) throw new Error(`precache ${res.status}: ${url}`);
        await cache.put(url, await clean(res));
      }));
    } catch (err) {
      await caches.delete(SHELL);   // all or nothing
      throw err;
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== SHELL && name !== RUNTIME) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => { if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;   // other origins / other apps on this host: untouched
  event.respondWith(respond(req, url));
});

async function respond(req, url) {
  // 1. The app itself: one consistent, precached version.
  const shellKey = req.mode === 'navigate' && isAppPage(url) ? INDEX : (SHELL_URLS.has(url.origin + url.pathname) ? url.origin + url.pathname : null);
  if (shellKey) {
    const hit = await caches.match(shellKey, { cacheName: SHELL });
    if (hit) return hit;
    try { return await fetch(req); } catch { return offline(req); }   // cache missing (e.g. cleared by the browser): fall through to the network
  }
  // 2. Anything else on our origin: network first, runtime cache as the offline fallback.
  try {
    const res = await fetch(req);
    if (storable(res)) { const c = await caches.open(RUNTIME); c.put(req, res.clone()).catch(() => {}); }
    return res;
  } catch {
    const hit = await caches.match(req, { cacheName: RUNTIME });
    return hit || offline(req);
  }
}

// Last resort: a navigation falls back to the game, everything else gets a plain 503 (never a fake success).
async function offline(req) {
  if (req.mode === 'navigate') { const hit = await caches.match(INDEX, { cacheName: SHELL }); if (hit) return hit; }
  return new Response('Offline', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
