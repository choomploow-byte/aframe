// Renders the promo cards in brand/promo/ to PNG: a 1200x630 landscape card (link previews, social
// posts) and a 1080x1080 square. They are built from the real wordmark, real screenshots of the game
// templates (site/img) and the app's own icon set, so they stay on brand when those change.
// Run: node scripts/render-promo.mjs   (needs Chrome; set CHROME_PATH if it is not in a standard place)
/* global document, window */
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../tests/e2e/harness.mjs';

const root = new URL('..', import.meta.url);
const data = readFileSync(new URL('src/core/icon-data.ts', root), 'utf8');
const icons = {};
for (const m of data.matchAll(
  /\{ name: "([^"]+)".*?vb: \[(\d+), (\d+)\], (rule: 'evenodd', )?source: "[^"]+", d: "([^"]+)" \}/g,
)) {
  icons[m[1]] = { vb: [Number(m[2]), Number(m[3])], eo: Boolean(m[4]), d: m[5] };
}

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
try {
  for (const [format, w, h, out] of [
    ['landscape', 1200, 630, 'atelier-promo-landscape.png'],
    ['square', 1080, 1080, 'atelier-promo-square.png'],
  ]) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
    await page.evaluateOnNewDocument((i) => {
      window.__ICONS__ = i;
    }, icons);
    await page.goto(
      pathToFileURL(
        new URL('brand/promo/promo.html', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
      ).href + `?format=${format}`,
      {
        waitUntil: 'load',
      },
    );
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 400));
    const file = new URL(`brand/promo/${out}`, root).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    await page.screenshot({ path: file });
    console.log(`${out}  ${w * 2}x${h * 2}  ${Math.round(statSync(file).size / 1024)} KB`);
    await page.close();
  }
} finally {
  await browser.close();
}
