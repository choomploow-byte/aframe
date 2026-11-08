// Phase 6 e2e: notes and references, driven like a person (real mouse and keyboard) in real Chrome.
// Pins and regions, a pin following its node, pins keeping their size at any zoom, the Notes tab,
// resolving, an AI reply, undo, "Ask AI", references with note and scope, and compare mode.
// SHOT_DIR=<dir> saves screenshots. Run: node tests/e2e/annotations.mjs
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { elementRect, idByName, node, press, reporter, settle, start } from './harness.mjs';

const t = await start({ width: 1500, height: 940 });
const { page } = t;
const r = reporter();
const { check, info } = r;
const SHOT_DIR = process.env.SHOT_DIR;
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const shot = async (name) => {
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
};
const doc = () =>
  page.evaluate(() => JSON.parse(JSON.stringify(window.__aframe.store.getState().doc)));
const dispatch = (ops, label = 'test') =>
  page.evaluate(
    (o, l) => window.__aframe.store.getState().dispatch(o, { label: l }).ok,
    ops,
    label,
  );
const pinRect = (id) =>
  page.evaluate((nid) => {
    const el = document.querySelector(`[data-annotation-id="${nid}"]`);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
  }, id);
const zoomNow = () => page.evaluate(() => window.__aframe.store.getState().viewport.zoom);
const tab = (name) =>
  page.evaluate((n) => {
    [...document.querySelectorAll('[role="tab"]')]
      .find((b) => b.textContent?.startsWith(n))
      ?.click();
  }, name);

// ---- a design to annotate -----------------------------------------------------------------------
await page.evaluate(() => window.__aframe.loadBlank());
await settle(page);
const root = (await doc()).rootId;
await dispatch([
  {
    op: 'create',
    parentId: root,
    node: {
      type: 'frame',
      name: 'Screen',
      x: 120,
      y: 120,
      w: 520,
      h: 360,
      layout: 'none',
      fill: '#FFFFFF',
      children: [
        { type: 'rect', name: 'Button', x: 60, y: 80, w: 160, h: 48, fill: '#5B3CB0', radius: 10 },
        { type: 'rect', name: 'Card', x: 260, y: 160, w: 200, h: 140, fill: '#ECE6F8', radius: 12 },
      ],
    },
  },
]);
await settle(page);
await page.evaluate(() => window.__aframe.canvas().fitAll());
await settle(page);
const buttonId = await idByName(page, 'Button');
const cardId = await idByName(page, 'Card');

// ---- the tool -----------------------------------------------------------------------------------
await page.focus('[data-testid="canvas"]');
await press(page, 'a');
check(
  'A selects the Annotate tool',
  (await page.evaluate(() => window.__aframe.store.getState().tool)) === 'annotate',
);
check(
  'the toolbar shows it as enabled',
  (await page.$eval('[data-tool="annotate"], [aria-label^="Annotate"]', (b) => !b.disabled)) ===
    true,
);

// ---- a pin on a button: click, type, Enter --------------------------------------------------------
{
  const b = await elementRect(page, buttonId);
  const at = { x: b.x + 20, y: b.y + 12 };
  await page.mouse.click(at.x, at.y);
  await settle(page);
  check('a click opens the note composer', !!(await page.$('[data-testid="note-composer"]')));
  await page.keyboard.type('make this pop');
  await shot('composer');
  await page.keyboard.press('Enter');
  await settle(page);
  const d = await doc();
  const note = d.annotations[0];
  check(
    'Enter saves the note',
    d.annotations.length === 1 && note.text === 'make this pop',
    JSON.stringify(note),
  );
  check(
    'it is attached to the button, not the page',
    note?.nodeId === buttonId,
    String(note?.nodeId),
  );
  const z = await zoomNow();
  check(
    'with the offset inside the button, in design units (a click 20px in, at this zoom)',
    note?.offset &&
      Math.abs(note.offset.x - 20 / z) < 1.5 &&
      Math.abs(note.offset.y - 12 / z) < 1.5,
    JSON.stringify({ offset: note?.offset, zoom: z }),
  );
  check('authored by the user, open', note?.author === 'user' && note?.status === 'open');
  const pin = await pinRect(note.id);
  check(
    'a numbered pin sits where it was clicked',
    pin !== null && Math.abs(pin.x - at.x) < 3 && Math.abs(pin.y - at.y) < 3,
    JSON.stringify({ pin, at }),
  );
  check(
    'and says 1',
    (await page.$eval(`[data-annotation-id="${note.id}"]`, (e) => e.textContent)) === '1',
  );
  check('the composer closed', !(await page.$('[data-testid="note-composer"]')));
  await shot('pin');
}

