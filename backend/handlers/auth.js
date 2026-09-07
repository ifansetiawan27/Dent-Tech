'use strict';
const path = require('path');
const { db, supabaseAdmin, createAuthClient } = require('../db');
const { saveFile, readFile } = require('../storage');
const { uid, now, sendJSON, publicUser, fileSig, verifyFileSig, nextNumber } = require('../util');
const auth = require('../auth');
const { audit } = require('./_common');

const AVATAR_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

async function loginHandler(ctx) {
  const { email, password } = ctx.body;
  if (!email || !password) return sendJSON(ctx.res, 400, { error: 'Email dan password wajib diisi' });
  const result = await auth.login(email, password);
  if (result.error) return sendJSON(ctx.res, 401, { error: result.error });
  audit(result.user, 'LOGIN', 'auth', result.user.id, 'User login', ctx.ip);
  sendJSON(ctx.res, 200, result);
}

function normalizePhone(p) {
  const digits = String(p || '').replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (/^62\d{8,14}$/.test(digits)) return '+' + digits;
  if (/^0\d{8,14}$/.test(digits)) return '+62' + digits.slice(1);
  if (/^8\d{7,13}$/.test(digits)) return '+62' + digits;
  return null;
}

async function createAuthUser(email, password, name, role) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
    app_metadata: { role }
  });
  if (error) throw new Error(error.message);
  return data.user;
}

