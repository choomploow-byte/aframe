// Performance check on a 500-node document (docs/19, docs/13 budgets): drives pan, zoom, a node
// drag and an auto-layout resize with real input events and records frame intervals.
// Run: npm run test:perf            (headless Chrome, software rendering: pessimistic)
//      CDP_URL=http://127.0.0.1:9222 npm run test:perf   (the real WebView2 window under `tauri dev`)
import { canvasBox, centerOf, idByName, reporter, settle, start } from './harness.mjs';

// Measure the optimised build by default; React's dev build is an order of magnitude slower.
process.env.PERF_BUILD ??= '1';

const NODES = Number(process.env.PERF_NODES ?? 500);
const t = await start();
const { page } = t;
const r = reporter();

await page.evaluate((n) => window.__atelier.loadStress(n), NODES);
await page.evaluate(() => document.fonts.ready);
await settle(page);

const nodeCount = await page.evaluate(
  () => Object.keys(window.__atelier.store.getState().doc.nodes).length,
);
r.info('browser', t.userAgent);
r.info('nodes in document', nodeCount);

await page.evaluate(() => {
  window.__perf = {
    times: [],
    running: false,
    start() {
      this.times = [];
      this.running = true;
      const loop = (now) => {
        if (!this.running) return;
        this.times.push(now);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
    stop() {
      this.running = false;
      const deltas = [];
      for (let i = 1; i < this.times.length; i += 1) deltas.push(this.times[i] - this.times[i - 1]);
      return deltas;
    },
  };
});

const nextFrame = () =>
  page.evaluate(() => new Promise((res) => requestAnimationFrame(() => res())));
const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

/** Runs `steps` of `action(i)`, waiting one frame after each, and reports frame timing. */
async function measure(name, steps, action) {
  const before = await page.metrics();
  await page.evaluate(() => window.__perf.start());
  for (let i = 0; i < steps; i += 1) {
    await action(i);
    await nextFrame();
  }
  const deltas = await page.evaluate(() => window.__perf.stop());
  const after = await page.metrics();
  const sorted = [...deltas].sort((a, b) => a - b);
  const avg = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length);
  const work = (k) => (((after[k] ?? 0) - (before[k] ?? 0)) * 1000) / steps; // ms per step
  const slow = deltas.filter((d) => d > 20).length;
  const result = {
    avgMs: +avg.toFixed(1),
    fps: +(1000 / avg).toFixed(0),
    p95Ms: +percentile(sorted, 95).toFixed(1),
    maxMs: +sorted.at(-1).toFixed(1),
    slowPct: +((slow / deltas.length) * 100).toFixed(0),
    scriptMsPerStep: +work('ScriptDuration').toFixed(2),
    layoutMsPerStep: +work('LayoutDuration').toFixed(2),
    styleMsPerStep: +work('RecalcStyleDuration').toFixed(2),
  };
  console.log(`PERF  ${name.padEnd(34)} ${JSON.stringify(result)}`);
  return result;
}

const box = await canvasBox(page);
const cx = box.x + box.w / 2;
const cy = box.y + box.h / 2;
await page.mouse.move(cx, cy);

// 1. Pan with the wheel (what a trackpad does).
const pan = await measure('pan (wheel)', 90, () => page.mouse.wheel({ deltaX: 6, deltaY: 14 }));

// 2. Zoom to the cursor, in and out.
await page.keyboard.down('Control');
const zoom = await measure('zoom (ctrl+wheel)', 90, (i) =>
  page.mouse.wheel({ deltaY: i < 45 ? -25 : 25 }),
);
await page.keyboard.up('Control');

// 3. Drag the whole artboard (a document update every frame).
await page.evaluate(() => window.__atelier.canvas().fitAll());
await settle(page);
const board = await idByName(page, 'Stress artboard');
await page.evaluate((id) => window.__atelier.store.getState().setSelection([id]), board);
await settle(page);
const label = await page.evaluate((id) => {
  const el = document.querySelector(`[data-artboard-label="${id}"]`);
  const b = el.getBoundingClientRect();
  return { x: b.x + 10, y: b.y + b.height / 2 };
}, board);
await page.mouse.move(label.x, label.y);
await page.mouse.down();
let step = 0;
const drag = await measure('drag artboard (doc update/frame)', 90, async () => {
  step += 1;
  await page.mouse.move(label.x + step * 3, label.y + step * 2);
});
await page.mouse.up();
await settle(page);

// 4. Resize an auto-layout card: every frame re-flows the cards of its row.
await page.evaluate(() => window.__atelier.store.getState().setSelection([]));
const card = await idByName(page, 'Card 5');
await page.evaluate((id) => window.__atelier.store.getState().setSelection([id]), card);
await page.evaluate(() => window.__atelier.canvas().fitSelection());
await settle(page);
const handle = await page.evaluate(() => {
  const h = document.querySelector('[data-handle="e"]').getBoundingClientRect();
  return { x: h.x + h.width / 2, y: h.y + h.height / 2 };
});
await page.mouse.move(handle.x, handle.y);
await page.mouse.down();
let rs = 0;
const resize = await measure('resize card (reflow row)', 60, async () => {
  rs += 1;
  await page.mouse.move(handle.x - rs * 2, handle.y);
});
await page.mouse.up();
await settle(page);

// 5. Click-select at depth (hit testing + overlay) across many nodes.
const cardC = await centerOf(page, card);
await page.mouse.move(cardC.x, cardC.y);
const hover = await measure('hover over nodes', 60, (i) =>
  page.mouse.move(cardC.x + (i % 10) * 4, cardC.y + (i % 7) * 4),
);

// Budgets (docs/13): interaction < 16 ms/frame on 500 nodes. Software-rendered headless Chrome is
// pessimistic, so the pass bar is the average interval, and the numbers above are the report.
for (const [name, res] of Object.entries({ pan, zoom, drag, resize, hover })) {
  r.check(`${name}: average frame under 20 ms (>= 50 fps)`, res.avgMs < 20, `${res.avgMs} ms`);
}
r.check('no console errors', t.errors.length === 0, t.errors.slice(0, 2).join(' | '));

await t.close();
process.exit(r.failures === 0 ? 0 : 1);
