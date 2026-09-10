import { api } from '../services/api.js';
import { fileToDataUrl } from './ui.js';
import { getUser, setUser } from '../utils/auth.js';
import { esc } from '../utils/format.js';

export async function uploadAvatar(file) {
  const dataUrl = await fileToDataUrl(file, 480, 0.85);
  const res = await api.post('/api/auth/photo', { dataUrl });
  if (res.user) setUser(res.user);
  else {
    const u = getUser();
    if (u && res.photo_url) { u.photo_url = res.photo_url; setUser(u); }
  }
  return res.user ? res.user.photo_url : null;
}

export function avatarHtml(user, sizeClass = 'w-8 h-8', textClass = 'text-xs') {
  if (user && user.photo_url) {
    return `<img src="${esc(user.photo_url)}" alt="${esc(user.name || 'profil')}" class="${sizeClass} rounded-full object-cover shrink-0">`;
  }
  const initials = (user && user.name ? user.name : '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return `<div class="${sizeClass} rounded-full bg-blue-600 flex items-center justify-center ${textClass} font-bold text-white shrink-0">${initials}</div>`;
}
