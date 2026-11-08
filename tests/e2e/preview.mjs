// Interactive preview and nested components, in real Chrome with the real mouse: buttons react to
// hover and press, tabs select and switch panels, links go to other frames and back, the design is
// never changed, and a card that holds a button follows that button. SHOT_DIR=<dir> saves PNGs.
// Run: node tests/e2e/preview.mjs
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { reporter, settle, start } from './harness.mjs';

const t = await start({ width: 1500, height: 940 });
const { page } = t;
const r = reporter();
const { check } = r;
const SHOT_DIR = process.env.SHOT_DIR;
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
const shot = async (name) => {
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
};
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

await page.evaluate(() => window.__aframe.loadBlank());
await settle(page);

// ---- a small app: tabs with panels, a button that links to another screen, a card holding a button ----
const ids = await page.evaluate(async () => {
  const { applyChanges } = await import('/src/core/apply.ts');
  const { createInstance, defineComponent } = await import('/src/core/component-ops.ts');
  const store = window.__aframe.store;
  const out = {};
  store.getState().edit((doc) => {
    const ops = (d, list) => {
      const res = applyChanges(d, list);
      if (!res.ok) throw new Error(JSON.stringify(res.errors));
      return res;
    };
    let made = ops(doc, [
      {
        op: 'create',
        parentId: doc.rootId,
        node: {
          type: 'frame',
          name: 'Tab',
          layout: 'row',
          padding: [8, 16, 8, 16],
          fill: '#333333',
          children: [{ type: 'text', name: 'Label', text: 'Tab', color: '#CCCCCC' }],
        },
      },
      {
        op: 'create',
        parentId: doc.rootId,
        node: {
          type: 'frame',
          name: 'Button',
          layout: 'row',
          padding: [8, 16, 8, 16],
          fill: '#FFAA00',
          children: [{ type: 'text', name: 'Label', text: 'Go', color: '#000000' }],
        },
      },
    ]);
    const [tabMaster, , buttonMaster] = made.created;
    let d = defineComponent(made.doc, {
      nodeId: tabMaster,
      kind: 'tab',
      states: { hover: { $self: { fill: '#444444' } }, selected: { $self: { fill: '#FFAA00' } } },
    }).doc;
    d = defineComponent(d, {
      nodeId: buttonMaster,
      kind: 'button',
      states: { hover: { $self: { fill: '#FFCC55' } }, pressed: { $self: { fill: '#CC8800' } } },
    }).doc;
    made = ops(d, [
      {
        op: 'create',
        parentId: d.rootId,
        node: {
          type: 'frame',
          name: 'Home',
          layout: 'none',
          x: 0,
          y: 0,
          w: 600,
          h: 400,
          fill: '#111111',
          children: [
            { type: 'frame', name: 'Tabs', layout: 'row', gap: 8, x: 20, y: 20 },
            {
              type: 'frame',
              name: 'Panel A',
              layout: 'none',
              x: 20,
              y: 80,
              w: 560,
              h: 200,
              fill: '#224466',
            },
            {
              type: 'frame',
              name: 'Panel B',
              layout: 'none',
              x: 20,
              y: 80,
              w: 560,
              h: 200,
              fill: '#664422',
              visible: false,
            },
          ],
        },
      },
      {
        op: 'create',
        parentId: d.rootId,
        node: {
          type: 'frame',
          name: 'Settings',
          layout: 'none',
          x: 700,
          y: 0,
          w: 300,
          h: 200,
          fill: '#442266',
        },
      },
    ]);
    d = made.doc;
    const [home, tabs, panelA, panelB, settings] = made.created;
    const tabIds = [];
    for (const [label, panel] of [
      ['A', 'Panel A'],
      ['B', 'Panel B'],
    ]) {
      const inst = createInstance(d, {
        component: tabMaster,
        parentId: tabs,
        name: `Tab ${label}`,
        overrides: { Label: { text: label } },
      });
      d = ops(inst.doc, [{ op: 'update', id: inst.instanceId, set: { href: `#${panel}` } }]).doc;
      tabIds.push(inst.instanceId);
    }
    const go = createInstance(d, {
      component: buttonMaster,
      parentId: home,
      name: 'Go',
      x: 20,
      y: 320,
    });
    d = ops(go.doc, [{ op: 'update', id: go.instanceId, set: { href: '#Settings' } }]).doc;
    Object.assign(out, {
      home,
      settings,
      panelA,
      panelB,
      tabA: tabIds[0],
      tabB: tabIds[1],
      go: go.instanceId,
      buttonMaster,
    });
    return d;
  }, 'fixture');
  return out;
});
await settle(page);
await page.evaluate((id) => window.__aframe.store.getState().setSelection([id]), ids.home);
const docBefore = await page.evaluate(() =>
  JSON.stringify(window.__aframe.store.getState().doc.nodes),
);
const pastBefore = await page.evaluate(() => window.__aframe.store.getState().history.past.length);

