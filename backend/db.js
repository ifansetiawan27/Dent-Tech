'use strict';
const { Pool, types } = require('pg');
const { createClient } = require('@supabase/supabase-js');

// COUNT/SUM di Postgres menghasilkan bigint (OID 20) yang defaultnya
// dikembalikan sebagai string oleh node-postgres; konversi ke number.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

// File disimpan di Supabase Storage (lihat storage.js), bukan disk lokal,
// agar persisten di serverless (Vercel) maupun lokal.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !DATABASE_URL) {
  throw new Error('SUPABASE_URL, SUPABASE_SECRET_KEY, dan DATABASE_URL wajib diatur di .env');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.on('error', (e) => console.error('[PG POOL ERROR]', e.message));

function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i));
}

function prepare(sql) {
  const pgSql = toPgSql(sql);
  return {
    get: async (...params) => (await pool.query(pgSql, params)).rows[0],
    all: async (...params) => (await pool.query(pgSql, params)).rows,
    run: async (...params) => {
      const r = await pool.query(pgSql, params);
      return { changes: r.rowCount };
    }
  };
}

const db = {
  prepare,
  query: async (sql, params = []) => (await pool.query(sql, params)).rows
};

module.exports = { db, supabase };
