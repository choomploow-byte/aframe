// Shared helpers for the browser tests: boots the Vite dev server, launches system Chrome, and
// offers small functions to read the store and drive the canvas like a user (real mouse and keyboard
// events through puppeteer, never by calling store actions, unless a test says so explicitly).
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, createServer, preview } from 'vite';
import puppeteer from 'puppeteer-core';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export function findChrome() {
  const path = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!path) {
    console.error('No Chrome found. Set CHROME_PATH.');
    process.exit(2);
  }
  return path;
}

/**
 * Starts everything. `close()` shuts it all down.
 * With CDP_URL=http://127.0.0.1:9222 it attaches to an already running `tauri dev` window
 * (WebView2 with --remote-debugging-port) instead of starting Vite and Chrome, so the same tests
 * can run against the real desktop webview.
 */
export async function start({ width = 1360, height = 860, persist = false } = {}) {
  const errors = [];
  // Every run gets a throwaway home, so no test can ever touch a real projects folder, even by
  // accident. `persist` boots the real app (projects, autosave, sync) against it; without it the
  // app stays in memory (`?nopersist`). Attached to a desktop window, its ATELIER_HOME is whatever
  // it was started with.
  const home = !process.env.CDP_URL ? mkdtempSync(join(tmpdir(), 'atelier-e2e-home-')) : undefined;
  if (home) process.env.ATELIER_HOME = home;
  if (process.env.CDP_URL) {
    const browser = await puppeteer.connect({
      browserURL: process.env.CDP_URL,
      defaultViewport: null,
    });
    const pages = await browser.pages();
    const page = pages.find((p) => p.url().includes('127.0.0.1:1420') || p.url().includes('tauri'));
    if (!page) throw new Error(`no app page at ${process.env.CDP_URL}`);
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.waitForFunction(() => window.__atelier !== undefined, { timeout: 30000 });
    if (persist) {
      // The real app, against the ATELIER_HOME the window was started with.
      await page.waitForFunction(() => window.__atelier?.sync?.()?.attached === true, {
        timeout: 30000,
      });
    } else {
      await page.evaluate(() => window.__atelier.loadSample());
      await page.waitForFunction(() => window.__atelier.store.getState().doc.id === 'p_sample');
      await page.evaluate(() => window.__atelier.canvas().fitAll());
    }
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
    return {
      page,
      errors,
      userAgent: await page.evaluate(() => navigator.userAgent),
      home: process.env.ATELIER_HOME,
      close: async () => browser.disconnect(),
    };
  }
  let server;
  let url;
  if (process.env.PERF_BUILD) {
    // Optimised (minified, no StrictMode double render) build with the dev hooks switched on.
    await build({
      mode: 'perf',
      logLevel: 'error',
      build: { outDir: 'dist-perf', sourcemap: false },
    });
    server = await preview({
      mode: 'perf',
      logLevel: 'error',
      build: { outDir: 'dist-perf' },
      preview: { port: 1433, strictPort: false, host: '127.0.0.1' },
    });
    url = server.resolvedUrls?.local[0];
  } else {
    server = await createServer({
      server: { port: 1432, strictPort: false, host: '127.0.0.1' },
      logLevel: 'error',
    });
    await server.listen();
    url = server.resolvedUrls?.local[0];
  }
  if (!url) throw new Error('Vite did not report a URL');
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport({ width, height });
  // The canvas and panel tests work on an in-memory document: no projects, no saving.
  if (persist) {
    // The app polls its files, so the network is never idle: wait for the app itself.
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__atelier?.sync?.()?.attached === true, {
      timeout: 30000,
    });
  } else {
    await page.goto(new URL('?nopersist', url).href, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.__atelier?.store.getState().doc.id === 'p_sample');
  }
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  return {
    page,
    errors,
    userAgent: await page.evaluate(() => navigator.userAgent),
    home,
    close: async () => {
      await browser.close();
      await (server.close ? server.close() : new Promise((r) => server.httpServer.close(r)));
      if (home) rmSync(home, { recursive: true, force: true });
    },
  };
}

/** Waits for React to commit and the overlay to measure (two frames). */
export async function settle(page) {
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}

/** A JSON-safe slice of the store. */
export function state(page) {
  return page.evaluate(() => {
    const s = window.__atelier.store.getState();
    return {
      rev: s.doc.rev,
      selection: s.selection,
      tool: s.tool,
      viewport: s.viewport,
      editing: s.editingTextId,
      past: s.history.past.map((e) => e.label),
      future: s.history.future.map((e) => e.label),
      nodeCount: Object.keys(s.doc.nodes).length,
    };
  });
}

export function node(page, id) {
  return page.evaluate((nid) => {
    const n = window.__atelier.store.getState().doc.nodes[nid];
    return n ? JSON.parse(JSON.stringify(n)) : null;
  }, id);
}

/** Finds a node id by its layer name (first match). */
export function idByName(page, name) {
  return page.evaluate((n) => {
    const nodes = window.__atelier.store.getState().doc.nodes;
    return Object.values(nodes).find((x) => x.name === n)?.id ?? null;
  }, name);
}

/** The node element's rect in client (page) pixels. */
export function elementRect(page, id) {
  return page.evaluate((nid) => {
    const el = document.querySelector(`[data-node-id="${nid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, id);
}

/** The selection box overlay's rect (client px) for a selected node id. */
export function selectionRect(page, id) {
  return page.evaluate((nid) => {
    const el = document.querySelector(`[data-selection-id="${nid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, id);
}

export function canvasBox(page) {
  return page.evaluate(() => {
    const r = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

/** World point -> client pixel, from the live viewport. */
export async function worldToClient(page, wx, wy) {
  const [s, box] = await Promise.all([state(page), canvasBox(page)]);
  return {
    x: box.x + s.viewport.x + wx * s.viewport.zoom,
    y: box.y + s.viewport.y + wy * s.viewport.zoom,
  };
}

export async function setViewport(page, viewport) {
  await page.evaluate((vp) => window.__atelier.store.getState().setViewport(vp), viewport);
  await settle(page);
}

/** Centre of a node element in client pixels. */
export async function centerOf(page, id) {
  const r = await elementRect(page, id);
  if (!r) throw new Error(`no element for ${id}`);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export async function drag(page, from, to, { steps = 8, hold = [] } = {}) {
  for (const k of hold) await page.keyboard.down(k);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  for (const k of hold) await page.keyboard.up(k);
  await settle(page);
}

export async function click(page, p, options) {
  await page.mouse.click(p.x, p.y, options);
  await settle(page);
}

export async function press(page, combo) {
  // '+' alone is the plus key; otherwise '+' joins modifiers ("Control+Shift+z").
  const keys = combo === '+' ? ['+'] : combo.split('+');
  const last = keys.pop();
  for (const k of keys) await page.keyboard.down(k);
  await page.keyboard.press(last);
  for (const k of keys.reverse()) await page.keyboard.up(k);
  await settle(page);
}

/** Tiny assertion reporter shared by the test scripts. */
export function reporter() {
  let failures = 0;
  return {
    check(name, ok, detail = '') {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${detail}`}`);
      if (!ok) failures += 1;
    },
    info(name, value) {
      console.log(`INFO  ${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    },
    get failures() {
      return failures;
    },
  };
}

export const near = (a, b, tol = 0.75) => typeof a === 'number' && Math.abs(a - b) <= tol;
