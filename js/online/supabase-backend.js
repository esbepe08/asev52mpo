// The ONLY file that talks to Supabase from the browser. supabase-js is loaded on demand (never for local play), pinned to an exact version.
// Backend contract used by session.js (tests substitute their own through window.EAS_BACKEND_FACTORY):
//   init()                    -> userId         (anonymous sign-in; the session is persisted by supabase-js, so a refresh keeps the identity)
//   call(body)                -> response json  (the eas-game Edge Function)
//   subscribe(gameId, h)      -> { close(), sendDraft(payload) }   h = { onEvent(payload), onDraft(payload), onStatus('SUBSCRIBED'|'ERROR'|'CLOSED'), onPresence(state) }
//                                onPresence gets supabase's presenceState(): { [userId]: [{ seat, draft, ... }, ...] }. The draft travels in the
//                                presence payload as well as in a broadcast, so a live preview keeps working even where the (newer) broadcast
//                                policy has not been applied yet: presence is the state, broadcast is the fast notification.
//   track(info)               -> announce (or update) presence on the current channel
// Every failure that leaves this file carries `info = { code, text, detail }`: `text` is a plain Arabic sentence that says WHAT to fix (see explain()), `detail` is
// the technical line to show underneath it (and to paste into a bug report).
import { ONLINE_ENV } from './env.js';

export const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
export const isConfigured = () => !!(window.EAS_BACKEND_FACTORY || (ONLINE_ENV.url && ONLINE_ENV.anonKey));

// Turns a low-level failure into the sentence a person can act on. `where`: 'lib' (loading supabase-js), 'auth' (anonymous sign-in), 'fn' (the Edge Function).
export function explain(e, where = '') {
  const raw = String(e?.message || e || ''), code = String(e?.code || e?.error_code || ''), status = e?.status ?? e?.context?.status ?? null, name = String(e?.name || '');
  const detail = [where, name, code, status, raw].filter(x => x !== '' && x !== null).join(' · ').slice(0, 180);
  const out = (c, text, retry = false) => ({ code: c, text, detail, retry });
  const all = `${name} ${code} ${raw}`;
  if (where === 'lib' || /dynamically imported module|importing a module script|Failed to resolve module/i.test(raw))
    return out('lib', 'تعذّر تحميل مكتبة Supabase. تحقق من الإنترنت ثم أعد المحاولة.', true);
  if (/anonymous.*(disabled|not enabled)|anonymous_provider_disabled/i.test(all))
    return out('anonymous_disabled', 'تسجيل الدخول المجهول مغلق في Supabase. فعّل «Allow anonymous sign-ins» من: Authentication ← Sign In / Providers.');
  if (/invalid api key|invalid jwt|bad_jwt|no api key|apikey/i.test(all) || (where === 'auth' && (status === 401 || status === 403)))
    return out('bad_key', 'مفتاح Supabase العام (SUPABASE_ANON_KEY) غير صحيح. انسخه من Project Settings ← API ثم أعد النشر.');
  if (/FunctionsHttpError/.test(name) && (status === 404 || /not found/i.test(raw)))
    return out('fn_missing', 'الدالة eas-game غير منشورة في مشروع Supabase. انشرها بالأمر: supabase functions deploy eas-game', false);
  if (/FunctionsHttpError/.test(name) && status === 401)
    return out('fn_auth', 'رفضت الدالة جلستك. أعد تحميل الصفحة، فإن تكرر فتحقق من إعداد تسجيل الدخول المجهول والمفتاح العام.');
  if (/FunctionsHttpError/.test(name))
    return out('fn_error', 'حدث خطأ داخل الدالة eas-game. راجع Supabase ← Edge Functions ← Logs.', true);
  if (/Failed to fetch|NetworkError|Load failed|FunctionsFetchError|FunctionsRelayError|AuthRetryableFetchError|status.?0/i.test(all) || status === 0)
    return out('network', where === 'fn'
      ? 'تعذّر الوصول إلى الدالة eas-game. تحقق من الإنترنت، ومن أن الدالة منشورة، ومن قيمة ALLOWED_ORIGIN إن كنت قد ضبطتها.'
      : 'تعذّر الوصول إلى Supabase. تحقق من الإنترنت، ومن رابط المشروع (SUPABASE_URL)، ومن أن المشروع غير متوقف.', true);
  return out('unknown', 'تعذّر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.', true);
}
const tag = (e, where) => Object.assign(e instanceof Error ? e : new Error(String(e)), { info: explain(e, where) });

export async function createBackend() {
  if (window.EAS_BACKEND_FACTORY) return window.EAS_BACKEND_FACTORY();
  let createClient;
  try { ({ createClient } = await import(SUPABASE_JS)); } catch (e) { throw tag(e, 'lib'); }
  const sb = createClient(ONLINE_ENV.url, ONLINE_ENV.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'eas.online.auth' } });
  let userId = null, channel = null, info = null;
  return {
    async init() {
      try {
        let { data: { session } } = await sb.auth.getSession();
        if (!session) { const r = await sb.auth.signInAnonymously(); if (r.error) throw r.error; session = r.data.session; }
        userId = session.user.id; return userId;
      } catch (e) { throw tag(e, 'auth'); }
    },
    async call(body) {
      const { data, error } = await sb.functions.invoke('eas-game', { body });
      if (error) { const x = explain(error, 'fn'); throw Object.assign(new Error(x.code), { network: true, final: !x.retry, info: x }); }
      return data;
    },
    async subscribe(gameId, h) {
      await sb.realtime.setAuth();
      const ch = sb.channel('game:' + gameId, { config: { private: true, presence: { key: userId }, broadcast: { self: false } } });
      ch.on('broadcast', { event: 'draft' }, m => h.onDraft?.(m.payload || {}))
        .on('broadcast', { event: '*' }, m => { if (m.event !== 'draft') h.onEvent?.(m.payload || {}); })
        .on('presence', { event: 'sync' }, () => h.onPresence?.(ch.presenceState()))
        .subscribe(status => {
          if (status === 'SUBSCRIBED') { h.onStatus?.('SUBSCRIBED'); if (info) ch.track(info); }
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') h.onStatus?.('ERROR');
          else if (status === 'CLOSED') h.onStatus?.('CLOSED');
        });
      channel = ch;
      return {
        close: () => { try { sb.removeChannel(ch); } catch { /* already gone */ } if (channel === ch) channel = null; },
        sendDraft: payload => { try { ch.send({ type: 'broadcast', event: 'draft', payload }); } catch { /* a draft is only a hint */ } }
      };
    },
    track(i) { info = i; if (channel) channel.track(i); }
  };
}
