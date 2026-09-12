const PAGES_KEY = 'pwa_last_pages';
const DISMISS_KEY = 'pwa_install_dismissed';

let deferredPrompt = null;
const installListeners = new Set();

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function canInstall() {
  return deferredPrompt !== null;
}

export function onInstallAvailability(cb) {
  installListeners.add(cb);
  cb(canInstall());
  return () => installListeners.delete(cb);
}

function emitInstallAvailability() {
  installListeners.forEach((cb) => { try { cb(canInstall()); } catch (e) { /* ignore */ } });
}

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  emitInstallAvailability();
  return outcome === 'accepted';
}

export function wasInstallDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; }
}

export function markInstallDismissed() {
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) { /* ignore */ }
}

function rememberPage() {
  try {
    const entry = { url: window.location.pathname + window.location.search, title: document.title };
    const pages = JSON.parse(localStorage.getItem(PAGES_KEY) || '[]')
      .filter((p) => p.url !== entry.url);
    pages.unshift(entry);
    localStorage.setItem(PAGES_KEY, JSON.stringify(pages.slice(0, 8)));
  } catch (e) { /* ignore */ }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    emitInstallAvailability();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    markInstallDismissed();
    emitInstallAvailability();
  });

  window.addEventListener('load', rememberPage);
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (window.__pwaReloading) return;
    window.__pwaReloading = true;
    window.location.reload();
  });
}

export function initPwa() {
  registerServiceWorker();
}
