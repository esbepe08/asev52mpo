// Online lobby: a full-screen flow instead of a modal dialog.
//   1. start   nickname, then "create a room" or "join with a code" (a ?room=CODE link opens here with the code filled in)
//   2. room    the waiting room: the code (copy / share a link), both seats with live ready/connection state, the host's rules, ready / start
// The lobby only renders snapshots and sends requests; the server owns every rule (who is host, who is ready, whether the game may start).
import { DURATIONS } from '../config.js';
import { TILE_MODES } from '../modes.js';
import { $ } from '../state.js';
import { esc } from '../names.js';
import { net, connect, enter, configured, resumeOpenGame } from './session.js';
import { rulesDetails } from '../wordrules.js';

const NICK = 'scrabble.online.nick';
let onBack = null, shown = '', busy = false, msg = '', tech = '', wired = false, snapNow = null, typedCode = '';

const root = () => $('#lobby');
const savedNick = () => { try { return localStorage.getItem(NICK) || ''; } catch { return ''; } };
const saveNick = v => { try { localStorage.setItem(NICK, v); } catch { /* storage unavailable */ } };
const linkFor = code => `${location.origin}${location.pathname}?room=${code}`;
const codeFromUrl = () => { try { return (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); } catch { return ''; } };

function open(back, auto = false) {
  onBack = back || null;
  const r = root(); r.hidden = false; document.body.classList.add('lobbyOn'); document.querySelector('.app').inert = true;
  wire();
  if (!configured()) return paint('off');
  paint('connecting');
  connect().then(() => resumeOpenGame()).then(resumed => { if (resumed) return; if (auto && !hasRoomLink()) return close(); paint('start'); })   // an automatic attempt with nothing to resume just shows the cover again
    .catch(e => { if (auto && !hasRoomLink()) return close(); msg = e?.info?.text || 'تعذّر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.'; tech = e?.info?.detail || ''; paint('error'); });
}
function close() {
  const r = root(); if (!r || r.hidden) return;
  r.hidden = true; shown = ''; snapNow = null; document.body.classList.remove('lobbyOn'); document.querySelector('.app').inert = false;
}
function show(snap) {   // called by the session for every lobby/starting snapshot
  snapNow = snap; const r = root();
  if (r.hidden) { r.hidden = false; document.body.classList.add('lobbyOn'); document.querySelector('.app').inert = true; wire(); }
  paint('room');
}

