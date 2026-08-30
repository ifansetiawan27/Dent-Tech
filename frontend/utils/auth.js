const TOKEN_KEY = 'sms_token';
const USER_KEY = 'sms_user';

export function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
export function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }
export function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } }
export function setUser(u) { if (u) localStorage.setItem(USER_KEY, JSON.stringify(u)); else localStorage.removeItem(USER_KEY); }

export function clearSession() { setToken(null); setUser(null); }

export function portalHome(role) {
  if (role === 'admin') return '/admin/';
  if (role === 'technician') return '/technician/';
  if (role === 'customer') return '/customer/';
  return '/';
}

export function requireAuth(expectedRoles) {
  const token = getToken();
  const user = getUser();
  if (!token || !user) { window.location.href = '/login.html'; return null; }
  if (expectedRoles && !expectedRoles.includes(user.role)) { window.location.href = portalHome(user.role); return null; }
  return user;
}

export async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: ('Bear' + 'er ') + getToken() } }); } catch {}
  clearSession();
  window.location.href = '/login.html';
}