// ---- a region: drag, type, Enter --------------------------------------------------------------------
{
  const c = await elementRect(page, cardId);
  await page.mouse.move(c.x + 20, c.y + 20);
  await page.mouse.down();
  await page.mouse.move(c.x + 90, c.y + 60, { steps: 6 });
  await page.mouse.move(c.x + 150, c.y + 110, { steps: 6 });
  await page.mouse.up();
  await settle(page);
  check('dragging makes a region note composer', !!(await page.$('[data-testid="note-composer"]')));
  check('with a draft outline on the canvas', !!(await page.$('.note-region--draft')));
  await page.keyboard.type('too cramped in here');
  await page.keyboard.press('Enter');
  await settle(page);
  const d = await doc();
  const region = d.annotations[1];
  const zr = await zoomNow();
  check(
    'a region is saved with its size (130 x 90 px on screen), on the card',
    region?.rect &&
      Math.abs(region.rect.w - 130 / zr) < 2 &&
      Math.abs(region.rect.h - 90 / zr) < 2 &&
      region.nodeId === cardId,
    JSON.stringify(region),
  );
  check(
    'and drawn as a dashed region',
    (await page.$$('.note-region:not(.note-region--draft)')).length === 1,
  );
}

// Escape cancels an empty composer; an empty note cannot be saved
{
  await page.mouse.click(700, 840);
  await settle(page);
  check(
    'Save is disabled while the note is empty',
    await page.$eval('[data-action="save-note"]', (b) => b.disabled),
  );
  await page.keyboard.press('Escape');
  await settle(page);
  check(
    'Escape cancels the composer',
    !(await page.$('[data-testid="note-composer"]')) && (await doc()).annotations.length === 2,
  );
}
await press(page, 'v');

// ---- a pin follows its node ----------------------------------------------------------------------------
{
  const id = (await doc()).annotations[0].id;
  const before = await pinRect(id);
  await dispatch([{ op: 'update', id: buttonId, set: { x: 160, y: 140 } }], 'move button');
  await settle(page);
  const after = await pinRect(id);
  const zoom = await page.evaluate(() => window.__aframe.store.getState().viewport.zoom);
  check(
    'moving the button moves the pin with it',
    Math.abs(after.x - before.x - 100 * zoom) < 2 && Math.abs(after.y - before.y - 60 * zoom) < 2,
    JSON.stringify({ before, after, zoom }),
  );
  await dispatch([{ op: 'update', id: buttonId, set: { w: 300 } }], 'resize button');
  await settle(page);
  const resized = await pinRect(id);
  check(
    'resizing it leaves the pin where it was inside the box',
    Math.abs(resized.x - after.x) < 1.5,
  );
  await shot('followed');
}

// ---- pins keep their size at any zoom ---------------------------------------------------------------------
{
  const id = (await doc()).annotations[0].id;
  const small = await pinRect(id);
  await page.evaluate(() => {
    const s = window.__aframe.store.getState();
    s.setViewport({ ...s.viewport, zoom: s.viewport.zoom * 3 });
  });
  await settle(page);
  const big = await pinRect(id);
  const region = await page.$eval(
    '.note-region:not(.note-region--draft)',
    (e) => e.getBoundingClientRect().width,
  );
  check(
    'a pin is the same size at three times the zoom',
    Math.abs(big.w - small.w) < 0.5,
    `${small.w} vs ${big.w}`,
  );
  check('a region grows with the zoom', region > 200, String(region));
  await page.evaluate(() => window.__aframe.canvas().fitAll());
  await settle(page);
}

