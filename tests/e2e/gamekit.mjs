// Game-UI editing kit e2e, in real Chrome with the real mouse: snapping while dragging and resizing
// (edges, centres, equal gaps, the on/off switch), the Widgets tab and themes, the Arrange buttons,
// outlined and gradient text, and tiled images. SHOT_DIR=<dir> saves PNGs.
// Run: node tests/e2e/gamekit.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  centerOf,
  idByName,
  near,
  node,
  reporter,
  settle,
  setViewport,
  start,
} from './harness.mjs';

const t = await start({ width: 1500, height: 940 });
const { page } = t;
const r = reporter();
const { check } = r;
const SHOT_DIR = process.env.SHOT_DIR;
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });

const dispatch = (ops) =>
  page.evaluate((o) => {
    const res = window.__aframe.store.getState().dispatch(o, { label: 'test' });
    return res.ok ? { ok: true, created: res.created, idMap: res.idMap } : res;
  }, ops);
const guides = () => page.evaluate(() => window.__aframe.store.getState().transient?.guides ?? []);
const F = (name) => `[data-field="${name}"]`;
const shot = async (name) => {
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
};

await page.evaluate(() => {
  localStorage.removeItem('aframe.snap');
  window.__aframe.loadBlank();
});
await settle(page);
await setViewport(page, { zoom: 1, x: 40, y: 40 });

// ---- a stage with three boxes -------------------------------------------------------------
const made = await dispatch([
  {
    op: 'create',
    parentId: await page.evaluate(() => window.__aframe.store.getState().doc.rootId),
    node: {
      type: 'frame',
      tempId: 'stage',
      name: 'Stage',
      layout: 'none',
      x: 0,
      y: 0,
      w: 800,
      h: 500,
      fill: '#FFFFFF',
      children: [
        { type: 'rect', name: 'A', x: 50, y: 50, w: 100, h: 60, fill: '#FF8800' },
        { type: 'rect', name: 'B', x: 400, y: 50, w: 100, h: 60, fill: '#0088FF' },
        { type: 'rect', name: 'C', x: 190, y: 56, w: 60, h: 60, fill: '#22AA55' },
      ],
    },
  },
]);
check('the stage is built', made.ok === true, JSON.stringify(made));
await settle(page);
const A = await idByName(page, 'A');
const B = await idByName(page, 'B');
const C = await idByName(page, 'C');

// ---- snapping: equal gaps -----------------------------------------------------------------
// C moves so its left edge is at 242. A..B gap is 150..400 = 250; C is 60 wide: centred x = 245.
async function dragC(toX, toY) {
  const from = await centerOf(page, C);
  const to = {
    x: from.x + (toX - (await node(page, C)).x),
    y: from.y + (toY - (await node(page, C)).y),
  };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  const live = await guides();
  await page.mouse.up();
  await settle(page);
  return live;
}
const live = await dragC(242, 62);
let c = await node(page, C);
check(
  'dragging a layer between two others centres it (equal gaps)',
  near(c.x, 245, 0.6),
  JSON.stringify(c),
);
check(
  'equal-gap markers with the gap size are shown while dragging',
  live.filter((g) => g.kind === 'gap').length >= 2 && live.some((g) => g.label === '95'),
  JSON.stringify(live),
);
await shot('snap-gaps');

// ---- snapping: edge alignment with a layer in the same row ---------------------------------
await dragC(260, 53); // top edge 3px from A's top (50)
c = await node(page, C);
check("top edge snaps to another layer's top", near(c.y, 50, 0.6), JSON.stringify(c));

// ---- Ctrl skips snapping once, and the switch turns it off --------------------------------
await dragC(250, 60);
await page.keyboard.down('Control');
await dragC(260, 53);
await page.keyboard.up('Control');
c = await node(page, C);
check('holding Ctrl while dragging skips snapping', near(c.y, 53, 0.6), JSON.stringify(c));

await page.click('[data-testid="snap-toggle"]');
await settle(page);
await dragC(242, 62);
c = await node(page, C);
check(
  'with snapping off the layer lands exactly where it is dropped',
  near(c.x, 242, 0.6) && near(c.y, 62, 0.6),
  JSON.stringify(c),
);
const persisted = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('aframe.snap') ?? '{}'),
);
check(
  'the switch is remembered, and is not in the design',
  persisted.enabled === false &&
    !(await page.evaluate(() =>
      JSON.stringify(window.__aframe.store.getState().doc).includes('snap'),
    )),
);
await page.keyboard.press('Escape');
await page.keyboard.down('Shift');
await page.keyboard.press('KeyS');
await page.keyboard.up('Shift');
await settle(page);
check(
  'Shift+S turns snapping back on',
  (await page.evaluate(() => JSON.parse(localStorage.getItem('aframe.snap')))).enabled === true,
);

