// Phase 0 smoke test: boots the Vite dev server, opens the shell in system Chrome in light and
// dark colour schemes, checks the four regions render with the themed colours, and fails on any
// console error. Optional: SHOT_DIR=<dir> saves screenshots there.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('No Chrome found. Set CHROME_PATH.');
  process.exit(2);
}

const EXPECTED = {
  light: { bg: 'rgb(250, 249, 245)', text: 'rgb(31, 30, 29)' },
  dark: { bg: 'rgb(38, 38, 36)', text: 'rgb(245, 244, 238)' },
};

// A throwaway projects folder: this test must never touch a real one.
const home = mkdtempSync(join(tmpdir(), 'atelier-smoke-home-'));
process.env.ATELIER_HOME = home;
const server = await createServer({
  server: { port: 1431, strictPort: false, host: '127.0.0.1' },
  logLevel: 'error',
});
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('Vite did not report a URL');

const browser = await puppeteer.launch({ executablePath: chromePath, headless: true });
let failures = 0;
try {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewport({ width: 1360, height: 860 });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await page.goto(new URL('?nopersist', url).href, { waitUntil: 'networkidle0' });

    const info = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      const rect = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      };
      return {
        fontsLoaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
        bg: cs.backgroundColor,
        text: cs.color,
        font: cs.fontFamily,
        topbar: rect('.topbar'),
        left: rect('.panel--left'),
        canvas: rect('.canvas'),
        right: rect('.panel--right'),
      };
    });

    const checks = [
      [`${scheme}: background`, info.bg === EXPECTED[scheme].bg, info.bg],
      [`${scheme}: text colour`, info.text === EXPECTED[scheme].text, info.text],
      [`${scheme}: Inter font`, /Inter/.test(info.font), info.font],
      [
        `${scheme}: Fraunces (used by the sample's headings) actually loaded`,
        info.fontsLoaded.some((f) => f.includes('Fraunces')),
        `loaded: ${info.fontsLoaded.join(', ')}`,
      ],
      [`${scheme}: top bar 44px`, info.topbar?.h === 44, JSON.stringify(info.topbar)],
      [`${scheme}: left panel 264px`, info.left?.w === 264, JSON.stringify(info.left)],
      [`${scheme}: right panel 304px`, info.right?.w === 304, JSON.stringify(info.right)],
      [
        `${scheme}: canvas fills the rest`,
        (info.canvas?.w ?? 0) === 1360 - 568,
        JSON.stringify(info.canvas),
      ],
      [`${scheme}: no console errors`, errors.length === 0, errors.join(' | ')],
    ];
    for (const [name, ok, detail] of checks) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${detail}`}`);
      if (!ok) failures += 1;
    }

    if (process.env.SHOT_DIR) {
      mkdirSync(process.env.SHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.SHOT_DIR, `shell-${scheme}.png`) });
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
  rmSync(home, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
