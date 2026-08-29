'use strict';
const { db, supabase } = require('./db');
const { publicUser } = require('./util');

async function login(email, password) {
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

function bearerToken(req) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

async function currentUser(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  const row = await db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(data.user.id);
  return row || null;
}

function requireRoles(...roles) {
  return (user) => !!user && (roles.length === 0 || roles.includes(user.role));
}

module.exports = { login, logout, currentUser, bearerToken, requireRoles, supabase };
