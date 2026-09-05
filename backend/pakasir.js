'use strict';

const { getEnv } = require('./runtime');

const BASE_URL = 'https://app.pakasir.com/api';
const DEFAULT_TIMEOUT_MS = 10000;

class PakasirError extends Error {
  constructor(message, code = 'PAKASIR_ERROR', status = 502) {
    super(message);
    this.name = 'PakasirError';
    this.code = code;
    this.status = status;
  }
}

function config() {
  const apiKey = getEnv('PAKASIR_API_KEY');
  if (!apiKey) throw new PakasirError('Layanan pembayaran belum dikonfigurasi', 'PAYMENT_SERVICE_UNAVAILABLE', 503);
  return { apiKey, project: getEnv('PAKASIR_PROJECT', 'dent-tech') };
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new PakasirError(`${field} tidak valid`, 'INVALID_PAYMENT_DATA', 400);
  return number;
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new PakasirError('Respons layanan pembayaran tidak valid', 'PAYMENT_SERVICE_UNAVAILABLE', 502); }
    if (!response.ok) throw new PakasirError(`Layanan pembayaran menolak permintaan (${response.status})`, 'PAYMENT_SERVICE_UNAVAILABLE', response.status >= 500 ? 503 : 502);
    return data;
  } catch (error) {
    if (error instanceof PakasirError) throw error;
    if (error.name === 'AbortError') throw new PakasirError('Layanan pembayaran melewati batas waktu', 'PAYMENT_TIMEOUT', 504);
    throw new PakasirError('Layanan pembayaran tidak dapat dihubungi', 'PAYMENT_SERVICE_UNAVAILABLE', 503);
  } finally {
    clearTimeout(timer);
  }
}

function validateIdentity(value, expected) {
  if (!value || value.project !== expected.project || value.order_id !== expected.orderId || Number(value.amount) !== expected.amount) {
    throw new PakasirError('Identitas transaksi dari layanan pembayaran tidak sesuai', 'PAYMENT_RESPONSE_MISMATCH');
  }
}

async function createQris({ orderId, amount }) {
  const { apiKey, project } = config();
  const normalizedAmount = positiveInteger(amount, 'amount');
  const data = await request(`${BASE_URL}/transactioncreate/qris`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, order_id: String(orderId), amount: normalizedAmount, api_key: apiKey })
  });
  const payment = data && data.payment;
  validateIdentity(payment, { project, orderId: String(orderId), amount: normalizedAmount });
  if (!payment.payment_number || payment.payment_method !== 'qris') throw new PakasirError('Data QRIS dari layanan pembayaran tidak lengkap', 'PAYMENT_RESPONSE_MISMATCH');
  return payment;
}

async function transactionDetail({ orderId, amount, project: expectedProject }) {
  const { apiKey, project } = config();
  if (expectedProject && expectedProject !== project) throw new PakasirError('Project pembayaran tidak sesuai', 'PAYMENT_PROJECT_MISMATCH', 400);
  const normalizedAmount = positiveInteger(amount, 'amount');
  const query = new URLSearchParams({ project, amount: String(normalizedAmount), order_id: String(orderId), api_key: apiKey });
  const data = await request(`${BASE_URL}/transactiondetail?${query}`);
  const transaction = data && data.transaction;
  validateIdentity(transaction, { project, orderId: String(orderId), amount: normalizedAmount });
  if (typeof transaction.status !== 'string') throw new PakasirError('Status transaksi dari layanan pembayaran tidak valid', 'PAYMENT_RESPONSE_MISMATCH');
  return transaction;
}

module.exports = { createQris, transactionDetail, PakasirError };
