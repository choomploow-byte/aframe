// Import e2e (Phase 10): SVG (with a visual diff against the original), a recorded Figma file, a
// captured web page (the running-app prototype, measured against the page it came from), and the
// Canva/image path. Driven through the Import dialog like a person, in real Chrome.
// SHOT_DIR=<dir> saves screenshots. Run: node tests/e2e/import.mjs
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { reporter, settle, start } from './harness.mjs';

const t = await start({ width: 1500, height: 940 });
const { page } = t;
const browser = page.browser();
const r = reporter();
const { check, info } = r;
const SHOT_DIR = process.env.SHOT_DIR;
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'atelier-import-'));
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const doc = () =>
  page.evaluate(() => JSON.parse(JSON.stringify(window.__atelier.store.getState().doc)));
const q = (sel) => page.$(sel);
const text = (sel) => page.$eval(sel, (el) => el.textContent ?? '').catch(() => null);

async function openImport(tab) {
  await page.click('[data-testid="open-import"]');
  await settle(page);
  if (tab) {
    await page.evaluate((label) => {
      [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent === label)?.click();
    }, tab);
    await settle(page);
  }
}
async function upload(testId, file) {
  const input = await page.$(`[data-testid="${testId}"]`);
  await input.uploadFile(file);
  await sleep(500);
  await settle(page);
}
async function addAndGetId() {
  await page.click('[data-action="import-add"]');
  await settle(page);
  return page.evaluate(() => window.__atelier.store.getState().selection[0]);
}
const captured = async (nodeId) => {
  const out = await page.evaluate(async (id) => {
    const { captureScreenshot } = await import('/src/canvas/screenshot.ts');
    const s = window.__atelier.store.getState();
    return captureScreenshot(s.doc, s.viewport.zoom, { nodeId: id, scale: 1, maxWidth: 4096 });
  }, nodeId);
  return PNG.sync.read(Buffer.from(out.pngBase64, 'base64'));
};
async function diffAgainstSvg(svgText, nodeId, label, tolerance) {
  const sp = await browser.newPage();
  await sp.setViewport({ width: 1200, height: 900 });
  const b64 = Buffer.from(svgText).toString('base64');
  await sp.setContent(
    `<body style="margin:0;background:#fff"><img id="i" src="data:image/svg+xml;base64,${b64}"></body>`,
  );
  await sp.evaluate(
    () =>
      new Promise((res) =>
        document.getElementById('i').complete ? res() : (document.getElementById('i').onload = res),
      ),
  );
  const original = PNG.sync.read(await (await sp.$('#i')).screenshot({ type: 'png' }));
  await sp.close();
  const imported = await captured(nodeId);
  if (original.width !== imported.width || original.height !== imported.height) {
    check(
      `${label}: same size as the original`,
      false,
      `${imported.width}x${imported.height} vs ${original.width}x${original.height}`,
    );
    return;
  }
  const bad = pixelmatch(original.data, imported.data, null, original.width, original.height, {
    threshold: 0.12,
  });
  const pct = (bad / (original.width * original.height)) * 100;
  check(
    `${label}: looks like the original (${pct.toFixed(2)}% of pixels differ)`,
    pct <= tolerance,
    `${pct.toFixed(2)}%`,
  );
}

await page.evaluate(() => window.__atelier.loadBlank());
await settle(page);