// ---- the Notes tab -------------------------------------------------------------------------------------------
{
  await tab('Notes');
  await settle(page);
  check(
    'the Notes tab carries the open count',
    (await page.$eval('[data-tab="notes"]', (e) => e.textContent)).includes('2'),
  );
  check('it lists both notes', (await page.$$('[data-testid="note-row"]')).length === 2);
  check(
    'each says who wrote it',
    (
      await page.$$eval('[data-testid="note-row"] .badge', (e) => e.map((x) => x.textContent))
    ).join() === 'You,You',
  );
  await shot('notes-tab');

  // clicking a note selects its node and focuses its card
  await page.evaluate(() => window.__aframe.store.getState().setSelection([]));
  await page.click('[data-testid="note-row"]:nth-child(2) .nrow__main');
  await settle(page);
  check(
    'clicking a note selects the node it is on',
    (await page.evaluate(() => window.__aframe.store.getState().selection[0])) === cardId,
  );
  check('and opens its card on the canvas', !!(await page.$('[data-testid="note-card"]')));
  const pin = await pinRect((await doc()).annotations[1].id);
  const view = await page.$eval('[data-testid="canvas"]', (e) => {
    const b = e.getBoundingClientRect();
    return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
  });
  check(
    'and brings its pin to the middle of the view',
    Math.abs(pin.x - view.cx) < 40 && Math.abs(pin.y - view.cy) < 40,
    JSON.stringify({ pin, view }),
  );
  await page.click('[data-testid="note-card"] [aria-label="Close"]');

  // an AI reply shows in the panel and on the card
  const id1 = (await doc()).annotations[0].id;
  await page.evaluate((id) => {
    const s = window.__aframe.store.getState();
    s.adoptExternal(
      {
        ...s.doc,
        annotations: s.doc.annotations.map((a) =>
          a.id === id ? { ...a, status: 'resolved', reply: 'Added a glow and bolder type.' } : a,
        ),
      },
      'AI resolved a note',
    );
  }, id1);
  await settle(page);
  check(
    'the resolved note leaves the Open list',
    (await page.$$('[data-testid="note-row"]')).length === 1,
  );
  await page.click('[data-tab="notes"]');
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="radio"]')]
      .find((b) => b.textContent?.startsWith('Resolved'))
      ?.click();
  });
  await settle(page);
  check(
    'the AI reply is shown under the resolved note',
    (await page.$eval('[data-testid="note-reply"]', (e) => e.textContent)).includes('Added a glow'),
  );
  check(
    'the Resolved filter shows it, with a check, not a number',
    (await page.$$('[data-testid="note-row"][data-status="resolved"]')).length === 1,
  );
  // reopen it
  await page.click('[data-testid="note-row"] [data-action="reopen-note"]');
  await settle(page);
  check('Reopen makes it open again', (await doc()).annotations[0].status === 'open');
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="radio"]')]
      .find((b) => b.textContent?.startsWith('Open'))
      ?.click();
  });
  await settle(page);

  // resolve one from the list; one undo brings it back
  const open1 = (await page.$$('[data-testid="note-row"]')).length;
  await page.click('[data-testid="note-row"] [data-action="resolve-note"]');
  await settle(page);
  check(
    'Resolve moves a note out of Open',
    (await page.$$('[data-testid="note-row"]')).length === open1 - 1,
  );
  await page.focus('[data-testid="canvas"]');
  await press(page, 'Control+z');
  await settle(page);
  check(
    'and one Ctrl+Z puts it back',
    (await page.$$('[data-testid="note-row"]')).length === open1,
  );

  // Ask AI
  await page.evaluate(() => navigator.clipboard?.writeText('').catch(() => undefined));
  await page.click('[data-action="ask-ai"]');
  await settle(page);
  const toast = await page.$$eval('[role="status"], .toast', (e) =>
    e.map((x) => x.textContent).join(' | '),
  );
  check(
    '"Ask AI" gives the sentence to say',
    /in aframe, address my open annotations/.test(toast),
    toast,
  );

  // delete from the list
  await page.click('[data-testid="note-row"]:last-child [data-action="delete-note"]');
  await settle(page);
  check('Delete removes a note', (await doc()).annotations.length === 1);
  await press(page, 'Control+z');
}

