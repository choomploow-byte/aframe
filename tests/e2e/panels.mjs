// Phase 3 e2e: the panels, driven like a user (real mouse, real keyboard) in system Chrome.
// Covers: theme (no flash, persisted), every property reachable, a landing hero built by hand,
// keyboard-only editing, layer drag/drop, tokens, assets and image import (picker, paste, drop,
// rejection of non-images), command palette, shortcut sheet, context menus and an accessible-name
// audit. Optional: SHOT_DIR=<dir> saves light/dark screenshots there.
// Run: node tests/e2e/panels.mjs
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import {
  canvasBox,
  centerOf,
  drag,
  idByName,
  node,
  press,
  reporter,
  setViewport,
  settle,
  start,
  state,
  worldToClient,
} from './harness.mjs';

const t = await start({ width: 1360, height: 900 });
const { page } = t;
const r = reporter();
const { check } = r;
const SHOT_DIR = process.env.SHOT_DIR;
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'aframe-e2e-'));

// ---- helpers --------------------------------------------------------------------------------
const F = (name) => `[data-field="${name}"]`;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const doc = () =>
  page.evaluate(() => JSON.parse(JSON.stringify(window.__aframe.store.getState().doc)));
const nodes = async () => (await doc()).nodes;
const setSelection = (ids) =>
  page
    .evaluate((x) => window.__aframe.store.getState().setSelection(x), ids)
    .then(() => settle(page));
const selectByName = async (name) => {
  const id = await idByName(page, name);
  if (!id) throw new Error(`no layer named ${name}`);
  await setSelection([id]);
  return id;
};
const resetSample = async () => {
  await page.evaluate(() => window.__aframe.loadSample());
  await page.evaluate(() => window.__aframe.canvas().fitAll());
  await settle(page);
};
const openTab = async (id) => {
  await page.click(`[data-tab="${id}"]`);
  await settle(page);
};
/** Types into a number/text field (selects its content first) and commits with Enter. */
const setField = async (name, value) => {
  await page.click(F(name), { clickCount: 3 });
  await page.keyboard.type(String(value));
  await page.keyboard.press('Enter');
  // Enter commits and keeps focus (so a follow-up edit is quick); let go so tool keys are not typed in.
  await page.evaluate(() => document.activeElement?.blur());
  await settle(page);
};
/** Clicks one option of a segmented control by its visible label. */
const seg = async (field, label) => {
  const h = await page.evaluateHandle(
    (f, l) =>
      [...document.querySelectorAll(`[data-field="${f}"] button`)].find(
        (b) => b.textContent.trim() === l,
      ) ?? null,
    field,
    label,
  );
  const el = h.asElement();
  if (!el) throw new Error(`no ${label} in ${field}`);
  await el.click();
  await settle(page);
};
const pick = async (field, value) => {
  await page.select(F(field), value);
  await settle(page);
};
const toasts = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="toast"]')].map((e) => e.textContent),
  );
const fieldsOnScreen = () =>
  page.evaluate(() => [
    ...new Set([...document.querySelectorAll('[data-field]')].map((e) => e.dataset.field)),
  ]);
const shot = async (name) => {
  if (!SHOT_DIR) return;
  await settle(page);
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
};
const layerRow = (id) => `[data-layer-id="${id}"]`;
async function group(name, fn) {
  console.log(`\n# ${name}`);
  try {
    await fn();
  } catch (e) {
    check(`${name}: threw`, false, String(e?.stack ?? e));
  }
}
/** A valid w x h PNG file on disk. */
function writePng(file, w, h, rgba = [201, 100, 66, 255]) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) png.data.set(rgba, i * 4);
  const path = join(tmp, file);
  writeFileSync(path, PNG.sync.write(png));
  return path;
}
const pngBytes = (w, h, rgba) => [
  ...PNG.sync.write(
    Object.assign(new PNG({ width: w, height: h }), {
      data: Buffer.from(Array.from({ length: w * h }, () => rgba).flat()),
    }),
  ),
];

// ---------------------------------------------------------------------------------------------
await group('welcome and first run', async () => {
  await page.evaluate(() => window.__aframe.loadBlank());
  await settle(page);
  check('an empty canvas shows the welcome', !!(await page.$('[data-testid="welcome"]')));
  check(
    'welcome offers five ways to begin',
    (await page.$$('[data-testid="welcome"] .welcome__card')).length === 5,
  );
  await page.click('[data-action="welcome-draw"]');
  check('"Draw a frame" picks the frame tool', (await state(page)).tool === 'frame');
  await press(page, 'v');
  await page.click('[data-action="welcome-sample"]');
  await page.waitForFunction(() => window.__aframe.store.getState().doc.id === 'p_sample');
  await settle(page);
  check(
    '"Open the sample" loads it and the welcome goes away',
    !(await page.$('[data-testid="welcome"]')),
  );
  check('Layers panel lists the sample artboards', (await page.$$('[data-layer-id]')).length >= 2);
  check(
    'properties say what to do with no selection',
    (await page.$eval('.panel--right', (e) => e.textContent)).includes('Select something'),
  );
});

