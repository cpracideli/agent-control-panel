// Web Push handlers imported by the Workbox service worker (vite-plugin-pwa).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {
    data = { title: 'Agent Control', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Agent Control';
  const options = {
    body: String(data.body || '').slice(0, 220),
    icon: '/pwa-192.png',
    badge: '/pwa-64.png',
    tag: data.tag || 'agent-control',
    data: { chatId: data.chatId || '', url: data.url || '' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const target = d.url || (d.chatId && d.chatId.startsWith('web:') ? '/#/chat/' + d.chatId.slice(4) : '/#/chat');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          if (client.navigate) client.navigate(target).catch(() => {});
          return;
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