// ---- snapping while resizing ----------------------------------------------------------------
await page.evaluate((id) => window.__aframe.store.getState().setSelection([id]), A);
await settle(page);
const eHandle = await page.$eval('[data-handle="e"]', (el) => {
  const b = el.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
await page.mouse.move(eHandle.x, eHandle.y);
await page.mouse.down();
await page.mouse.move(eHandle.x + 246, eHandle.y, { steps: 10 }); // right edge ~396, B's left is 400
const resizeGuides = await guides();
await page.mouse.up();
await settle(page);
const a = await node(page, A);
check(
  'resizing pulls the dragged edge onto another layer (right edge at 400)',
  near(a.x + a.w, 400, 0.6),
  JSON.stringify(a),
);
check(
  'a guide is drawn while resizing',
  resizeGuides.some((g) => g.axis === 'x' && near(g.at, 400, 0.6)),
  JSON.stringify(resizeGuides),
);

// ---- grid snapping from the options menu -----------------------------------------------------
await page.click('[data-testid="snap-options"]');
await page.select('[data-testid="snap-grid"]', '8');
await page.click('[data-testid="snap-objects"]');
await page.click('[data-testid="snap-spacing"]');
await page.keyboard.press('Escape');
await settle(page);
await page.evaluate((id) => window.__aframe.store.getState().setSelection([id]), C);
await dragC(303, 203);
c = await node(page, C);
// grid is in world units; the layer sits in a frame at 0,0 so local equals world
check(
  'with only the grid on, positions land on multiples of 8',
  c.x % 8 === 0 && c.y % 8 === 0,
  JSON.stringify(c),
);
await page.evaluate(() => localStorage.removeItem('aframe.snap'));

// ---- arrange buttons ---------------------------------------------------------------------------
await page.evaluate(() => window.__aframe.store.getState().setSelection([]));
await dispatch([
  { op: 'update', id: A, set: { x: 20, y: 300, w: 100, h: 60 } },
  { op: 'update', id: B, set: { x: 220, y: 340, w: 60, h: 40 } },
  { op: 'update', id: C, set: { x: 500, y: 310, w: 80, h: 50 } },
]);
await page.evaluate((ids) => window.__aframe.store.getState().setSelection(ids), [A, B, C]);
await settle(page);
await page.click(F('align-top'));
await settle(page);
let tops = [(await node(page, A)).y, (await node(page, B)).y, (await node(page, C)).y];
check(
  'Align top lines the three layers up',
  tops.every((y) => y === 300),
  JSON.stringify(tops),
);
await page.click(F('distribute-h'));
await settle(page);
const [na, nb, nc] = [await node(page, A), await node(page, B), await node(page, C)];
check(
  'Distribute horizontally evens the gaps',
  near(nb.x - (na.x + na.w), nc.x - (nb.x + nb.w), 0.5),
  JSON.stringify([na.x, nb.x, nc.x]),
);
await page.click(F('match-h'));
await settle(page);
check(
  'Same height matches the tallest',
  (await node(page, B)).h === 60 && (await node(page, C)).h === 60,
);
await page.click(F('flipX'));
await settle(page);
check(
  'Flip horizontally mirrors every selected layer',
  (await node(page, A)).flipX === true && (await node(page, C)).flipX === true,
);
await page.evaluate(() => window.__aframe.store.getState().undo());
check('flip is one undo step', (await node(page, A)).flipX !== true);

// ---- Widgets tab and themes ----------------------------------------------------------------------
await page.evaluate(
  (id) => window.__aframe.store.getState().setSelection([id]),
  await idByName(page, 'Stage'),
);
for (const tab of await page.$$('[role="tab"]')) {
  if ((await tab.evaluate((e) => e.textContent)) === 'Widgets') await tab.click();
}
await settle(page);
check(
  'the Widgets tab lists the widgets and themes',
  (await page.$$('[data-widget]')).length === 16 && (await page.$$('[data-theme-id]')).length >= 6,
);
await page.click('[data-widget="button"]');
await settle(page);
const btn = await idByName(page, 'Button');
check(
  'clicking a widget adds it, selected, inside the selected frame',
  btn !== null && (await node(page, btn)).parentId === (await idByName(page, 'Stage')),
);
const outlined = await page.evaluate((id) => {
  const el = document.querySelector(`[data-node-id="${id}"] [data-node-id]`);
  return el ? getComputedStyle(el).webkitTextStrokeWidth : null;
}, btn);
check("the widget's label is outlined", outlined !== null && outlined !== '0px', String(outlined));
await page.click('[data-theme-id="candy-pop"]');
await settle(page);
const prim = await page.evaluate(() => window.__aframe.store.getState().doc.tokens.colors.primary);
check('picking a theme sets the tokens', prim === '#FF6FB5', prim);
await page.click('[data-widget="progress_bar"]');
await page.click('[data-widget="item_slot"]');
await settle(page);
await shot('widgets');
check(
  'widgets render without console errors',
  t.errors.length === 0,
  t.errors.slice(0, 3).join(' | '),
);

// ---- outlined + gradient text, flip, colour adjust, tiling (really rendered) ---------------------
const lettering = await dispatch([
  {
    op: 'create',
    parentId: await idByName(page, 'Stage'),
    node: {
      type: 'text',
      name: 'Title',
      x: 40,
      y: 400,
      text: 'LEVEL UP',
      fontFamily: 'Lilita One',
      fontSize: 64,
      color: 'linear-gradient(180deg, #FFF3B0, #FFB020)',
      textStroke: '#120B24',
      textStrokeWidth: 5,
      shadow: [{ x: 0, y: 5, blur: 0, spread: 0, color: '#120B24' }],
    },
  },
]);
check('gradient + outlined text is accepted', lettering.ok === true, JSON.stringify(lettering));
await settle(page);
const titleId = await idByName(page, 'Title');
const css = await page.evaluate((id) => {
  const s = getComputedStyle(document.querySelector(`[data-node-id="${id}"]`));
  return {
    clip: s.webkitBackgroundClip,
    fill: s.webkitTextFillColor,
    stroke: s.webkitTextStrokeWidth,
    filter: s.filter,
  };
}, titleId);
check(
  'gradient lettering is clipped to the glyphs, with an outline and a drop shadow',
  css.clip === 'text' && css.stroke === '5px' && css.filter.includes('drop-shadow'),
  JSON.stringify(css),
);
await page.evaluate((id) => window.__aframe.store.getState().setSelection([id]), titleId);
await settle(page);
check(
  'the panel shows the gradient editor for gradient text',
  (await page.$(F('text-fill-type'))) !== null && (await page.$(F('textStroke'))) !== null,
);
await shot('lettering');

// A tiled picture: a 2x2 red/blue checker PNG made in the page.
const tile = await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = '#E63946';
  g.fillRect(0, 0, 8, 8);
  g.fillRect(8, 8, 8, 8);
  g.fillStyle = '#1D3557';
  g.fillRect(8, 0, 8, 8);
  g.fillRect(0, 8, 8, 8);
  return c.toDataURL('image/png');
});
const stored = await page.evaluate(async (dataUrl) => {
  const { addAsset } = await import('/src/core/assets.ts');
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (ch) => ch.charCodeAt(0));
  const s = window.__aframe.store.getState();
  const out = addAsset(s.doc, bytes);
  s.adoptExternal(out.doc, 'asset');
  return out.assetId;
}, tile);
await dispatch([
  {
    op: 'create',
    parentId: await idByName(page, 'Stage'),
    node: {
      type: 'image',
      name: 'Checker',
      assetId: stored,
      fit: 'tile',
      tileSize: 32,
      x: 400,
      y: 380,
      w: 160,
      h: 96,
    },
  },
]);
await settle(page);
const checker = await idByName(page, 'Checker');
const bg = await page.evaluate((id) => {
  const el = document.querySelector(`[data-node-id="${id}"]`);
  const s = getComputedStyle(el);
  return {
    tag: el.tagName,
    repeat: s.backgroundRepeat,
    size: s.backgroundSize,
    image: s.backgroundImage.slice(0, 20),
  };
}, checker);
check(
  'a tiled image is drawn as a repeating background at the tile size',
  bg.tag === 'DIV' &&
    bg.repeat === 'repeat' &&
    bg.size === '32px auto' &&
    bg.image.startsWith('url('),
  JSON.stringify(bg),
);
await page.evaluate((id) => window.__aframe.store.getState().setSelection([id]), checker);
await settle(page);
check('the panel offers Tile and the tile size', (await page.$(F('tileSize'))) !== null);

