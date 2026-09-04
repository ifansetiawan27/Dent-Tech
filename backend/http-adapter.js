'use strict';

const { Buffer } = require('buffer');

class WorkerResponseAdapter {
  constructor() {
    this.status = 200;
    this.headers = new Headers();
    this.body = null;
    this.headersSent = false;
  }

  writeHead(status, headers = {}) {
    this.status = status;
    for (const [name, value] of Object.entries(headers)) {
      if (value !== undefined) this.headers.set(name, String(value));
    }
    this.headersSent = true;
  }

  end(body = null) {
    this.body = body;
    this.headersSent = true;
  }

  toResponse() {
    const body = this.body === null || this.body === undefined
      ? null
      : Buffer.isBuffer(this.body) ? this.body : String(this.body);
    return new Response(body, { status: this.status, headers: this.headers });
  }
}

function requestAdapter(request) {
  const headers = {};
  request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  const url = new URL(request.url);
  return { method: request.method, url: url.pathname + url.search, headers };
}

async function readWorkerBody(request, limitBytes = 20 * 1024 * 1024) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > limitBytes) throw new Error('Payload too large');
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > limitBytes) throw new Error('Payload too large');
  if (!buffer.byteLength) return {};
  try { return JSON.parse(new TextDecoder().decode(buffer)); }
  catch { throw new Error('Invalid JSON body'); }
}

module.exports = { WorkerResponseAdapter, requestAdapter, readWorkerBody };
