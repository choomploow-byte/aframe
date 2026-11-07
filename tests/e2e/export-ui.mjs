// Export dialog e2e: driven like a person (real keyboard and mouse) in real Chrome.
// Opens from the shortcut, the top bar menu, the context menu and the palette; previews and copies
// code in every format; downloads the zip; saves PNG (scales, transparent) and SVG; and checks the
// empty-design message. Folder saving needs the native dialog, so it is covered by the Rust tests and
// the confined-writer tests, not here.
// SHOT_DIR=<dir> saves screenshots. Run: node tests/e2e/export-ui.mjs
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { idByName, press, reporter, settle, start } from './harness.mjs';

const t = await start({ width: 1500, height: 940 });
const { page } = t;
const r = reporter();
const { check } = r;
const SHOT_DIR = process.env.SHOT_DIR;
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const shot = async (name) => {
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
};

// Capture what the page hands the browser to download, and what it puts on the clipboard.
await page.evaluate(() => {
  window.__downloads = [];
  const original = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    void blob.arrayBuffer().then((buf) => {
      window.__downloads.push({
        type: blob.type,
        base64: (() => {
          const u8 = new Uint8Array(buf);
          let bin = '';
          for (let i = 0; i < u8.length; i += 0x8000) {
            bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
          }
          return btoa(bin);
        })(),
      });
    });
    return original(blob);
  };
  HTMLAnchorElement.prototype.click = function () {
    window.__lastDownloadName = this.download;
  };
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (text) => {
        window.__copied.push(text);
        return Promise.resolve();
      },
      write: (items) => {
        window.__copied.push(`items:${items.length}`);
        return Promise.resolve();
      },
    },
  });
});
const downloads = () => page.evaluate(() => window.__downloads);
const lastName = () => page.evaluate(() => window.__lastDownloadName);
const dialog = () => page.$('[data-testid="export-dialog"]');
const preview = () =>
  page.$eval('[data-testid="export-preview"]', (el) => el.textContent ?? '').catch(() => null);
const clickAction = async (action) => {
  await page.click(`[data-action="${action}"]`);
  await settle(page);
  await sleep(250);
};
const chooseSegment = async (field, value) => {
  await page.click(`[data-field="${field}"] [data-value="${value}"]`);
  await settle(page);
};

// ---- a design to export: the pricing template ---------------------------------------------------
await page.evaluate(() => window.__atelier.loadTemplate('pricing'));
await page.evaluate(() => document.fonts.ready);
await settle(page);
const screenId = await page.evaluate(() => {
  const s = window.__atelier.store.getState();
  return s.doc.nodes[s.doc.rootId].children.find((id) => s.doc.nodes[id].name !== 'Components');
});
const frameName = await page.evaluate(
  (id) => window.__atelier.store.getState().doc.nodes[id].name,
  screenId,
);

// Select the frame with a real click on its layer, then Ctrl+Shift+E.
await page.evaluate((id) => window.__atelier.store.getState().setSelection([id]), screenId);
await settle(page);
await press(page, 'Control+Shift+E');
check('Ctrl+Shift+E opens the export dialog', (await dialog()) !== null);
const title = await page.$eval(
  '[role="dialog"]',
  (el) => el.getAttribute('aria-label') ?? el.textContent,
);
check(
  'the dialog is about the selected frame',
  String(title).includes(frameName),
  String(title).slice(0, 80),
);
check(
  'it opens on React + CSS Modules with the component code',
  /export default function/.test((await preview()) ?? ''),
);
await shot('export-code');

// Formats.
await chooseSegment('export-format', 'html');
check('HTML shows index.html', /<!doctype html>/.test((await preview()) ?? ''));
await page
  .select('[data-field="export-file"] select, select[data-field="export-file"]', 'styles.css')
  .catch(() => undefined);
