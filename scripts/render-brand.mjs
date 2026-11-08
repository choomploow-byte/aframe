// Renders the wordmark SVGs from scripts/gen-brand.mjs to the PNGs the app and the site use:
//   public/brand/wordmark-3d-on-{light,dark}.png, site/img/wordmark-3d-on-dark.png
// It does not touch the app icon, the favicon or src-tauri/icons: the mark is unchanged.
// Also writes .shots/brand-sheet.png, a contact sheet to look at.
// Run: node scripts/render-brand.mjs      (needs Chrome; CHROME_PATH if not in a standard place)
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../tests/e2e/harness.mjs';

const read = (p) => readFileSync(p, 'utf8');
const sizeOf = (svg) => {
  const m = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  return [Number(m[1]), Number(m[2])];
};

mkdirSync('public/brand', { recursive: true });
mkdirSync('.shots', { recursive: true });

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
try {
  /** One SVG as a transparent PNG `width` pixels wide. */
  const render = async (svgPath, width, outPath) => {
    const svg = read(svgPath);
    const [w, h] = sizeOf(svg);
    const height = Math.round((width * h) / w);
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(
      `<body style="margin:0;background:transparent"><div style="width:${width}px;height:${height}px">${svg.replace(/width="[\d.]+" height="[\d.]+"/, `width="${width}" height="${height}"`)}</div></body>`,
    );
    await page.screenshot({
      path: outPath,
      omitBackground: true,
      clip: { x: 0, y: 0, width, height },
    });
    await page.close();
  };
  await render('brand/wordmark-3d-on-light.svg', 2400, 'public/brand/wordmark-3d-on-light.png');
  await render('brand/wordmark-3d-on-dark.svg', 2400, 'public/brand/wordmark-3d-on-dark.png');
  copyFileSync('public/brand/wordmark-3d-on-dark.png', 'site/img/wordmark-3d-on-dark.png');

  // A contact sheet to look at: the icon next to the wordmarks on both surfaces.
  const sheet = await browser.newPage();
  await sheet.setViewport({ width: 1400, height: 760 });
  const inline = (p, w) => read(p).replace(/width="[\d.]+" height="[\d.]+"/, `width="${w}"`);
  await sheet.setContent(`<body style="margin:0;font:14px sans-serif">
    <div style="display:flex;gap:28px;align-items:flex-end;padding:24px;background:#faf9f5">
      ${inline('brand/icon-3d.svg', 160)}${inline('brand/icon-flat.svg', 96)}${inline('brand/wordmark-flat-purple.svg', 520)}
    </div>
    <div style="padding:24px;background:#faf9f5">${inline('brand/wordmark-3d-on-light.svg', 900)}</div>
    <div style="padding:24px;background:#1b1a19">${inline('brand/wordmark-3d-on-dark.svg', 900)}${inline('brand/wordmark-flat-cream.svg', 360)}</div></body>`);
  writeFileSync('.shots/brand-sheet.png', await sheet.screenshot({ type: 'png' }));
} finally {
  await browser.close();
}
console.log(
  'rendered public/brand/wordmark-*.png, site/img/wordmark-3d-on-dark.png, .shots/brand-sheet.png',
);