// ---------------------------------------------------------------------------------------------
await group('theme: toggle, persistence, no flash', async () => {
  await resetSample();
  const pref = () => page.$eval('[data-testid="theme-toggle"]', (e) => e.dataset.themePref);
  const attr = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const stored = () => page.evaluate(() => localStorage.getItem('aframe.theme'));
  await page.evaluate(() => localStorage.removeItem('aframe.theme'));
  check('starts on "system"', (await pref()) === 'system');
  await page.click('[data-testid="theme-toggle"]');
  check('first click → light', (await attr()) === 'light' && (await stored()) === 'light');
  await shot('light-sample');
  await page.click('[data-testid="theme-toggle"]');
  check('second click → dark', (await attr()) === 'dark' && (await stored()) === 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('dark applies the dark palette', bg === 'rgb(38, 38, 36)', bg);
  await shot('dark-sample');

  // Reload with dark saved: the attribute must be set while <body> does not exist yet.
  await page.evaluateOnNewDocument(() => {
    const orig = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (name === 'data-theme' && this === document.documentElement && !window.__themeFirst) {
        window.__themeFirst = {
          value,
          bodyExists: !!document.body,
          readyState: document.readyState,
        };
      }
      return orig.call(this, name, value);
    };
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__aframe?.store.getState().doc.id === 'p_sample');
  const first = await page.evaluate(() => window.__themeFirst);
  check(
    'saved theme applied before <body> existed (no flash)',
    first?.value === 'dark' && first.bodyExists === false && first.readyState === 'loading',
    JSON.stringify(first),
  );
  check('the choice survives a reload', (await pref()) === 'dark');
  await page.click('[data-testid="theme-toggle"]');
  check('third click → back to system', (await attr()) === null && (await stored()) === null);
  await page.click('[data-testid="theme-toggle"]');
  await page.click('[data-testid="theme-toggle"]'); // light → dark so the rest runs in dark? keep light:
  await page.click('[data-testid="theme-toggle"]');
  await page.evaluate(() => window.__aframe.canvas().fitAll());
  await settle(page);
});

// ---------------------------------------------------------------------------------------------
await group('every doc-04 property is reachable from the panels', async () => {
  await resetSample();
  const seen = new Set();
  const collect = async () => {
    // Rarely used sections start closed; open them so their fields are on screen.
    await page.evaluate(() =>
      document
        .querySelectorAll('.section__toggle[aria-expanded="false"]')
        .forEach((b) => b.click()),
    );
    await settle(page);
    (await fieldsOnScreen()).forEach((f) => seen.add(f));
  };
  // A frame with auto layout, a text node, a plain frame with no layout, and (below) an image.
  for (const name of ['Hero', 'Headline', 'Landing - Desktop', 'Logo']) {
    await selectByName(name);
    await collect();
  }
  // Rectangle and ellipse via the draw tools.
  await page.evaluate(() => {
    const s = window.__aframe.store.getState();
    s.dispatch(
      [
        {
          op: 'create',
          parentId: s.doc.rootId,
          node: {
            type: 'ellipse',
            tempId: 'e',
            name: 'Dot',
            x: 0,
            y: 1500,
            w: 50,
            h: 50,
            fill: '#ff0000',
          },
        },
        {
          op: 'create',
          parentId: s.doc.rootId,
          node: {
            type: 'rect',
            tempId: 'r',
            name: 'Box',
            x: 100,
            y: 1500,
            w: 50,
            h: 50,
            fill: '#00ff00',
          },
        },
      ],
      { label: 'Scratch' },
    );
  });
  for (const name of ['Dot', 'Box']) {
    await selectByName(name);
    await collect();
  }
  // Add a shadow, then a gradient fill, to reveal their sub-fields.
  await selectByName('Box');
  await page.click('[data-action="add-shadow"]');
  await seg('fill-type', 'Linear');
  await collect();
  // An image node, to reveal the image section.
  const png = writePng('probe.png', 4, 4);
  await openTab('assets');
  const input = await page.$('[data-testid="asset-file-input"]');
  await input.uploadFile(png);
  await page.waitForFunction(
    () => Object.keys(window.__aframe.store.getState().doc.assets).length > 0,
  );
  await page.click('.asset__thumb');
  await settle(page);
  await collect();
  await openTab('layers');

  const required = [
    'name',
    'role',
    'href',
    'opacity',
    'visible',
    'locked',
    'x',
    'y',
    'w',
    'h',
    'w-mode',
    'h-mode',
    'rotation',
    'layout',
    'gap',
    'padding-t',
    'padding-r',
    'padding-b',
    'padding-l',
    'align',
    'justify',
    'wrap',
    'clip',
    'fill-type',
    'fill',
    'gradient-angle',
    'stroke',
    'strokeWidth',
    'strokeAlign',
    'radius',
    'radius-token',
    'radius-tl',
    'radius-tr',
    'radius-br',
    'radius-bl',
    'shadow-0-x',
    'shadow-0-y',
    'shadow-0-blur',
    'shadow-0-spread',
    'shadow-0-color',
    'shadow-0-inset',
    'blur',
    'backdropBlur',
    'hue',
    'saturation',
    'brightness',
    'contrast',
    'align-left',
    'flipX',
    'flipY',
    'textStroke',
    'textStyle',
    'textStrokeWidth',
    'text',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'lineHeight',
    'letterSpacing',
    'textAlign',
    'textTransform',
    'color',
    'fit',
  ];
  const missing = required.filter((f) => !seen.has(f));
  check('all property fields are present', missing.length === 0, `missing: ${missing.join(', ')}`);
  r.info('fields seen', [...seen].sort());
});

// ---------------------------------------------------------------------------------------------
await group('build a landing hero by hand (panels + canvas only)', async () => {
  const t0 = Date.now();
  await page.evaluate(() => window.__aframe.loadBlank());
  await settle(page);
  await setViewport(page, { zoom: 0.5, x: 40, y: 40 });

  // 1. A frame, drawn with the F tool.
  await press(page, 'f');
  const a = await worldToClient(page, 0, 0);
  const b = await worldToClient(page, 1000, 640);
  await drag(page, a, b);
  const s1 = await state(page);
  const hero = s1.selection[0];
  check('drawing a frame selects it', !!hero && (await node(page, hero))?.type === 'frame');
  await setField('name', 'Hero');
  await pick('w-mode', 'fixed');
  await setField('w', 1000);
  await seg('layout', 'Column');
  await setField('gap', 24);
  for (const side of ['t', 'r', 'b', 'l']) await setField(`padding-${side}`, 80);
  await pick('align', 'center');
  await pick('justify', 'center');
  await seg('fill-type', 'Solid');
  await setField('fill', '$surface');
  let n = await node(page, hero);
  check(
    'frame: name, column layout, gap, padding, alignment and token fill',
    n.name === 'Hero' &&
      n.layout === 'column' &&
      n.gap === 24 &&
      n.align === 'center' &&
      n.justify === 'center' &&
      n.fill === '$surface' &&
      JSON.stringify(n.padding) === JSON.stringify([80, 80, 80, 80]),
    JSON.stringify(n),
  );

  // 2. The headline: T tool, click inside the frame, type, Escape.
  await press(page, 't');
  const inside = await worldToClient(page, 500, 200);
  await page.mouse.click(inside.x, inside.y);
  await settle(page);
  await page.keyboard.type('Plan work your team will follow');
  await page.keyboard.press('Escape');
  await settle(page);
  const headId = (await state(page)).selection[0];
  let h = await node(page, headId);
  check(
    'text typed on the canvas lands inside the frame',
    h?.type === 'text' && h.parentId === hero,
    JSON.stringify(h),
  );
  await setField('fontSize', 56);
  await page.click(F('fontFamily'));
  await page.click('[data-font="$font.heading"]');
  await pick('fontWeight', '700');
  await seg('textAlign', 'Center');
  await setField('color', '$text');
  h = await node(page, headId);
  check(
    'text: size, heading font token, weight, alignment and colour token',
    h.fontSize === 56 &&
      h.fontFamily === '$font.heading' &&
      h.fontWeight === 700 &&
      h.textAlign === 'center' &&
      h.color === '$text',
    JSON.stringify(h),
  );
  const css = await page.evaluate((id) => {
    const el = document.querySelector(`[data-node-id="${id}"]`);
    const cs = getComputedStyle(el);
    return { size: cs.fontSize, family: cs.fontFamily, weight: cs.fontWeight };
  }, headId);
  check(
    'the canvas shows what the panel set (56px, Fraunces, 700)',
    css.size === '56px' && /Fraunces/.test(css.family) && css.weight === '700',
    JSON.stringify(css),
  );

  // 3. A button: R tool, draw inside the frame, then size, colour and rounded corners from panels.
  await press(page, 'r');
  const p1 = await worldToClient(page, 420, 400);
  const p2 = await worldToClient(page, 580, 450);
  await drag(page, p1, p2);
  const btnId = (await state(page)).selection[0];
  let btn = await node(page, btnId);
  check(
    'the button rectangle is a child of the frame',
    btn?.type === 'rect' && btn.parentId === hero,
    JSON.stringify(btn),
  );
  await setField('name', 'Button');
  await pick('w-mode', 'fixed');
  await setField('w', 168);
  await pick('h-mode', 'fixed');
  await setField('h', 48);
  await seg('fill-type', 'Solid');
  await setField('fill', '$primary');
  await pick('radius-token', 'md');
  btn = await node(page, btnId);
  check(
    'button: fixed size, token fill, radius token',
    btn.name === 'Button' &&
      btn.w === 168 &&
      btn.h === 48 &&
      btn.fill === '$primary' &&
      btn.radius === '$radius.md',
    JSON.stringify(btn),
  );
  const bg = await page.evaluate(
    (id) => getComputedStyle(document.querySelector(`[data-node-id="${id}"]`)).backgroundColor,
    btnId,
  );
  check('the button renders in the primary colour', bg === 'rgb(91, 60, 176)', bg);
  const secs = (Date.now() - t0) / 1000;
  r.info('time to hand-build the hero (scripted)', `${secs.toFixed(1)}s`);
  check('well under the 5-minute acceptance budget', secs < 120, `${secs}s`);
  const order = (await doc()).nodes[hero].children;
  check(
    'the frame holds headline then button, in that order',
    order[0] === headId && order[1] === btnId,
    JSON.stringify(order),
  );
  await page.evaluate(() => window.__aframe.canvas().fitAll());
  await shot('hero-built');
});

// ---------------------------------------------------------------------------------------------
await group('keyboard only: select, fill, rename, delete', async () => {
  await resetSample();
  const tabTo = async (pred, label, max = 120) => {
    for (let i = 0; i < max; i++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(pred)) return true;
    }
    throw new Error(`Tab never reached ${label}`);
  };
  await page.evaluate(() => document.activeElement?.blur());
  const positions = async () =>
    JSON.stringify(Object.values(await nodes()).map((x) => [x.id, x.x, x.y]));
  const positionsBefore = await positions();
  // Reach the layer tree with Tab alone.
  await tabTo(() => !!document.activeElement?.closest('[role="tree"]'), 'the layer tree');
  check('Tab reaches the layer tree', true);
  // Walk to "Landing - Desktop" with the arrows, open it and go to Hero.
  const focusedName = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  for (let i = 0; i < 6 && (await focusedName()) !== 'Landing - Desktop'; i++)
    await page.keyboard.press('ArrowDown');
  check(
    'arrows move through layers',
    (await focusedName()) === 'Landing - Desktop',
    await focusedName(),
  );
  await page.keyboard.press('ArrowRight'); // expand
  for (let i = 0; i < 8 && (await focusedName()) !== 'Hero'; i++)
    await page.keyboard.press('ArrowDown');
  await settle(page);
  const heroId = await idByName(page, 'Hero');
  check('arrow keys select as they go', (await state(page)).selection[0] === heroId);
  check(
    'arrow keys in the tree walk the tree; they do not nudge nodes on the canvas',
    (await positions()) === positionsBefore,
  );

  // Rename with F2.
  await page.keyboard.press('F2');
  await page.keyboard.type('Hero section');
  await page.keyboard.press('Enter');
  await settle(page);
  check('F2 renames the layer', (await node(page, heroId)).name === 'Hero section');

  // Change the fill from the properties panel using Tab only (Hero has no fill: set Solid first).
  await tabTo(
    () => !!document.activeElement?.closest('[data-field="fill-type"]'),
    'the fill type control',
  );
  await page.keyboard.press('ArrowRight'); // None → Solid in the radio group
  await page.keyboard.press('Space');
  await settle(page);
  let hn = await node(page, heroId);
  check('fill type changed by keyboard', typeof hn.fill === 'string', JSON.stringify(hn.fill));
  await tabTo(
    () => document.activeElement?.getAttribute('data-field') === 'fill',
    'the fill colour field',
  );
  await page.keyboard.type('#123456');
  await page.keyboard.press('Enter');
  await settle(page);
  hn = await node(page, heroId);
  check('fill typed by keyboard', hn.fill === '#123456', JSON.stringify(hn.fill));
  check('every edit is its own undo step', (await state(page)).past.length >= 2);

  // Delete from the layer tree.
  await page.focus(layerRow(heroId));
  const before = (await state(page)).nodeCount;
  const kids = (await doc()).nodes[heroId].children.length;
  await page.keyboard.press('Delete');
  await settle(page);
  check(
    'Delete removes the layer and its children',
    (await state(page)).nodeCount <= before - 1 - kids,
    `${before} → ${(await state(page)).nodeCount}`,
  );
  check('the layer is gone from the panel', !(await page.$(layerRow(heroId))));
  await press(page, 'Control+z');
  check(
    'Ctrl+Z brings it back',
    !!(await page.$(layerRow(heroId))) || (await idByName(page, 'Hero section')) === heroId,
  );
});

