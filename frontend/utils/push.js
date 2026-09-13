// Web Push: subscribe notifikasi OS (bunyi + banner) untuk user yang login.
// Notifikasi tetap masuk walaupun aplikasi tertutup, selama user tidak logout
// (subscription tersimpan per user di backend) dan PWA ter-install di perangkat
// (Android Chrome; iOS 16.4+ Safari "Add to Home Screen").

import { getUser } from './auth.js';
import { api } from '../services/api.js';

const PUSH_STATE_KEY = 'sms_push_state';

function currentState() {
  try { return localStorage.getItem(PUSH_STATE_KEY) || ''; } catch { return ''; }
}

function setState(state) {
  try { localStorage.setItem(PUSH_STATE_KEY, state); } catch { /* ignore */ }
}

async function getVapidKey() {
  const result = await api.get('/api/push/vapid');
  return result.public_key || null;
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function subscribeUser(registration) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') { setState('denied'); return false; }
  const key = await getVapidKey();
  if (!key) { setState('no-key'); return false; }
  const existing = await registration.pushManager.getSubscription();
  const sub = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key)
  });
  await api.post('/api/push/subscribe', {
    endpoint: sub.endpoint,
    keys: sub.toJSON().keys,
    user_agent: navigator.userAgent
  });
  setState('subscribed');
  return true;
}

// Inisiasi dari portal pages (user sudah login). Di iOS, panggilan ini HARUS
// berada dalam event handler gesture user — pakai tombol "Aktifkan Notifikasi"
// yang muncul otomatis jika belum subscribed (lihat promptEnablePush).
export async function enablePush() {
  const user = getUser();
  if (!user) return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setState('unsupported'); return false; }
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    return await subscribeUser(registration);
  } catch (e) {
    console.error('[push] subscribe gagal:', e?.message || e);
    setState('error');
    return false;
  }
}

// Verifikasi di setiap kunjungan portal: pastikan subscription backend masih
// cocok dengan user login (misal ganti akun/perangkat). Non-interaktif.
export async function syncPushSubscription() {
  const user = getUser();
  if (!user) return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (currentState() !== 'subscribed') return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    if (!sub) { setState(''); return; }
    await api.post('/api/push/subscribe', {
      endpoint: sub.endpoint,
      keys: sub.toJSON().keys,
      user_agent: navigator.userAgent
    });
  } catch { /* offline / token kedaluwarsa: coba lagi nanti */ }
}

export function isPushEnabled() {
  return currentState() === 'subscribed';
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Sinkronkan lencana ikon aplikasi (Android) dengan jumlah notifikasi belum-dibaca
// milik user login. Dipanggil saat app dibuka/di-refresh dan setelah notif dibaca.
export async function syncAppBadge() {
  try {
    const user = getUser();
    if (!user) return;
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (!reg || typeof reg.setAppBadge !== 'function') return;
    const me = await api.get('/api/auth/me');
    const unread = Number(me.unread_notifications) || 0;
    if (unread > 0) await reg.setAppBadge(unread);
    else if (typeof reg.clearAppBadge === 'function') await reg.clearAppBadge();
  } catch { /* offline / SW belum siap: abaikan */ }
}

export async function disablePush() {
  try {
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    if (sub) {
      await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
    setState('');
    return true;
  } catch { return false; }
}
