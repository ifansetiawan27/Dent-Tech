'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'frontend', 'index.html');
const iconDirectory = path.join(root, 'node_modules', 'lucide-static', 'icons');

let html = fs.readFileSync(htmlPath, 'utf8');
const iconPattern = /<i\s+data-lucide="([^"]+)"\s+class="([^"]*)"><\/i>/g;
const staticIconPattern = /<svg class="lucide lucide-([^\s"]+)\s+([^"]*)" aria-hidden="true"[^>]*>[\s\S]*?<\/svg>/g;
const usedIcons = new Set();
let count = 0;

function iconUse(iconName, className) {
  const iconPath = path.join(iconDirectory, `${iconName}.svg`);
  if (!fs.existsSync(iconPath)) throw new Error(`Lucide icon tidak ditemukan: ${iconName}`);
  usedIcons.add(iconName);
  count += 1;
  return `<svg class="lucide lucide-${iconName} ${className}" aria-hidden="true"><use href="/assets/landing-icons.svg?v=1#${iconName}"></use></svg>`;
}

html = html.replace(iconPattern, (match, iconName, className) => iconUse(iconName, className));
html = html.replace(staticIconPattern, (match, iconName, className) => iconUse(iconName, className));

if (usedIcons.size) {
  const symbols = [...usedIcons].sort().map((iconName) => {
    const source = fs.readFileSync(path.join(iconDirectory, `${iconName}.svg`), 'utf8');
    const svgMatch = source.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
    if (!svgMatch) throw new Error(`Lucide SVG tidak valid: ${iconName}`);
    return `<symbol id="${iconName}" viewBox="0 0 24 24">${svgMatch[1].trim()}</symbol>`;
  });
  const sprite = `<svg xmlns="http://www.w3.org/2000/svg"><defs>${symbols.join('')}</defs></svg>`;
  fs.writeFileSync(path.join(root, 'frontend', 'assets', 'landing-icons.svg'), sprite);
}

const mapPattern = /<svg viewBox="0 0 1000 368"[\s\S]*?<\/svg>/;
const mapMatch = html.match(mapPattern);
if (mapMatch) {
  const mapPath = path.join(root, 'frontend', 'assets', 'coverage-map.svg');
  let mapSvg = mapMatch[0]
    .replace(/ class="[^"]*"/, '')
    .replace(/ role="img"/, '')
    .replace(/ aria-label="[^"]*"/, '');
  fs.writeFileSync(mapPath, mapSvg);
  html = html.replace(mapPattern, '<img src="/assets/coverage-map.svg?v=1" alt="Peta area layanan Dent Tech.id di Indonesia" width="1000" height="368" loading="lazy" decoding="async" class="w-full h-auto select-none">');
}

if (count === 0 && !html.includes('class="lucide lucide-')) throw new Error('Tidak ada ikon landing yang ditemukan');
fs.writeFileSync(htmlPath, html);
console.log(count ? `Optimized ${count} landing icons into ${usedIcons.size} sprite symbols.` : 'Landing icons already optimized.');
if (mapMatch) console.log('Extracted coverage map to a lazy-loaded SVG asset.');
