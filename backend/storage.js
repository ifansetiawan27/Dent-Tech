'use strict';
// Abstraksi penyimpanan file berbasis Supabase Storage.
// Dipakai (bukan disk lokal) agar file persisten di serverless (Vercel) maupun lokal.
const { supabase } = require('./db');

const BUCKET = 'uploads';
let _bucketReady = null;

async function ensureBucket() {
  if (_bucketReady) return _bucketReady;
  _bucketReady = (async () => {
    try {
      const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
      if (error && !/already exists|sudah ada|409/i.test(error.message || '')) {
        console.error('[STORAGE] createBucket:', error.message);
      }
    } catch (e) {
      console.error('[STORAGE] createBucket exception:', e.message);
    }
  })();
  return _bucketReady;
}

async function saveFile(fileName, buffer, contentType) {
  await ensureBucket();
  const { error } = await supabase.storage.from(BUCKET).upload(fileName, buffer, {
    contentType: contentType || 'application/octet-stream',
    upsert: true
  });
  if (error) throw new Error('Gagal menyimpan file ke storage: ' + error.message);
}

async function readFile(fileName) {
  await ensureBucket();
  const { data, error } = await supabase.storage.from(BUCKET).download(fileName);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function deleteFile(fileName) {
  await ensureBucket();
  await supabase.storage.from(BUCKET).remove([fileName]);
}

module.exports = { saveFile, readFile, deleteFile, BUCKET };
