// [SHARED-MODULE] from Exchange hwanjeoneobmu/client/public/sw.js
// Service Worker — Web Push 알림 처리
// 이 파일은 client/public/에 위치하여 Vite가 빌드 시 dist/public/로 복사

self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const payload = event.data.json();
    const title = payload.title || '환전소 알림';
    const options = {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: payload.data || {},
      tag: 'exchange-notification',
      renotify: true,
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch {
    // 파싱 실패 시 텍스트로 폴백
    const body = event.data.text();
    event.waitUntil(
      self.registration.showNotification('환전소 알림', { body })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 이미 열린 탭이 있으면 포커스
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // 열린 탭이 없으면 새 탭
      return self.clients.openWindow(url);
    })
  );
});
