/* Dent Tech.id — Service Worker (PWA)
 * Strategi:
 *  - Navigasi (HTML): network-first, fallback ke halaman offline saat gagal.
 *  - API (/api/*): network-only, tidak pernah di-cache (data sensitif & dinamis).
 *  - Aset statis same-origin (/assets, /styles, /components, /utils, /services): stale-while-revalidate.
 *  - Cross-origin (font/CDN): dibiarkan lewat tanpa intervensi.
 */

const VERSION = 'denttech-v6';
const OFFLINE_URL = '/offline.html';

// Lapor ke server bahwa push BENAR-BENAR diterima perangkat (diagnostik delivery).
// Server tidak menulis apa pun; log ini hanya untuk memastikan pesan sampai.
function ackPush(data) {
  try {
    self.registration.pushManager.getSubscription().then((sub) => fetch('/api/push/ack', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: sub ? sub.endpoint : '',
        title: data.title || '',
        tag: data.tag || '',
        notifications: data.notifications || 0,
        badge_api: typeof self.navigator.setAppBadge === 'function'
      })
    })).catch(() => {});
  } catch { /* abaikan */ }
}

const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/styles/app.css',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/icon-maskable-192.png',
  '/assets/icons/icon-maskable-512.png',
  '/assets/icons/apple-touch-icon.png',
  '/assets/logo.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isApi(url) {
  return url.pathname.startsWith('/api/');
}

function isStaticAsset(url) {
  return /^\/(assets|styles|components|utils|services)\//.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (isApi(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL)))
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response && response.status === 200 && response.type === 'basic') {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ---------- Web Push (notifikasi saat aplikasi tertutup) ----------
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || 'Dent Tech.id';
  const options = {
    body: data.body || '',
    icon: '/assets/icons/icon-192.png',
    badge: '/assets/icons/icon-192.png',
    tag: data.ref_type && data.ref_id ? `${data.ref_type}-${data.ref_id}` : 'denttech-notification',
    // renotify WAJIB true saat memakai tag: notifikasi baru dengan tag sama
    // akan menggantikan yang lama TANPA bunyi/banner jika false.
    renotify: true,
    data: { ref_type: data.ref_type || '', ref_id: data.ref_id || '' },
    vibrate: [200, 100, 200],
    // silent:false → Android/iOS membunyikan notifikasi (default nada sistem).
    silent: false,
    requireInteraction: false
  };
  // showNotification WAJIB berhasil agar push tidak dibuang browser. Jika opsi
  // lengkap ditolak (perangkat/versi tertentu), ulangi dengan opsi minimal.
  const shown = self.registration.showNotification(title, options)
    .then(() => {
      // Kick laporan: push benar-benar diterima perangkat ini.
      ackPush(data);
      // Coba tampilkan angka belum-dibaca di ikon (hanya platform yang mendukung
      // Badging API; di Android lencana muncul otomatis dari notifikasi itu sendiri).
      const count = Number(data.badge) || 0;
      if (count > 0 && typeof self.navigator.setAppBadge === 'function') {
        return self.navigator.setAppBadge(count).catch(() => {});
      }
      return undefined;
    })
    .catch(() =>
      self.registration.showNotification(title, { body: options.body, tag: options.tag })
        .then(() => ackPush(data))
        .catch(() => {})
    );
  event.waitUntil(shown);
});

function pushTargetUrl(data) {
  const { ref_type: type, ref_id: id } = data || {};
  if (!type || !id) return '/login.html';
  return `/login.html?ref=${encodeURIComponent(type)}:${encodeURIComponent(id)}`;
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = pushTargetUrl(event.notification.data);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
