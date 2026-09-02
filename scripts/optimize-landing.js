'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'frontend', 'index.html');
const iconDirectory = path.join(root, 'node_modules', 'lucide-static', 'icons');

let html = fs.readFileSync(htmlPath, 'utf8');
const iconPattern = /<i\s+data-lucide="([^"]+)"\s+class="([^"]*)"><\/i>/g;
let count = 0;

html = html.replace(iconPattern, (match, iconName, className) => {
  const iconPath = path.join(iconDirectory, `${iconName}.svg`);
  if (!fs.existsSync(iconPath)) throw new Error(`Lucide icon tidak ditemukan: ${iconName}`);
  const source = fs.readFileSync(iconPath, 'utf8');
  const svgMatch = source.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  if (!svgMatch) throw new Error(`Lucide SVG tidak valid: ${iconName}`);
  count += 1;
  return `<svg class="lucide lucide-${iconName} ${className}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgMatch[1].trim()}</svg>`;
});

// Repair output from the initial optimizer version, which could leave a nested SVG opener.
html = html.replace(/(<svg class="lucide[^>]*>)<svg\s+[\s\S]*?>\s*/g, '$1');

if (count === 0 && !html.includes('class="lucide lucide-')) throw new Error('Tidak ada ikon landing yang ditemukan');
fs.writeFileSync(htmlPath, html);
console.log(count ? `Converted ${count} landing icons to static SVG.` : 'Landing icons already optimized.');
