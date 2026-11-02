// Injected into every test page BEFORE the app runs: the browser-side half of the stand-in for Supabase (same contract as supabase-backend.js).
window.EAS_BACKEND_FACTORY = () => {
  const user = window.__USER; let channel = null, info = null;
  return {
    async init() { return user; },
    async call(body) { const r = await fetch('/__api', { method: 'POST', body: JSON.stringify({ user, body }) }); return r.json(); },
    async subscribe(gameId, h) {
      let since = 0, dsince = 0, last = '', alive = true;
      setTimeout(() => h.onStatus?.('SUBSCRIBED'), 0);
      const poll = async () => {
        if (!alive) return;
        try {
          const r = await (await fetch(`/__events?game=${gameId}&user=${user}&since=${since}&ds=${dsince}`)).json();
          since = r.next; dsince = r.dnext ?? dsince; for (const d of r.drafts || []) h.onDraft?.(d);
          for (const e of r.events) h.onEvent?.({ revision: e.revision, status: e.status, event: e.event });
          const key = r.presence.join(','); if (key !== last) { last = key; h.onPresence?.(r.presence); }
        } catch { /* the test server is local */ }
        setTimeout(poll, 250);
      };
      poll(); return { close() { alive = false; }, sendDraft(payload) { fetch('/__draft', { method: 'POST', body: JSON.stringify({ game: gameId, user, payload }) }).catch(() => {}); } };
    },
    track() {}
  };
};
