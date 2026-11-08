// The desktop window has no native title bar: the top bar carries minimise / maximise / close and
// moves the window. In a normal browser there is no window to control, so nothing is drawn. Here a
// scripted stand-in for the native side is installed through the dev hook and driven with the real
// mouse. Optional: SHOT_DIR=<dir> saves screenshots.
// Run: node tests/e2e/titlebar.mjs
import { mkdirSync } from 'node:fs';
import { reporter, start } from './harness.mjs';

const t = await start({ width: 1360, height: 860 });
const { page } = t;
const r = reporter();
const { check } = r;
const SHOT_DIR = process.env.SHOT_DIR;
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });

const buttons = () => page.$$('[data-testid="window-buttons"] button');

check('no window buttons in a plain browser', (await buttons()).length === 0);

await page.evaluate(() => {
  const calls = [];
  let maximized = false;
  window.__winCalls = calls;
  window.__aframe.setWindowControls({
    minimize: async () => void calls.push('minimize'),
    toggleMaximize: async () => {
      calls.push('toggleMaximize');
      maximized = !maximized;
      window.dispatchEvent(new Event('resize'));
    },
    isMaximized: async () => maximized,
    close: async () => void calls.push('close'),
    startDrag: async () => void calls.push('startDrag'),
  });
});
await page.waitForSelector('[data-testid="window-buttons"]');
const calls = () => page.evaluate(() => window.__winCalls.slice());

check('three buttons appear once the window is ours', (await buttons()).length === 3);
const names = await page.$$eval('[data-testid="window-buttons"] button', (els) =>
  els.map((e) => e.getAttribute('aria-label')),
);
check(
  'they are named Minimise, Maximise, Close',
  names.join() === 'Minimise,Maximise,Close',
  names.join(),
);

const geo = await page.evaluate(() => {
  const bar = document.querySelector('.topbar').getBoundingClientRect();
  const close = document.querySelector('[data-testid="win-close"]').getBoundingClientRect();
  return {
    barRight: bar.right,
    barTop: bar.top,
    barH: bar.height,
    close: { right: close.right, top: close.top, height: close.height },
  };
});
check(
  'the buttons sit in the top-right corner, full bar height',
  Math.abs(geo.close.right - geo.barRight) < 1 &&
    Math.abs(geo.close.top - geo.barTop) < 1 &&
    Math.abs(geo.close.height - geo.barH) <= 1.5, // the bar has a 1px bottom border
  JSON.stringify(geo),
);

await page.click('[data-testid="win-minimize"]');
await page.click('[data-testid="win-maximize"]');
await page.waitForFunction(
  () =>
    document.querySelector('[data-testid="win-maximize"]').getAttribute('aria-label') === 'Restore',
);
check('maximise toggles and the button turns into Restore', true);
await page.click('[data-testid="win-maximize"]');
await page.waitForFunction(
  () =>
    document.querySelector('[data-testid="win-maximize"]').getAttribute('aria-label') ===
    'Maximise',
);
check('restore puts it back to Maximise', true);
await page.click('[data-testid="win-close"]');
check(
  'each button calls the matching window action',
  (await calls()).join() === 'minimize,toggleMaximize,toggleMaximize,close',
  (await calls()).join(),
);

// Dragging: only an empty stretch of the bar moves the window.
const spacer = await page.$eval('.topbar__spacer', (el) => {
  const b = el.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
await page.evaluate(() => (window.__winCalls.length = 0));
await page.mouse.move(spacer.x, spacer.y);
await page.mouse.down();
await page.mouse.up();
check(
  'pressing the empty bar starts a drag',
  (await calls()).join() === 'startDrag',
  (await calls()).join(),
);

await page.evaluate(() => (window.__winCalls.length = 0));
await page.mouse.move(spacer.x, spacer.y);
await page.mouse.down({ clickCount: 1 });
await page.mouse.up({ clickCount: 1 });
await page.mouse.down({ clickCount: 2 });
await page.mouse.up({ clickCount: 2 });
check(
  'double-pressing the empty bar maximises',
  (await calls()).includes('toggleMaximize'),
  (await calls()).join(),
);
await page.evaluate(() => window.__aframe.setWindowControls); // keep the maximise state tidy
await page.evaluate(() => (window.__winCalls.length = 0));

for (const sel of ['[data-testid="open-palette"]', '[data-testid="theme-toggle"]']) {
  const c = await page.$eval(sel, (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.click(c.x, c.y);
  await page.keyboard.press('Escape');
}
check(
  'pressing real buttons never starts a drag',
  !(await calls()).includes('startDrag'),
  (await calls()).join(),
);

const name = await page.$('[data-field="project-name"]');
if (name) {
  await page.evaluate(() => (window.__winCalls.length = 0));
  await name.click();
  await page.keyboard.type('x');
  check('typing in the project name does not drag', !(await calls()).includes('startDrag'));
  await page.keyboard.press('Escape');
}

// Keyboard: the buttons are reachable and show a focus ring.
await page.focus('[data-testid="win-minimize"]');
const ring = await page.$eval(
  '[data-testid="win-minimize"]',
  (el) => getComputedStyle(el).outlineStyle,
);
check('a focused window button shows a focus ring', ring !== 'none', ring);

for (const scheme of ['light', 'dark']) {
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  if (SHOT_DIR) {
    const bar = await page.$('.topbar');
    await bar?.screenshot({ path: `${SHOT_DIR}/titlebar-${scheme}.png` });
  }
}

check('no console errors', t.errors.length === 0, t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(
  r.failures === 0 ? '\nTitle bar checks passed.' : `\n${r.failures} title bar check(s) failed.`,
);
process.exit(r.failures === 0 ? 0 : 1);
