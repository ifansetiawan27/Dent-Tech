import { createClient } from '@supabase/supabase-js';
import backendRouter from './backend/router.js';
import backendAuth from './backend/auth.js';
import backendDb from './backend/db.js';
import backendRuntime from './backend/runtime.js';
import backendUtil from './backend/util.js';
import httpAdapter from './backend/http-adapter.js';

const { matchRoute } = backendRouter;
const { currentUser } = backendAuth;
const { createWorkerDbClient } = backendDb;
const { runWithRuntime, flushTasks } = backendRuntime;
const { loadSecret } = backendUtil;
const { WorkerResponseAdapter, requestAdapter, readWorkerBody } = httpAdapter;

const JSON_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const REQUIRED_SECRETS = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'];

// Google Analytics 4 — disisipkan di setiap halaman HTML yang dilayani Worker
// (tanpa mengubah file konten apa pun).
const GA_TRACKING_ID = 'G-YD7Y9VZQLQ';
const GA_SNIPPET = `<!-- Google Analytics 4 -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_TRACKING_ID}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_TRACKING_ID}');
</script>`;

function isHtmlResponse(res) {
  return (res.headers.get('content-type') || '').includes('text/html');
}

async function serveAsset(request, env) {
  const res = await env.ASSETS.fetch(request);
  if (!res || !res.ok || request.method !== 'GET' || !isHtmlResponse(res)) return res;
  const text = await res.text();
  const injected = /<\/head>/i.test(text)
    ? text.replace(/<\/head>/i, GA_SNIPPET + '</head>')
    : (/<\/body>/i.test(text) ? text.replace(/<\/body>/i, GA_SNIPPET + '</body>') : text + GA_SNIPPET);
  const headers = new Headers(res.headers);
  // Body di-decode oleh text(); header encoding/length lama tidak lagi valid.
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');
  headers.set('Content-Length', String(new TextEncoder().encode(injected).length));
  return new Response(injected, { status: res.status, statusText: res.statusText, headers });
}

function json(status, payload) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

function withSecurityHeaders(response, api = false) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(self), geolocation=(), microphone=()');
  headers.set('X-Frame-Options', 'DENY');
  if (api) headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function handleApi(request, env, executionCtx) {
  for (const name of REQUIRED_SECRETS) if (!env[name]) return json(503, { error: `Worker secret ${name} belum dikonfigurasi` });
  if (!env.HYPERDRIVE?.connectionString) return json(503, { error: 'Cloudflare Hyperdrive belum dikonfigurasi' });

  const url = new URL(request.url);
  const matched = matchRoute(request.method, url.pathname);
  if (!matched) return json(404, { error: 'Endpoint tidak ditemukan' });

  const client = await createWorkerDbClient(env.HYPERDRIVE.connectionString);
  const runtime = {
    env,
    dbClient: client,
    executionCtx,
    pendingTasks: [],
    supabaseAdmin: createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })
  };
  let backgroundScheduled = false;
  const finishBackground = () => runWithRuntime(runtime, flushTasks).catch(() => {}).then(() => client.end().catch(() => {}));

  try {
    return await runWithRuntime(runtime, async () => {
      await loadSecret();
      const req = requestAdapter(request);
      const res = new WorkerResponseAdapter();
      const { route, params } = matched;
      const user = await currentUser(req);
      if (route.roles !== null && !user) return json(401, { error: 'Silakan login terlebih dahulu' });
      if (user && route.roles?.length && !route.roles.includes(user.role)) return json(403, { error: 'Anda tidak memiliki akses ke endpoint ini' });

      let body = {};
      if (JSON_METHODS.has(request.method) && (request.headers.get('content-type') || '').includes('application/json')) {
        body = await readWorkerBody(request);
      }
      const query = Object.fromEntries(url.searchParams.entries());
      const ip = request.headers.get('CF-Connecting-IP') || '';
      await route.handler({ req, res, user, params, query, body, ip, executionCtx, runtimeEnv: env });
      // Respons dikirim segera; task sekunder (notify/audit/timeline) di-flush
      // lewat waitUntil agar tidak menambah latency, lalu koneksi DB ditutup.
      if (executionCtx?.waitUntil) {
        backgroundScheduled = true;
        executionCtx.waitUntil(finishBackground());
      } else {
        await finishBackground();
      }
      return res.toResponse();
    });
  } catch (error) {
    console.error(`[WORKER API ERROR] ${request.method} ${url.pathname}:`, error?.message || error);
    const status = error?.message === 'Payload too large' ? 413 : 500;
    return json(status, { error: error?.message === 'Invalid JSON body' ? 'Format request tidak valid' : 'Terjadi kesalahan pada server' });
  } finally {
    if (!backgroundScheduled) {
      await runWithRuntime(runtime, flushTasks).catch(() => {});
      await client.end().catch(() => {});
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return withSecurityHeaders(await handleApi(request, env, ctx), true);
    if (!['GET', 'HEAD'].includes(request.method)) return withSecurityHeaders(new Response(null, { status: 405 }));
    return withSecurityHeaders(await serveAsset(request, env));
  }
};
