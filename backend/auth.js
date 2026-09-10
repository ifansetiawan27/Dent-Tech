'use strict';
const { db, createAuthClient } = require('./db');
const { publicUser } = require('./util');

async function login(email, password) {
  const supabase = createAuthClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email || '').trim(),
    password: String(password || '')
  });
  if (error || !data.session) return { error: 'Email atau password salah' };
  const user = await db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(data.user.id);
  if (!user) return { error: 'Akun tidak terdaftar di sistem ini' };
  return { token: data.session.access_token, user: publicUser(user) };
}

function logout() {
  // JWT bersifat stateless; cukup client membuang token.
}

// Validasi access token Supabase (dipakai alur OAuth Google & reset password).
async function getUserFromToken(token) {
  if (!token) return null;
  const supabase = createAuthClient();
  const { data, error } = await supabase.auth.getUser(String(token));
  if (error || !data || !data.user) return null;
  return data.user;
}

// Kirim email reset password lewat layanan email Supabase.
async function sendPasswordReset(email, redirectTo) {
  const supabase = createAuthClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  return { error };
}

function bearerToken(req) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

// Cache verifikasi token (dalam memori, per isolate): menghindari round-trip
// ke Supabase Auth pada SETIAP request. Entry invalid di-cache singkat,
// entry valid sampai mendekati kedaluwarsa token (maks 15 menit).
let authClient = null;
const tokenCache = new Map();
const CACHE_HIT_MAX_AGE_MS = 60 * 1000;

function cacheGet(token) {
  const entry = tokenCache.get(token);
  if (!entry || entry.expiresAt <= Date.now()) return undefined;
  return entry.user;
}

function cacheSet(token, user, expiresAt) {
  if (tokenCache.size > 1000) {
    const nowMs = Date.now();
    for (const [key, entry] of tokenCache) if (entry.expiresAt <= nowMs) tokenCache.delete(key);
  }
  tokenCache.set(token, { user, expiresAt });
}

async function currentUser(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const cached = cacheGet(token);
  if (cached !== undefined) return cached;
  const nowMs = Date.now();
  if (!authClient) authClient = createAuthClient();
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    cacheSet(token, null, nowMs + 10 * 1000);
    return null;
  }
  const row = await db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(data.user.id);
  let ttl = CACHE_HIT_MAX_AGE_MS;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    if (payload.exp) ttl = Math.min(payload.exp * 1000 - nowMs - 30 * 1000, CACHE_HIT_MAX_AGE_MS);
  } catch {}
  cacheSet(token, row || null, nowMs + Math.max(ttl, 5 * 1000));
  return row || null;
}

function requireRoles(...roles) {
  return (user) => !!user && (roles.length === 0 || roles.includes(user.role));
}

module.exports = { login, logout, currentUser, bearerToken, requireRoles, getUserFromToken, sendPasswordReset };