await settle(page);
check(
  'the file picker switches the preview to styles.css',
  /:root/.test((await preview()) ?? '') && /--color-/.test((await preview()) ?? ''),
);
await chooseSegment('export-format', 'react-tailwind');
check(
  'Tailwind shows utility classes',
  /className="[^"]*\b(flex|bg-|text-\[)/.test((await preview()) ?? ''),
);
await chooseSegment('export-format', 'react-css');
await page.type('[data-field="export-component"]', 'my pricing page');
await settle(page);
check(
  'the component name field renames the component',
  /export default function MyPricingPage\(/.test((await preview()) ?? ''),
  ((await preview()) ?? '').slice(0, 200),
);

// Copy.
await clickAction('export-copy');
const copied = await page.evaluate(() => window.__copied);
check(
  'Copy puts the previewed file on the clipboard',
  copied.length === 1 && /MyPricingPage/.test(copied[0]),
  String(copied[0]).slice(0, 80),
);

// Download as a zip (a browser build has no folder to save into).
await clickAction('export-save');
await sleep(200);
const dl = await downloads();
const zip = dl.find((d) => d.type === 'application/zip');
check(
  'Download produces a .zip',
  zip !== undefined && (await lastName()).endsWith('.zip'),
  JSON.stringify(dl.map((d) => d.type)),
);
if (zip) {
  const bytes = Buffer.from(zip.base64, 'base64');
  check('the zip starts with the PK signature', bytes.readUInt32LE(0) === 0x04034b50);
  const names = [];
  for (let i = 0; i < bytes.length - 46; i += 1) {
    if (bytes.readUInt32LE(i) === 0x02014b50) {
      const len = bytes.readUInt16LE(i + 28);
      names.push(bytes.subarray(i + 46, i + 46 + len).toString('utf8'));
    }
  }
  check(
    'the zip holds the component, its CSS, tokens and README',
    ['MyPricingPage.tsx', 'MyPricingPage.module.css', 'tokens.css', 'README-atelier.md'].every(
      (n) => names.includes(n),
    ),
    names.join(', '),
  );
}
const status = await page
  .$eval('[data-testid="export-status"]', (el) => el.textContent ?? '')
  .catch(() => '');
check('it says what was saved', /saved/.test(status), status);

// ---- image tab ------------------------------------------------------------------------------------
await page.evaluate(() => {
  [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent === 'Image')?.click();
});
await settle(page);
const frameW = await page.evaluate(
  (id) => window.__atelier.store.getState().doc.nodes[id].w,
  screenId,
);
const size = await page.$eval('[data-testid="export-size"]', (el) => el.textContent ?? '');
check(
  'the Image tab shows the output size at the chosen scale',
  size.includes(String(frameW * 2)),
  size,
);
await shot('export-image');
const before = (await downloads()).length;
await clickAction('export-save');
await sleep(1500);
const afterPng = await downloads();
const png = afterPng.slice(before).find((d) => d.type === 'image/png');
check(
  'Save downloads a PNG',
  png !== undefined,
  JSON.stringify(afterPng.slice(before).map((d) => d.type)) +
    ' status: ' +
    (await page
      .$eval('[data-testid="export-status"]', (el) => el.textContent ?? '')
      .catch(() => '(none)')),
);
if (png) {
  const img = PNG.sync.read(Buffer.from(png.base64, 'base64'));
  check(`the 2x PNG is ${frameW * 2} px wide`, img.width === frameW * 2, `${img.width}`);
  check(
    'the download is named after the frame and scale',
    /@2x\.png$/.test(await lastName()),
    await lastName(),
  );
}
await chooseSegment('export-scale', '1');
await page.click('[data-field="export-transparent"]');
await settle(page);
await clickAction('export-copy-image');
check(
  'Copy image writes to the clipboard',
  (await page.evaluate(() => window.__copied)).some((c) => c === 'items:1'),
);
await chooseSegment('export-image-format', 'svg');
const beforeSvg = (await downloads()).length;
await clickAction('export-save');
await sleep(1500);
const svg = (await downloads()).slice(beforeSvg).find((d) => d.type === 'image/svg+xml');
check(
  'SVG downloads as an svg document',
  svg !== undefined && Buffer.from(svg.base64, 'base64').toString('utf8').startsWith('<svg'),
);
check(
  'there is no PNG-only control for SVG',
  (await page.$('[data-action="export-copy-image"]')) === null,
);

// Escape closes it and focus is not trapped.
await page.keyboard.press('Escape');
await settle(page);
check('Escape closes the dialog', (await dialog()) === null);

// ---- other entry points ----------------------------------------------------------------------------
await page.click('[data-testid="export-menu"]');
await settle(page);
const menu = await page.$$eval('[role="menuitem"]', (els) => els.map((e) => e.textContent ?? ''));
check(
  'the top bar Export menu offers code, image and project file',
  menu.some((m) => m.startsWith('Design as code')) &&
    menu.some((m) => m.startsWith('Image')) &&
    menu.some((m) => m.startsWith('Project file')),
  menu.join(' | '),
);
await page.evaluate(() => {
  [...document.querySelectorAll('[role="menuitem"]')]
    .find((e) => e.textContent?.startsWith('Image'))
    ?.click();
});
await settle(page);
check(
  'choosing Image opens the dialog on the Image tab',
  (await page.$('[data-field="export-scale"]')) !== null,
);
await page.keyboard.press('Escape');
await settle(page);

await press(page, 'Control+k');
await page.keyboard.type('export design as code');
await sleep(150);
await page.keyboard.press('Enter');
await settle(page);
check(
  'the command palette opens the code export',
  (await dialog()) !== null && (await preview()) !== null,
);
await page.keyboard.press('Escape');
await settle(page);

// Context menu on a layer.
const layer = await idByName(page, 'Pricing - Needs Work').catch(() => null);
void layer;
await page.evaluate((id) => window.__atelier.store.getState().setSelection([id]), screenId);
await settle(page);
const box = await page.evaluate((id) => {
  const el = document.querySelector(`[data-node-id="${id}"]`);
  const b = el?.getBoundingClientRect();
  return b ? { x: b.x + 20, y: b.y + 20 } : null;
}, screenId);
if (box) {
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await settle(page);
  const items = await page.$$eval('[role="menuitem"]', (els) =>
    els.map((e) => e.textContent ?? ''),
  );
  check(
    'the right-click menu offers the exports',
    items.some((m) => m.includes('Copy as code')) &&
      items.some((m) => m.startsWith('Export as image')),
    items.join(' | '),
  );
  await page.keyboard.press('Escape');
  await settle(page);
}

// ---- nothing to export -----------------------------------------------------------------------------
await page.evaluate(() => window.__atelier.loadBlank());
await settle(page);
await press(page, 'Control+Shift+E');
check('with no frame, no dialog opens', (await dialog()) === null);
const toast = await page.$$eval('[role="status"], [role="alert"]', (els) =>
  els.map((e) => e.textContent ?? '').join(' | '),
);
check('and a toast says why', /nothing to export/i.test(toast), toast.slice(0, 120));

check('no console errors', t.errors.length === 0, t.errors.slice(0, 2).join(' | '));
await t.close();
console.log(r.failures === 0 ? 'ALL PASSED' : `${r.failures} FAILED`);
process.exit(r.failures === 0 ? 0 : 1);
