'use strict';
const { Pool, Client, types } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const { currentRuntime, getDbExecutor, getEnv } = require('./runtime');

// COUNT/SUM di Postgres menghasilkan bigint (OID 20) yang defaultnya
// dikembalikan sebagai string oleh node-postgres; konversi ke number.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

let localPool = null;
let localAdmin = null;

function requiredEnv(name) {
  const value = getEnv(name);
  if (!value) throw new Error(`${name} wajib dikonfigurasi`);
  return value;
}

function getLocalPool() {
  if (!localPool) {
    localPool = new Pool({ connectionString: requiredEnv('DATABASE_URL'), ssl: { rejectUnauthorized: false } });
    localPool.on('error', (e) => console.error('[PG POOL ERROR]', e.message));
  }
  return localPool;
}

function executor() {
  return getDbExecutor() || getLocalPool();
}

function getSupabaseAdmin() {
  const runtime = currentRuntime();
  if (runtime?.supabaseAdmin) return runtime.supabaseAdmin;
  if (!localAdmin) {
    localAdmin = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SECRET_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }
  return localAdmin;
}

// Proxy mempertahankan kompatibilitas seluruh handler tanpa menyimpan client lintas request Worker.
const supabaseAdmin = new Proxy({}, {
  get(_target, property) {
    const client = getSupabaseAdmin();
    const value = client[property];
    return typeof value === 'function' ? value.bind(client) : value;
  }
});

function createAuthClient() {
  return createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i));
}

function prepareWith(target, sql) {
  const pgSql = toPgSql(sql);
  return {
    get: async (...params) => (await target.query(pgSql, params)).rows[0],
    all: async (...params) => (await target.query(pgSql, params)).rows,
    run: async (...params) => {
      const result = await target.query(pgSql, params);
      return { changes: result.rowCount };
    }
  };
}

function prepare(sql) {
  return prepareWith(executor(), sql);
}

async function transaction(fn) {
  const requestClient = getDbExecutor();
  const client = requestClient || await getLocalPool().connect();
  try {
    await client.query('BEGIN');
    const tx = {
      prepare: (sql) => prepareWith(client, sql),
      query: async (sql, params = []) => (await client.query(sql, params)).rows
    };
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (!requestClient) client.release();
  }
}

const db = {
  prepare,
  transaction,
  query: async (sql, params = []) => (await executor().query(sql, params)).rows
};

async function createWorkerDbClient(connectionString) {
  if (!connectionString) throw new Error('Binding HYPERDRIVE wajib dikonfigurasi');
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

module.exports = { db, supabaseAdmin, getSupabaseAdmin, createAuthClient, createWorkerDbClient };
