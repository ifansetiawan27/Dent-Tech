'use strict';
const { Pool, types } = require('pg');
const { createClient } = require('@supabase/supabase-js');

// COUNT/SUM di Postgres menghasilkan bigint (OID 20) yang defaultnya
// dikembalikan sebagai string oleh node-postgres; konversi ke number.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

// File disimpan di Supabase Storage (lihat storage.js), bukan disk lokal,
// agar persisten di serverless (Vercel) maupun lokal.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY || !DATABASE_URL) {
  throw new Error('SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, dan DATABASE_URL wajib diatur di .env');
}

// Client admin tidak boleh pernah dipakai untuk signIn user. signIn mengubah Authorization
// client dan dapat membuat operasi Storage berikutnya terkena RLS sebagai user biasa.
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

function createAuthClient() {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.on('error', (e) => console.error('[PG POOL ERROR]', e.message));

function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i));
}

function prepareWith(executor, sql) {
  const pgSql = toPgSql(sql);
  return {
    get: async (...params) => (await executor.query(pgSql, params)).rows[0],
    all: async (...params) => (await executor.query(pgSql, params)).rows,
    run: async (...params) => {
      const r = await executor.query(pgSql, params);
      return { changes: r.rowCount };
    }
  };
}

function prepare(sql) {
  return prepareWith(pool, sql);
}

async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx = {
      prepare: (sql) => prepareWith(client, sql),
      query: async (sql, params = []) => (await client.query(sql, params)).rows
    };
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

const db = {
  prepare,
  transaction,
  query: async (sql, params = []) => (await pool.query(sql, params)).rows
};

module.exports = { db, supabaseAdmin, createAuthClient };