// The renderer used for screenshots and exports draws the tile as well.
const exported = await page.evaluate(
  async (stage) => {
    const { captureExport } = await import('/src/canvas/screenshot.ts');
    const s = window.__aframe.store.getState();
    const out = await captureExport(s.doc, 1, {
      nodeId: stage,
      format: 'png',
      scale: 1,
      transparent: false,
    });
    return out.dataBase64;
  },
  await idByName(page, 'Stage'),
);
if (SHOT_DIR) writeFileSync(join(SHOT_DIR, 'stage-export.png'), Buffer.from(exported, 'base64'));
const { PNG } = await import('pngjs');
const png = PNG.sync.read(Buffer.from(exported, 'base64'));
const px = (x, y) => {
  const i = (png.width * y + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
};
// Tile = 32px, quadrants of 16px: (400..416, 380..396) is red, the next 16px to the right is blue.
const red = px(408, 388);
const blue = px(424, 388);
check(
  'the screenshot renderer tiles the picture (red then blue, then repeats)',
  red[0] > 200 && red[2] < 100 && blue[2] > 60 && blue[0] < 60 && px(408 + 32, 388)[0] > 200,
  JSON.stringify([red, blue, px(440, 388)]),
);

check(
  'no console errors in the whole run',
  t.errors.length === 0,
  t.errors.slice(0, 3).join(' | '),
);
await t.close();
console.log(
  r.failures === 0 ? '\nGame kit checks passed.' : `\n${r.failures} game kit check(s) failed.`,
);
process.exit(r.failures === 0 ? 0 : 1);