async function signupHandler(ctx) {
  const { email, password, name, clinic_name, phone, address, city } = ctx.body || {};
  const emailNorm = String(email || '').trim().toLowerCase();
  if (!emailNorm || !password || !name || !clinic_name || !phone || !address) {
    return sendJSON(ctx.res, 400, { error: 'Semua kolom wajib diisi' });
  }
  if (!/^[a-z0-9._%+-]+@gmail\.com$/.test(emailNorm)) {
    return sendJSON(ctx.res, 400, { error: 'Pendaftaran hanya menerima email Gmail (@gmail.com)' });
  }
  if (String(password).length < 6) return sendJSON(ctx.res, 400, { error: 'Password minimal 6 karakter' });
  const phoneNorm = normalizePhone(phone);
  if (!phoneNorm) return sendJSON(ctx.res, 400, { error: 'Nomor WhatsApp tidak valid (contoh: 0812xxxxxxx)' });

  const existing = await db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(emailNorm);
  if (existing) return sendJSON(ctx.res, 409, { error: 'Email sudah terdaftar, silakan login' });

  let authUser;
  try {
    authUser = await createAuthUser(emailNorm, password, String(name).trim(), 'customer');
  } catch (e) {
    if (/already been registered|already registered/i.test(e.message)) return sendJSON(ctx.res, 409, { error: 'Email sudah terdaftar, silakan login' });
    return sendJSON(ctx.res, 500, { error: 'Gagal membuat akun: ' + e.message });
  }

  const customerId = uid();
  const code = await nextNumber('CUS');
  const ts = now();
  try {
    await db.transaction(async (tx) => {
      await tx.prepare('INSERT INTO customers (id, code, name, industry, phone, email, address, city, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(customerId, code, String(clinic_name).trim(), 'Klinik', phoneNorm, emailNorm, String(address).trim(), String(city || '').trim(), 'ACTIVE', ts);
      await tx.prepare('INSERT INTO customer_contacts (id, customer_id, name, role, phone, email, is_primary) VALUES (?, ?, ?, ?, ?, ?, 1)')
        .run(uid(), customerId, String(name).trim(), 'Penanggung Jawab', phoneNorm, emailNorm);
      await tx.prepare('INSERT INTO users (id, email, password_hash, name, role, phone, customer_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)')
        .run(authUser.id, emailNorm, 'supabase-auth', String(name).trim(), 'customer', phoneNorm, customerId, ts);
      await tx.prepare('INSERT INTO wallet_accounts (id, customer_id, balance, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
        .run(uid(), customerId, ts, ts);
    });
  } catch (error) {
    await supabaseAdmin.auth.admin.deleteUser(authUser.id).catch(() => {});
    throw error;
  }

  const result = await auth.login(emailNorm, password);
  if (result.error) return sendJSON(ctx.res, 500, { error: 'Pendaftaran berhasil namun gagal login, silakan coba login kembali' });
  audit(result.user, 'CREATE', 'auth', authUser.id, `Signup klinik ${clinic_name}`, ctx.ip);
  sendJSON(ctx.res, 201, result);
}

async function logoutHandler(ctx) {
  auth.logout();
  sendJSON(ctx.res, 200, { ok: true });
}

async function meHandler(ctx) {
  const unread = (await db.prepare(
    `SELECT COUNT(*) AS c FROM notifications
     WHERE read_at IS NULL AND (user_id = ? OR (user_id IS NULL AND role = ?) OR (user_id IS NULL AND role IS NULL AND customer_id = ?))`
  ).get(ctx.user.id, ctx.user.role, ctx.user.customer_id || '')).c;
  const company = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'company_%'").all();
  const settings = {};
  for (const r of company) settings[r.key] = r.value;
  sendJSON(ctx.res, 200, { user: publicUser(ctx.user), unread_notifications: unread, settings });
}

async function changePasswordHandler(ctx) {
  const { current_password, new_password } = ctx.body;
  if (!current_password || !new_password) return sendJSON(ctx.res, 400, { error: 'Password lama dan baru wajib diisi' });
  if (String(new_password).length < 6) return sendJSON(ctx.res, 400, { error: 'Password baru minimal 6 karakter' });
  const authClient = createAuthClient();
  const { error: verifyErr } = await authClient.auth.signInWithPassword({ email: ctx.user.email, password: current_password });
  if (verifyErr) return sendJSON(ctx.res, 400, { error: 'Password lama salah' });
  const { error } = await supabaseAdmin.auth.admin.updateUserById(ctx.user.id, { password: new_password });
  if (error) return sendJSON(ctx.res, 500, { error: 'Gagal mengubah password: ' + error.message });
  audit(ctx.user, 'UPDATE', 'user', ctx.user.id, 'Mengubah password sendiri', ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function listUsersHandler(ctx) {
  const { role, search } = ctx.query;
  let sql = 'SELECT id, email, name, role, phone, customer_id, active, created_at FROM users WHERE 1=1';
  const params = [];
  if (role) { sql += ' AND role = ?'; params.push(role); }
  if (search) { sql += ' AND (name ILIKE ? OR email ILIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY created_at ASC';
  const users = await db.prepare(sql).all(...params);
  for (const u of users) {
    if (u.customer_id) {
      const c = await db.prepare('SELECT name FROM customers WHERE id = ?').get(u.customer_id);
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
  const existing = await db.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(String(email).trim());
  if (existing) return sendJSON(ctx.res, 409, { error: 'Email sudah terdaftar' });
  if (role === 'customer' && !customer_id) return sendJSON(ctx.res, 400, { error: 'User customer harus terhubung ke satu customer' });
  if (customer_id) {
    const c = await db.prepare('SELECT id FROM customers WHERE id = ?').get(customer_id);
    if (!c) return sendJSON(ctx.res, 400, { error: 'Customer tidak ditemukan' });
  }
  let authUser;
  try {
    authUser = await createAuthUser(String(email).trim().toLowerCase(), password, name, role);
  } catch (e) {
    if (/already been registered|already registered/i.test(e.message)) return sendJSON(ctx.res, 409, { error: 'Email sudah terdaftar' });
    return sendJSON(ctx.res, 500, { error: 'Gagal membuat akun: ' + e.message });
  }
  await db.prepare('INSERT INTO users (id, email, password_hash, name, role, phone, customer_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)')
    .run(authUser.id, String(email).trim().toLowerCase(), 'supabase-auth', name, role, phone, customer_id, now());
  audit(ctx.user, 'CREATE', 'user', authUser.id, `Membuat user ${name} (${role})`, ctx.ip);
  sendJSON(ctx.res, 201, { id: authUser.id });
}

async function updateUserHandler(ctx) {
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id);
  if (!target) return sendJSON(ctx.res, 404, { error: 'User tidak ditemukan' });
  const { name, phone, active, password } = ctx.body;
  if (name) await db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, target.id);
  if (phone !== undefined) await db.prepare('UPDATE users SET phone = ? WHERE id = ?').run(phone, target.id);
  if (active !== undefined) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(target.id, { ban_duration: active ? 'none' : '876000h' });
    if (error && !/not found/i.test(error.message || '')) return sendJSON(ctx.res, 500, { error: 'Gagal mengubah status login: ' + error.message });
    await db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, target.id);
  }
  if (password) {
    if (String(password).length < 6) return sendJSON(ctx.res, 400, { error: 'Password minimal 6 karakter' });
    const { error } = await supabaseAdmin.auth.admin.updateUserById(target.id, { password });
    if (error) return sendJSON(ctx.res, 500, { error: 'Gagal mengubah password: ' + error.message });
  }
  audit(ctx.user, 'UPDATE', 'user', target.id, `Memperbarui user ${target.name}`, ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
}

async function deleteTechnicianHandler(ctx) {
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id);
  if (!target) return sendJSON(ctx.res, 404, { error: 'Teknisi tidak ditemukan' });
  if (target.role !== 'technician') return sendJSON(ctx.res, 400, { error: 'Fitur hapus ini hanya untuk akun teknisi' });

  const activeWorkOrders = await db.prepare(
    "SELECT number, status FROM work_orders WHERE technician_id = ? AND status IN ('ASSIGNED','STARTED','WAITING_QUOTATION','WAITING_CUSTOMER_APPROVAL','REPAIR_AUTHORIZED','REPAIR_STARTED') ORDER BY created_at ASC"
  ).all(target.id);
  if (activeWorkOrders.length) {
    return sendJSON(ctx.res, 409, {
      error: `Teknisi masih memiliki ${activeWorkOrders.length} pekerjaan aktif. Selesaikan atau pindahkan penugasan terlebih dahulu.`,
      work_orders: activeWorkOrders
    });
  }

  if (target.active) {
    await db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(target.id);
    audit(ctx.user, 'DELETE', 'user', target.id, `Menghapus teknisi ${target.name} dari operasional; riwayat service dipertahankan`, ctx.ip);
  }

  let authDisabled = true;
  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(target.id, { ban_duration: '876000h' });
  if (authError && !/not found/i.test(authError.message || '')) {
    authDisabled = false;
    console.error('[deleteTechnician] Gagal menonaktifkan Supabase Auth:', authError.message);
  }

  sendJSON(ctx.res, 200, {
    ok: true,
    archived: true,
    auth_disabled: authDisabled,
    message: 'Teknisi dihapus dari operasional. Riwayat service tetap tersimpan.'
  });
}

async function publicSettingsHandler(ctx) {
  const rows = await db.prepare("SELECT key, value FROM settings WHERE key LIKE 'company_%'").all();
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
  await saveFile(fileName, buf, mime);
  await db.prepare('UPDATE users SET photo_path = ?, photo_mime = ? WHERE id = ?').run(fileName, mime, ctx.user.id);
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id);
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
  const u = await db.prepare('SELECT photo_path, photo_mime FROM users WHERE id = ?').get(userId);
  if (!u || !u.photo_path) return sendJSON(ctx.res, 404, { error: 'Foto tidak ditemukan' });
  const data = await readFile(path.basename(u.photo_path));
  if (!data) return sendJSON(ctx.res, 404, { error: 'Foto tidak ditemukan' });
  ctx.res.writeHead(200, { 'Content-Type': u.photo_mime || 'image/jpeg', 'Content-Length': data.length, 'Cache-Control': 'private, max-age=3600' });
  ctx.res.end(data);
}

module.exports = {
  loginHandler, signupHandler, logoutHandler, meHandler, changePasswordHandler,
  listUsersHandler, createUserHandler, updateUserHandler, deleteTechnicianHandler, publicSettingsHandler,
  uploadPhotoHandler, getPhotoHandler
};