// ---- references ------------------------------------------------------------------------------------------------
{
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC';
  await page.evaluate((url) => {
    const s = window.__aframe.store.getState();
    const d = s.doc;
    s.adoptExternal(
      {
        ...d,
        assets: { ...d.assets, img_ref01: url },
        references: [{ id: 'r_ref01', name: 'Reference 1', assetId: 'img_ref01', scope: 'style' }],
      },
      'test reference',
    );
  }, png);
  await tab('Design');
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent === 'Assets')?.click();
  });
  await settle(page);
  check(
    'a reference shows its number and id',
    (await page.$eval('[data-reference-id="r_ref01"]', (e) => e.textContent)).includes(
      'Reference 1',
    ) && (await page.$eval('.refcard__id', (e) => e.textContent)) === 'r_ref01',
  );
  await page.select('[data-field="reference-scope"]', 'layout');
  await settle(page);
  check('the scope can be changed', (await doc()).references[0].scope === 'layout');
  await page.click('[aria-label="Note for the AI"]');
  await page.keyboard.type('match spacing and type, not colours');
  await page.keyboard.press('Enter');
  await settle(page);
  check(
    'the note can be written',
    (await doc()).references[0].note === 'match spacing and type, not colours',
    JSON.stringify((await doc()).references[0]),
  );

  // compare
  await page.evaluate(
    (id) => window.__aframe.store.getState().setSelection([id]),
    await idByName(page, 'Screen'),
  );
  await page.click('[data-action="compare-reference"]');
  await settle(page);
  check(
    'Compare shows the reference over the selected frame',
    !!(await page.$('[data-testid="compare-overlay"]')) &&
      !!(await page.$('[data-testid="compare-bar"]')),
  );
  const frame = await elementRect(page, await idByName(page, 'Screen'));
  const ov = await page.$eval('[data-testid="compare-overlay"]', (e) => {
    const b = e.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, op: getComputedStyle(e).opacity };
  });
  check(
    'lined up with the frame, at half opacity',
    Math.abs(ov.x - frame.x) < 2 && Math.abs(ov.w - frame.w) < 2 && ov.op === '0.5',
    JSON.stringify({ ov, frame }),
  );
  await page.focus('[data-field="compare-opacity"]');
  await page.keyboard.press('Home'); // a real key on the slider: all the way down
  await settle(page);
  check(
    'the slider changes the opacity',
    (await page.$eval('[data-testid="compare-overlay"]', (e) => getComputedStyle(e).opacity)) ===
      '0',
  );
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await settle(page);
  check(
    'and arrow keys nudge it',
    (await page.$eval('[data-testid="compare-overlay"]', (e) => getComputedStyle(e).opacity)) ===
      '0.99',
  );
  await shot('compare-overlay');
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="radio"]')]
      .find((b) => b.textContent === 'Side by side')
      ?.click();
  });
  await settle(page);
  const side = await page.$eval('[data-testid="compare-side"]', (e) => {
    const b = e.getBoundingClientRect();
    return { x: b.x, h: b.height };
  });
  check(
    'side by side puts it to the right at the same height',
    !!side && side.x > frame.x + frame.w && Math.abs(side.h - frame.h) < 3,
    JSON.stringify({ side, frame }),
  );
  await shot('compare-side');
  await page.click('[data-action="stop-compare"]');
  await settle(page);
  check('Stop comparing clears it', !(await page.$('[data-testid="compare-bar"]')));
  check(
    'compare never touched the design',
    (await doc()).nodes[await idByName(page, 'Screen')].name === 'Screen' &&
      Object.keys((await doc()).nodes).length === 4,
  );
}

info('node check', await node(page, buttonId).then((n) => ({ x: n.x, y: n.y, w: n.w })));
check('no console errors during the run', t.errors.length === 0, t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(r.failures === 0 ? 'ALL PASSED' : `${r.failures} FAILED`);
process.exit(r.failures === 0 ? 0 : 1);
void sleep;
