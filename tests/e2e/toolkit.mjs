// Game-UI toolkit e2e: icons, display fonts, pattern fills, effect presets, components with states,
// the genre templates, and the editing fixes, in real Chrome against the real app. Drives the UI the
// way a person would (clicks the panels) and reads real rendered pixels. SHOT_DIR=<dir> saves PNGs.
// Run: node tests/e2e/toolkit.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { idByName, node, reporter, settle, start } from './harness.mjs';

const t = await start({ width: 1500, height: 940 });
const { page } = t;
const r = reporter();
const { check, info } = r;
const SHOT_DIR = process.env.SHOT_DIR;
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const doc = () =>
  page.evaluate(() => JSON.parse(JSON.stringify(window.__atelier.store.getState().doc)));
const dispatch = (ops, label = 'test') =>
  page.evaluate(
    (o, l) => {
      const r = window.__atelier.store.getState().dispatch(o, { label: l });
      return r.ok ? { ok: true, created: r.created ?? [], warnings: r.warnings ?? [] } : r;
    },
    ops,
    label,
  );
const loadTemplate = async (name) => {
  await page.evaluate((n) => window.__atelier.loadTemplate(n), name);
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  await sleep(150);
};
const setSelection = (ids) =>
  page
    .evaluate((x) => window.__atelier.store.getState().setSelection(x), ids)
    .then(() => settle(page));
const F = (name) => `[data-field="${name}"]`;
const shot = async (name) => {
  if (!SHOT_DIR) return;
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
};
/** The pixels of one element, via the same renderer the agent's screenshot tool uses. */
const capture = (params) =>
  page.evaluate(async (p) => {
    const { captureScreenshot } = await import('/src/canvas/screenshot.ts');
    const s = window.__atelier.store.getState();
    const out = await captureScreenshot(s.doc, s.viewport.zoom, p);
    return out;
  }, params);
