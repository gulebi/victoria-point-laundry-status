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
