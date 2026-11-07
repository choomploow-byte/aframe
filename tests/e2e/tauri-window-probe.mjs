// Connects to a running `tauri dev` window through the WebView2 remote-debugging port and checks
// the real desktop webview renders the shell. Start the app first with:
//   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'; npm run tauri:dev
// Windows only (WebView2). Optional: SHOT_DIR=<dir> saves a screenshot.
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const port = process.env.DEBUG_PORT ?? '9222';
const browserURL = `http://127.0.0.1:${port}`;
const deadline = Date.now() + Number(process.env.WAIT_MS ?? 240000);

let browser;
for (;;) {
  try {
    browser = await puppeteer.connect({ browserURL, defaultViewport: null });
    break;
  } catch {
    if (Date.now() > deadline) {
      console.error(`FAIL  could not connect to ${browserURL}`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const pages = await browser.pages();
const page = pages.find((p) => p.url().includes('127.0.0.1:1420') || p.url().includes('tauri'));
if (!page) {
  console.error('FAIL  no app page found; pages:', pages.map((p) => p.url()).join(', '));
  process.exit(1);
}
// Reload with listeners attached so CSP violations and load errors during startup are captured.
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(String(e)));
await page.reload({ waitUntil: 'networkidle0' });
await page.waitForSelector('.shell', { timeout: 30000 });

const info = await page.evaluate(() => ({
  url: location.href,
  ua: navigator.userAgent,
  tauri: '__TAURI_INTERNALS__' in window,
  topbar: Math.round(document.querySelector('.topbar').getBoundingClientRect().height),
  headline: document.querySelector('.canvas__headline').textContent,
  bg: getComputedStyle(document.body).backgroundColor,
}));
console.log(JSON.stringify(info, null, 2));

const ok =
  info.tauri && info.topbar === 44 && info.headline === 'Design with your AI.' && !problems.length;
if (problems.length) console.error('console errors:', problems);
console.log(ok ? 'PASS  real Tauri window renders the shell' : 'FAIL  unexpected state');

if (process.env.SHOT_DIR) {
  await page.screenshot({ path: join(process.env.SHOT_DIR, 'tauri-window.png') });
}
await browser.disconnect();
process.exit(ok ? 0 : 1);
