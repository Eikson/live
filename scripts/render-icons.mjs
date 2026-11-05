// Erzeugt die PNG-Icons aus public/icon.svg mit dem ohnehin installierten Playwright-Chromium.
// Aufruf: npm run icons
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>.*?<\/title>/, '');

// Maskierbar: volle Fläche ohne Rundung, Motiv auf die sichere Zone (80 %) verkleinert.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#F5F0E8"/>
  <g transform="translate(51.2 51.2) scale(0.8)">${inner.replace(/<rect[^>]*\/>/, '')}</g>
</svg>`;
// Apple: ohne eigene Rundung, iOS rundet selbst.
const apple = svg.replace(/rx="112"/, 'rx="0"');

const targets = [
  { file: 'icon-192.png', size: 192, source: svg },
  { file: 'icon-512.png', size: 512, source: svg },
  { file: 'icon-maskable-512.png', size: 512, source: maskable },
  { file: 'apple-touch-icon.png', size: 180, source: apple },
];

const browser = await chromium.launch();
try {
  for (const { file, size, source } of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const html = `<html><body style="margin:0;background:transparent">${source.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`;
    await page.setContent(html);
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await writeFile(new URL(`../public/${file}`, import.meta.url), png);
    await page.close();
    console.log(`public/${file}`);
  }
} finally {
  await browser.close();
}
