import { canInstall, onInstallAvailability, promptInstall, isStandalone, wasInstallDismissed, markInstallDismissed } from '../utils/pwa.js';

const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>';

export function initInstallButton(options = {}) {
  const position = options.position === 'inline' ? 'inline' : 'floating';
  if (isStandalone()) return null;

  const wrap = document.createElement('div');
  wrap.dataset.pwaInstall = position;
  if (options.raised) wrap.classList.add('pwa-install-raised');

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pwa-install-btn';
  btn.innerHTML = `${DOWNLOAD_ICON}<span>Install App</span>`;
  btn.setAttribute('aria-label', 'Install aplikasi Dent Tech.id');

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'pwa-install-close';
  close.innerHTML = '&times;';
  close.setAttribute('aria-label', 'Tutup');
  close.addEventListener('click', (e) => {
    e.stopPropagation();
    markInstallDismissed();
    wrap.remove();
  });

  btn.addEventListener('click', async () => {
    const ok = await promptInstall();
    if (ok || !canInstall()) wrap.remove();
  });

  wrap.appendChild(btn);
  wrap.appendChild(close);

  if (position === 'inline' && options.target) {
    wrap.classList.add('pwa-install-inline');
    options.target.appendChild(wrap);
  } else {
    document.body.appendChild(wrap);
  }

  const sync = (available) => {
    const show = available && !wasInstallDismissed();
    wrap.classList.toggle('hidden', !show);
  };
  onInstallAvailability(sync);
  sync(canInstall());

  return wrap;
}
