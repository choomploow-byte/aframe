// Captures a page for AFrame's "import a web page" (a prototype: see docs/10 for what it can and
// cannot carry). Loads a URL in headless Chrome, measures every element and its computed style, and
// writes <out>.json (the snapshot AFrame imports) and <out>.png (what the page looked like).
//
//   node scripts/capture-dom.mjs http://localhost:3000 [--out capture] [--width 1280] [--height 800]
//                                                      [--allow-remote]
//
// Needs Chrome or Chromium installed (CHROME_PATH to point at one). Only localhost addresses are
// captured unless --allow-remote is given: this reads a page's text and styles into a file.
import { existsSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--') && /^https?:\/\//.test(a));
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
if (!url) {
  console.error(
    'Usage: node scripts/capture-dom.mjs <http://localhost:PORT> [--out capture] [--width 1280] [--height 800]',
  );
  process.exit(2);
}
const host = new URL(url).hostname;
const local =
  host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
if (!local && !args.includes('--allow-remote')) {
  console.error(
    `Refusing to capture ${host}: pass --allow-remote if you mean to capture a page that is not on this computer.`,
  );
  process.exit(2);
}
const out = value('out', 'capture');
const width = Number(value('width', '1280'));
const height = Number(value('height', '800'));

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const chrome = CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error('No Chrome found. Install Chrome or set CHROME_PATH to its executable.');
  process.exit(2);
}

const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  const snapshot = await page.evaluate(() => {
    const STYLE_KEYS = [
      'display',
      'flexDirection',
      'flexWrap',
      'gap',
      'rowGap',
      'columnGap',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'justifyContent',
      'alignItems',
      'backgroundColor',
      'backgroundImage',
      'color',
      'fontFamily',
      'fontSize',
      'fontWeight',
      'lineHeight',
      'letterSpacing',
      'textAlign',
      'textTransform',
      'borderRadius',
      'borderTopLeftRadius',
      'borderTopRightRadius',
      'borderBottomRightRadius',
      'borderBottomLeftRadius',
      'borderTopWidth',
      'borderTopColor',
      'borderTopStyle',
      'boxShadow',
      'opacity',
    ];
    let count = 0;
    const walk = (el, depth) => {
      if (count > 1500 || depth > 24) return null;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return null;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      count += 1;
      const style = {};
      for (const k of STYLE_KEYS) style[k] = cs[k];
      const tag = el.tagName.toLowerCase();
      const attrs = {};
      for (const k of ['id', 'class', 'href', 'alt', 'placeholder', 'value']) {
        const v = el.getAttribute(k);
        if (v) attrs[k] = v.slice(0, 200);
      }
      const node = {
        tag,
        box: { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height },
        style,
        attrs,
        children: [],
      };
      const elementKids = [...el.children];
      const ownText = [...el.childNodes]
        .filter((c) => c.nodeType === 3)
        .map((c) => c.textContent ?? '')
        .join(' ')
        .trim();
      if (elementKids.length === 0) {
        if (ownText !== '') node.text = ownText.slice(0, 2000);
      } else {
        for (const c of elementKids) {
          const child = walk(c, depth + 1);
          if (child) node.children.push(child);
        }
        // Loose text between elements gets its own box so it is not lost.
        if (ownText !== '') {
          const range = document.createRange();
          for (const c of el.childNodes) {
            if (c.nodeType === 3 && (c.textContent ?? '').trim() !== '') {
              range.selectNodeContents(c);
              const b = range.getBoundingClientRect();
              if (b.width > 0 && b.height > 0) {
                node.children.push({
                  tag: 'span',
                  box: { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height },
                  style,
                  attrs: {},
                  children: [],
                  text: (c.textContent ?? '').trim().slice(0, 2000),
                });
              }
            }
          }
        }
      }
      return node;
    };
    const rootEl = document.body;
    const root = walk(rootEl, 0);
    return {
      url: location.href,
      title: document.title,
      width: document.documentElement.clientWidth,
      height: Math.max(document.documentElement.scrollHeight, rootEl.scrollHeight),
      root,
    };
  });
  if (!snapshot.root) throw new Error('The page has nothing visible to capture.');
  writeFileSync(`${out}.json`, JSON.stringify(snapshot));
  await page.screenshot({ path: `${out}.png`, fullPage: true });
  console.log(
    `Captured ${url}\n  ${out}.json  (import this in AFrame: Import > Web page)\n  ${out}.png   (what the page looked like)`,
  );
} finally {
  await browser.close();
}