// ---- opening it --------------------------------------------------------------------------------------
await page.click('[data-testid="open-preview"]');
await page.waitForSelector('[data-testid="preview-host"] [data-node-id]');
check(
  'the preview opens on the selected frame',
  (await page.$eval('[data-testid="preview-title"]', (e) => e.textContent)) === 'Home',
);
const el = (id) => `[data-testid="preview-host"] [data-node-id="${id}"]`;
const bg = (id) => page.$eval(el(id), (e) => getComputedStyle(e).backgroundColor);
const shown = (id) => page.$eval(el(id), (e) => getComputedStyle(e).display !== 'none');
const center = (id) =>
  page.$eval(el(id), (e) => {
    const b = e.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
check(
  'the frame is drawn, with the first panel showing and the second hidden',
  (await shown(ids.panelA)) && !(await shown(ids.panelB)),
);
await shot('preview-open');

// ---- hover and press ---------------------------------------------------------------------------------
check(
  'a button starts in its normal look',
  (await bg(ids.go)) === 'rgb(255, 170, 0)',
  await bg(ids.go),
);
let p = await center(ids.go);
await page.mouse.move(p.x, p.y);
await sleep(350);
check(
  'hovering shows the hover state',
  (await bg(ids.go)) === 'rgb(255, 204, 85)',
  await bg(ids.go),
);
await page.mouse.down();
await sleep(350);
check(
  'pressing shows the pressed state',
  (await bg(ids.go)) === 'rgb(204, 136, 0)',
  await bg(ids.go),
);
await page.mouse.up();
await sleep(100);
// (the click on the button follows its link; come back to carry on)
check(
  'letting go with a link goes to that frame',
  (await page.$eval('[data-testid="preview-title"]', (e) => e.textContent)) === 'Settings',
);
await page.click('[data-action="preview-back"]');
await sleep(200);
check(
  'Back returns to the first frame',
  (await page.$eval('[data-testid="preview-title"]', (e) => e.textContent)) === 'Home',
);
await page.mouse.move(5, 5);
await sleep(350);
check(
  'moving away puts the button back',
  (await bg(ids.go)) === 'rgb(255, 170, 0)',
  await bg(ids.go),
);

// state changes are animated: the element is restyled in place, not replaced
const stable = await page.evaluate((id) => {
  const e = document.querySelector(`[data-testid="preview-host"] [data-node-id="${id}"]`);
  window.__goEl = e;
  return getComputedStyle(e).transitionProperty.includes('background-color');
}, ids.go);
p = await center(ids.go);
await page.mouse.move(p.x, p.y);
await sleep(150);
check(
  'the transition is on, and the same element is restyled (so it can animate)',
  stable &&
    (await page.evaluate(
      (id) =>
        document.querySelector(`[data-testid="preview-host"] [data-node-id="${id}"]`) ===
        window.__goEl,
      ids.go,
    )),
);
await page.mouse.move(5, 5);

// ---- tabs and panels ---------------------------------------------------------------------------------
p = await center(ids.tabB);
await page.mouse.click(p.x, p.y);
await sleep(300);
await page.mouse.move(5, 5);
await sleep(300);
check(
  'clicking a tab selects it',
  (await bg(ids.tabB)) === 'rgb(255, 170, 0)' && (await bg(ids.tabA)) === 'rgb(51, 51, 51)',
  `${await bg(ids.tabB)} / ${await bg(ids.tabA)}`,
);
check('and its panel replaces the other', (await shown(ids.panelB)) && !(await shown(ids.panelA)));
await shot('preview-tab-b');
p = await center(ids.tabA);
await page.mouse.click(p.x, p.y);
await sleep(300);
check(
  'clicking the other tab switches back',
  (await shown(ids.panelA)) && !(await shown(ids.panelB)),
);

// ---- the design is untouched -------------------------------------------------------------------------------
const docAfter = await page.evaluate(() =>
  JSON.stringify(window.__aframe.store.getState().doc.nodes),
);
const pastAfter = await page.evaluate(() => window.__aframe.store.getState().history.past.length);
check(
  'the design was not changed, and nothing was added to undo',
  docAfter === docBefore && pastAfter === pastBefore,
);

// ---- reset and close -----------------------------------------------------------------------------------------
await page.click('[data-action="preview-reset"]');
await sleep(300);
check(
  'Reset puts everything back as designed',
  (await shown(ids.panelA)) &&
    !(await shown(ids.panelB)) &&
    (await bg(ids.tabA)) === 'rgb(51, 51, 51)',
);
await page.click('[data-action="preview-actual"]');
await settle(page);
await page.click('[data-action="preview-actual"]');
await page.keyboard.press('Escape');
await settle(page);
check('Escape closes it', (await page.$('[data-testid="preview"]')) === null);

// ---- Alt+P and a broken link ---------------------------------------------------------------------------------
await page.evaluate((id) => window.__aframe.store.getState().setSelection([id]), ids.settings);
await page.keyboard.down('Alt');
await page.keyboard.press('KeyP');
await page.keyboard.up('Alt');
await page.waitForSelector('[data-testid="preview"]');
check(
  'Alt+P opens the preview of the selected frame',
  (await page.$eval('[data-testid="preview-title"]', (e) => e.textContent)) === 'Settings',
);
await page.click('[data-action="preview-close"]');

// ---- a card that holds a button ----------------------------------------------------------------------------------
const card = await page.evaluate(async (buttonMaster) => {
  const { applyChanges } = await import('/src/core/apply.ts');
  const { createInstance, defineComponent } = await import('/src/core/component-ops.ts');
  const store = window.__aframe.store;
  const out = {};
  const res = store.getState().edit((doc) => {
    const ops = (d, list) => {
      const x = applyChanges(d, list);
      if (!x.ok) throw new Error(JSON.stringify(x.errors));
      return x;
    };
    const made = ops(doc, [
      {
        op: 'create',
        parentId: doc.rootId,
        node: {
          type: 'frame',
          name: 'Card',
          layout: 'column',
          gap: 8,
          padding: [12, 12, 12, 12],
          fill: '#222222',
          x: 0,
          y: 500,
          children: [
            { type: 'text', name: 'Title', text: 'Sword', color: '#FFFFFF' },
            { type: 'frame', name: 'Buy', instanceOf: buttonMaster },
          ],
        },
      },
    ]);
    const d = defineComponent(made.doc, { nodeId: made.created[0], kind: 'card' }).doc;
    const inst = createInstance(d, {
      component: made.created[0],
      x: 400,
      y: 500,
      name: 'Sword card',
    });
    out.master = made.created[0];
    out.instance = inst.instanceId;
    return inst.doc;
  }, 'card');
  out.ok = res.ok;
  return out;
}, ids.buttonMaster);
await settle(page);
check('a master can hold an instance of another component', card.ok === true);
const buyFill = () =>
  page.evaluate((inst) => {
    const d = window.__aframe.store.getState().doc;
    const walk = (id, out = []) => {
      for (const c of d.nodes[id].children) {
        out.push(d.nodes[c]);
        walk(c, out);
      }
      return out;
    };
    return walk(inst).find((n) => n.name === 'Buy')?.fill;
  }, card.instance);
check(
  'the card instance shows the nested button as it looks',
  (await buyFill()) === '#FFAA00',
  String(await buyFill()),
);
await page.evaluate(
  (m) =>
    window.__aframe.store.getState().dispatch([{ op: 'update', id: m, set: { fill: '#00AA55' } }], {
      label: 'recolour the button',
    }),
  ids.buttonMaster,
);
await settle(page);
check(
  'editing the button updates the card that holds it',
  (await buyFill()) === '#00AA55',
  String(await buyFill()),
);
const loop = await page.evaluate(
  ({ master, buttonMaster }) => {
    const res = window.__aframe.store
      .getState()
      .dispatch(
        [{ op: 'create', parentId: buttonMaster, node: { type: 'frame', instanceOf: master } }],
        { label: 'loop' },
      );
    return res.ok ? 'allowed' : (res.errors[0]?.code ?? 'error');
  },
  { master: card.master, buttonMaster: ids.buttonMaster },
);
check(
  'a loop (the button holding the card that holds the button) is refused',
  loop === 'CYCLE',
  loop,
);

// the preview reacts to the button nested in the card, not the whole card
await page.evaluate((id) => window.__aframe.store.getState().setSelection([id]), card.instance);
await page.click('[data-testid="open-preview"]');
await page.waitForSelector('[data-testid="preview-host"] [data-node-id]');
const buyId = await page.evaluate((inst) => {
  const d = window.__aframe.store.getState().doc;
  const walk = (id, out = []) => {
    for (const c of d.nodes[id].children) {
      out.push(d.nodes[c]);
      walk(c, out);
    }
    return out;
  };
  return walk(inst).find((n) => n.name === 'Buy')?.id;
}, card.instance);
const hostEl = `[data-testid="preview-host"] [data-node-id="${buyId}"]`;
const buyBox = await page.$eval(hostEl, (e) => {
  const b = e.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
await page.mouse.move(buyBox.x, buyBox.y);
await sleep(350);
const hovered = await page.$eval(hostEl, (e) => getComputedStyle(e).backgroundColor);
check(
  'hovering the nested button shows the button’s own hover state',
  hovered === 'rgb(255, 204, 85)',
  hovered,
);
await shot('preview-card');
await page.keyboard.press('Escape');

check('no console errors', t.errors.length === 0, t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(
  r.failures === 0 ? '\nPreview checks passed.' : `\n${r.failures} preview check(s) failed.`,
);
process.exit(r.failures === 0 ? 0 : 1);
