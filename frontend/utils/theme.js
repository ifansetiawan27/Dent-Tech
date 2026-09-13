import { refreshIcons } from '../components/ui.js';

const THEME_KEY = 'sms_theme';

export function isDarkTheme() {
  return document.documentElement.classList.contains('dark');
}

export function bindThemeToggle(btn) {
  const sync = () => {
    const dark = isDarkTheme();
    btn.innerHTML = `<i data-lucide="${dark ? 'sun' : 'moon'}" class="w-5 h-5"></i>`;
    btn.title = dark ? 'Mode Terang' : 'Mode Gelap';
    btn.setAttribute('aria-label', btn.title);
    refreshIcons();
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const dark = !isDarkTheme();
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    sync();
  });
  sync();
}
