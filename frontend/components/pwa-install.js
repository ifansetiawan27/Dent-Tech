import { canInstall, onInstallAvailability, promptInstall, isStandalone, isIOS } from '../utils/pwa.js';

const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>';
const SHARE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>';

export function initInstallButton(options = {}) {
  const position = options.position === 'inline' ? 'inline' : 'floating';
  if (isStandalone()) return null;

  const wrap = document.createElement('div');
  wrap.dataset.pwaInstall = position;
  if (options.raised) wrap.classList.add('pwa-install-raised');

  if (isIOS()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = options.btnClass ? `pwa-install-btn ${options.btnClass}` : 'pwa-install-btn';
    btn.setAttribute('aria-label', 'Cara install aplikasi di iPhone/iPad');
    btn.innerHTML = `${SHARE_ICON}<span>Install App</span>`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-pwa-ios-tip]').forEach((el) => { el.remove(); });
      const tip = document.createElement('div');
      tip.dataset.pwaIosTip = '1';
      tip.setAttribute('role', 'dialog');
      tip.setAttribute('aria-label', 'Cara install di iPhone/iPad');
      tip.innerHTML = `
        <div class="pwa-ios-tip-backdrop" data-pwa-ios-close></div>
        <div class="pwa-ios-tip-card">
          <button type="button" class="pwa-ios-tip-close" data-pwa-ios-close aria-label="Tutup">&times;</button>
          <p class="pwa-ios-tip-title">Install di iPhone/iPad</p>
          <ol class="pwa-ios-tip-steps">
            <li><span class="pwa-ios-tip-num">1</span>Buka situs ini di <strong>Safari</strong></li>
            <li><span class="pwa-ios-tip-num">2</span>Tekan tombol <span class="pwa-ios-tip-share">${SHARE_ICON}</span><strong>Share</strong> di bar bawah</li>
            <li><span class="pwa-ios-tip-num">3</span>Pilih <strong>Add to Home Screen</strong>, lalu <strong>Add</strong></li>
          </ol>
          <p class="pwa-ios-tip-note">Aplikasi akan muncul di home screen dan berjalan fullscreen seperti app native.</p>
        </div>`;
      document.body.appendChild(tip);
      tip.querySelectorAll('[data-pwa-ios-close]').forEach((el) => el.addEventListener('click', () => tip.remove()));
    });
    wrap.appendChild(btn);
    if (position === 'inline' && options.target) {
      wrap.classList.add('pwa-install-inline');
      options.target.appendChild(wrap);
    } else {
      document.body.appendChild(wrap);
    }
    return wrap;
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = options.btnClass ? `pwa-install-btn ${options.btnClass}` : 'pwa-install-btn';
  btn.innerHTML = `${DOWNLOAD_ICON}<span>Install App</span>`;
  btn.setAttribute('aria-label', 'Install aplikasi Dent Tech.id');

  btn.addEventListener('click', () => { promptInstall(); });

  wrap.appendChild(btn);

  if (position === 'inline' && options.target) {
    wrap.classList.add('pwa-install-inline');
    options.target.appendChild(wrap);
  } else {
    document.body.appendChild(wrap);
  }

  const sync = (available) => {
    wrap.classList.toggle('hidden', !available);
  };
  onInstallAvailability(sync);
  sync(canInstall());

  return wrap;
}