// ---------- rendering ----------
function paint(view) {
  const r = root(); let html;
  if (view === 'off') html = card('اللعب عبر الإنترنت', '<p class="lbNote">اللعب عبر الإنترنت غير مُفعّل في هذه النسخة: لم تُضبط قيمتا SUPABASE_URL وSUPABASE_ANON_KEY عند النشر. أضفهما في إعدادات المنصة (Vercel ← Settings ← Environment Variables) ثم أعد النشر. اللعب المحلي يعمل كالمعتاد.</p>', '<button class="btn" data-a="back">رجوع</button>');
  else if (view === 'connecting') html = card('اللعب عبر الإنترنت', '<p class="lbNote" role="status">جارٍ الاتصال…</p>', '<button class="btn" data-a="back">رجوع</button>');
  else if (view === 'error') html = card('اللعب عبر الإنترنت', `<p class="lbNote bad" role="alert">${esc(msg)}</p>${tech ? `<p class="lbNote tech">${esc(tech)}</p>` : ''}`, '<button class="btn yes" data-a="retry">إعادة المحاولة</button><button class="btn" data-a="back">رجوع</button>');
  else if (view === 'start') html = startView();
  else html = roomView(snapNow);
  const key = view + '|' + html;
  if (key === shown) return;
  shown = key; r.innerHTML = html;
  const f = r.querySelector('[data-focus]'); if (f && view !== 'room') f.focus({ preventScroll: true });
}
const card = (title, body, foot) => `<div class="lbCard"><h2 class="lbT">${title}</h2>${body}<div class="lbFoot">${foot}</div></div>`;
const startView = () => {
  const code = typedCode || codeFromUrl();
  return card('اللعب عبر الإنترنت', `
    <label class="lbLabel" for="lbNick">اسمك</label>
    <input id="lbNick" class="lbInput" maxlength="16" autocomplete="off" spellcheck="false" placeholder="لاعب" value="${esc(savedNick())}">
    <div class="lbSplit">
      <section class="lbBox"><h3>غرفة جديدة</h3><p class="lbNote">أنشئ غرفة وأرسل الرمز إلى صديقك.</p><button class="btn yes" data-a="create"${busy ? ' disabled' : ''}>إنشاء غرفة</button></section>
      <section class="lbBox"><h3>الانضمام</h3><label class="lbLabel" for="lbCode">رمز الغرفة</label>
        <input id="lbCode" class="lbInput lbCodeIn" maxlength="7" dir="ltr" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123" value="${esc(code)}"${code ? ' data-focus' : ''}>
        <button class="btn" data-a="join"${busy ? ' disabled' : ''}>انضمام</button></section>
    </div>
    <p class="lbNote bad" role="alert">${esc(msg)}</p>`, '<button class="btn" data-a="back">رجوع</button>');
};
function roomView(snap) {
  if (!snap) return card('الغرفة', '<p class="lbNote">…</p>', '');
  const g = snap.game, me = snap.me.seat, host = me === 0;
  const seat = i => {
    const p = snap.players.find(x => x.seat === i);
    if (!p) return `<li class="lbSeat empty"><span class="lbWho">بانتظار لاعب…</span><span class="lbTag wait">مقعد فارغ</span></li>`;
    const tag = i === 0 ? '<span class="lbTag host">المضيف</span>' : p.ready ? '<span class="lbTag ok">جاهز</span>' : '<span class="lbTag wait">لم يؤكد بعد</span>';
    return `<li class="lbSeat${i === me ? ' me' : ''}"><span class="lbWho"><bdi>${esc(p.nickname)}</bdi>${i === me ? ' <small>(أنت)</small>' : ''}</span>${tag}</li>`;
  };
  const modes = Object.values(TILE_MODES).map(m => `<button class="btn lbOpt" data-a="mode" data-v="${m.id}" aria-pressed="${g.tile_mode === m.id}"${host && !busy ? '' : ' disabled'}>${m.labelAr}</button>`).join('');
  const mins = DURATIONS.map(m => `<button class="btn lbOpt" data-a="min" data-v="${m}" aria-pressed="${g.minutes === m}"${host && !busy ? '' : ' disabled'}>${m}</button>`).join('');
  const live = [[1, 'مفعّل'], [0, 'مغلق']].map(([v, t]) => `<button class="btn lbOpt" data-a="live" data-v="${v}" aria-pressed="${g.live === !!v}"${host && !busy ? '' : ' disabled'}>${t}</button>`).join('');
  const liveNote = g.live ? 'مفعّل الآن: يرى كل لاعب قطع الخصم أثناء وضعها (ظلال متقطعة)، ويُختار السحب قبل الاحتساب.' : 'مغلق الآن: لا يرى أحد قطع الخصم قبل الاحتساب.';
  const full = snap.players.length === 2, guest = snap.players.find(p => p.seat === 1);
  const act = host
    ? `<button class="btn yes" data-a="start"${busy || !full || !guest?.ready ? ' disabled' : ''}>${!full ? 'بانتظار الخصم…' : !guest.ready ? 'بانتظار جاهزية الخصم…' : 'ابدأ المباراة'}</button>`
    : `<button class="btn ${guest?.ready ? '' : 'yes'}" data-a="ready" data-v="${guest?.ready ? 0 : 1}"${busy ? ' disabled' : ''}>${guest?.ready ? 'إلغاء الجاهزية' : 'أنا جاهز'}</button>`;
  return card('غرفة اللعب', `
    <div class="lbCodeBox"><span class="lbLabel">رمز الغرفة</span><b class="lbCode" dir="ltr" aria-label="رمز الغرفة ${g.room_code.split('').join(' ')}">${g.room_code}</b>
      <div class="lbRow"><button class="btn" data-a="copy" data-v="${g.room_code}">نسخ الرمز</button><button class="btn" data-a="share" data-v="${g.room_code}">مشاركة رابط</button></div></div>
    <ul class="lbSeats" aria-label="اللاعبون">${seat(0)}${seat(1)}</ul>
    <div class="lbRules" aria-busy="${busy}"><div><span class="lbLabel">نمط القطع</span><div class="lbRow">${modes}</div></div><div><span class="lbLabel">وقت كل لاعب (دقيقة)</span><div class="lbRow">${mins}</div></div><div><span class="lbLabel">عرض القطع التي تجرّبها للخصم مباشرةً</span><div class="lbRow">${live}</div><p class="lbNote">${liveNote}</p></div></div>
    ${rulesDetails()}
    ${host ? '' : '<p class="lbNote">المضيف يحدد القواعد.</p>'}<p class="lbNote bad" role="alert">${esc(msg)}</p>`, `${act}<button class="btn danger" data-a="leave">مغادرة الغرفة</button>`);
}

