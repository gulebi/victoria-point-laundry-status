self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  if (!event.data) return;
  let notification;
  try { notification = event.data.json(); } catch { return; }
  const { title, tag } = notification ?? {};
  if (typeof title !== 'string' || typeof tag !== 'string') return;
  event.waitUntil(self.registration.showNotification(title, {
    body: 'Circuit Go reported your machine available. You can collect your laundry.',
    icon: '/icon.svg',
    tag,
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const dashboard = new URL('/', self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url === dashboard);
    if (existing) await existing.focus();
    else await self.clients.openWindow(dashboard);
  })());
});
