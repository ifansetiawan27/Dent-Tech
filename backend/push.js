'use strict';
// Web Push sender (RFC 8030 + RFC 8291 aes128gcm + RFC 8292 VAPID) tanpa
// dependency eksternal — berjalan di Node (crypto) maupun Cloudflare Workers
// (WebCrypto). Semua notifikasi dikirim saat aplikasi dalam keadaan tertutup;
// subscription hanya tersedia untuk user yang masih login.
//
// Deteksi runtime: di Node, global `crypto` adalah WebCrypto (ada `subtle`,
// tanpa API node). Modul `require('crypto')` Node TIDAK punya `subtle`.
// Jadi: punya subtle → WebCrypto path; tidak → Node crypto path.

const { db } = require('./db');
const { getEnv, trackTask } = require('./runtime');

function hasSubtle() {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}

// ---------- VAPID keys ----------
// Format (standar web-push library):
//   VAPID_PUBLIC_KEY  = raw uncompressed point P-256 (65 byte) base64url
//   VAPID_PRIVATE_KEY = raw scalar d (32 byte) base64url
const VAPID_SUBJECT = 'mailto:support@denttech.id';

function vapidKeys() {
  const publicKey = getEnv('VAPID_PUBLIC_KEY', '');
  const privateKey = getEnv('VAPID_PRIVATE_KEY', '');
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey };
}

// ---------- Base64url helpers ----------
function b64urlToBytes(b64) {
  const normalized = b64.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(padded, 'base64'));
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  if (typeof Buffer !== 'undefined') return Buffer.from(bin, 'binary').toString('base64url');
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Muat private key VAPID (raw 32-byte scalar) menjadi key object siap tanda tangan.
// JWK EC private menyertakan x,y agar diterima Node WebCrypto maupun Workers.
async function vapidPrivateKeyObject(privateKey, publicKey) {
  const d = b64urlToBytes(privateKey);
  const pubBytes = b64urlToBytes(publicKey);
  if (d.length !== 32) throw new Error('VAPID_PRIVATE_KEY harus 32 byte scalar base64url');
  if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) throw new Error('VAPID_PUBLIC_KEY harus raw point 65 byte');
  const jwk = {
    kty: 'EC', crv: 'P-256',
    d: bytesToB64url(d),
    x: bytesToB64url(pubBytes.slice(1, 33)),
    y: bytesToB64url(pubBytes.slice(33))
  };
  if (!hasSubtle()) {
    const { createPrivateKey } = require('crypto');
    return createPrivateKey({ key: jwk, format: 'jwk' });
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

// ---------- VAPID JWT (ES256) ----------
async function vapidJwt(audience, publicKey, privateKey) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT
  };
  const enc = (obj) => bytesToB64url(new TextEncoder().encode(JSON.stringify(obj)));
  const signingInput = enc(header) + '.' + enc(payload);

  const key = await vapidPrivateKeyObject(privateKey, publicKey);
  let sig;
  if (!hasSubtle()) {
    const { sign } = require('crypto');
    const raw = sign(null, Buffer.from(signingInput), key);
    // ES256 raw signature: r (32) || s (32)
    sig = new Uint8Array(64);
    sig.set(raw.slice(0, 32), 0);
    sig.set(raw.slice(32, 64), 32);
  } else {
    // WebCrypto — signature sudah IEEE P1363 (r||s)
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput)));
    sig = raw;
  }
  return signingInput + '.' + bytesToB64url(sig);
}

// ---------- ECDH key pair (agreement + public key transport) ----------
async function generateEphemeralKeys() {
  if (!hasSubtle()) {
    const { generateKeyPairSync } = require('crypto');
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    // Export raw public key: DER SPKI terakhir 65 byte (0x04 || X || Y)
    const spki = publicKey.export({ type: 'spki', format: 'der' });
    const raw = new Uint8Array(spki.slice(spki.length - 65));
    return { privateKeyRaw: privateKey.export({ type: 'pkcs8', format: 'der' }), publicKeyRaw: raw };
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return { privateKeyRaw: pkcs8, publicKeyRaw: raw };
}

async function deriveBits(privateKeyRaw, publicKeyRaw, length) {
  if (!hasSubtle()) {
    const { createPublicKey, createPrivateKey, diffieHellman } = require('crypto');
    const priv = createPrivateKey({ key: Buffer.from(privateKeyRaw), format: 'der', type: 'pkcs8' });
    const spkiPrefix = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
    const pub = createPublicKey({ key: Buffer.concat([spkiPrefix, Buffer.from(publicKeyRaw)]), format: 'der', type: 'spki' });
    return new Uint8Array(diffieHellman({ privateKey: priv, publicKey: pub }).subarray(0, length));
  }
  const priv = await crypto.subtle.importKey('pkcs8', privateKeyRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const pub = await crypto.subtle.importKey('raw', publicKeyRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, priv, length * 8));
}

async function hkdf(ikm, salt, info, length) {
  if (!hasSubtle()) {
    const { hkdfSync } = require('crypto');
    return new Uint8Array(hkdfSync('sha256', ikm, salt, info, length));
  }
  const algo = { name: 'HKDF', hash: 'SHA-256', salt, info };
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(algo, key, length * 8));
}