// ---------------------------------------------------------------------------------------------
await group('layers panel: visibility, lock, filter, drag to reorder and reparent', async () => {
  await resetSample();
  const headline = await selectByName('Headline');
  const subhead = await idByName(page, 'Subhead');
  const ctaRow = await idByName(page, 'CTA Row');
  const hero = await idByName(page, 'Hero');
  const kids = async () => (await doc()).nodes[hero].children;
  const before = await kids();
  r.info(
    'hero children before',
    before.map((id) => id.slice(0, 7)),
  );

  // Drag Subhead above Headline.
  const rowBox = async (id) =>
    page.$eval(layerRow(id), (el) => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
  const dragRow = async (fromId, toId, zone) => {
    const from = await rowBox(fromId);
    const to = await rowBox(toId);
    const y = zone === 'above' ? to.y + 3 : zone === 'below' ? to.y + to.h - 3 : to.y + to.h / 2;
    await page.mouse.move(from.x + 60, from.y + from.h / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 60, y, { steps: 10 });
    await page.mouse.up();
    await settle(page);
  };
  const pos = (arr, id) => arr.indexOf(id);
  const hi = pos(before, headline);
  const si = pos(before, subhead);
  const undoDepth = (await state(page)).past.length;
  // The panel lists the front-most child first, so "above Subhead" in the panel is later in children.
  await dragRow(headline, subhead, 'above');
  let after = await kids();
  check(
    'dragging a row reorders it',
    pos(after, headline) !== hi || pos(after, subhead) !== si,
    JSON.stringify([before, after].map((a) => a.map((x) => x.slice(0, 5)))),
  );
  check(
    'reorder is one undo step',
    (await state(page)).past.length === undoDepth + 1,
    `${undoDepth} → ${(await state(page)).past.length}`,
  );
  await press(page, 'Control+z');
  check('undo restores the order', JSON.stringify(await kids()) === JSON.stringify(before));

  // Drag Headline into CTA Row (reparent).
  await dragRow(headline, ctaRow, 'inside');
  const moved = (await node(page, headline)).parentId;
  check('dropping on the middle of a frame row reparents into it', moved === ctaRow, moved);
  await press(page, 'Control+z');
  check('undo puts it back', (await node(page, headline)).parentId === hero);

  // A drop onto its own descendant must be refused (no cycle).
  await selectByName('Landing - Desktop');
  const landing = await idByName(page, 'Landing - Desktop');
  await dragRow(landing, ctaRow, 'inside');
  check('cannot drop a layer into its own child', (await node(page, landing)).parentId !== ctaRow);

  // Visibility and lock buttons.
  await selectByName('Headline');
  await page.hover(layerRow(headline));
  await page.click(`${layerRow(headline)} button[aria-label^="Hide"]`);
  check('eye button hides the node', (await node(page, headline)).visible === false);
  const hiddenOnCanvas = await page.evaluate((id) => {
    const el = document.querySelector(`[data-node-id="${id}"]`);
    return (
      !el || getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden'
    );
  }, headline);
  check('and it disappears from the canvas', hiddenOnCanvas);
  await page.click(`${layerRow(headline)} button[aria-label^="Show"]`);
  await page.click(`${layerRow(headline)} button[aria-label^="Lock"]`);
  check('lock button locks the node', (await node(page, headline)).locked === true);
  await page.click(`${layerRow(headline)} button[aria-label^="Unlock"]`);
  check('and unlocks it', (await node(page, headline)).locked === false);

  // Filter.
  await page.type('[aria-label="Filter layers"]', 'subhead');
  await settle(page);
  const names = await page.$$eval('[data-layer-id]', (els) =>
    els.map((e) => e.getAttribute('aria-label')),
  );
  check(
    'filter narrows the tree to matches and their ancestors',
    names.includes('Subhead') && !names.includes('Headline'),
    names.join(', '),
  );
  await page.click('[aria-label="Filter layers"]', { clickCount: 3 });
  await page.keyboard.press('Escape');
  await settle(page);
  check('Esc clears the filter', (await page.$$('[data-layer-id]')).length > names.length);

  // Double-click renames.
  const box = await rowBox(subhead);
  await page.mouse.click(box.x + 80, box.y + box.h / 2, { clickCount: 2 });
  await settle(page);
  check('double-click opens the rename field', !!(await page.$('input[aria-label="Layer name"]')));
  await page.keyboard.press('Escape');
  check('Esc cancels the rename', (await node(page, subhead)).name === 'Subhead');
});

// ---------------------------------------------------------------------------------------------
await group('tokens: edit, rename, extract, delete', async () => {
  await resetSample();
  await openTab('tokens');
  const usesBefore = await nodes();
  const withPrimary = Object.values(usesBefore).filter((x) => x.fill === '$primary').length;
  check('the sample uses the primary token', withPrimary > 0, String(withPrimary));

  // Edit a value.
  await setField('token-color-primary', '#2255aa');
  let d = await doc();
  check(
    'editing a colour token changes the design token',
    d.tokens.colors.primary.toLowerCase() === '#2255aa',
    d.tokens.colors.primary,
  );
  const primaryNode = Object.values(d.nodes).find((x) => x.fill === '$primary');
  const bg = await page.evaluate(
    (id) => getComputedStyle(document.querySelector(`[data-node-id="${id}"]`)).backgroundColor,
    primaryNode.id,
  );
  check('and every node using it re-renders', bg === 'rgb(34, 85, 170)', bg);

  // Rename: references follow.
  await setField('token-name-color-primary', 'brand');
  d = await doc();
  const stillPrimary = Object.values(d.nodes).filter((x) => x.fill === '$primary').length;
  const nowBrand = Object.values(d.nodes).filter((x) => x.fill === '$brand').length;
  check(
    'renaming rewrites every reference',
    stillPrimary === 0 &&
      nowBrand === withPrimary &&
      'brand' in d.tokens.colors &&
      !('primary' in d.tokens.colors),
    JSON.stringify({ stillPrimary, nowBrand }),
  );
  check(
    'rename is a single undo step',
    (await state(page)).past.at(-1)?.toLowerCase().includes('rename'),
    (await state(page)).past.at(-1),
  );
  await press(page, 'Control+z');
  d = await doc();
  check(
    'undo restores name and references',
    'primary' in d.tokens.colors &&
      Object.values(d.nodes).filter((x) => x.fill === '$primary').length === withPrimary,
  );

  // A clashing name is refused.
  await setField('token-name-color-primary', 'surface');
  d = await doc();
  check(
    'a name already in use is refused and flagged',
    'primary' in d.tokens.colors &&
      'surface' in d.tokens.colors &&
      (await toasts()).some((s) => /surface/.test(s)),
    (await toasts()).join('|'),
  );
  await page.keyboard.press('Escape');

  // Delete detaches (nodes keep the literal value).
  await page.click('[data-token-row="muted"] [data-action="delete-token"]');
  await settle(page);
  d = await doc();
  check('deleting a token removes it', !('muted' in d.tokens.colors));
  check(
    'nodes that used it keep its value',
    Object.values(d.nodes).every((x) => x.fill !== '$muted' && x.color !== '$muted'),
  );
  check(
    'a toast offers Undo',
    (await toasts()).some((s) => /Deleted "muted"/.test(s) && /Undo/.test(s)),
    (await toasts()).join('|'),
  );
  await press(page, 'Control+z');
  check('undo brings the token back', 'muted' in (await doc()).tokens.colors);

  // Add token + extract from selection.
  const colourCount = Object.keys((await doc()).tokens.colors).length;
  await page.click('[data-action="add-color-token"]');
  check(
    '+ adds a new colour token',
    Object.keys((await doc()).tokens.colors).length === colourCount + 1,
  );
  await page.evaluate(() => {
    const s = window.__aframe.store.getState();
    s.dispatch(
      [
        {
          op: 'create',
          parentId: s.doc.rootId,
          node: {
            type: 'rect',
            tempId: 'x',
            name: 'Swatch',
            x: 0,
            y: 1500,
            w: 40,
            h: 40,
            fill: '#7a1fa2',
          },
        },
      ],
      { label: 'Scratch' },
    );
  });
  await selectByName('Swatch');
  await page.click('[data-action="extract-token"]');
  await settle(page);
  d = await doc();
  const sw = Object.values(d.nodes).find((x) => x.name === 'Swatch');
  const tokName = /^\$(.+)$/.exec(sw.fill)?.[1];
  check(
    '"Create token from selection" tokenises the colour and applies it',
    !!tokName && d.tokens.colors[tokName] === '#7a1fa2',
    JSON.stringify(sw.fill),
  );

  // Spacing scale + fonts + radii are editable too.
  const sp = await fieldsOnScreen();
  check(
    'spacing, font and radius tokens are editable',
    sp.some((f) => f.startsWith('spacing-')) &&
      sp.some((f) => f.startsWith('token-font-')) &&
      sp.some((f) => f.startsWith('token-radius-')),
    sp.filter((f) => f.startsWith('token') || f.startsWith('spacing')).join(','),
  );
  await shot('light-tokens');
  await openTab('layers');
});

// ---------------------------------------------------------------------------------------------
await group('assets: import by picker, paste and drop; reject non-images', async () => {
  await resetSample();
  await openTab('assets');
  const assetCount = async () => Object.keys((await doc()).assets).length;
  const base = await assetCount();
  const input = await page.$('[data-testid="asset-file-input"]');

  // Picker with a valid PNG.
  await input.uploadFile(writePng('a.png', 8, 8));
  await page.waitForFunction(
    (n) => Object.keys(window.__aframe.store.getState().doc.assets).length === n + 1,
    {},
    base,
  );
  check('picker: a PNG becomes an asset', (await assetCount()) === base + 1);
  check('and shows up in the Assets panel', (await page.$$('[data-asset-id]')).length === base + 1);

  // A text file renamed .png is refused with a message that names the file.
  const fake = join(tmp, 'notes.png');
  writeFileSync(fake, 'this is not an image at all');
  await input.uploadFile(fake);
  await sleep(300);
  check('picker: a non-image is rejected', (await assetCount()) === base + 1);
  check(
    'and the toast names the file and says what is accepted',
    (await toasts()).some((s) => s.includes('notes.png') && /PNG|JPEG|image/i.test(s)),
    (await toasts()).join('|'),
  );

  // SVG is accepted but only ever shown through <img>, where scripts do not run.
  const svg = join(tmp, 'x.svg');
  writeFileSync(
    svg,
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>parent.__svgRan = 1</script><rect width="10" height="10"/></svg>',
  );
  await input.uploadFile(svg);
  await page
    .waitForFunction(
      (n) => Object.keys(window.__aframe.store.getState().doc.assets).length === n + 2,
      { timeout: 3000 },
      base,
    )
    .catch(() => {});
  check(
    'picker: an SVG is stored as an image asset',
    (await assetCount()) === base + 2,
    String(await assetCount()),
  );
  await page.click('.asset__thumb:last-of-type').catch(() => {});
  await sleep(300);
  check(
    'an SVG with a <script> never runs it',
    (await page.evaluate(() => window.__svgRan)) === undefined,
  );
  const baseAssets = await assetCount();

  // Paste: an image on the clipboard drops into the view centre.
  const imagesBefore = Object.values(await nodes()).filter((x) => x.type === 'image').length;
  await page.evaluate(
    (bytes) => {
      const file = new File([new Uint8Array(bytes)], 'pasted.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      document.body.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    },
    pngBytes(6, 6, [10, 120, 200, 255]),
  );
  await page
    .waitForFunction(
      (n) =>
        Object.values(window.__aframe.store.getState().doc.nodes).filter((x) => x.type === 'image')
          .length ===
        n + 1,
      { timeout: 3000 },
      imagesBefore,
    )
    .catch(() => {});
  const imagesAfter = Object.values(await nodes()).filter((x) => x.type === 'image').length;
  check(
    'paste: an image on the clipboard becomes an image node',
    imagesAfter === imagesBefore + 1,
    `${imagesBefore} → ${imagesAfter}`,
  );
  check(
    'paste: the asset is stored in the document',
    (await assetCount()) === baseAssets + 1,
    `${baseAssets} → ${await assetCount()}`,
  );

  // Drop on the canvas at a specific spot.
  const cb = await canvasBox(page);
  const at = { x: cb.x + 300, y: cb.y + 300 };
  await page.evaluate(
    (bytes, p) => {
      const file = new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const canvas = document.querySelector('[data-testid="canvas"]');
      canvas.dispatchEvent(
        new DragEvent('dragover', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: p.x,
          clientY: p.y,
        }),
      );
      canvas.dispatchEvent(
        new DragEvent('drop', {
          dataTransfer: dt,
          bubbles: true,
          cancelable: true,
          clientX: p.x,
          clientY: p.y,
        }),
      );
    },
    pngBytes(5, 5, [0, 0, 0, 255]),
    at,
  );
  await page
    .waitForFunction(
      (n) =>
        Object.values(window.__aframe.store.getState().doc.nodes).filter((x) => x.type === 'image')
          .length ===
        n + 2,
      { timeout: 3000 },
      imagesBefore,
    )
    .catch(() => {});
  const dropped = Object.values(await nodes())
    .filter((x) => x.type === 'image')
    .at(-1);
  check(
    'drop: an image dropped on the canvas becomes a node',
    (await nodes()) &&
      Object.values(await nodes()).filter((x) => x.type === 'image').length === imagesBefore + 2,
  );
  if (dropped) {
    const rect = await page.evaluate((id) => {
      const b = document.querySelector(`[data-node-id="${id}"]`).getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    }, dropped.id);
    check(
      'and it lands under the cursor',
      at.x >= rect.x - 4 &&
        at.x <= rect.x + rect.w + 4 &&
        at.y >= rect.y - 4 &&
        at.y <= rect.y + rect.h + 4,
      JSON.stringify({ at, rect }),
    );
  }

  // Panel actions.
  const firstAsset = await page.$eval('[data-asset-id]', (e) => e.dataset.assetId);
  await page.click(`[data-asset-id="${firstAsset}"] [data-action="make-reference"]`);
  await settle(page);
  check(
    '"Use as reference" adds a reference',
    (await doc()).references.length === 1,
    JSON.stringify((await doc()).references),
  );
  await page.click(`[data-asset-id="${firstAsset}"] [data-action="delete-asset"]`);
  await settle(page);
  const used = Object.values(await nodes()).some(
    (x) => x.type === 'image' && x.assetId === firstAsset,
  );
  const left = await assetCount();
  r.info('first asset still used by a node', used);
  check(
    'deleting an image asset removes it (and the images using it) or is refused with a message',
    left === baseAssets + 2 - 1 || (await toasts()).length > 0,
    `${baseAssets + 2} → ${left}`,
  );
  await shot('light-assets');
  await openTab('layers');
});

// ---------------------------------------------------------------------------------------------
await group('command palette, shortcut sheet and context menus', async () => {
  await resetSample();
  const hero = await selectByName('Hero');
  await page.focus(layerRow(hero));
  await press(page, 'Control+k');
  check(
    'Ctrl+K opens the palette with the input focused',
    await page.evaluate(() => document.activeElement?.classList.contains('palette__input')),
  );
  const count = () => page.$$eval('.palette__item', (e) => e.length);
  const all = await count();
  await page.keyboard.type('dupl');
  await settle(page);
  const filtered = await page.$$eval('.palette__item', (els) => els.map((e) => e.textContent));
  check(
    'typing filters the commands (fuzzy)',
    filtered.length > 0 && filtered.length < all && filtered.some((x) => /Duplicate/.test(x)),
    filtered.join('|'),
  );
  const nBefore = (await state(page)).nodeCount;
  await page.keyboard.press('Enter');
  await settle(page);
  check(
    'Enter runs the command and closes the palette',
    (await state(page)).nodeCount > nBefore && !(await page.$('.palette__input')),
  );
  await press(page, 'Control+z');

  // Escape closes and focus returns to where it was.
  await page.focus(layerRow(hero));
  await press(page, 'Control+k');
  await page.keyboard.press('Escape');
  await settle(page);
  check(
    'Esc closes the palette and returns focus to the layer',
    await page.evaluate((id) => document.activeElement?.getAttribute('data-layer-id') === id, hero),
  );

  // Palette also reaches panel-only actions.
  await press(page, 'Control+k');
  await page.keyboard.type('theme');
  await settle(page);
  check('the palette includes theme and navigation commands', (await count()) > 0);
  await page.keyboard.press('Escape');

  // Shortcut sheet.
  await press(page, 'Control+/');
  const sheet = await page.$eval('.dialog', (e) => e.textContent).catch(() => '');
  check(
    'Ctrl+/ opens the shortcut sheet',
    /Keyboard shortcuts/.test(sheet) &&
      /Command palette/.test(sheet) &&
      /Zoom to fit all/.test(sheet),
  );
  check(
    'it is a modal dialog',
    await page.$eval(
      '.dialog',
      (e) => e.getAttribute('role') === 'dialog' && e.getAttribute('aria-modal') === 'true',
    ),
  );
  await shot('light-shortcuts');
  // Focus is trapped: Tab never leaves the dialog.
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  check(
    'focus stays inside the dialog',
    await page.evaluate(() => !!document.activeElement?.closest('.dialog')),
  );
  await page.keyboard.press('Escape');
  check('Esc closes it', !(await page.$('.dialog')));

  // Context menu on a layer.
  const box = await page.$eval(layerRow(hero), (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.x + 70, y: b.y + b.height / 2 };
  });
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await settle(page);
  const menu = await page.$$eval('.menu--context [role="menuitem"]', (els) =>
    els.map((e) => e.textContent.trim()),
  );
  check('right-click on a layer opens a context menu', menu.length >= 6, menu.join('|'));
  check(
    'it offers duplicate, delete, wrap, hide and lock',
    ['Duplicate', 'Delete', 'Wrap in frame', 'Hide', 'Lock'].every((w) =>
      menu.some((m) => m.startsWith(w)),
    ),
    menu.join('|'),
  );
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  check('Esc closes the context menu', !(await page.$('.menu--context')));

  // Context menu on the canvas runs a command.
  const c = await centerOf(page, await idByName(page, 'Features'));
  await page.mouse.click(c.x, c.y, { button: 'right' });
  await settle(page);
  check(
    'right-click on the canvas selects the node under it and opens the menu',
    !!(await page.$('.menu--context')) && (await state(page)).selection.length === 1,
  );
  const dupItem = await page.evaluateHandle(
    () =>
      [...document.querySelectorAll('.menu--context [role="menuitem"]')].find((e) =>
        e.textContent.startsWith('Duplicate'),
      ) ?? null,
  );
  const n0 = (await state(page)).nodeCount;
  await dupItem.asElement().click();
  await settle(page);
  check(
    'choosing a menu item runs it',
    (await state(page)).nodeCount > n0 && !(await page.$('.menu--context')),
  );
  await press(page, 'Control+z');
});

// ---------------------------------------------------------------------------------------------
await group('accessibility audit', async () => {
  await resetSample();
  await selectByName('Hero');
  const audit = async (label) => {
    const bad = await page.evaluate(() => {
      const name = (el) => {
        const aria = el.getAttribute('aria-label')?.trim();
        if (aria) return aria;
        const by = el.getAttribute('aria-labelledby');
        if (by && document.getElementById(by)?.textContent?.trim()) return 'labelled';
        if (el.labels?.length && [...el.labels].some((l) => l.textContent.trim())) return 'label';
        if (el.textContent?.trim()) return el.textContent.trim();
        if (el.getAttribute('title')) return el.getAttribute('title');
        return '';
      };
      return [
        ...document.querySelectorAll(
          'button, input:not([type=file]), select, textarea, [role="button"], [role="tab"]',
        ),
      ]
        .filter((el) => el.getClientRects().length > 0 && !name(el))
        .map(
          (el) =>
            `${el.tagName.toLowerCase()}.${el.className}${el.dataset.field ? `[${el.dataset.field}]` : ''}`,
        );
    });
    check(
      `${label}: every visible control has an accessible name`,
      bad.length === 0,
      bad.slice(0, 8).join(', '),
    );
  };
  await audit('layers + properties');
  await openTab('tokens');
  await audit('tokens');
  await openTab('assets');
  await audit('assets');
  await openTab('layers');
  const lang = await page.evaluate(() => document.documentElement.lang);
  check('the page declares its language', lang === 'en', lang);
  const roles = await page.evaluate(() => ({
    tabs: !!document.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]'),
    panel: !!document.querySelector('[role="tabpanel"]'),
    tree: !!document.querySelector('[role="tree"] [role="treeitem"][aria-selected]'),
  }));
  check(
    'tabs, tab panel and tree have their ARIA roles',
    roles.tabs && roles.panel && roles.tree,
    JSON.stringify(roles),
  );
  // Arrow keys move between tabs.
  await page.focus('[data-tab="layers"]');
  await page.keyboard.press('ArrowRight');
  await settle(page);
  check(
    'arrow keys move between tabs',
    (await page.evaluate(() => document.activeElement?.getAttribute('data-tab'))) === 'assets',
  );
  await page.keyboard.press('ArrowLeft');
  // Visible focus: the focused control has an outline.
  await page.focus('[data-testid="open-palette"]');
  const outline = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement);
    return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  });
  // :focus-visible only applies for keyboard focus; programmatic focus after a key press counts.
  await page.keyboard.press('Shift');
  r.info('programmatic focus shows an outline', outline);
  // Reduced motion honours the OS setting.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const dur = await page.evaluate(
    () => getComputedStyle(document.querySelector('.btn, .pill, .toolbar__btn')).transitionDuration,
  );
  check(
    'reduced motion switches transitions off',
    /^0s|^0.00001s|^1e-05s/.test(dur) || dur === '0s',
    dur,
  );
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
});

// ---------------------------------------------------------------------------------------------
await group('light/dark screenshots with the panels in use', async () => {
  for (const theme of ['light', 'dark']) {
    await page.evaluate((th) => {
      localStorage.setItem('aframe.theme', th);
      document.documentElement.setAttribute('data-theme', th);
    }, theme);
    await resetSample();
    await selectByName('Hero');
    await shot(`${theme}-properties`);
  }
  await page.evaluate(() => {
    localStorage.removeItem('aframe.theme');
    document.documentElement.removeAttribute('data-theme');
  });
});

// ---------------------------------------------------------------------------------------------
await group('stability', async () => {
  check(
    'no console errors during the whole run',
    t.errors.length === 0,
    t.errors.slice(0, 3).join(' | '),
  );
});

await t.close();
console.log(
  r.failures === 0 ? '\nAll panel checks passed.' : `\n${r.failures} panel check(s) failed.`,
);
process.exit(r.failures === 0 ? 0 : 1);
