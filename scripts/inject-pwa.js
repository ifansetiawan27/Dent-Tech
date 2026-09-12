'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const PUBLIC_PAGES = new Set([
  'index.html', 'login.html', 'signup.html', 'forgot-password.html',
  'reset-password.html', 'auth-callback.html', 'artikel.html'
].map((f) => `frontend/${f}`));

const PWA_TAGS = [
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<meta name="theme-color" content="#2563eb">',
  '<link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<meta name="apple-mobile-web-app-title" content="Dent Tech.id">'
].join('\n  ');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && entry.name.endsWith('.html') ? [full] : [];
  });
}

const files = walk(path.join(root, 'frontend'));
let injected = 0;
let skipped = 0;

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const isPublic = PUBLIC_PAGES.has(rel);
  const bootTag = isPublic ? '\n  <script type="module" src="/utils/pwa-boot.js"></script>' : '';

  let html = fs.readFileSync(file, 'utf8');

  if (html.includes('manifest.webmanifest') && html.includes('pwa-boot')) {
    skipped += 1;
    continue;
  }

  if (!html.includes('<link rel="manifest"')) {
    html = html.replace('</head>', `  ${PWA_TAGS}${bootTag}\n</head>`);
  }

  if (isPublic && !html.includes('pwa-boot.js')) {
    html = html.replace('</head>', '  <script type="module" src="/utils/pwa-boot.js"></script>\n</head>');
  }

  fs.writeFileSync(file, html);
  injected += 1;
  console.log(`injected: ${rel}${isPublic ? ' (+boot)' : ''}`);
}

console.log(`\nSelesai. Diinjeksi: ${injected}, dilewati: ${skipped}`);