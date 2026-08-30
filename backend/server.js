'use strict';
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { sendJSON, readBody, loadSecret } = require('./util');
const auth = require('./auth');
const { seed } = require('./seed');

const { matchRoute } = require('./router');

const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const PORT = Number(process.env.PORT) || 3000;

// ---------------- Router & tabel route: lihat backend/router.js ----------------

// ---------------- Static ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (!path.extname(rel)) rel = rel.replace(/\/?$/, '/index.html');
  const filePath = path.normalize(path.join(FRONTEND_DIR, rel));
  if (!filePath.startsWith(FRONTEND_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---------------- Server ----------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const ip = req.socket.remoteAddress || '';

  if (pathname.startsWith('/api/')) {
    const matched = matchRoute(req.method, pathname);
    if (!matched) return sendJSON(res, 404, { error: 'Endpoint tidak ditemukan' });
    const { route: r, params } = matched;
    try {
      const user = await auth.currentUser(req);
      if (r.roles !== null && !user) return sendJSON(res, 401, { error: 'Silakan login terlebih dahulu' });
      if (user && r.roles && r.roles.length && !r.roles.includes(user.role)) {
        return sendJSON(res, 403, { error: 'Anda tidak memiliki akses ke endpoint ini' });
      }
      const query = Object.fromEntries(url.searchParams.entries());
      let body = {};
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && (req.headers['content-type'] || '').includes('application/json')) {
        body = await readBody(req);
      }
      await r.handler({ req, res, user, params, query, body, ip });
    } catch (e) {
      console.error(`[API ERROR] ${req.method} ${pathname}:`, e);
      if (!res.headersSent) sendJSON(res, e.message === 'Payload too large' ? 413 : 500, { error: e.message === 'Invalid JSON body' ? 'Format request tidak valid' : 'Terjadi kesalahan pada server' });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, pathname);
});

(async () => {
  try {
    await loadSecret();
    const seeded = await seed();
    if (seeded) console.log('[SEED] Data demo berhasil dibuat di Supabase');
  } catch (e) {
    console.error('[STARTUP ERROR]', e);
  }
  server.listen(PORT, () => {
    console.log('====================================================');
    console.log('  Service Management System - Dent Tech');
    console.log('  Database: Supabase (PostgreSQL) · Auth: Supabase JWT');
    console.log(`  Server berjalan di http://localhost:${PORT}`);
    console.log('====================================================');
  });
})();
