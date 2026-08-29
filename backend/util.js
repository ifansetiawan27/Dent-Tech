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

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pw, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const check = crypto.scryptSync(String(pw), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch {
    return false;
  }
}

function nextNumber(prefix) {
  const year = new Date().getFullYear();
  const key = `seq:${prefix}:${year}`;
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  const n = (row ? parseInt(row.value, 10) : 0) + 1;
  if (row) db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(n), key);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, String(n));
  return `${prefix}-${year}-${String(n).padStart(6, '0')}`;
}

function fileSig(fileId, ttlMinutes = 24 * 60) {
  const secret = getSecret();
  const exp = Date.now() + ttlMinutes * 60 * 1000;
  const sig = crypto.createHmac('sha256', secret).update(`${fileId}.${exp}`).digest('hex');
  return { exp, sig };
}

function verifyFileSig(fileId, exp, sig) {
  if (!exp || !sig) return false;
  if (Date.now() > Number(exp)) return false;
  const secret = getSecret();
  const expected = crypto.createHmac('sha256', secret).update(`${fileId}.${exp}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(String(sig), 'hex'));
  } catch {
    return false;
  }
}

function getSecret() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'app_secret'").get();
  if (row) return row.value;
  const secret = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO settings (key, value) VALUES ('app_secret', ?)").run(secret);
  return secret;
}

function getSetting(key, def = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : def;
}

function setSetting(key, value) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(value), key);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
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
  uid, now, localDate, localMonthKey, sendJSON, readBody, hashPassword, verifyPassword,
  nextNumber, fileSig, verifyFileSig, getSetting, setSetting, publicUser
};
