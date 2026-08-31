const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const PORT = 3000;
let server = null;

function portInUse() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(true));
    s.once('listening', () => { s.close(() => resolve(false)); });
    s.listen(PORT);
  });
}

function httpUp() {
  return new Promise((resolve) => {
    const req = http.get({ host: 'localhost', port: PORT, path: '/api/public/settings', timeout: 1500 }, (res) => {
      res.resume(); resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitPortFree(ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) { if (!(await portInUse())) return; await new Promise((r) => setTimeout(r, 200)); }
}

async function waitHttpUp(ms = 10000) {
  const start = Date.now();
  while (Date.now() - start < ms) { if (await httpUp()) return; await new Promise((r) => setTimeout(r, 200)); }
}

function wipeDb() {
  // Database is Supabase (PostgreSQL), not SQLite. Reset = truncate all tables,
  // delete Supabase auth users, clean uploads, then reseed. reset_db.js does all of it.
  execFileSync(process.execPath, ['reset_db.js'], { cwd: ROOT, stdio: 'inherit' });
}

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, ['backend/server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => reject(new Error('server start timeout: ' + out)), 15000);
    server.stdout.on('data', (d) => { out += d.toString(); });
    server.stderr.on('data', (d) => { out += d.toString(); });
    server.on('exit', (code) => { if (!out.includes('Server berjalan')) { clearTimeout(timer); reject(new Error('server exited early: ' + out)); } });
    (async () => {
      await waitHttpUp();
      clearTimeout(timer);
      if (await httpUp()) resolve(); else reject(new Error('server not responding: ' + out));
    })();
  });
}

function stopServer() {
  return new Promise(async (resolve) => {
    if (!server) { await waitPortFree(); return resolve(); }
    const s = server; server = null;
    s.on('exit', () => {});
    try { s.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { s.kill('SIGKILL'); } catch {} }, 2000);
    await waitPortFree();
    resolve();
  });
}

function runSuite(cmd, args) {
  try {
    const out = execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') + e.message };
  }
}

function extractResult(out) {
  const m = out.match(/RESULT:\s*(\d+)\s*passed,\s*(\d+)\s*failed/i) || out.match(/(\d+)\s*passed,\s*(\d+)\s*failed/i);
  return m ? { pass: Number(m[1]), fail: Number(m[2]) } : null;
}

(async () => {
  const suites = [
    { name: 'API (27)', cmd: 'powershell', args: ['-ExecutionPolicy', 'Bypass', '-File', 'test_api.ps1'], resetBefore: true },
    { name: 'Browser pages (32)', cmd: process.execPath, args: ['test_browser.js'], resetBefore: false },
    { name: 'Finance module (9)', cmd: process.execPath, args: ['test_finance.js'], resetBefore: true },
    { name: 'Rupiah inputs (8)', cmd: process.execPath, args: ['test_rupiah.js'], resetBefore: false },
    { name: 'Invoice sync (13)', cmd: process.execPath, args: ['test_invoice_sync.js'], resetBefore: true },
    { name: 'Lifecycle flow (11)', cmd: process.execPath, args: ['test_flow.js'], resetBefore: true },
    { name: 'Portal features (10)', cmd: process.execPath, args: ['test_newfeatures.js'], resetBefore: true },
    { name: 'New features (30)', cmd: process.execPath, args: ['test_features2.js'], resetBefore: true },
    { name: 'Visual audit (11)', cmd: process.execPath, args: ['visual_audit.js'], resetBefore: true }
  ];

  const summary = [];
  for (const s of suites) {
    if (s.resetBefore) { await stopServer(); wipeDb(); await startServer(); }
    else if (!server) { await startServer(); }
    if (!(await httpUp())) { console.log(`  !! server not up before ${s.name}, retrying start`); await stopServer(); await startServer(); }
    console.log(`\n########## SUITE: ${s.name} ##########`);
    const r = runSuite(s.cmd, s.args);
    const res = extractResult(r.out);
    if (res) {
      console.log(`  >> ${s.name}: ${res.pass} passed, ${res.fail} failed`);
      summary.push({ name: s.name, ...res });
    } else {
      console.log('  >> could not parse result; ok=' + r.ok);
      console.log(r.out.slice(-1500));
      summary.push({ name: s.name, pass: 0, fail: 1 });
    }
  }

  await stopServer();

  console.log('\n================ AUDIT SUMMARY ================');
  let tp = 0, tf = 0;
  for (const s of summary) { tp += s.pass; tf += s.fail; console.log(`  ${s.name}: ${s.pass} passed, ${s.fail} failed`); }
  console.log(`  TOTAL: ${tp} passed, ${tf} failed`);
  console.log('===============================================');
  process.exit(tf > 0 ? 1 : 0);
})().catch((e) => { console.error('AUDIT FATAL', e); process.exit(2); });
