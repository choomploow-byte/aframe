// Visual regression for the renderer and overlay: screenshots of the canvas compared with baseline
// PNGs via pixelmatch. Baselines are per platform (tests/e2e/baselines/<platform>/) because text
// anti-aliasing differs between operating systems; a missing baseline is created and reported.
// Refresh deliberately with UPDATE_BASELINES=1. Diffs of failures land in tests/e2e/__diff__/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { canvasBox, idByName, reporter, setViewport, settle, start } from './harness.mjs';

if (process.env.CDP_URL) {
  console.log(
    'visual: skipped when attached to a live window (the viewport size is not under test control).',
  );
  process.exit(0);
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_DIR = join(HERE, 'baselines', process.platform);
const DIFF_DIR = join(HERE, '__diff__');
const MAX_DIFF_RATIO = 0.005; // 0.5% of pixels
const r = reporter();

const t = await start();
const { page } = t;
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
await settle(page);

async function shot() {
  const box = await canvasBox(page);
  const buf = await page.screenshot({
    type: 'png',
    clip: { x: box.x, y: box.y, width: box.w, height: box.h },
  });
  return PNG.sync.read(Buffer.from(buf));
}

function compare(name, actual) {
  mkdirSync(BASE_DIR, { recursive: true });
  const file = join(BASE_DIR, `${name}.png`);
  if (!existsSync(file) || process.env.UPDATE_BASELINES) {
    writeFileSync(file, PNG.sync.write(actual));
    r.info(
      `baseline ${existsSync(file) ? 'written' : 'created'}`,
      `${process.platform}/${name}.png`,
    );
    return;
  }
  const expected = PNG.sync.read(readFileSync(file));
  if (expected.width !== actual.width || expected.height !== actual.height) {
    r.check(
      `${name}: same size as baseline`,
      false,
      `${actual.width}x${actual.height} vs ${expected.width}x${expected.height}`,
    );
    return;
  }
  const diff = new PNG({ width: actual.width, height: actual.height });
  const bad = pixelmatch(expected.data, actual.data, diff.data, actual.width, actual.height, {
    threshold: 0.1,
  });
  const ratio = bad / (actual.width * actual.height);
  if (ratio > MAX_DIFF_RATIO) {
    mkdirSync(DIFF_DIR, { recursive: true });
    writeFileSync(join(DIFF_DIR, `${name}.diff.png`), PNG.sync.write(diff));
    writeFileSync(join(DIFF_DIR, `${name}.actual.png`), PNG.sync.write(actual));
  }
  r.check(
    `${name}: matches baseline (${(ratio * 100).toFixed(3)}% pixels differ)`,
    ratio <= MAX_DIFF_RATIO,
    `${bad} px`,
  );
}

const setSelection = (ids) =>
  page
    .evaluate((x) => window.__atelier.store.getState().setSelection(x), ids)
    .then(() => settle(page));

// 1. Both artboards, fitted: layout, fonts, colours, fills, radii, strokes.
await page.evaluate(() => window.__atelier.canvas().fitAll());
await settle(page);
compare('sample-fit', await shot());

// 2. The hero at 100%: text rendering and spacing up close.
const hero = await idByName(page, 'Hero');
await setViewport(page, { zoom: 1, x: -150, y: -20 });
compare('hero-100', await shot());

// 3. The pricing board (the "needs work" design) with a card selected: overlay and handles.
const pro = await idByName(page, 'Plan - Pro');
await setViewport(page, { zoom: 1.4, x: -2150, y: 120 });
await setSelection([pro]);
compare('pricing-selected', await shot());
void hero;

// 4. Dark theme.
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await setSelection([]);
await page.evaluate(() => window.__atelier.canvas().fitAll());
await settle(page);
compare('sample-fit-dark', await shot());

r.check('no console errors', t.errors.length === 0, t.errors.slice(0, 2).join(' | '));
await t.close();
process.exit(r.failures === 0 ? 0 : 1);
