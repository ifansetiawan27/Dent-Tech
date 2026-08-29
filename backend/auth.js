'use strict';
const crypto = require('crypto');
const { db } = require('./db');
const { uid, now, verifyPassword, publicUser } = require('./util');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function login(email, password) {
  const user = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(String(email || '').trim());
  if (!user || !user.active) return { error: 'Email tidak terdaftar atau akun nonaktif' };
  if (!verifyPassword(password, user.password_hash)) return { error: 'Password salah' };
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, user.id, now(), new Date(Date.now() + TOKEN_TTL_MS).toISOString());
  db.prepare("DELETE FROM tokens WHERE expires_at < ?").run(now());
  return { token, user: publicUser(user) };
}

function logout(token) {
  if (token) db.prepare('DELETE FROM tokens WHERE token = ?').run(token);
}

function bearerToken(req) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

function currentUser(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token = ? AND t.expires_at > ? AND u.active = 1`
  ).get(token, now());
  return row || null;
}

function requireRoles(...roles) {
  return (user) => !!user && (roles.length === 0 || roles.includes(user.role));
}

module.exports = { login, logout, currentUser, bearerToken, requireRoles };
