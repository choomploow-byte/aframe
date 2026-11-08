// Renders the "professional" template screens to site/img/pro-*.png for the professional website.
// Each is the real app's own PNG export of the template's screen (no mock-ups), plus two shots of
// the editor itself (light and dark) with the landing template open.
// Run: node scripts/render-site-shots.mjs      (needs Chrome; CHROME_PATH if not in a standard place)
import { writeFileSync } from 'node:fs';
import { settle, start } from '../tests/e2e/harness.mjs';

const SHOTS = [
  { template: 'landing', file: 'pro-landing.png', scale: 1 },
  { template: 'pricing', file: 'pro-pricing.png', scale: 1 },
  { template: 'mobile', file: 'pro-mobile.png', scale: 2 },
];

const t = await start({ width: 1500, height: 940 });
try {
  for (const { template, file, scale } of SHOTS) {
    await t.page.evaluate((name) => window.__aframe.loadTemplate(name), template);
    await settle(t.page);
    const out = await t.page.evaluate(async (sc) => {
      const { captureExport } = await import('/src/canvas/screenshot.ts');
      const s = window.__aframe.store.getState();
      const root = s.doc.nodes[s.doc.rootId];
      const first = root.children[root.children.length - 1]; // the screen; the first is the components sheet
      return captureExport(s.doc, s.viewport.zoom, {
        nodeId: first,
        format: 'png',
        scale: sc,
        transparent: false,
      });
    }, scale);
    writeFileSync(`site/img/${file}`, Buffer.from(out.dataBase64, 'base64'));
    console.log(`${file}  ${out.width}x${out.height}`);
  }
  // The editor itself, light and dark.
  await t.page.evaluate(() => window.__aframe.loadTemplate('landing'));
  await settle(t.page);
  await t.page.evaluate(() => {
    // Select the screen (so Design shows its properties), zoomed to fill the canvas.
    const a = window.__aframe;
    const s = a.store.getState();
    const screen = s.doc.nodes[s.doc.rootId].children.at(-1);
    s.setSelection([screen]);
    a.canvas()?.fitSelection();
  });
  await settle(t.page);
  for (const scheme of ['light', 'dark']) {
    await t.page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await settle(t.page);
    await t.page.screenshot({ path: `site/img/pro-editor-${scheme}.png`, type: 'png' });
    console.log(`pro-editor-${scheme}.png`);
  }
  if (t.errors.length) console.log('console errors:', t.errors.slice(0, 3));
} finally {
  await t.close();
}
