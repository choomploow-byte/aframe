// An agent driving the REAL desktop app (WebView2, production build, strict CSP) through the MCP
// server, the way Claude Code would. No dev hooks are used: only MCP calls and, to look at the
// window, a debug connection.
//
//   $env:ATELIER_HOME = '<folder>'; $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9333'
//   <start the release exe>                      # src-tauri/target/release/atelier.exe
//   $env:CDP_URL = 'http://127.0.0.1:9333'; node tests/e2e/mcp-desktop.mjs
//
// It checks what only the real window can prove: that html-to-image works under the production
// CSP with the bundled fonts, that the app installed its embedded server, and that screenshots
// survive a hidden window.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';
import { reporter } from './harness.mjs';

const HOME = process.env.ATELIER_HOME;
const CDP = process.env.CDP_URL;
if (!HOME || !CDP) throw new Error('Set ATELIER_HOME and CDP_URL (see the header of this file).');
const r = reporter();
const { check, info } = r;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const SHOT_DIR = process.env.SHOT_DIR;
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });

const browser = await puppeteer.connect({ browserURL: CDP, defaultViewport: null });
const page = (await browser.pages()).find((p) => !p.url().startsWith('devtools'));
if (!page) throw new Error('no app page');
const installed = path.join(HOME, 'mcp', 'atelier-mcp.mjs');

async function until(fn, timeout = 6000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    if (await fn()) return Math.round(performance.now() - t0);
    await sleep(40);
  }
  return null;
}

console.log('\n# the app installed its embedded server');
const text = await fs.readFile(installed, 'utf8').catch(() => '');
check(
  '~/.atelier/mcp/atelier-mcp.mjs is the real server, not the placeholder',
  // (The real server's own source mentions the placeholder marker, so look at how the file starts.)
  text.slice(0, 200).includes('// atelier-mcp-version: ') &&
    !text.slice(0, 120).includes('atelier-generated placeholder'),
  !text.includes('atelier-generated placeholder'),
  `${text.length} bytes`,
);
const ver = spawnSync(process.execPath, [installed, '--version'], { encoding: 'utf8' });
check(
  'it runs, and says its version',
  ver.status === 0 && /^\d+\.\d+\.\d+/.test(ver.stdout.trim()),
  ver.stdout + ver.stderr,
);
const doc = spawnSync(process.execPath, [installed, 'doctor'], {
  encoding: 'utf8',
  env: { ...process.env, ATELIER_HOME: HOME },
});
check(
  'doctor sees the running app',
  /\[ok\]\s+Atelier app: running/.test(doc.stdout),
  doc.stdout.split('\n').find((l) => l.includes('Atelier app')) ?? doc.stdout.slice(0, 200),
);

const client = new Client({ name: 'desktop-test', version: '1.0.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [installed],
    env: { ...process.env, ATELIER_HOME: HOME },
    stderr: 'ignore',
  }),
);
async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const t = res.content.find((c) => c.type === 'text')?.text ?? '';
  let json = {};
  try {
    json = JSON.parse(t);
  } catch {
    /* not JSON */
  }
  return {
    isError: res.isError === true,
    text: t,
    json,
    images: res.content.filter((c) => c.type === 'image'),
  };
}
const projectName = () =>
  page.$eval('[data-field="project-name"]', (e) => e.value).catch(() => null);

console.log('\n# an agent opens a project in the real window');
const created = (await call('create_project', { name: 'Agent demo', template: 'landing' })).json
  .project;
check('create_project works against the installed server', !!created?.id, JSON.stringify(created));
const opened = await call('open_project', { project: created.id });
check('open_project is answered by the app', !opened.isError, opened.text.slice(0, 200));
const switched = await until(async () => (await projectName()) === 'Agent demo');
info('open_project → the window shows it', switched === null ? 'timeout' : `${switched} ms`);
check('the window switches to the project', switched !== null);

console.log('\n# screenshots under the production CSP');
const t0 = performance.now();
const shot = await call('screenshot', { scale: 1 });
info('first screenshot (cold)', `${Math.round(performance.now() - t0)} ms`);
check(
  'screenshot returns an image',
  !shot.isError && shot.images.length === 1,
  shot.text.slice(0, 240),
);
const png = PNG.sync.read(Buffer.from(shot.images[0]?.data ?? '', 'base64'));
check(
  'of the whole landing frame (1440 wide)',
  png.width === 1440 && png.height > 300,
  `${png.width}x${png.height}`,
);
const colours = new Map();
for (let i = 0; i < png.data.length; i += 4 * 97)
  colours.set(`${png.data[i] >> 4},${png.data[i + 1] >> 4},${png.data[i + 2] >> 4}`, 1);
