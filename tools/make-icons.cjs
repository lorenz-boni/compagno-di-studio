// Genera le icone PNG dell'app dai file SVG in icons/ (usa Playwright, già presente).
// Uso: node tools/make-icons.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'icons');
const jobs = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon.svg', 'icon-256.png', 256],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  ['icon-maskable.svg', 'apple-touch-icon.png', 180],
  ['favicon.svg', 'favicon-32.png', 32],
  ['favicon.svg', 'favicon-16.png', 16],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [src, out, size] of jobs) {
    const svg = fs.readFileSync(path.join(dir, src), 'utf8');
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(dir, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log(out, size);
  }
  await browser.close();
})();
