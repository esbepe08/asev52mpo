// PWA glue: service-worker registration + update prompt, install UI (Android/desktop prompt, iOS guide), offline-readiness status,
// and keeping <meta name="theme-color"> in step with the selected theme. Nothing here touches game state; if anything is missing
// (no service-worker support, insecure context, storage blocked) the game simply runs as a normal web page.
//
// Honesty rules: "offline ready" is only claimed once the worker has finished installing (its install step downloads every
// file or fails), "installed" is only claimed when the page runs in an installed display mode, and an install button is only
// shown when it can really do something (a captured browser prompt, or the iOS guide on iOS).
const $ = s => document.querySelector(s);
const DISMISS_KEY = 'scrabble.pwa.dismissed', DISMISS_DAYS = 30;
const UPDATE_CHECK_MS = 15 * 60 * 1000;

let deferred = null;       // the browser's BeforeInstallPromptEvent, once captured
let offlineState = 'pending';   // pending | ready | unsupported | failed
let installedNow = false;  // set by the appinstalled event (Chromium) so the UI updates without a reload

// ---------- Capability detection (no user-agent sniffing) ----------
const mq = q => window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} };
const standalone = () => ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some(m => mq(`(display-mode: ${m})`).matches) || navigator.standalone === true;
// iOS/iPadOS WebKit exposes navigator.standalone (false in a tab, true from the Home Screen); no other engine defines it, and iPadOS 13+ cannot be told apart by UA.
const iosGuide = () => 'standalone' in navigator && navigator.standalone === false && !deferred;
const store = {
  get() { try { return localStorage.getItem(DISMISS_KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(DISMISS_KEY, v); } catch { /* storage unavailable */ } }
};
const bannerSuppressed = () => { const t = +store.get(); return Number.isFinite(t) && t > 0 && Date.now() - t < DISMISS_DAYS * 864e5; };

// ---------- Install UI ----------
function refresh() {
  const bar = $('#pwaBar'), go = $('#pwaBarGo'), btn = $('#pwaInstall'), st = $('#pwaStatus'), hint = $('#pwaHint');
  if (!bar || !btn) return;
  const installed = installedNow || standalone();
  const mode = installed ? 'none' : deferred ? 'prompt' : iosGuide() ? 'ios' : 'none';
  const label = mode === 'ios' ? 'طريقة التثبيت' : 'تثبيت التطبيق';
  btn.hidden = mode === 'none'; btn.textContent = label;
  go.textContent = mode === 'ios' ? 'طريقة التثبيت' : 'تثبيت';
  $('#pwaBarText').textContent = mode === 'ios' ? 'أضف اللعبة إلى الشاشة الرئيسية لتفتحها كأي تطبيق.' : 'ثبّت اللعبة على جهازك لتفتحها كأي تطبيق.';
  bar.hidden = mode === 'none' || bannerSuppressed() || !!$('#cover')?.hidden;
  hint.hidden = !(mode === 'none' && !installed);
  hint.textContent = 'إن كان متصفحك يدعم التثبيت فستجد خيار «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية» في قائمته.';
  st.textContent = [installed ? 'اللعبة تعمل الآن كتطبيق مثبّت.' : '',
    { pending: 'جارٍ تجهيز اللعبة للعمل دون إنترنت…', ready: 'جاهزة للعمل دون إنترنت على هذا الجهاز.',
      unsupported: 'العمل دون إنترنت غير متاح في هذا المتصفح.', failed: 'تعذّر تجهيز العمل دون إنترنت؛ تعمل اللعبة بالإنترنت فقط.' }[offlineState]].filter(Boolean).join(' ');
}

async function install() {
  if (deferred) {
    const ev = deferred; deferred = null;   // a captured prompt can be used once
    refresh();
    try { await ev.prompt(); await ev.userChoice; } catch { /* prompt refused or already used */ }
  } else if (iosGuide()) {
    $('#pd').showModal();
  }
  refresh();
}

function initInstall() {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; refresh(); });
  window.addEventListener('appinstalled', () => { deferred = null; installedNow = true; refresh(); });
  $('#pwaBarGo').addEventListener('click', install);
  $('#pwaInstall').addEventListener('click', install);
  $('#pwaBarX').addEventListener('click', () => { store.set(String(Date.now())); $('#pwaBar').hidden = true; });
  // the banner lives on the cover; once the cover is gone there is nothing to hide, so only the Settings entry remains
  new MutationObserver(refresh).observe($('#cover'), { attributes: true, attributeFilter: ['hidden'] });
  mq('(display-mode: standalone)').addEventListener?.('change', refresh);
  refresh();
}

// ---------- Service worker + updates ----------
function initWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) { offlineState = 'unsupported'; refresh(); return; }
  let applying = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (applying) location.reload(); });
  const offer = w => {
    const bar = $('#pwaUpdate'); if (!bar || !w) return;
    bar.hidden = false;
    $('#pwaUpdateGo').onclick = () => { applying = true; w.postMessage({ type: 'SKIP_WAITING' }); $('#pwaUpdateGo').disabled = true; };
    $('#pwaUpdateLater').onclick = () => { bar.hidden = true; };
  };
  const register = async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' });   // relative to the page: works at any base path
      // A worker that finished installing has downloaded every precached file: that is the only moment offline use is promised.
      navigator.serviceWorker.ready.then(() => { offlineState = 'ready'; refresh(); });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);   // not on the very first install
          if (w.state === 'redundant' && offlineState === 'pending') { offlineState = 'failed'; refresh(); }
        });
      });
      let last = Date.now();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - last > UPDATE_CHECK_MS) { last = Date.now(); reg.update().catch(() => {}); }
      });
    } catch (err) {
      console.warn('Service worker registration failed; the game keeps working online.', err);
      offlineState = 'failed'; refresh();
    }
  };
  document.readyState === 'complete' ? register() : window.addEventListener('load', register, { once: true });   // never compete with the game for start-up bandwidth
}

// ---------- Browser chrome colour follows the theme ----------
function initThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]'); if (!meta) return;
  const sync = () => { const c = getComputedStyle(document.documentElement).getPropertyValue('--cover-2').trim(); if (c) meta.content = c; };
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  sync();
}

export function initPwa() {
  try { initInstall(); initWorker(); initThemeColor(); }
  catch (err) { console.warn('PWA features unavailable', err); }   // never let PWA glue break the game
}
