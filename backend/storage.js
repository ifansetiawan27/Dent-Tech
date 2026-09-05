'use strict';
// Abstraksi penyimpanan file berbasis Supabase Storage.
// Dipakai (bukan disk lokal) agar file persisten di serverless (Vercel) maupun lokal.
const { supabaseAdmin } = require('./db');

const BUCKET = 'uploads';
let bucketReady = null;

async function ensureBucket() {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { data } = await supabaseAdmin.storage.getBucket(BUCKET);
      if (data) return;
      const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
        public: false,
        fileSizeLimit: 10 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'application/pdf']
      });
      if (error && !/already exists|sudah ada|409/i.test(error.message || '')) {
        throw new Error('Gagal menyiapkan bucket storage: ' + error.message);
      }
    })().catch((e) => {
      bucketReady = null;
      throw e;
    });
  }
  return bucketReady;
}

async function saveFile(fileName, buffer, contentType) {
  await ensureBucket();
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(fileName, buffer, {
    contentType: contentType || 'application/octet-stream',
    upsert: true
  });
  if (error) throw new Error('Gagal menyimpan file ke storage: ' + error.message);
}

async function readFile(fileName) {
  await ensureBucket();
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(fileName);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function deleteFile(fileName) {
  await ensureBucket();
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([fileName]);
  if (error) throw new Error('Gagal menghapus file dari storage: ' + error.message);
}

module.exports = { saveFile, readFile, deleteFile, BUCKET };