async function aesGcmEncrypt(keyBytes, nonce, plaintext) {
  if (!hasSubtle()) {
    const { createCipheriv } = require('crypto');
    const cipher = createCipheriv('aes-128-gcm', keyBytes, nonce);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { ciphertext: new Uint8Array(Buffer.concat([ct, tag])) };
  }
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext));
  return { ciphertext: ct };
}

// ---------- RFC 8291 aes128gcm payload ----------
async function encryptPayload(payload, subscription) {
  const asPub = b64urlToBytes(subscription.p256dh);
  const authSecret = b64urlToBytes(subscription.auth);

  const { privateKeyRaw, publicKeyRaw } = await generateEphemeralKeys();
  const ecdhSecret = await deriveBits(privateKeyRaw, asPub, 32);

  // IKM sesuai RFC 8291: HKDF(ECDH, salt=auth, info="WebPush: info"||0x00||asPub||0x00).
  // Info dibangun per-byte (bukan string) agar byte >0x7F tidak berubah via UTF-8.
  const ikmInfo = new Uint8Array(13 + 1 + asPub.length + 1);
  ikmInfo.set(new TextEncoder().encode('WebPush: info'), 0);
  ikmInfo[13] = 0x00;
  ikmInfo.set(asPub, 14);
  ikmInfo[ikmInfo.length - 1] = 0x00;
  const ikm = await hkdf(ecdhSecret, authSecret, ikmInfo, 32);

  const salt = new Uint8Array(16);
  if (!hasSubtle()) {
    const { randomBytes } = require('crypto');
    salt.set(randomBytes(16));
  } else {
    crypto.getRandomValues(salt);
  }
  const cek = await hkdf(ikm, salt, new TextEncoder().encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdf(ikm, salt, new TextEncoder().encode('Content-Encoding: nonce\x00'), 12);

  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const { ciphertext } = await aesGcmEncrypt(cek, nonce, plaintext);

  // aes128gcm body: salt(16) | rs(4) | idlen(1) | keyid(65) | ciphertext
  const record = new Uint8Array(21 + 65 + ciphertext.length);
  record.set(salt, 0);
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  record.set(rs, 16);
  record[20] = 65; // panjang public key ephemeral
  record.set(publicKeyRaw, 21);
  record.set(ciphertext, 21 + 65);
  return record;
}

// ---------- Kirim ke endpoint ----------
async function sendToSubscription(subscription, payload) {
  const keys = vapidKeys();
  if (!keys) return { sent: false, reason: 'no-vapid-keys' };

  const endpointUrl = new URL(subscription.endpoint);
  const audience = endpointUrl.origin;
  const token = await vapidJwt(audience, keys.publicKey, keys.privateKey);
  const body = await encryptPayload(payload, subscription);

  const headers = {
    'TTL': '2419200',
    'Urgency': 'high',
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    // RFC 8292: key publik disertakan di Authorization (t=...;k=...) —
    // FCM menolak format lama `vapid <token>` + Crypto-Key terpisah.
    'Authorization': `vapid t=${token}; k=${keys.publicKey}`
  };

  let res;
  if (typeof fetch === 'function') {
    res = await fetch(subscription.endpoint, { method: 'POST', headers, body });
  } else {
    throw new Error('fetch tidak tersedia di runtime ini');
  }

  if (res.status === 404 || res.status === 410) {
    // Subscription tidak valid lagi — hapus
    await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(subscription.endpoint);
    return { sent: false, reason: 'unsubscribed', status: res.status };
  }
  if (!res.ok) {
    return { sent: false, reason: 'endpoint-error', status: res.status };
  }
  return { sent: true, status: res.status };
}

// ---------- API untuk handler ----------
function publicVapidKey() {
  const keys = vapidKeys();
  return keys ? keys.publicKey : null;
}

// Kirim push ke SEMUA subscription milik kumpulan user.
async function pushToUsers(userIds, payload) {
  if (!Array.isArray(userIds) || !userIds.length) return { sent: 0 };
  const keys = vapidKeys();
  if (!keys) return { sent: 0 };
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return { sent: 0 };
  const placeholders = unique.map(() => '?').join(',');
  const subs = await db.prepare(`SELECT * FROM push_subscriptions WHERE user_id IN (${placeholders})`).all(...unique);
  if (!subs.length) return { sent: 0 };
  let sent = 0;
  for (const sub of subs) {
    try {
      const result = await sendToSubscription(sub, payload);
      if (result.sent) sent++;
    } catch (e) {
      console.error(`[push] endpoint gagal: ${e?.message || e}`);
    }
  }
  return { sent };
}

// Kirim sebagai background task (menyertai notify() yang sudah async fire-and-forget).
function pushNotify(userIds, payload) {
  return trackTask(pushToUsers(userIds, payload), 'push');
}

module.exports = { publicVapidKey, pushToUsers, pushNotify, vapidKeys, encryptPayload };