// ---- SVG ----------------------------------------------------------------------------------------------
const FIXTURES = {
  shapes: {
    tolerance: 2,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160" viewBox="0 0 300 160"><rect x="10" y="10" width="120" height="70" rx="12" fill="#c96442"/><circle cx="200" cy="50" r="38" fill="#1f1e1d" stroke="#faf9f5" stroke-width="4"/><ellipse cx="80" cy="125" rx="60" ry="22" fill="#6b7cff" opacity="0.6"/><rect x="170" y="100" width="110" height="40" fill="#e8e6dc" stroke="#999" stroke-width="2"/></svg>',
  },
  gradient: {
    tolerance: 2.5,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff7a59"/><stop offset="1" stop-color="#6b4eff"/></linearGradient></defs><rect width="240" height="120" rx="16" fill="url(#g)"/></svg>',
  },
  groups: {
    tolerance: 2,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="140"><g transform="translate(20 20)"><rect width="60" height="60" fill="#2d9d78"/><g transform="translate(70 0) scale(1.5)"><rect width="40" height="40" fill="#e0a31a"/></g></g><rect x="20" y="100" width="220" height="6" fill="#444"/></svg>',
  },
  paths: {
    tolerance: 2,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="140" viewBox="0 0 200 140"><path d="M20 120 L100 20 L180 120 Z" fill="#c96442"/><path d="M60 120 Q100 60 140 120" fill="none" stroke="#1f1e1d" stroke-width="6"/><rect x="10" y="10" width="30" height="30" fill="#6b7cff"/></svg>',
  },
};
await openImport('SVG');
check(
  'the Import dialog opens from the top bar',
  (await q('[data-testid="import-dialog"]')) !== null,
);
let n = 0;
for (const [name, fx] of Object.entries(FIXTURES)) {
  const file = join(work, `${name}.svg`);
  writeFileSync(file, fx.svg);
  await upload('import-svg-file', file);
  const summary = await text('[data-testid="import-summary"]');
  check(
    `${name}.svg: the report says what came across`,
    /layer.*editable/.test(summary ?? ''),
    String(summary),
  );
  if (SHOT_DIR && n === 0) await page.screenshot({ path: join(SHOT_DIR, 'import-svg.png') });
  const id = await addAndGetId();
  check(
    `${name}.svg: it is added and selected`,
    typeof id === 'string' && (await doc()).nodes[id] !== undefined,
  );
  await diffAgainstSvg(fx.svg, id, `${name}.svg`, fx.tolerance);
  n += 1;
  if (n < Object.keys(FIXTURES).length) await openImport('SVG');
}
const pathsDoc = await doc();
check(
  'the path drawing is kept as an image whose asset is an SVG',
  Object.values(pathsDoc.nodes).some(
    (x) =>
      x.type === 'image' && String(pathsDoc.assets[x.assetId]).startsWith('data:image/svg+xml'),
  ),
);
await page.evaluate(() => window.__atelier.store.getState().undo());
await settle(page);
check(
  'one undo removes the whole import',
  Object.values((await doc()).nodes).every((x) => x.name !== 'paths'),
);

// Hostile and broken files.
await openImport('SVG');
const bomb = join(work, 'bomb.svg');
writeFileSync(
  bomb,
  '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "AAAA"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><text x="0" y="20">&b;</text><script>alert(1)</script></svg>',
);
const started = Date.now();
await upload('import-svg-file', bomb);
check(
  'an entity bomb and a script are handled instantly and safely',
  Date.now() - started < 3000 && (await text('[data-testid="import-report"]')) !== null,
);
const notSvg = join(work, 'notes.svg');
writeFileSync(notSvg, 'this is not a drawing');
await upload('import-svg-file', notSvg);
check(
  'a file that is not SVG gets a plain message',
  /not an SVG|not valid/i.test((await text('[data-testid="import-error"]')) ?? ''),
  String(await text('[data-testid="import-error"]')),
);
await page.keyboard.press('Escape');
await settle(page);

// ---- Figma (a recorded file) ------------------------------------------------------------------------------
await page.evaluate(() => window.__atelier.loadBlank());
await settle(page);
await openImport('Figma');
check(
  'without the desktop app the Figma tab says it needs it, and still takes a saved file',
  /desktop app/.test((await text('[data-testid="import-dialog"]')) ?? '') &&
    (await q('[data-testid="import-figma-file"]')) !== null,
);
await upload('import-figma-file', join('fixtures', 'figma-sample.json'));
const figmaSummary = await text('[data-testid="import-summary"]');
check(
  'the Figma report is shown with a percentage',
  /\d+% editable/.test(figmaSummary ?? ''),
  String(figmaSummary),
);
check(
  'the report lists the vector that became a placeholder',
  /Decorative squiggle/.test((await text('[data-testid="import-report"]')) ?? ''),
);
if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, 'import-figma.png') });
const heroId = await addAndGetId();
const hero = (await doc()).nodes[heroId];
check(
  'the Hero frame keeps its auto-layout, gap and padding',
  hero.name === 'Hero' &&
    hero.layout === 'column' &&
    hero.gap === 24 &&
    JSON.stringify(hero.padding) === '[112,64,112,64]',
  JSON.stringify([hero.layout, hero.gap, hero.padding]),
);
const heroKids = hero.children.map((id) => (async () => (await doc()).nodes[id])());
const kids = await Promise.all(heroKids);
check(
  'with its headline text, button, image panel and placeholder',
  kids.map((k) => k.type).join() === 'text,frame,rect,rect',
  kids.map((k) => k.type).join(),
);
check(
  'the headline keeps its font and size',
  kids[0].fontFamily === 'Fraunces' && kids[0].fontSize === 60 && kids[0].fontWeight === 700,
);
await page.evaluate(() => window.__atelier.store.getState().undo());
await settle(page);
await openImport('Figma');
const badJson = join(work, 'bad.json');
writeFileSync(badJson, '{"nope": true}');
await upload('import-figma-file', badJson);
check(
  'a JSON file that is not a Figma file is refused kindly',
  /Figma file/.test((await text('[data-testid="import-error"]')) ?? ''),
  String(await text('[data-testid="import-error"]')),
);
await page.keyboard.press('Escape');
await settle(page);