// ---------- actions ----------
const nick = () => { const v = ($('#lbNick')?.value || '').trim(); saveNick(v); return v; };
async function begin(action, body) {
  const nickname = nick(); typedCode = body.code || typedCode;   // read BEFORE the repaint below replaces the inputs
  busy = true; msg = ''; tech = ''; paint('start');
  const r = await net.call({ action, nickname, ...body }, { quiet: true });
  busy = false;
  if (!r) { msg = net.lastError?.text || 'تعذّر الاتصال بالخادم.'; tech = net.lastError?.detail || ''; return paint('start'); }
  if (r.ok) return enter(r.snapshot);
  if (r.code === 'ALREADY_IN_GAME' && r.snapshot) return enter(r.snapshot);   // you are already in a room: go back to it
  msg = r.message || 'تعذّر تنفيذ الطلب.'; paint('start');
}
async function roomAct(action, extra) {
  busy = true; msg = ''; paint('room');
  const r = await net.lobbyAction(action, extra);
  busy = false;
  if (r && !r.ok && r.message) msg = r.message;
  paint('room');
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const t = Object.assign(document.createElement('textarea'), { value: text }); document.body.append(t); t.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* not allowed */ } t.remove(); return ok;
}
function wire() {
  if (wired) return; wired = true;
  root().addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    const a = b.dataset.a, v = b.dataset.v;
    if (a === 'back') { close(); return onBack && onBack(); }
    if (a === 'retry') return open(onBack, false);
    if (a === 'create') return begin('create_room', { settings: {} });
    if (a === 'join') return begin('join_room', { code: $('#lbCode').value });
    if (a === 'mode') return roomAct('update_settings', { settings: { tile_mode: v } });
    if (a === 'live') return roomAct('update_settings', { settings: { live: v === '1' } });
    if (a === 'min') return roomAct('update_settings', { settings: { minutes: +v } });
    if (a === 'ready') return roomAct('set_ready', { ready: v === '1' });
    if (a === 'start') return roomAct('start_game');
    if (a === 'leave') return net.leave();
    if (a === 'copy') { const ok = await copy(v); msg = ok ? '' : 'تعذّر النسخ. انسخ الرمز يدويًا.'; b.textContent = ok ? 'تم النسخ ✓' : 'نسخ الرمز'; if (!ok) paint('room'); setTimeout(() => { if (b.isConnected) b.textContent = 'نسخ الرمز'; }, 1500); return; }
    if (a === 'share') {
      const url = linkFor(v);
      if (navigator.share) { try { await navigator.share({ title: 'سكرابل عربي', text: `انضم إلى مباراتي. الرمز: ${v}`, url }); return; } catch { return; } }
      const ok = await copy(url); b.textContent = ok ? 'تم نسخ الرابط ✓' : 'مشاركة رابط'; setTimeout(() => { if (b.isConnected) b.textContent = 'مشاركة رابط'; }, 1500);
    }
  });
  root().addEventListener('input', e => { if (e.target.id === 'lbCode') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9\-]/g, ''); });
  root().addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'lbCode') begin('join_room', { code: e.target.value }); if (e.key === 'Enter' && e.target.id === 'lbNick') $('#lbCode').focus(); });
}

export const lobby = { open, close, show };
export const hasRoomLink = () => !!codeFromUrl();
