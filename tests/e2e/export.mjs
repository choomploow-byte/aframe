// Phase 8 acceptance: exported code renders like the design.
//
// For every fixture screen (the seven templates and the sample project's frames) and every format
// (html, react-css, react-tailwind):
//   1. export it,
//   2. for React: build it in a real Vite project (with Tailwind v4 for that flavour) and type-check
//      the component with the TypeScript compiler (zero diagnostics),
//   3. render the result in headless Chrome and pixel-diff it against what the canvas draws
//      (the same screenshot the agent's tool takes), failing above 2%.
// Run: node --import tsx tests/e2e/export.mjs     (SHOT_DIR=<dir> keeps the diff images)
import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import ts from 'typescript';
import { build } from 'vite';
import { exportDesign } from '../../src/core/export/index.ts';
import { loadDoc } from '../../src/core/doc.ts';
import { createTemplateDoc, TEMPLATES } from '../../src/core/templates.ts';
import { buildDoc } from '../../src/core/testing.ts';
import { reporter, settle, start } from './harness.mjs';

const ROOT = resolve('.');
const WORK = join(ROOT, '.shots', 'export-check');
const THRESHOLD = 2; // percent of pixels
const SHOT_DIR = process.env.SHOT_DIR;
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

// ---- a static server over the repository (the exported pages, and the bundled fonts) -----------------
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
};
const server = createServer((req, res) => {
  const path = resolve(ROOT, `.${decodeURIComponent((req.url ?? '/').split('?')[0])}`);
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = readFileSync(path);
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const urlOf = (file) =>
  `http://127.0.0.1:${PORT}/${file.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '')}`;

// ---- fixtures ------------------------------------------------------------------------------------------
const fixtures = [];
for (const t of TEMPLATES.filter((x) => x !== 'blank')) {
  const doc = createTemplateDoc(t, { name: t, id: 'p_exp01', now: '2026-01-01T00:00:00.000Z' });
  const screen = doc.nodes[doc.rootId].children
    .map((id) => doc.nodes[id])
    .find((n) => n.name !== 'Components');
  fixtures.push({ name: t, doc, nodeId: screen.id });
}
{
  const loaded = loadDoc(JSON.parse(readFileSync('fixtures/sample-doc.json', 'utf8')));
  if (!loaded.ok) throw new Error('the sample fixture does not load');
  for (const id of loaded.doc.nodes[loaded.doc.rootId].children) {
    fixtures.push({
      name: `sample-${loaded.doc.nodes[id].name}`.replace(/[^A-Za-z0-9]+/g, '-'),
      doc: loaded.doc,
      nodeId: id,
    });
  }
}

const t = await start({ width: 1600, height: 1000 });
const appPage = t.page;
const browser = appPage.browser();
const r = reporter();
const { check, info } = r;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const write = (dir, files) => {
  for (const f of files) {
    const p = join(dir, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
  }
};

/** The canvas's own picture of a node: the screenshot the agent's tool takes. */
async function canvasShot(doc, nodeId) {
  await appPage.evaluate((d) => {
    window.__aframe.projects.detachForTests();
    window.__aframe.store.getState().loadDoc(d);
  }, doc);
  await appPage.evaluate(() => document.fonts.ready);
  await settle(appPage);
  await sleep(200);
  const out = await appPage.evaluate(async (id) => {
    const { captureScreenshot } = await import('/src/canvas/screenshot.ts');
    const s = window.__aframe.store.getState();
    return captureScreenshot(s.doc, s.viewport.zoom, { nodeId: id, scale: 1, maxWidth: 4096 });
  }, nodeId);
  return PNG.sync.read(Buffer.from(out.pngBase64, 'base64'));
}

/** A React project around the exported component, built for real. Returns the page to open. */
async function buildReact(dir, result, tailwindFlavour) {
  const src = join(dir, 'src');
  write(src, result.files);
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
  );
  writeFileSync(
    join(src, 'main.tsx'),
    `import { createRoot } from 'react-dom/client';\nimport ${result.componentName} from './${result.componentName}';\ncreateRoot(document.getElementById('root') as HTMLElement).render(<${result.componentName} />);\n`,
  );
  // Type-check the component like a user's project would (strict, bundler resolution, Vite client types).
  const files = [join(src, 'main.tsx'), join(src, `${result.componentName}.tsx`)];
  const program = ts.createProgram(files, {
    strict: true,
    noEmit: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
    types: ['vite/client'],
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  await build({
    root: dir,
    base: './',
    configFile: false,
    logLevel: 'silent',
    plugins: tailwindFlavour ? [react(), tailwind()] : [react()],
    build: { outDir: 'dist', emptyOutDir: true },
  });
  return { page: join(dir, 'dist', 'index.html'), diagnostics };
}

const FORMATS = ['html', 'react-css', 'react-tailwind'];
const numbers = [];
for (const fx of fixtures) {
  const reference = await canvasShot(fx.doc, fx.nodeId);
  for (const format of FORMATS) {
    const label = `${fx.name} / ${format}`;
    const dir = join(WORK, `${fx.name}-${format}`);
    let result;
    try {
      result = exportDesign(fx.doc, fx.nodeId, format);
    } catch (e) {
      check(`${label}: exports`, false, String(e));
      continue;
    }
    let pageFile;
    try {
      if (format === 'html') {
        write(dir, result.files);
        pageFile = join(dir, 'index.html');
      } else {
        const built = await buildReact(dir, result, format === 'react-tailwind');
        pageFile = built.page;
        const errors = built.diagnostics.map((d) =>
          ts.flattenDiagnosticMessageText(d.messageText, ' '),
        );
        check(
          `${label}: type-checks with zero errors`,
          errors.length === 0,
          errors.slice(0, 2).join(' | '),
        );
      }
    } catch (e) {
      check(`${label}: builds`, false, String(e?.message ?? e).slice(0, 300));
      continue;
    }

    const page = await browser.newPage();
    await page.setViewport({ width: Math.max(1600, reference.width + 40), height: 1000 });
    await page.goto(urlOf(pageFile), { waitUntil: 'load' });
    // The design's fonts, served from the repository, the way the app registers them.
    await page.addStyleTag({ url: `http://127.0.0.1:${PORT}/src/canvas/fonts.css` });
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (const f of [
        'Inter',
        'DM Sans',
        'Fraunces',
        'Playfair Display',
        'Space Grotesk',
        'JetBrains Mono',
        'Lilita One',
        'Fredoka',
        'Bungee',
        'Luckiest Guy',
      ]) {
        await document.fonts.load(`400 16px "${f}"`).catch(() => undefined);
        await document.fonts.load(`600 16px "${f}"`).catch(() => undefined);
      }
    });
    await sleep(150);
    const handle = await page.$(format === 'html' ? 'body > *' : '#root > *');
    const exported = PNG.sync.read(await handle.screenshot({ type: 'png' }));
    await page.close();

    if (exported.width !== reference.width || exported.height !== reference.height) {
      check(
        `${label}: same size as the canvas`,
        false,
        `${exported.width}x${exported.height} vs ${reference.width}x${reference.height}`,
      );
      continue;
    }
    const diff = new PNG({ width: reference.width, height: reference.height });
    const bad = pixelmatch(
      reference.data,
      exported.data,
      diff.data,
      reference.width,
      reference.height,
      { threshold: 0.1 },
    );
    const percent = (bad / (reference.width * reference.height)) * 100;
    numbers.push({ label, percent });
    check(
      `${label}: renders within ${THRESHOLD}% of the canvas (${percent.toFixed(3)}%)`,
      percent <= THRESHOLD,
      `${percent.toFixed(2)}%`,
    );
    if (SHOT_DIR && percent > 0.2) {
      writeFileSync(join(SHOT_DIR, `diff-${fx.name}-${format}.png`), PNG.sync.write(diff));
    }
  }
}

// ---- image export from the canvas: PNG at 1x/2x/3x, transparent background, SVG ------------------------
{
  const doc = buildDoc([
    { id: 'n_round', type: 'frame', name: 'Round', w: 200, h: 100, radius: 40, fill: '#ff0000' },
  ]);
  await appPage.evaluate((d) => {
    window.__aframe.projects.detachForTests();
    window.__aframe.store.getState().loadDoc(d);
  }, doc);
  await settle(appPage);
  const run = (params) =>
    appPage.evaluate(async (pr) => {
      const { captureExport } = await import('/src/canvas/screenshot.ts');
      const s = window.__aframe.store.getState();
      try {
        return await captureExport(s.doc, s.viewport.zoom, pr);
      } catch (e) {
        return { error: String(e.message ?? e), code: e.code };
      }
    }, params);
  const png = (out) => PNG.sync.read(Buffer.from(out.dataBase64, 'base64'));
  const alphaAt = (img, x, y) => img.data[(y * img.width + x) * 4 + 3];

  for (const scale of [1, 2, 3]) {
    const out = await run({ nodeId: 'n_round', format: 'png', scale, transparent: false });
    const img = png(out);
    check(
      `PNG at ${scale}x is ${200 * scale}x${100 * scale}`,
      img.width === 200 * scale && img.height === 100 * scale && out.width === img.width,
      `${img.width}x${img.height}`,
    );
  }
  const opaque = png(await run({ nodeId: 'n_round', format: 'png', scale: 1, transparent: false }));
  const clear = png(await run({ nodeId: 'n_round', format: 'png', scale: 1, transparent: true }));
  check(
    'opaque PNG fills the area behind the rounded corner',
    alphaAt(opaque, 1, 1) === 255,
    String(alphaAt(opaque, 1, 1)),
  );
  check(
    'transparent PNG leaves the area behind the rounded corner clear',
    alphaAt(clear, 1, 1) === 0,
    String(alphaAt(clear, 1, 1)),
  );
  check(
    'transparent PNG keeps the design opaque',
    alphaAt(clear, 100, 50) === 255,
    String(alphaAt(clear, 100, 50)),
  );
  const tooBig = await run({ nodeId: 'n_round', format: 'png', scale: 4, transparent: false });
  check(
    'a scale outside 1 to 3 is refused',
    tooBig.error !== undefined && /scale/.test(tooBig.error),
    JSON.stringify(tooBig).slice(0, 120),
  );
  const missing = await run({ nodeId: 'n_nope', format: 'png', scale: 1, transparent: false });
  check(
    'an unknown node is refused',
    missing.code === 'NOT_FOUND',
    JSON.stringify(missing).slice(0, 120),
  );

  // SVG: valid markup that draws the same picture when opened on its own.
  const svgOut = await run({ nodeId: 'n_round', format: 'svg', scale: 1, transparent: true });
  const svgText = Buffer.from(svgOut.dataBase64, 'base64').toString('utf8');
  check(
    'SVG export is an svg document of the right size',
    /^<svg[^>]*width="200"[^>]*height="100"/.test(svgText) ||
      (svgText.startsWith('<svg') && svgText.includes('viewBox="0 0 200 100"')),
    svgText.slice(0, 120),
  );
  const svgPath = join(WORK, 'round.svg');
  writeFileSync(svgPath, svgText);
  const sp = await browser.newPage();
  await sp.setViewport({ width: 400, height: 300 });
  await sp.setContent(
    `<body style="margin:0;background:transparent"><img id="i" src="data:image/svg+xml;base64,${svgOut.dataBase64}"></body>`,
  );
  await sp.evaluate(
    () =>
      new Promise((r) =>
        document.getElementById('i').complete ? r() : (document.getElementById('i').onload = r),
      ),
  );
  const svgShot = PNG.sync.read(
    await (await sp.$('#i')).screenshot({ type: 'png', omitBackground: true }),
  );
  await sp.close();
  check(
    'SVG renders at the design size',
    svgShot.width === 200 && svgShot.height === 100,
    `${svgShot.width}x${svgShot.height}`,
  );
  const svgDiff =
    (pixelmatch(clear.data, svgShot.data, null, 200, 100, { threshold: 0.1 }) / 200 / 100) * 100;
  check(
    `SVG renders like the PNG (${svgDiff.toFixed(3)}% different)`,
    svgDiff <= THRESHOLD,
    `${svgDiff.toFixed(2)}%`,
  );
}

numbers.sort((a, b) => b.percent - a.percent);
info(
  'worst five',
  numbers.slice(0, 5).map((n) => `${n.label} ${n.percent.toFixed(3)}%`),
);
info(
  'mean diff',
  `${(numbers.reduce((s, n) => s + n.percent, 0) / Math.max(1, numbers.length)).toFixed(3)}%`,
);
check('no console errors in the app', t.errors.length === 0, t.errors.slice(0, 2).join(' | '));
await t.close();
server.close();
console.log(r.failures === 0 ? 'ALL PASSED' : `${r.failures} FAILED`);
process.exit(r.failures === 0 ? 0 : 1);
