'use strict';
const crypto = require('crypto');
const { db } = require('./db');

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const localMonthKey = (d = new Date()) => localDate(d).slice(0, 7);

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, limitBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function nextNumber(prefix) {
  const rows = await db.query('SELECT next_number($1) AS n', [prefix]);
  return rows[0].n;
}

let _secret = null;
async function loadSecret() {
  if (_secret) return _secret;
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'app_secret'").get();
  if (row && row.value) { _secret = row.value; return _secret; }
  const secret = crypto.randomBytes(32).toString('hex');
  await db.prepare("INSERT INTO settings (key, value) VALUES ('app_secret', ?) ON CONFLICT (key) DO NOTHING").run(secret);
  // Baca ulang: isolate lain bisa memenangkan INSERT, jadi nilai yang dipakai
  // harus yang benar-benar tersimpan agar signature konsisten antar isolate.
  const persisted = await db.prepare("SELECT value FROM settings WHERE key = 'app_secret'").get();
  _secret = (persisted && persisted.value) || secret;
  return _secret;
}

function requireSecret() {
  if (!_secret) throw new Error('App secret belum dimuat');
  return _secret;
}

function fileSig(fileId, ttlMinutes = 24 * 60) {
  const secret = requireSecret();
  const exp = Date.now() + ttlMinutes * 60 * 1000;
  const sig = crypto.createHmac('sha256', secret).update(`${fileId}.${exp}`).digest('hex');
  return { exp, sig };
}

function verifyFileSig(fileId, exp, sig) {
  if (!exp || !sig) return false;
  if (!Number.isFinite(Number(exp))) return false;
  if (Date.now() > Number(exp)) return false;
  const secret = requireSecret();
  const expected = crypto.createHmac('sha256', secret).update(`${fileId}.${exp}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(String(sig), 'hex'));
  } catch {
    return false;
  }
}

async function getSetting(key, def = '') {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : def;
}

async function setSetting(key, value) {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = ?')
    .run(key, String(value), String(value));
}

function publicUser(u) {
  if (!u) return null;
  const out = { id: u.id, email: u.email, name: u.name, role: u.role, phone: u.phone || '', customer_id: u.customer_id || null };
  if (u.photo_path) {
    const ref = 'avatar-' + u.id;
    const sig = fileSig(ref);
    out.photo_url = `/api/auth/photo?id=${ref}&exp=${sig.exp}&sig=${sig.sig}`;
  }
  return out;
}

module.exports = {
  uid, now, localDate, localMonthKey, sendJSON, readBody,
  nextNumber, loadSecret, fileSig, verifyFileSig, getSetting, setSetting, publicUser
};