// ---- a web page: capture it, import it, compare with the page --------------------------------------------------
const PAGE = `<!doctype html><html><head><title>Demo app</title><style>
body{margin:0;font-family:Arial,sans-serif;background:#faf9f5;color:#1f1e1d}
nav{display:flex;justify-content:space-between;align-items:center;padding:16px 32px;background:#fff;border-bottom:1px solid #e8e6dc}
nav .links{display:flex;gap:24px;font-size:15px}
.hero{padding:56px 32px;display:flex;flex-direction:column;gap:16px;align-items:flex-start}
.hero h1{margin:0;font-size:44px;line-height:1.1}
.hero p{margin:0;font-size:18px;color:#555;max-width:520px}
.btn{background:#c96442;color:#fff;padding:12px 22px;border-radius:10px;font-weight:600;font-size:16px;box-shadow:0 4px 12px rgba(0,0,0,.15)}
.cards{display:flex;gap:20px;padding:0 32px 40px}
.card{flex:1;background:#fff;border:1px solid #e8e6dc;border-radius:14px;padding:20px}
.card h3{margin:0 0 8px;font-size:20px}.card p{margin:0;font-size:15px;color:#666}
</style></head><body>
<nav><strong>Acme</strong><div class="links"><span>Product</span><span>Pricing</span><span>Docs</span></div></nav>
<section class="hero"><h1>Plan work your team will follow</h1><p>One place for goals, tasks and the plans that connect them.</p><div class="btn">Get started</div></section>
<div class="cards"><div class="card"><h3>Plan</h3><p>Set goals and break them down.</p></div><div class="card"><h3>Track</h3><p>See progress without meetings.</p></div><div class="card"><h3>Ship</h3><p>Know what is blocked, early.</p></div></div>
</body></html>`;
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
});
await new Promise((res) => server.listen(0, '127.0.0.1', res));
const url = `http://127.0.0.1:${server.address().port}/`;
const captureBase = join(work, 'demo');
let captureOutput;
try {
  // Not execFileSync: this process also serves the page the script is loading.
  captureOutput = (
    await promisify(execFile)(
      process.execPath,
      ['scripts/capture-dom.mjs', url, '--out', captureBase, '--width', '1100', '--height', '700'],
      { encoding: 'utf8' },
    )
  ).stdout;
} catch (e) {
  captureOutput = `FAILED ${String(e.stderr ?? e.message)}`;
}
check(
  'the capture script writes a snapshot and a picture',
  /Captured/.test(captureOutput),
  captureOutput.slice(0, 200),
);
const refused = (() => {
  try {
    execFileSync(
      process.execPath,
      ['scripts/capture-dom.mjs', 'https://example.com', '--out', join(work, 'x')],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    return false;
  } catch (e) {
    return /Refusing to capture/.test(String(e.stderr));
  }
})();
check('it refuses a page that is not on this computer unless told to', refused);
server.close();

await openImport('Web page');
await upload('import-web-file', `${captureBase}.json`);
const webSummary = await text('[data-testid="import-summary"]');
check(
  'the web page import reports what came across',
  /layer.*editable/.test(webSummary ?? ''),
  String(webSummary),
);
if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, 'import-web.png') });
const webId = await addAndGetId();
const webDoc = await doc();
const root = webDoc.nodes[webId];
const all = Object.values(webDoc.nodes).filter((x) => x.type !== 'page');
check('the page title is the frame name', root.name === 'Demo app', root.name);
check(
  'flex rows and columns became auto-layout',
  all.some((x) => x.layout === 'row') && all.some((x) => x.layout === 'column'),
);
check('text came across as text layers', all.filter((x) => x.type === 'text').length >= 8);
check(
  'the button is a frame with its fill, radius and shadow',
  all.some((x) => x.fill === '#c96442' && x.radius === 10 && (x.shadow ?? []).length === 1),
);
// Compare with the page itself.
const pp = await browser.newPage();
await pp.setViewport({ width: 1100, height: 700 });
await pp.goto(captureOutput.includes('Captured') ? 'about:blank' : 'about:blank');
await pp.setContent(PAGE);
const original = PNG.sync.read(await pp.screenshot({ type: 'png', fullPage: true }));
await pp.close();
const importedShot = await captured(webId);
if (SHOT_DIR)
  writeFileSync(join(SHOT_DIR, 'import-web-imported.png'), PNG.sync.write(importedShot));