check('with real content, not a blank image', colours.size > 6, `${colours.size} distinct colours`);
// The buttons use the document's own `primary` token: look it up rather than assume a colour.
const tokenHex = String((await call('get_tokens')).json.colors?.primary ?? '');
const want = [1, 3, 5].map((i) => parseInt(tokenHex.slice(i, i + 2), 16));
let primary = 0;
for (let i = 0; i < png.data.length; i += 4)
  if (
    Math.abs(png.data[i] - want[0]) < 6 &&
    Math.abs(png.data[i + 1] - want[1]) < 6 &&
    Math.abs(png.data[i + 2] - want[2]) < 6
  )
    primary += 1;
check(
  'the primary-coloured buttons are in it',
  /^#[0-9a-f]{6}$/i.test(tokenHex) && primary > 2000,
  `${primary} px of ${tokenHex}`,
);
if (SHOT_DIR)
  await fs.writeFile(
    path.join(SHOT_DIR, 'desktop-landing.png'),
    Buffer.from(shot.images[0]?.data ?? '', 'base64'),
  );

// The headline is set in the bundled heading font; if the font failed to embed, the glyph shapes (and so
// the text width) would be those of the fallback. Compare against the same frame from the live canvas.
const head = (await call('get_design', { depth: 4 })).json.root.children[0];
const headline = JSON.stringify(head).match(
  /"id":"(n_[a-z0-9]+)","type":"text","name":"Headline"/,
)?.[1];
const cropped = headline ? await call('screenshot', { nodeId: headline, scale: 1 }) : null;
if (cropped) {
  const p2 = PNG.sync.read(Buffer.from(cropped.images[0]?.data ?? '', 'base64'));
  const domWidth = await page.evaluate(
    (id) => document.querySelector(`[data-node-id="${id}"]`)?.offsetWidth ?? 0,
    headline,
  );
  check(
    'the headline image has the width the live canvas gives it (so the font really embedded)',
    Math.abs(p2.width - domWidth) <= 2,
    `${p2.width} vs ${domWidth}`,
  );
}

console.log('\n# a hidden window still answers');
let hidden = false;
try {
  const cdp = await page.createCDPSession();
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
  hidden = true;
  await sleep(1200);
  const h0 = performance.now();
  const hs = await call('screenshot', { scale: 1 });
  info('screenshot while minimised', `${Math.round(performance.now() - h0)} ms`);
  check(
    'a screenshot taken while the window is minimised works',
    !hs.isError && hs.images.length === 1,
    hs.text.slice(0, 200),
  );
  const ping = await call('get_selection');
  check(
    'and so does the heartbeat-based state',
    ping.json.appOnline === true,
    ping.text.slice(0, 120),
  );
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
} catch (e) {
  info('minimise', `not testable through this debug connection (${String(e).slice(0, 80)})`);
  if (hidden) throw e;
}

console.log('\n# the agent edits; the user sees it');
const frame = head.id;
const edit = await call('apply_changes', {
  label: 'Retitle',
  operations: [
    { op: 'update', id: headline, set: { text: 'Edited by an agent in the real window' } },
  ],
});
check('apply_changes succeeds', !edit.isError, edit.text.slice(0, 200));
const shown = await until(() =>
  page.evaluate(
    (id) =>
      document.querySelector(`[data-node-id="${id}"]`)?.textContent ===
      'Edited by an agent in the real window',
    headline,
  ),
);
info('agent edit → text changes in the window', shown === null ? 'timeout' : `${shown} ms`);
check('the new headline is on the canvas', shown !== null);
check('with the editing chip showing', !!(await page.$('[data-testid="agent-editing"]')));
// The app looks for agents every 3 s (and a hidden window slows its timers), so give it a moment.
const pillOn = await until(
  async () =>
    (await page.$eval('[data-testid="connect-ai"]', (e) => e.dataset.connected)) === 'true',
  9000,
);
info('server running → pill green', pillOn === null ? 'timeout' : `${pillOn} ms`);
check('and the Connect pill is green', pillOn !== null);
void frame;

console.log('\n# what the user selects reaches the agent');
await page.click(`[data-layer-id]`).catch(() => undefined);
const sel = await until(
  async () => ((await call('get_selection')).json.ids ?? []).length > 0,
  4000,
);
check('clicking a layer makes get_selection return it', sel !== null);

await client.close().catch(() => undefined);
await browser.disconnect();
console.log(
  r.failures === 0
    ? '\nAll desktop MCP checks passed.'
    : `\n${r.failures} desktop MCP check(s) failed.`,
);
process.exit(r.failures === 0 ? 0 : 1);
