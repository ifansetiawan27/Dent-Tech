'use strict';
const fs = require('fs');
const path = require('path');
const { db, UPLOADS_DIR } = require('../db');
const { uid, now, hashPassword, verifyPassword, sendJSON, publicUser, fileSig, verifyFileSig } = require('../util');
const auth = require('../auth');
const { audit } = require('./_common');

const AVATAR_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

async function loginHandler(ctx) {
  const { email, password } = ctx.body;
  if (!email || !password) return sendJSON(ctx.res, 400, { error: 'Email dan password wajib diisi' });
  const result = auth.login(email, password);
  if (result.error) return sendJSON(ctx.res, 401, { error: result.error });
  audit(result.user, 'LOGIN', 'auth', result.user.id, 'User login', ctx.ip);
  sendJSON(ctx.res, 200, result);
}

async function logoutHandler(ctx) {
  const token = auth.bearerToken(ctx.req);
  auth.logout(token);
  sendJSON(ctx.res, 200, { ok: true });
}

async function meHandler(ctx) {
  const unread = db.prepare(
    `SELECT COUNT(*) AS c FROM notifications
     WHERE read_at IS NULL AND (user_id = ? OR (user_id IS NULL AND role = ?) OR (user_id IS NULL AND role IS NULL AND customer_id = ?))`
  ).get(ctx.user.id, ctx.user.role, ctx.user.customer_id || '').c;
  const company = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'company_%'").all();
  const settings = {};
  for (const r of company) settings[r.key] = r.value;
  sendJSON(ctx.res, 200, { user: publicUser(ctx.user), unread_notifications: unread, settings });
}

async function changePasswordHandler(ctx) {
  const { current_password, new_password } = ctx.body;
  if (!current_password || !new_password) return sendJSON(ctx.res, 400, { error: 'Password lama dan baru wajib diisi' });
  if (String(new_password).length < 6) return sendJSON(ctx.res, 400, { error: 'Password baru minimal 6 karakter' });
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
  if (!verifyPassword(current_password, row.password_hash)) return sendJSON(ctx.res, 400, { error: 'Password lama salah' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), ctx.user.id);
  audit(ctx.user, 'UPDATE', 'user', ctx.user.id, 'Mengubah password sendiri', ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function listUsersHandler(ctx) {
  const { role, search } = ctx.query;
  let sql = 'SELECT id, email, name, role, phone, customer_id, active, created_at FROM users WHERE 1=1';
  const params = [];
  if (role) { sql += ' AND role = ?'; params.push(role); }
  if (search) { sql += ' AND (name LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY created_at DESC';
  const users = db.prepare(sql).all(...params);
  for (const u of users) {
    if (u.customer_id) {
      const c = db.prepare('SELECT name FROM customers WHERE id = ?').get(u.customer_id);
      u.customer_name = c ? c.name : null;
    }
  }
  sendJSON(ctx.res, 200, { users });
}

async function createUserHandler(ctx) {
  const { email, password, name, role, phone = '', customer_id = null } = ctx.body;
  if (!email || !password || !name || !role) return sendJSON(ctx.res, 400, { error: 'Email, password, nama, dan role wajib diisi' });
  if (!['admin', 'technician', 'customer'].includes(role)) return sendJSON(ctx.res, 400, { error: 'Role tidak valid' });
  if (String(password).length < 6) return sendJSON(ctx.res, 400, { error: 'Password minimal 6 karakter' });
  const exists = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(String(email).trim());
  if (exists) return sendJSON(ctx.res, 409, { error: 'Email sudah terdaftar' });
  if (role === 'customer' && !customer_id) return sendJSON(ctx.res, 400, { error: 'User customer harus terhubung ke satu customer' });
  if (customer_id) {
    const c = db.prepare('SELECT id FROM customers WHERE id = ?').get(customer_id);
    if (!c) return sendJSON(ctx.res, 400, { error: 'Customer tidak ditemukan' });
  }
  const id = uid();
  db.prepare('INSERT INTO users (id, email, password_hash, name, role, phone, customer_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)')
    .run(id, String(email).trim(), hashPassword(password), name, role, phone, customer_id, now());
  audit(ctx.user, 'CREATE', 'user', id, `Membuat user ${name} (${role})`, ctx.ip);
  sendJSON(ctx.res, 201, { id });
}

async function updateUserHandler(ctx) {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id);
  if (!target) return sendJSON(ctx.res, 404, { error: 'User tidak ditemukan' });
  const { name, phone, active, password } = ctx.body;
  if (name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, target.id);
  if (phone !== undefined) db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, target.id);
  if (active !== undefined) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, target.id);
  if (password) {
    if (String(password).length < 6) return sendJSON(ctx.res, 400, { error: 'Password minimal 6 karakter' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), target.id);
  }
  audit(ctx.user, 'UPDATE', 'user', target.id, `Memperbarui user ${target.name}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function publicSettingsHandler(ctx) {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'company_%'").all();
  const settings = {};
  for (const r of rows) settings[r.key] = r.value;
  sendJSON(ctx.res, 200, { settings });
}

async function uploadPhotoHandler(ctx) {
  const { dataUrl } = ctx.body;
  if (!dataUrl || typeof dataUrl !== 'string') return sendJSON(ctx.res, 400, { error: 'File tidak valid' });
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
  if (!m) return sendJSON(ctx.res, 400, { error: 'Format file harus base64 data URL' });
  const mime = m[1];
  if (!AVATAR_MIME[mime]) return sendJSON(ctx.res, 400, { error: 'Foto profil harus jpg/png/webp' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 5 * 1024 * 1024) return sendJSON(ctx.res, 400, { error: 'Ukuran foto maksimal 5MB' });
  const fileName = `avatar_${ctx.user.id}${AVATAR_MIME[mime]}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buf);
  db.prepare('UPDATE users SET photo_path = ?, photo_mime = ? WHERE id = ?').run(fileName, mime, ctx.user.id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
  audit(ctx.user, 'UPDATE', 'user', ctx.user.id, 'Mengubah foto profil', ctx.ip);
  sendJSON(ctx.res, 200, { ok: true, user: publicUser(row) });
}

async function getPhotoHandler(ctx) {
  const ref = ctx.query.id || '';
  if (!String(ref).startsWith('avatar-')) return sendJSON(ctx.res, 400, { error: 'Request tidak valid' });
  const userId = String(ref).slice('avatar-'.length);
  let allowed = verifyFileSig(ref, ctx.query.exp, ctx.query.sig);
  if (!allowed && ctx.user) allowed = true;
  if (!allowed) return sendJSON(ctx.res, 403, { error: 'Tidak memiliki akses' });
  const u = db.prepare('SELECT photo_path, photo_mime FROM users WHERE id = ?').get(userId);
  if (!u || !u.photo_path) return sendJSON(ctx.res, 404, { error: 'Foto tidak ditemukan' });
  const filePath = path.join(UPLOADS_DIR, path.basename(u.photo_path));
  if (!fs.existsSync(filePath)) return sendJSON(ctx.res, 404, { error: 'Foto tidak ditemukan' });
  const data = fs.readFileSync(filePath);
  ctx.res.writeHead(200, { 'Content-Type': u.photo_mime || 'image/jpeg', 'Content-Length': data.length, 'Cache-Control': 'private, max-age=3600' });
  ctx.res.end(data);
}

module.exports = {
  loginHandler, logoutHandler, meHandler, changePasswordHandler,
  listUsersHandler, createUserHandler, updateUserHandler, publicSettingsHandler,
  uploadPhotoHandler, getPhotoHandler
};