const w = Math.min(original.width, importedShot.width);
const h = Math.min(original.height, importedShot.height);
const crop = (img) => {
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(img, out, 0, 0, w, h, 0, 0);
  return out;
};
const bad = pixelmatch(crop(original).data, crop(importedShot).data, null, w, h, {
  threshold: 0.15,
});
const pct = (bad / (w * h)) * 100;
info(
  'web import vs the page',
  `${pct.toFixed(1)}% of pixels differ (${importedShot.width}x${importedShot.height} vs ${original.width}x${original.height})`,
);
// The screenshot of the page is at least as tall as the window; the content is what is compared.
check(
  `the imported page looks like the page (${pct.toFixed(1)}% differ, limit 12%)`,
  pct <= 12,
  `${pct.toFixed(1)}%`,
);

// ---- Canva or any image: add it, and hand it to the assistant (or say what to tell an external one) ----------------------
await page.evaluate(() => window.__atelier.loadBlank());
await settle(page);
const png = new PNG({ width: 60, height: 40 });
png.data.fill(180);
const pngPath = join(work, 'canva.png');
writeFileSync(pngPath, PNG.sync.write(png));
await openImport('Canva or image');
check(
  'the Canva tab is honest that Canva files cannot be opened',
  /cannot open a Canva file/.test((await text('[data-testid="canva-note"]')) ?? ''),
);
await upload('import-canva-file', pngPath);
await sleep(600);
const afterCanva = await doc();
check(
  'the image is on the canvas',
  Object.values(afterCanva.nodes).some((x) => x.type === 'image'),
);
check(
  'with no assistant set up, it says what to tell an external agent',
  /rebuild the image I just added/.test((await text('[data-testid="canva-done"]')) ?? ''),
  String(await text('[data-testid="canva-done"]')),
);
await page.keyboard.press('Escape');
await settle(page);

await page.evaluate(async () => {
  const chat = await window.__atelier.chat();
  window.__chat = chat;
  window.__sent = [];
  chat.transport.setTransportForTests((_p, body) => {
    window.__sent.push(JSON.parse(JSON.stringify(body)));
    return Promise.resolve({
      status: 200,
      text: JSON.stringify({
        content: [{ type: 'text', text: 'I will rebuild it.' }],
        stop_reason: 'end_turn',
        usage: {},
      }),
    });
  });
  chat.keys.setKeyStoreForTests({
    available: true,
    has: () => Promise.resolve(true),
    set: () => Promise.resolve(),
    clear: () => Promise.resolve(),
  });
  chat.settings.settingsStore.getState().update({ acknowledged: true, provider: 'anthropic' });
  await chat.keys.refreshKeys();
});
await openImport('Canva or image');
await upload('import-canva-file', pngPath);
await sleep(1200);
const sent = await page.evaluate(() => window.__sent);
check(
  'with the assistant set up, the image goes to it with the rebuild brief',
  sent.length >= 1 &&
    JSON.stringify(sent[0].messages[0]).includes('"media_type":"image/png"') &&
    /Rebuild the image/.test(JSON.stringify(sent[0].messages[0])),
);
check('and the Chat tab opens', (await q('[data-testid="chat-panel"]')) !== null);

check('no console errors', t.errors.length === 0, t.errors.slice(0, 2).join(' | '));
await t.close();
console.log(r.failures === 0 ? 'ALL PASSED' : `${r.failures} FAILED`);
process.exit(r.failures === 0 ? 0 : 1);
