'use strict';
// Vercel catch-all serverless function: menangani semua request /api/*.
// Menggunakan kembali (reuse) tabel route + handler yang sama dengan server lokal,
// sehingga perilaku API identik di Vercel maupun lokal.
const { matchRoute } = require('../backend/router');
const auth = require('../backend/auth');
const { sendJSON, readBody, loadSecret } = require('../backend/util');
const { seed } = require('../backend/seed');

let _seedPromise = null;
function ensureSeed() {
  if (!_seedPromise) {
    _seedPromise = seed().catch((e) => {
      console.error('[SEED ERROR]', e.message);
      return false;
    });
  }
  return _seedPromise;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

module.exports = async function handler(req, res) {
  try {
    await loadSecret();
    await ensureSeed();

    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    const matched = matchRoute(req.method, pathname);
    if (!matched) return sendJSON(res, 404, { error: 'Endpoint tidak ditemukan' });
    const { route: r, params } = matched;

    const user = await auth.currentUser(req);
    if (r.roles !== null && !user) return sendJSON(res, 401, { error: 'Silakan login terlebih dahulu' });
    if (user && r.roles && r.roles.length && !r.roles.includes(user.role)) {
      return sendJSON(res, 403, { error: 'Anda tidak memiliki akses ke endpoint ini' });
    }

    const query = Object.fromEntries(url.searchParams.entries());

    let body = {};
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (req.body !== undefined && req.body !== null) {
        body = typeof req.body === 'string' ? safeParse(req.body) : req.body;
      } else if ((req.headers['content-type'] || '').includes('application/json')) {
        body = await readBody(req);
      }
    }

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';

    await r.handler({ req, res, user, params, query, body, ip });
  } catch (e) {
    console.error('[API ERROR]', req.method, req.url, e);
    if (!res.headersSent) {
      const code = e.message === 'Payload too large' ? 413 : 500;
      const msg = e.message === 'Invalid JSON body' ? 'Format request tidak valid' : 'Terjadi kesalahan pada server';
      sendJSON(res, code, { error: msg });
    }
  }
};