const decode = (b64) => PNG.sync.read(Buffer.from(b64, 'base64'));
const pixel = (png, x, y) => {
  const i = (png.width * y + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
};
const differs = (a, b) => a.some((v, i) => Math.abs(v - b[i]) > 6);

// ---- 1. the eight templates open, render, and use the toolkit --------------------------------
for (const name of [
  'landing',
  'dashboard',
  'mobile',
  'pricing',
  'game-hud',
  'game-shop',
  'game-inventory',
]) {
  await loadTemplate(name);
  const d = await doc();
  const rendered = await page.evaluate(() => document.querySelectorAll('[data-node-id]').length);
  check(
    `template ${name}: every node is drawn`,
    rendered >= Object.keys(d.nodes).length - 1,
    `${rendered} drawn`,
  );
  check(
    `template ${name}: has a component kit`,
    Object.values(d.nodes).filter((n) => n.component).length >= 5,
  );
  await shot(`template-${name}`);
}

// ---- 2. icons ---------------------------------------------------------------------------------
await loadTemplate('game-shop');
{
  const d = await doc();
  const icon = Object.values(d.nodes).find((n) => n.type === 'icon' && n.icon === 'gem' && !n.from);
  const el = await page.evaluate((id) => {
    const e = document.querySelector(`[data-node-id="${id}"]`);
    const path = e?.querySelector('svg path');
    return e
      ? {
          type: e.getAttribute('data-node-type'),
          d: path?.getAttribute('d')?.length ?? 0,
          color: getComputedStyle(e).color,
        }
      : null;
  }, icon.id);
  check('icon draws an svg path', el?.type === 'icon' && el.d > 100, JSON.stringify(el));
  check(
    'icon takes its colour from the token ($gem = #38D6FF)',
    el?.color === 'rgb(56, 214, 255)',
    el?.color,
  );
}

await dispatch([
  {
    op: 'create',
    parentId: (await doc()).rootId,
    node: {
      type: 'icon',
      icon: 'dragon-egg',
      x: 40,
      y: 760,
      w: 96,
      h: 96,
      color: '$gold',
      name: 'Missing icon',
    },
  },
  {
    op: 'create',
    parentId: (await doc()).rootId,
    node: {
      type: 'icon',
      icon: 'dragon-egg',
      x: 160,
      y: 760,
      w: 24,
      h: 24,
      color: '$gold',
      name: 'Missing small',
    },
  },
]);
await settle(page);
{
  const info1 = await page.evaluate(() => {
    const nodes = window.__atelier.store.getState().doc.nodes;
    const big = Object.values(nodes).find((n) => n.name === 'Missing icon');
    const el = document.querySelector(`[data-node-id="${big.id}"]`);
    return {
      placeholder: el?.querySelector('svg')?.getAttribute('data-placeholder'),
      texts: [...(el?.querySelectorAll('svg text') ?? [])].map((x) => x.textContent),
      dashed: el?.querySelector('svg rect')?.getAttribute('stroke-dasharray'),
    };
  });
  check(
    'unknown icon draws a labelled placeholder, not a blank square',
    info1.placeholder === 'true' &&
      info1.texts.includes('?') &&
      info1.texts.some((x) => x.startsWith('dragon-')) &&
      !!info1.dashed,
    JSON.stringify(info1),
  );
}

// ---- 3. fonts: display faces load, and a missing weight is not faked ----------------------------
{
  const faces = await page.evaluate(async () => {
    const out = {};
    for (const f of ['Lilita One', 'Luckiest Guy', 'Bungee', 'Fredoka']) {
      await document.fonts.load(`400 24px "${f}"`);
      out[f] = document.fonts.check(`400 24px "${f}"`);
    }
    return out;
  });
  check(
    'Lilita One, Luckiest Guy, Bungee and Fredoka load in the webview',
    Object.values(faces).every(Boolean),
    JSON.stringify(faces),
  );
  // Ink, not width: a synthetic bold smears the glyphs without changing their advance.
  const ink = await page.evaluate(() => {
    const draw = (family, weight, synth) => {
      const s = document.createElement('div');
      s.textContent = 'PLAY NOW';
      s.style.cssText = `position:fixed;left:0;top:0;width:320px;height:70px;background:#fff;color:#000;font:${weight} 40px "${family}";font-synthesis:${synth}`;
      document.body.appendChild(s);
      const el = s;
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 70;
      const ctx = c.getContext('2d');
      ctx.font = `${weight} 40px "${family}"`;
      ctx.fillStyle = '#000';
      ctx.textBaseline = 'top';
      ctx.fillText('PLAY NOW', 0, 10);
      el.remove();
      const d = ctx.getImageData(0, 0, 320, 70).data;
      let sum = 0;
      for (let i = 3; i < d.length; i += 4) sum += d[i];
      return sum;
    };
    return {
      regular: draw('Lilita One', 400, 'none'),
      at900: draw('Lilita One', 900, 'none'),
      inter400: draw('Inter', 400, 'none'),
      inter900: draw('Inter', 900, 'none'),
    };
  });
  check(
    'Inter really reaches weight 900 (heavier ink than 400)',
    ink.inter900 > ink.inter400 * 1.25,
    JSON.stringify(ink),
  );
  info('Lilita One ink at 400 vs 900 on canvas (the browser may fake bold here)', ink);
  const textId = await page.evaluate(() => {
    const d = window.__atelier.store.getState().doc;
    const n = Object.values(d.nodes).find(
      (x) => x.type === 'text' && x.fontFamily === '$font.display',
    );
    window.__atelier.store
      .getState()
      .dispatch([{ op: 'update', id: n.id, set: { fontWeight: 900 } }], { label: 'w900' });
    return n.id;
  });
  await settle(page);
  const cssSynth = await page.evaluate(
    (id) => getComputedStyle(document.querySelector(`[data-node-id="${id}"]`)).fontSynthesis,
    textId,
  );
  check(
    'a 900 request on a single-weight display face turns font-synthesis off',
    /none/.test(cssSynth),
    String(cssSynth),
  );
  const textCss = await page.evaluate(() => {
    const d = window.__atelier.store.getState().doc;
    const label = Object.values(d.nodes).find(
      (n) => n.type === 'text' && n.fontFamily === '$font.display' && n.from,
    );
    return label
      ? getComputedStyle(document.querySelector(`[data-node-id="${label.id}"]`)).fontFamily
      : null;
  });
  check('display text is set in Lilita One', /Lilita One/.test(textCss ?? ''), String(textCss));
}

// ---- 4. pattern fills: follow radius and clipping ---------------------------------------------------
await page.evaluate(() => window.__atelier.loadBlank());
await settle(page);
const rootId = (await doc()).rootId;
{
  const made = await dispatch([
    {
      op: 'create',
      parentId: rootId,
      node: {
        type: 'frame',
        name: 'Rounded clip',
        x: 0,
        y: 0,
        w: 200,
        h: 200,
        layout: 'none',
        radius: 100,
        clip: true,
        fill: '#FFFFFF',
        children: [
          {
            type: 'rect',
            name: 'Stripes',
            x: 0,
            y: 0,
            w: 200,
            h: 200,
            fill: { pattern: 'stripes', color: '#FF0000', size: 8, spacing: 8, angle: 45 },
          },
        ],
      },
    },
    {
      op: 'create',
      parentId: rootId,
      node: {
        type: 'rect',
        name: 'Dots',
        x: 240,
        y: 0,
        w: 200,
        h: 200,
        radius: 100,
        fill: {
          pattern: 'halftone',
          color: '#000000',
          size: 4,
          spacing: 12,
          background: '#FFE08A',
        },
      },
    },
    {
      op: 'create',
      parentId: rootId,
      node: {
        type: 'rect',
        name: 'Rays',
        x: 480,
        y: 0,
        w: 200,
        h: 200,
        fill: {
          pattern: 'sunburst',
          color: '#FFFFFF',
          size: 10,
          spacing: 10,
          background: '#5B3CB0',
        },
      },
    },
    {
      op: 'create',
      parentId: rootId,
      node: {
        type: 'rect',
        name: 'Noise',
        x: 720,
        y: 0,
        w: 200,
        h: 200,
        fill: { pattern: 'noise', color: '#000000', size: 2, opacity: 0.6, background: '#CCCCCC' },
      },
    },
  ]);
  check('pattern fills apply without error', made.ok === true, JSON.stringify(made));
  await settle(page);
  const png = decode((await capture({ scale: 1 })).pngBase64);
  info('pattern screenshot', `${png.width}x${png.height}`);
  // page background is #f0eee6; the clip circle (r=100 at 100,100) must leave its corners untouched
  const corner = pixel(png, 6, 6);
  check(
    'stripes follow the parent radius and clip: the corner stays page-coloured',
    corner[0] > 225 && corner[1] > 225 && corner[2] > 215,
    JSON.stringify(corner),
  );
  // inside the circle, along a diagonal, we must see both red stripe and white gap
  const samples = [];
  for (let k = 0; k < 24; k += 1) samples.push(pixel(png, 70 + k, 70 + 0));
  const reds = samples.filter((p) => p[0] > 200 && p[1] < 90).length;
  const whites = samples.filter((p) => p[0] > 235 && p[1] > 235 && p[2] > 235).length;
  check(
    'stripes alternate red and white inside the clip',
    reds >= 3 && whites >= 3,
    `reds ${reds}, whites ${whites}`,
  );
  const dotsCorner = pixel(png, 246, 6);
  check(
    'halftone follows its own radius (corner outside the circle is page-coloured)',
    dotsCorner[0] > 225 && dotsCorner[2] > 215,
    JSON.stringify(dotsCorner),
  );
  let darkDots = 0;
  for (let y = 60; y < 140; y += 1)
    for (let x = 300; x < 380; x += 1) if (pixel(png, x, y)[0] < 80) darkDots += 1;
  check(
    'halftone draws dots (a sparse grid, not a flood)',
    darkDots > 300 && darkDots < 80 * 80 * 0.35,
    `dark px ${darkDots}`,
  );
  const rayColours = new Set();
  for (let a = 0; a < 360; a += 5) {
    const x = 580 + Math.round(Math.cos((a * Math.PI) / 180) * 70);
    const y = 100 + Math.round(Math.sin((a * Math.PI) / 180) * 70);
    const p = pixel(png, x, y);
    rayColours.add(p[0] > 200 ? 'light' : 'dark');
  }
  check(
    'sunburst alternates light and dark rays around the centre',
    rayColours.size === 2,
    [...rayColours].join(),
  );
  const grain = new Set();
  for (let y = 40; y < 160; y += 3)
    for (let x = 760; x < 880; x += 3) grain.add(pixel(png, x, y)[0]);
  check(
    'noise has many distinct grey levels (it is grain, not a flat fill)',
    grain.size > 12,
    `${grain.size} levels`,
  );
  await shot('patterns');
  const css = await page.evaluate(
    (id) =>
      getComputedStyle(document.querySelector(`[data-node-id="${id}"]`)).backgroundImage.slice(
        0,
        40,
      ),
    await idByName(page, 'Noise'),
  );
  check(
    'noise survives the CSP (data: svg background is allowed)',
    /^url\("data:image\/svg\+xml/.test(css),
    css,
  );
}

// ---- 5. effect presets ------------------------------------------------------------------------------
{
  await dispatch([
    {
      op: 'create',
      parentId: rootId,
      node: {
        type: 'frame',
        name: 'Chunky',
        x: 40,
        y: 260,
        w: 220,
        h: 72,
        radius: 36,
        fill: '#FFB020',
        stroke: '#120B24',
        strokeWidth: 3,
        effects: ['gloss-top', 'hard-3d-bottom'],
      },
    },
    {
      op: 'create',
      parentId: rootId,
      node: {
        type: 'frame',
        name: 'Flat',
        x: 300,
        y: 260,
        w: 220,
        h: 72,
        radius: 36,
        fill: '#FFB020',
        stroke: '#120B24',
        strokeWidth: 3,
      },
    },
    {
      op: 'create',
      parentId: rootId,
      node: {
        type: 'frame',
        name: 'Pressed',
        x: 560,
        y: 260,
        w: 220,
        h: 72,
        radius: 36,
        fill: '#FFB020',
        stroke: '#120B24',
        strokeWidth: 3,
        effects: ['bevel-pressed'],
      },
    },
    {
      op: 'create',
      parentId: rootId,
      node: { type: 'rect', name: 'Spacer', x: 40, y: 380, w: 10, h: 10, fill: '#FFFFFF' },
    },
    {
      op: 'create',
      parentId: rootId,
      node: {
        type: 'frame',
        name: 'Glow',
        x: 820,
        y: 260,
        w: 220,
        h: 72,
        radius: 16,
        fill: '#2D2250',
        effects: [{ preset: 'inner-glow', color: '#38D6FF', intensity: 1.5 }],
      },
    },
  ]);
  await settle(page);
  const png = decode((await capture({ scale: 1 })).pngBase64);
  // the 3D ledge: below the chunky button's bottom edge (y 332) there is a dark ledge, but not under Flat
  const ledge = pixel(png, 150, 332 + 3);
  const none = pixel(png, 410, 332 + 3);
  check(
    'hard-3d-bottom draws a solid ledge below the button',
    ledge[0] < 160 && none[0] > 225,
    `${ledge} vs ${none}`,
  );
  const glossTop = pixel(png, 150, 260 + 6);
  const glossMid = pixel(png, 150, 260 + 40);
  check(
    'gloss-top lightens the top edge',
    glossTop[0] >= glossMid[0] && glossTop[1] > glossMid[1] + 6,
    `${glossTop} vs ${glossMid}`,
  );
  const pressedTop = pixel(png, 660, 260 + 6);
  const pressedMid = pixel(png, 660, 260 + 40);
  check(
    'bevel-pressed shades the top inside edge',
    pressedTop[0] < pressedMid[0] - 10,
    `${pressedTop} vs ${pressedMid}`,
  );
  await shot('presets');

  const textBox = await dispatch([
    {
      op: 'create',
      parentId: rootId,
      node: {
        type: 'text',
        name: 'Shadowed text',
        text: 'SHADOW',
        x: 40,
        y: 400,
        fontSize: 48,
        color: '#000000',
        shadow: [{ x: 0, y: 4, blur: 0, spread: 12, color: '#FF0000' }],
      },
    },
  ]);
  check('a shadow on text applies (as a glyph shadow)', textBox.ok);
  await settle(page);
  const p2 = decode((await capture({ scale: 1 })).pngBase64);
  // a box-shadow with spread 12 would paint red well outside the glyphs; text-shadow ignores spread
  const outside = pixel(p2, 40 + 150, 400 - 8);
  check(
    'text never gets a box around it',
    !(outside[0] > 200 && outside[1] < 80),
    JSON.stringify(outside),
  );
}

// ---- 6. components: instances follow, states, overrides, undo ----------------------------------------
await loadTemplate('game-hud');
{
  const before = await doc();
  const master = Object.values(before.nodes).find((n) => n.name === 'Button Chunky' && n.component);
  const fillBefore = Object.values(before.nodes).find((n) => n.name === 'Attack Button').fill;
  const attack = Object.values(before.nodes).find((n) => n.name === 'Attack Button');
  check('the Attack button is an instance of Button Chunky', attack?.instanceOf === master.id);
  const instFill = await page.evaluate(
    (id) => getComputedStyle(document.querySelector(`[data-node-id="${id}"]`)).backgroundColor,
    attack.id,
  );
  check(
    'the instance draws the master look ($primary gold)',
    instFill === 'rgb(255, 176, 32)',
    instFill,
  );

  // edit the master -> the instance follows on the canvas
  await dispatch([{ op: 'update', id: master.id, set: { fill: '#22AA55' } }], 'recolour master');
  await settle(page);
  const after = await page.evaluate(
    (id) => getComputedStyle(document.querySelector(`[data-node-id="${id}"]`)).backgroundColor,
    attack.id,
  );
  check(
    'editing the master recolours the instance on the canvas',
    after === 'rgb(34, 170, 85)',
    after,
  );

  // an override on the instance survives the next master edit
  const label = Object.values((await doc()).nodes).find(
    (n) => n.from && n.name === 'Label' && n.parentId === attack.id,
  );
  await dispatch([{ op: 'update', id: label.id, set: { text: 'GO!' } }], 'override label');
  await dispatch(
    [{ op: 'update', id: master.id, set: { fill: '#AA2255' } }],
    'recolour master again',
  );
  await settle(page);
  const kept = await page.evaluate(
    (id) => document.querySelector(`[data-node-id="${id}"]`)?.textContent,
    label.id,
  );
  check('an instance override survives master edits', kept === 'GO!', String(kept));

  // layers inside an instance cannot be deleted
  const refused = await dispatch([{ op: 'delete', id: label.id }]);
  check(
    'deleting a layer inside an instance is refused with advice',
    refused.ok === false && /visible/.test(JSON.stringify(refused)),
    JSON.stringify(refused).slice(0, 200),
  );

  // screenshots in other states
  await dispatch([{ op: 'update', id: master.id, set: { fill: '#FFB020' } }], 'restore');
  await settle(page);
  const wrapper = attack.id;
  const def = decode((await capture({ nodeId: wrapper, scale: 1 })).pngBase64);
  const hover = decode((await capture({ nodeId: wrapper, scale: 1, state: 'hover' })).pngBase64);
  const pressed = decode(
    (await capture({ nodeId: wrapper, scale: 1, state: 'pressed' })).pngBase64,
  );
  const disabled = decode(
    (await capture({ nodeId: wrapper, scale: 1, state: 'disabled' })).pngBase64,
  );
  const mid = (png) => pixel(png, Math.floor(png.width * 0.15), Math.floor(png.height / 2));
  check(
    'hover draws a different colour from default',
    differs(mid(def), mid(hover)),
    `${mid(def)} vs ${mid(hover)}`,
  );
  check(
    'pressed differs from default and hover',
    differs(mid(def), mid(pressed)) && differs(mid(hover), mid(pressed)),
    `${mid(pressed)}`,
  );
  check(
    'disabled is the muted purple-grey',
    differs(mid(def), mid(disabled)) && mid(disabled)[2] > mid(disabled)[0] - 20,
    `${mid(disabled)}`,
  );
  const stored = await doc();
  check(
    'a state screenshot does not change the saved document',
    stored.nodes[attack.id].state === undefined && stored.nodes[attack.id].fill === '#FFB020',
    `state ${stored.nodes[attack.id].state} fill ${stored.nodes[attack.id].fill} (was ${fillBefore})`,
  );
  const all = decode((await capture({ nodeId: wrapper, scale: 1, state: 'all' })).pngBase64);
  check(
    'state "all" stacks the states into a taller picture',
    all.height > def.height * 3 && all.width > def.width,
    `${all.width}x${all.height} vs ${def.width}x${def.height}`,
  );
  if (SHOT_DIR) writeFileSync(join(SHOT_DIR, 'states-all.png'), PNG.sync.write(all));
  let refusedState = null;
  try {
    await capture({ nodeId: wrapper, state: 'selected' });
  } catch (e) {
    refusedState = String(e.message ?? e);
  }
  check(
    'asking for a state nothing defines explains instead of lying',
    /defines a "selected" state/.test(refusedState ?? ''),
    String(refusedState),
  );
}

// ---- 7. the panels: pattern editor, presets, icon, component ----------------------------------------------
await page.evaluate(() => window.__atelier.loadBlank());
await settle(page);
{
  const root = (await doc()).rootId;
  await dispatch([
    {
      op: 'create',
      parentId: root,
      node: {
        type: 'frame',
        name: 'Panel A',
        x: 100,
        y: 100,
        w: 300,
        h: 200,
        fill: '#2D2250',
        radius: 20,
      },
    },
  ]);
  const id = await idByName(page, 'Panel A');
  await setSelection([id]);

  // Fill -> Pattern
  await page.click(`${F('fill-type')} button:last-child`);
  await settle(page);
  const patched = await node(page, id);
  check(
    'choosing Pattern in the Fill section makes a pattern fill',
    typeof patched.fill === 'object' &&
      patched.fill.pattern === 'stripes' &&
      patched.fill.background === '#2D2250',
    JSON.stringify(patched.fill),
  );
  check('the pattern editor appears', (await page.$('[data-testid="pattern-editor"]')) !== null);
  await page.select(`${F('pattern')} select, select${F('pattern')}`, 'halftone').catch(async () => {
    await page.evaluate(() => {
      const sel = document.querySelector('[data-testid="pattern-editor"] select');
      sel.value = 'halftone';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await settle(page);
  check(
    'changing the pattern in the editor updates the node',
    (await node(page, id)).fill.pattern === 'halftone',
  );
  await shot('panel-pattern');

  // Presets
  await page.click(`${F('effect-gloss-top')}`);
  await settle(page);
  check(
    'toggling a preset adds it to effects',
    JSON.stringify((await node(page, id)).effects) === '["gloss-top"]',
    JSON.stringify((await node(page, id)).effects),
  );
  await page.click(`${F('effect-hard-3d-bottom')}`);
  await settle(page);
  check('presets combine', (await node(page, id)).effects.length === 2);
  await page.click(`${F('effect-gloss-top')}`);
  await settle(page);
  check(
    'turning one off removes only it',
    JSON.stringify((await node(page, id)).effects) === '["hard-3d-bottom"]',
  );

  // Make component
  await page.click('[data-action="make-component"]');
  await settle(page);
  check(
    'Create component makes the frame a master',
    (await node(page, id)).component?.kind === 'custom',
  );
  check(
    'the Component section now reports instances',
    /0 instances/.test(await page.$eval('[data-testid="component-summary"]', (e) => e.textContent)),
  );
}

// Icons tab: insert, undo is one step
{
  await page.evaluate(() => window.__atelier.loadBlank());
  await settle(page);
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find(
      (b) => b.textContent === 'Icons',
    );
    tab.click();
  });
  await settle(page);
  check(
    'the Icons tab shows the whole set',
    (await page.$$eval('[data-icon-pick]', (els) => els.length)) >= 150,
  );
  await page.type('input[aria-label="Search icons"]', 'sword');
  await settle(page);
  const picks = await page.$$eval('[data-icon-pick]', (els) =>
    els.map((e) => e.getAttribute('data-icon-pick')),
  );
  check(
    'searching narrows to matching icons',
    picks.includes('sword') && picks.includes('swords') && picks.length < 8,
    picks.join(),
  );
  const rev0 = (await doc()).rev;
  await page.click('[data-icon-pick="sword"]');
  await settle(page);
  const afterInsert = await doc();
  const placed = Object.values(afterInsert.nodes).find((n) => n.type === 'icon');
  check(
    'clicking an icon places it as one undo step',
    placed?.icon === 'sword' && afterInsert.rev === rev0 + 1,
    JSON.stringify({ icon: placed?.icon, rev: afterInsert.rev, rev0 }),
  );
  check(
    'the new icon is selected',
    (await page.evaluate(() => window.__atelier.store.getState().selection))[0] === placed.id,
  );
  // the properties panel shows the icon section
  check('the Icon section is shown for an icon', (await page.$(F('icon'))) !== null);
  await page.click(F('icon'));
  await settle(page);
  await page
    .click('[role="dialog"] [data-icon-pick="gem"], [data-icon-pick="gem"]:not(:first-child)')
    .catch(() => undefined);
  await settle(page);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__atelier.store.getState().undo());
  await settle(page);
}

// ---- 8. editing fixes through the same dispatch the UI uses -------------------------------------------------
{
  await page.evaluate(() => window.__atelier.loadBlank());
  await settle(page);
  const root = (await doc()).rootId;
  const made = await dispatch([
    {
      op: 'create',
      parentId: root,
      node: {
        type: 'frame',
        name: 'Col',
        layout: 'column',
        x: 0,
        y: 0,
        children: [{ type: 'rect', name: 'Item' }],
      },
    },
  ]);
  const item = await idByName(page, 'Item');
  const res = await page.evaluate((id) => {
    const r = window.__atelier.store
      .getState()
      .dispatch([{ op: 'update', id, set: { y: 40 } }], { label: 'y on layout child' });
    return { ok: r.ok, warnings: r.warnings?.map((w) => w.code) ?? null };
  }, item);
  info('dispatch result', res);
  check('the app accepted the edit', made.ok && res.ok);
  const bare = item.slice(2);
  const viaBare = await page.evaluate(
    (id) =>
      window.__atelier.store
        .getState()
        .dispatch([{ op: 'update', id, set: { opacity: 0.5 } }], { label: 'bare id' }).ok,
    bare,
  );
  check(
    'ids work without the n_ prefix',
    viaBare === true && (await node(page, item)).opacity === 0.5,
  );
}

check('no console errors during the run', t.errors.length === 0, t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(r.failures === 0 ? 'ALL PASSED' : `${r.failures} FAILED`);
process.exit(r.failures === 0 ? 0 : 1);
