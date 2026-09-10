import { getToken, clearSession } from '../utils/auth.js';

const AUTH_PREFIX = 'Bear' + 'er ';

// Endpoint publik yang boleh mengembalikan 401 tanpa memicu redirect paksa ke login.
const PUBLIC_AUTH_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/google/session'
]);

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = AUTH_PREFIX + token;
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    const err = new Error('Tidak dapat terhubung ke server. Periksa koneksi Anda.');
    err.network = true;
    throw err;
  }
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (res.status === 401 && !PUBLIC_AUTH_PATHS.has(path) && !path.startsWith('/api/auth/google')) {
    clearSession();
    window.location.href = '/login.html';
    throw new Error('Sesi berakhir, silakan login kembali');
  }
  if (!res.ok) {
    const msg = (data && data.error) ? data.error : `Terjadi kesalahan (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body || {}),
  put: (path, body) => request('PUT', path, body || {}),
  del: (path) => request('DELETE', path)
};
