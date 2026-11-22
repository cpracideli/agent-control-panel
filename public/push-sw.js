// Web Push handlers imported by the Workbox service worker (vite-plugin-pwa).
function extractHash(u) {
  if (!u) return '';
  const str = String(u);
  const idx = str.indexOf('#');
  if (idx >= 0) return str.slice(idx).replace(/\/+$/, '');
  return '';
}

function normalizeTarget(url, chatId) {
  const fallback = chatId && String(chatId).startsWith('web:')
    ? '/#/chat/' + encodeURIComponent(String(chatId).slice(4))
    : '/#/chat';
  if (!url) return fallback;
  const raw = String(url).trim();
  if (!raw) return fallback;
  const hash = extractHash(raw);
  if (hash) return '/' + hash;
  try {
    const parsed = new URL(raw, self.location.origin);
    if (parsed.origin === self.location.origin) {
      const p = (parsed.pathname || '/').replace(/\/+$/, '');
      if (!p || p === '/index.html') return parsed.hash ? '/' + parsed.hash.replace(/\/+$/, '') : fallback;
      return '/#' + p + (parsed.search || '');
    }
    return parsed.href;
  } catch {
    if (raw.startsWith('/')) return '/#' + raw.replace(/\/+$/, '');
    return fallback;
  }
}

function chatIdFromHash(hash) {
  if (!hash || !hash.startsWith('#/chat/')) return '';
  const raw = decodeURIComponent(hash.slice('#/chat/'.length).split(/[/?#]/)[0] || '');
  if (!raw) return '';
  return raw.startsWith('web:') ? raw : 'web:' + raw;
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {
    data = { title: 'Agent Control', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Agent Control';
  const target = normalizeTarget(data.url, data.chatId);
  const targetHash = extractHash(target);
  const isTest = data.tag === 'push-test';
  const options = {
    body: String(data.body || '').slice(0, 220),
    icon: '/pwa-192.png',
    badge: '/pwa-64.png',
    tag: data.tag || 'agent-control',
    data: { chatId: data.chatId || '', url: target },
  };
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      if (!isTest && targetHash) {
        const viewingSame = list.some((client) => (
          client.visibilityState === 'visible'
          && client.focused
          && extractHash(client.url) === targetHash
        ));
        if (viewingSame) return undefined;
      }
      return self.registration.showNotification(title, options);
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const target = normalizeTarget(d.url, d.chatId);
  const targetUrl = new URL(target, self.location.origin).href;
  const targetHash = extractHash(targetUrl);
  const targetChatId = targetHash === '#/chat' || targetHash.startsWith('#/chat/')
    ? (chatIdFromHash(targetHash) || (d.chatId && String(d.chatId).startsWith('web:') ? String(d.chatId) : ''))
    : '';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
      const panelClients = list.filter((client) => {
        try {
          const u = new URL(client.url);
          return u.origin === self.location.origin && (u.pathname === '/' || u.pathname === '/index.html');
        } catch {
          return false;
        }
      });

      const best = panelClients.find((c) => extractHash(c.url) === targetHash)
        || panelClients.find((c) => c.focused)
        || panelClients.find((c) => c.visibilityState === 'visible')
        || panelClients[0];

      if (best) {
        const msg = { type: 'acp:navigate', url: targetUrl, hash: targetHash, chatId: targetChatId };
        try { best.postMessage(msg); } catch {}
        if ('focus' in best) await best.focus().catch(() => {});
        if (extractHash(best.url) !== targetHash) {
          if (typeof best.navigate === 'function') {
            await best.navigate(targetUrl).catch(() => {});
          }
          // Re-send after focus/navigate for iOS Safari PWA wake-up reliability
          try { best.postMessage(msg); } catch {}
        }
        return best;
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
