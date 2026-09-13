'use strict';
const path = require('path');
const { db, supabaseAdmin, createAuthClient } = require('../db');
const { saveFile, readFile } = require('../storage');
const { uid, now, sendJSON, publicUser, fileSig, verifyFileSig, nextNumber, getSetting } = require('../util');
const auth = require('../auth');
const { getEnv } = require('../runtime');
const { audit, rateAllowed } = require('./_common');

const AVATAR_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

async function loginHandler(ctx) {
  const { email, password } = ctx.body;
  if (!email || !password) return sendJSON(ctx.res, 400, { error: 'Email dan password wajib diisi' });
  const result = await auth.login(email, password);
  if (result.error) return sendJSON(ctx.res, 401, { error: result.error });
  audit(result.user, 'LOGIN', 'auth', result.user.id, 'User login', ctx.ip);
  sendJSON(ctx.res, 200, result);
}

// Base URL publik untuk redirect OAuth/reset password.
// Prioritas: env APP_URL (produksi) → header origin/host request → localhost.
function publicBaseUrl(ctx) {
  const configured = String(getEnv('APP_URL') || getEnv('PUBLIC_APP_URL') || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  const headers = ctx.req?.headers || {};
  const proto = headers['x-forwarded-proto'] || 'https';
  const host = headers['x-forwarded-host'] || headers.host || '';
  if (host) return `${proto}://${host}`;
  return '';
}

// Deteksi provider aktif dari endpoint publik Supabase (/auth/v1/settings),
// agar tombol Google hanya muncul bila provider benar-benar diaktifkan.
// Saat pemeriksaan gagal, anggap nonaktif (fail-closed) agar tombol tidak
// tampil padahal provider mati.
let providerCache = { at: 0, value: null };
async function detectProviders() {
  const supabaseUrl = getEnv('SUPABASE_URL') || '';
  const anonKey = getEnv('SUPABASE_PUBLISHABLE_KEY') || '';
  if (!supabaseUrl || !anonKey) return { google: false };
  if (providerCache.value && Date.now() - providerCache.at < 60 * 1000) return providerCache.value;
  try {
    const res = await fetch(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/settings`, {
      headers: { apikey: anonKey }
    });
    if (res.ok) {
      const data = await res.json();
      const value = { google: !!(data && data.external && data.external.google) };
      providerCache = { at: Date.now(), value };
      return value;
    }
  } catch (error) {
    console.error('[auth-providers]', error?.message || error);
  }
  return { google: false };
}

// Pastikan sesi Supabase berasal dari identitas Google, bukan email/password
// (anon key publik + signup Supabase aktif, jadi token apa pun bisa diperoleh).
function isGoogleIdentity(authUser) {
  const providers = authUser.app_metadata?.providers;
  if (Array.isArray(providers) && providers.includes('google')) return true;
  if (authUser.app_metadata?.provider === 'google') return true;
  if (Array.isArray(authUser.identities) && authUser.identities.some((i) => i && i.provider === 'google')) return true;
  return false;
}

// Rate limit sederhana per isolate untuk endpoint auth publik (rateAllowed dari _common).
const authRateAllowed = (key, limit, windowMs) => rateAllowed(`auth:${key}`, limit, windowMs);

// Tukar access token Supabase (hasil OAuth Google) menjadi sesi aplikasi.
// Customer harus sudah terdaftar di tabel users agar bisa masuk ke portal.
async function googleSessionHandler(ctx) {
  const { access_token } = ctx.body || {};
  if (!access_token) return sendJSON(ctx.res, 400, { error: 'Token Google tidak ditemukan' });

  if (!authRateAllowed(`google:${ctx.ip || 'unknown'}`, 30, 60000)) {
    return sendJSON(ctx.res, 429, { error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  }

  const authUser = await auth.getUserFromToken(access_token);
  if (!authUser || !authUser.email) return sendJSON(ctx.res, 401, { error: 'Sesi Google tidak valid' });
  if (!isGoogleIdentity(authUser)) return sendJSON(ctx.res, 403, { error: 'Sesi bukan dari login Google' });

  const emailNorm = String(authUser.email).trim().toLowerCase();
  // Cek tanpa filter active agar akun yang dinonaktifkan tidak salah dianggap
  // belum terdaftar (yang dulu memicu percobaan insert duplikat).
  const existing = await db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(emailNorm);
  if (existing && !existing.active) {
    return sendJSON(ctx.res, 403, { error: 'Akun Anda dinonaktifkan. Hubungi admin.' });
  }

  let user = existing;
  // Belum terdaftar: hanya boleh masuk jika pendaftaran mandiri customer diaktifkan
  // dan email memakai domain Gmail (konsisten dengan signup manual).
  if (!user) {
    const signupEnabled = (await getSetting('customer_google_signup', 'OFF')) === 'ON';
    if (!signupEnabled) return sendJSON(ctx.res, 403, { error: 'Akun belum terdaftar. Silakan daftar terlebih dahulu.' });
    if (!/^[a-z0-9._%+-]+@gmail\.com$/.test(emailNorm)) {
      return sendJSON(ctx.res, 403, { error: 'Pendaftaran Google hanya menerima email @gmail.com' });
    }
    const created = await provisionGoogleCustomer(authUser, emailNorm);
    if (created.error) return sendJSON(ctx.res, created.status || 500, { error: created.error });
    user = created.user;
  }

  if (!user || user.role !== 'customer') {
    return sendJSON(ctx.res, 403, { error: 'Login Google hanya tersedia untuk akun customer' });
  }

  audit(user, 'LOGIN', 'auth', user.id, 'Customer login via Google', ctx.ip);
  sendJSON(ctx.res, 200, { token: access_token, user: publicUser(user) });
}

// Buat customer + user + wallet untuk akun Google yang belum terdaftar.
// Idempoten: request paralel/ulang tidak membuat data ganda.
async function provisionGoogleCustomer(authUser, emailNorm) {
  const name = String(authUser.user_metadata?.full_name || authUser.user_metadata?.name || emailNorm.split('@')[0]).trim();
  const customerId = uid();
  const ts = now();
  try {
    const code = await nextNumber('CUS');
    await db.transaction(async (tx) => {
      const already = await tx.prepare('SELECT id FROM users WHERE id = ?').get(authUser.id);
      if (already) return;
      await tx.prepare('INSERT INTO customers (id, code, name, industry, phone, email, address, city, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(customerId, code, name, 'Klinik', '', emailNorm, '', '', 'ACTIVE', ts);
      await tx.prepare('INSERT INTO customer_contacts (id, customer_id, name, role, phone, email, is_primary) VALUES (?, ?, ?, ?, ?, ?, 1)')
        .run(uid(), customerId, name, 'Penanggung Jawab', '', emailNorm);
      await tx.prepare('INSERT INTO users (id, email, password_hash, name, role, phone, customer_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT (id) DO NOTHING')
        .run(authUser.id, emailNorm, 'supabase-oauth', name, 'customer', '', customerId, ts);
      await tx.prepare('INSERT INTO wallet_accounts (id, customer_id, balance, created_at, updated_at) VALUES (?, ?, 0, ?, ?) ON CONFLICT (customer_id) DO NOTHING')
        .run(uid(), customerId, ts, ts);
    });
  } catch (error) {
    console.error('[google-provision]', error?.message || error);
    return { error: 'Gagal membuat akun customer. Silakan coba lagi.' };
  }
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(authUser.id);
  if (!user) return { error: 'Gagal membuat akun customer. Silakan coba lagi.' };
  return { user };
}

// Konfigurasi publik untuk klien browser (anon key memang untuk publik).
// Dipakai login Google (SDK) dan halaman reset password (SDK).
async function providersHandler(ctx) {
  const providers = await detectProviders();
  const cfg = {
    providers,
    supabase_url: (getEnv('SUPABASE_URL') || '').replace(/\/+$/, ''),
    supabase_anon_key: getEnv('SUPABASE_PUBLISHABLE_KEY') || ''
  };
  sendJSON(ctx.res, 200, cfg);
}

async function forgotPasswordHandler(ctx) {
  const emailNorm = String(ctx.body?.email || '').trim().toLowerCase();
  if (!emailNorm) return sendJSON(ctx.res, 400, { error: 'Email wajib diisi' });

  if (!authRateAllowed(`forgot:${ctx.ip || 'unknown'}`, 5, 60000)) {
    return sendJSON(ctx.res, 429, { error: 'Terlalu banyak permintaan. Coba lagi nanti.' });
  }

  const user = await db.prepare('SELECT id, active FROM users WHERE lower(email) = ?').get(emailNorm);
  // Selalu balas sukses agar tidak membocorkan keberadaan akun.
  if (user && user.active) {
    const base = publicBaseUrl(ctx);
    const redirectTo = `${base}/reset-password.html`;
    const { error } = await auth.sendPasswordReset(emailNorm, redirectTo);
    if (error) console.error('[forgot-password]', error.message || error);
  }
  sendJSON(ctx.res, 200, { ok: true, message: 'Jika email terdaftar, tautan reset password telah dikirim.' });
}

// Decode klaim JWT (sudah divalidasi via getUser()). Digunakan hanya untuk
// membaca klaim "amr" guna memastikan token berasal dari konteks recovery,
// bukan dari login Google/SSO biasa.
function readJwtClaims(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// Token yang bisa reset password harus berasal dari mechanism email/password
// (recovery email atau login password). Token hasil Google/SSO ditolak.
// Berbasis whitelist yang longgar agar tidak menolak token recovery sah:
// hanya SSO/OAuth yang dianggap tidak layak.
function isRecoveryUsableToken(claims) {
  if (!claims) return true;
  const amr = claims.amr;
  if (Array.isArray(amr) && amr.length) {
    const methods = amr.map((factor) => factor && factor.method).filter(Boolean);
    // Token yang terautentikasi via OAuth/SSO (mis. Google) tidak boleh
    // dipakai mereset password. Factor lain (password/otp/email) diizinkan.
    if (methods.includes('oauth') || methods.includes('sso')) return false;
    return true;
  }
  // Tanpa amr: tolak hanya bila klaim menunjukkan identitas Google.
  return !(claims.provider === 'google' || (Array.isArray(claims.providers) && claims.providers.includes('google')));
}

async function resetPasswordHandler(ctx) {
  const { access_token, new_password } = ctx.body || {};
  if (!access_token) return sendJSON(ctx.res, 400, { error: 'Tautan reset tidak valid' });
  if (!new_password || String(new_password).length < 6) return sendJSON(ctx.res, 400, { error: 'Password baru minimal 6 karakter' });

  if (!authRateAllowed(`reset:${ctx.ip || 'unknown'}`, 10, 60000)) {
    return sendJSON(ctx.res, 429, { error: 'Terlalu banyak percobaan. Coba lagi nanti.' });
  }

  const authUser = await auth.getUserFromToken(access_token);
  if (!authUser) return sendJSON(ctx.res, 401, { error: 'Tautan reset sudah kedaluwarsa. Silakan minta ulang.' });
  if (!isRecoveryUsableToken(readJwtClaims(access_token))) {
    return sendJSON(ctx.res, 403, { error: 'Tautan reset tidak valid untuk mereset password.' });
  }

  const user = await db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(authUser.id);
  if (!user) return sendJSON(ctx.res, 403, { error: 'Akun tidak terdaftar di sistem ini' });

  const { error } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, { password: String(new_password) });
  if (error) return sendJSON(ctx.res, 500, { error: 'Gagal mengubah password: ' + error.message });

  audit(user, 'UPDATE', 'user', user.id, 'Reset password via lupa password', ctx.ip);
  sendJSON(ctx.res, 200, { ok: true });
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
  uploadPhotoHandler, getPhotoHandler,
  providersHandler, googleSessionHandler, forgotPasswordHandler, resetPasswordHandler
};
