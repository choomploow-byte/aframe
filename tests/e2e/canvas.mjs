// Phase 2 e2e: drives the real canvas in system Chrome with real mouse and keyboard events.
// Covers: overlay accuracy at many zoom levels and inside auto-layout, selection rules, the draw
// tools, move/resize/reorder, inline text editing, undo/redo, view controls and shortcuts.
// Run: npm run test:e2e:canvas
import {
  canvasBox,
  centerOf,
  click,
  drag,
  elementRect,
  idByName,
  near,
  node,
  press,
  reporter,
  selectionRect,
  setViewport,
  settle,
  start,
  state,
  worldToClient,
} from './harness.mjs';

const t = await start();
const { page } = t;
const r = reporter();
const { check } = r;

const setSelection = (ids) =>
  page
    .evaluate((x) => window.__aframe.store.getState().setSelection(x), ids)
    .then(() => settle(page));
const setTool = (tool) => page.evaluate((x) => window.__aframe.store.getState().setTool(x), tool);
const resetSample = async () => {
  await page.evaluate(() => window.__aframe.loadSample());
  await page.evaluate(() => window.__aframe.canvas().fitAll());
  await settle(page);
};
/** Zoom 1 with world point (wx, wy) at the centre of the canvas. */
const lookAt = async (wx, wy, zoom = 1) => {
  const b = await canvasBox(page);
  await setViewport(page, { zoom, x: b.w / 2 - wx * zoom, y: b.h / 2 - wy * zoom });
};

async function group(name, fn) {
  console.log(`\n# ${name}`);
  try {
    await fn();
  } catch (e) {
    check(`${name}: threw`, false, String(e?.stack ?? e));
  }
}

// ---------------------------------------------------------------------------------------------
await group('rendering', async () => {
  const hero = await idByName(page, 'Hero');
  const heroRect = await elementRect(page, hero);
  const s = await state(page);
  check('sample document loaded (55 nodes)', s.nodeCount === 55, String(s.nodeCount));
  check(
    'fit-all shows both artboards on first load',
    s.viewport.zoom > 0.1 && s.viewport.zoom < 1,
    JSON.stringify(s.viewport),
  );
  check('hero is rendered', heroRect && heroRect.w > 10, JSON.stringify(heroRect));
  const fontOk = await page.evaluate(() => {
    const el = document.querySelector('[data-node-type="text"]');
    return (
      getComputedStyle(el).fontFamily.includes('Fraunces') ||
      getComputedStyle(el).fontFamily.includes('Inter')
    );
  });
  check('text uses the bundled design fonts', fontOk);
});

// ---------------------------------------------------------------------------------------------
await group('selection overlay is exact at every zoom, inside auto-layout too', async () => {
  const ids = {
    hero: await idByName(page, 'Hero'),
    headline: await idByName(page, 'Headline'),
    card: await idByName(page, 'Card - Shared plans'),
    label: await idByName(page, 'Start free Label'),
    pro: await idByName(page, 'Plan - Pro'),
  };
  for (const zoom of [0.1, 0.25, 0.5, 1, 2.5, 8]) {
    await setViewport(page, { zoom, x: 120, y: 90 });
    let worst = 0;
    for (const [name, id] of Object.entries(ids)) {
      await setSelection([id]);
      const el = await elementRect(page, id);
      const box = await selectionRect(page, id);
      if (!el || !box) {
        check(`overlay @${zoom}x ${name}: measured`, false, 'missing rect');
        continue;
      }
      worst = Math.max(
        worst,
        Math.abs(el.x - box.x),
        Math.abs(el.y - box.y),
        Math.abs(el.w - box.w),
        Math.abs(el.h - box.h),
      );
    }
    check(
      `selection boxes match the DOM at ${zoom}x (worst error ${worst.toFixed(2)}px)`,
      worst < 0.75,
      String(worst),
    );
  }
  // The handles sit on the corners of that box.
  await setViewport(page, { zoom: 1, x: 120, y: 90 });
  await setSelection([ids.pro]);
  const box = await selectionRect(page, ids.pro);
  const nw = await page.evaluate(() => {
    const h = document.querySelector('[data-handle="nw"]').getBoundingClientRect();
    return { x: h.x + h.width / 2, y: h.y + h.height / 2 };
  });
  check(
    'north-west handle is centred on the box corner',
    near(nw.x, box.x, 1) && near(nw.y, box.y, 1),
    JSON.stringify([nw, box]),
  );
});

// ---------------------------------------------------------------------------------------------
await group('selecting', async () => {
  await resetSample();
  await setSelection([]);
  const hero = await idByName(page, 'Hero');
  const headline = await idByName(page, 'Headline');
  const features = await idByName(page, 'Features');
  const landing = await idByName(page, 'Landing - Desktop');

  await lookAt(720, 300, 0.5);
  await click(page, await centerOf(page, headline));
  check(
    'click content selects the artboard child (Hero), not the text',
    (await state(page)).selection[0] === hero,
    JSON.stringify((await state(page)).selection),
  );
  await click(page, await centerOf(page, headline));
  check('clicking again stays at the same level', (await state(page)).selection[0] === hero);
  await page.mouse.click((await centerOf(page, headline)).x, (await centerOf(page, headline)).y, {
    count: 2,
  });
  await settle(page);
  check(
    'double-click goes one level deeper',
    (await state(page)).selection[0] === headline || (await state(page)).editing === headline,
    JSON.stringify(await state(page)),
  );
  await page.keyboard.press('Escape'); // closes the editor if it opened
  await settle(page);
  await setSelection([]);
  await page.keyboard.down('Control');
  await click(page, await centerOf(page, headline));
  await page.keyboard.up('Control');
  check('ctrl+click selects the deepest node', (await state(page)).selection[0] === headline);
  await press(page, 'Escape');
  check(
    'Esc steps out to the parent',
    (await state(page)).selection[0] === hero,
    JSON.stringify((await state(page)).selection),
  );
  await press(page, 'Escape');
  await press(page, 'Escape');
  check('Esc at the top clears the selection', (await state(page)).selection.length === 0);

  await setSelection([hero]);
  await page.keyboard.down('Shift');
  await click(page, await centerOf(page, features));
  await page.keyboard.up('Shift');
  const sel = (await state(page)).selection;
  check(
    'shift+click adds to the selection',
    sel.includes(hero) && sel.includes(features),
    JSON.stringify(sel),
  );

  await setSelection([]);
  await resetSample();
  const c = await canvasBox(page);
  await drag(page, { x: c.x + 40, y: c.y + 40 }, { x: c.x + c.w - 40, y: c.y + c.h - 140 });
  const marquee = (await state(page)).selection;
  check(
    'marquee from empty canvas selects the artboards it touches',
    marquee.includes(landing) && marquee.length === 2,
    JSON.stringify(marquee),
  );
  check('marquee overlay disappears afterwards', (await page.$('.ov-marquee')) === null);

  await press(page, 'Tab');
  check('Tab selects a sibling', (await state(page)).selection.length === 1);
});

// ---------------------------------------------------------------------------------------------
await group('draw tools, undo and redo', async () => {
  await resetSample();
  await setSelection([]);
  const b = await canvasBox(page);
  const before = await state(page);
  const pageId = await page.evaluate(() => window.__aframe.store.getState().doc.rootId);
  const emptyY = b.y + b.h - 220; // below the artboards at the fit-all zoom
  const start1 = { x: b.x + 330, y: emptyY };
  await press(page, 'f');
  check('F selects the frame tool', (await state(page)).tool === 'frame');
  await page.mouse.move(start1.x, start1.y);
  await page.mouse.down();
  await page.mouse.move(start1.x + 120, start1.y + 90, { steps: 6 });
  const preview = await page.evaluate(
    () =>
      document.querySelector('.ov-draw') !== null &&
      document.querySelector('.ov-size')?.textContent,
  );
  check(
    'live size readout while drawing',
    typeof preview === 'string' && /\d+ × \d+/.test(preview),
    String(preview),
  );
  await page.mouse.up();
  await settle(page);
  let s = await state(page);
  const frameId = s.selection[0];
  const frame = await node(page, frameId);
  const zoom = s.viewport.zoom;
  check(
    'a frame was created under the page and selected',
    frame?.type === 'frame' && frame.layout === 'none' && frame.parentId === pageId,
    JSON.stringify(frame),
  );
  check(
    'its size matches the drag in world units',
    near(frame.w, 120 / zoom, 1.5) && near(frame.h, 90 / zoom, 1.5),
    `${frame.w}x${frame.h} vs ${120 / zoom}x${90 / zoom}`,
  );
  check(
    'tool returns to select, history has one "Add frame"',
    s.tool === 'select' &&
      s.past.at(-1) === 'Add frame' &&
      s.past.length === before.past.length + 1,
    JSON.stringify(s.past),
  );

  // Rectangle inside that frame.
  await press(page, 'r');
  const fr = await elementRect(page, frameId);
  await drag(page, { x: fr.x + 10, y: fr.y + 10 }, { x: fr.x + 60, y: fr.y + 50 });
  s = await state(page);
  const rectId = s.selection[0];
  const rect = await node(page, rectId);
  check(
    'rectangle is a child of the frame under the pointer',
    rect?.type === 'rect' && rect.parentId === frameId,
    JSON.stringify(rect),
  );
  check(
    'its position is relative to the frame',
    near(rect.x, 10 / zoom, 1.5) && near(rect.y, 10 / zoom, 1.5),
    `${rect.x},${rect.y}`,
  );
  check('rectangle got a token fill', rect.fill === '$border', String(rect.fill));

  await press(page, 'Control+z');
  check(
    'undo removes the rectangle only',
    (await node(page, rectId)) === null && (await node(page, frameId)) !== null,
  );
  await press(page, 'Control+Shift+z');
  check('redo brings it back', (await node(page, rectId)) !== null);
  await press(page, 'Control+y');
  check('Ctrl+Y is redo too (nothing left to redo)', (await state(page)).future.length === 0);

  // Ellipse by click (default size).
  await press(page, 'o');
  await click(page, { x: fr.x + 70, y: fr.y + 60 });
  const ell = await node(page, (await state(page)).selection[0]);
  check(
    'click with the ellipse tool creates a default 100x100 ellipse',
    ell?.type === 'ellipse' && ell.w === 100 && ell.h === 100,
    JSON.stringify(ell),
  );

  // Text tool: click, type, Escape -> one undo step.
  await press(page, 't');
  const pastBefore = (await state(page)).past.length;
  await click(page, { x: fr.x + 20, y: fr.y + 5 });
  s = await state(page);
  check('text tool starts editing the new node', s.editing !== null, JSON.stringify(s));
  const textId = s.editing;
  await page.keyboard.type('Hello canvas');
  await page.keyboard.press('Escape');
  await settle(page);
  const txt = await node(page, textId);
  check(
    'typed text is committed on Escape',
    txt?.text === 'Hello canvas',
    JSON.stringify(txt?.text),
  );
  s = await state(page);
  check(
    'create + type is one history step',
    s.past.length === pastBefore + 1 && s.past.at(-1) === 'Add text',
    JSON.stringify(s.past),
  );
  await press(page, 'Control+z');
  check('undo removes the whole text layer', (await node(page, textId)) === null);

  // Empty text is discarded.
  await press(page, 't');
  await click(page, { x: fr.x + 20, y: fr.y + 5 });
  await page.keyboard.press('Escape');
  await settle(page);
  s = await state(page);
  check(
    'leaving a new text empty creates nothing',
    (s.editing === null && s.selection.length === 0) ||
      (await node(page, s.selection[0] ?? 'none')) === null,
    JSON.stringify(s),
  );
});

// ---------------------------------------------------------------------------------------------
await group('move, snap, nudge', async () => {
  await resetSample();
  // A free-positioned scratch artboard with two rects.
  const ids = await page.evaluate(() => {
    const s = window.__aframe.store.getState();
    const res = s.dispatch(
      [
        {
          op: 'create',
          parentId: s.doc.rootId,
          node: {
            type: 'frame',
            tempId: 'f',
            name: 'Scratch',
            x: 0,
            y: 1400,
            w: 600,
            h: 400,
            layout: 'none',
            fill: '#ffffff',
          },
        },
        {
          op: 'create',
          parentId: '$f',
          node: {
            type: 'rect',
            tempId: 'a',
            name: 'A',
            x: 40,
            y: 40,
            w: 100,
            h: 60,
            fill: '#C96442',
          },
        },
        {
          op: 'create',
          parentId: '$f',
          node: {
            type: 'rect',
            tempId: 'b',
            name: 'B',
            x: 300,
            y: 200,
            w: 100,
            h: 60,
            fill: '#6B6A65',
          },
        },
      ],
      { label: 'Scratch' },
    );
    return res.idMap;
  });
  await lookAt(300, 1600, 1);
  await setSelection([ids.a]);
  const a0 = await node(page, ids.a);
  const from = await centerOf(page, ids.a);
  await page.keyboard.down('Control'); // disables snapping for the plain-move assertion
  await drag(page, from, { x: from.x + 70, y: from.y + 30 });
  await page.keyboard.up('Control');
  const a1 = await node(page, ids.a);
  check(
    'dragging moves the node by the pointer delta (at 1x)',
    near(a1.x, a0.x + 70, 1) && near(a1.y, a0.y + 30, 1),
    `${a1.x},${a1.y}`,
  );
  check(
    'the whole drag is one undo step',
    (await state(page)).past.at(-1) === 'Move' &&
      (await state(page)).past.filter((l) => l === 'Move').length === 1,
  );
  await press(page, 'Control+z');
  const a2 = await node(page, ids.a);
  check('undo puts it back exactly', a2.x === a0.x && a2.y === a0.y);

  // Snapping: drag A so its left edge is 3px from B's left edge (x=300).
  const p = await centerOf(page, ids.a);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + (297 - a0.x), p.y, { steps: 5 });
  const guideShown = await page.evaluate(() => document.querySelectorAll('.ov-guide').length);
  await page.mouse.up();
  await settle(page);
  const snapped = await node(page, ids.a);
  check('snaps to the sibling edge within 6px', snapped.x === 300, String(snapped.x));
  check('guide line shown while snapped', guideShown >= 1, String(guideShown));
  check('guides are gone after release', (await page.$('.ov-guide')) === null);

  // Nudge.
  await setSelection([ids.b]);
  const b0 = await node(page, ids.b);
  await press(page, 'ArrowRight');
  await press(page, 'Shift+ArrowDown');
  const b1 = await node(page, ids.b);
  check(
    'arrows nudge 1px, shift+arrow 10px',
    b1.x === b0.x + 1 && b1.y === b0.y + 10,
    `${b1.x},${b1.y}`,
  );
});

// ---------------------------------------------------------------------------------------------
await group('resize', async () => {
  await resetSample();
  const ids = await page.evaluate(() => {
    const s = window.__aframe.store.getState();
    return s.dispatch(
      [
        {
          op: 'create',
          parentId: s.doc.rootId,
          node: {
            type: 'frame',
            tempId: 'f',
            name: 'Scratch',
            x: 0,
            y: 1400,
            w: 600,
            h: 400,
            layout: 'none',
            fill: '#ffffff',
          },
        },
        {
          op: 'create',
          parentId: '$f',
          node: { type: 'rect', tempId: 'a', x: 100, y: 100, w: 100, h: 100, fill: '#C96442' },
        },
      ],
      { label: 'Scratch' },
    ).idMap;
  });
  await lookAt(200, 1550, 2);
  await setSelection([ids.a]);
  const handle = async (h) =>
    page.evaluate((name) => {
      const r = document.querySelector(`[data-handle="${name}"]`).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, h);

  let from = await handle('se');
  await drag(page, from, { x: from.x + 40, y: from.y + 20 });
  let n = await node(page, ids.a);
  check(
    'se handle grows width/height by delta/zoom (2x zoom)',
    n.w === 120 && n.h === 110 && n.x === 100 && n.y === 100,
    JSON.stringify(n),
  );
  check('resize is one undo step', (await state(page)).past.at(-1) === 'Resize');

  from = await handle('nw');
  await drag(page, from, { x: from.x + 20, y: from.y + 20 });
  n = await node(page, ids.a);
  check(
    'nw handle moves the origin and shrinks, opposite corner stays',
    n.x === 110 && n.y === 110 && n.w === 110 && n.h === 100,
    JSON.stringify(n),
  );

  from = await handle('e');
  await drag(page, from, { x: from.x + 20, y: from.y + 99 });
  n = await node(page, ids.a);
  check('edge handles change one axis only', n.w === 120 && n.h === 100, JSON.stringify(n));

  from = await handle('se');
  await drag(page, from, { x: from.x + 100, y: from.y + 10 }, { hold: ['Shift'] });
  n = await node(page, ids.a);
  check(
    'shift keeps the aspect ratio on corners',
    near(n.w / n.h, 120 / 100, 0.02),
    JSON.stringify(n),
  );

  const c0 = await node(page, ids.a);
  from = await handle('se');
  await drag(page, from, { x: from.x + 20, y: from.y + 20 }, { hold: ['Alt'] });
  n = await node(page, ids.a);
  check(
    'alt resizes from the centre',
    near(n.x + n.w / 2, c0.x + c0.w / 2, 0.5) &&
      near(n.y + n.h / 2, c0.y + c0.h / 2, 0.5) &&
      n.w > c0.w,
    JSON.stringify([c0, n]),
  );

  from = await handle('se');
  await drag(page, from, { x: from.x - 5000, y: from.y - 5000 });
  n = await node(page, ids.a);
  check('cannot collapse below 1px', n.w >= 1 && n.h >= 1, JSON.stringify(n));

  // Auto-layout child: resize sets a fixed size, siblings reflow.
  await resetSample();
  const card = await idByName(page, 'Card - Shared plans');
  const sibling = await idByName(page, 'Card - Focused weeks');
  await lookAt(720, 1400, 0.6);
  const sibBefore = await elementRect(page, sibling);
  await setSelection([card]);
  from = await handle('e');
  await drag(page, from, { x: from.x + 60, y: from.y });
  n = await node(page, card);
  const sibAfter = await elementRect(page, sibling);
  check(
    'resizing an auto-layout child sets a fixed width and no x/y',
    typeof n.w === 'number' && n.x === 0,
    JSON.stringify([n.w, n.x]),
  );
  check(
    'siblings reflow live (the fill siblings got narrower)',
    sibAfter.w < sibBefore.w - 5,
    `${sibBefore.w} -> ${sibAfter.w}`,
  );
  await press(page, 'Control+z');
  const restored = await elementRect(page, sibling);
  check('undo restores the layout', near(restored.w, sibBefore.w, 0.5), `${restored.w}`);
});

// ---------------------------------------------------------------------------------------------
await group('reorder inside auto-layout', async () => {
  await resetSample();
  const [l1, l2, l3, navLinks] = await Promise.all(
    ['Link Product', 'Link Pricing', 'Link Docs', 'Nav Links'].map((n) => idByName(page, n)),
  );
  await lookAt(1000, 70, 1);
  await setSelection([l1]);
  const from = await centerOf(page, l1);
  const target = await centerOf(page, l3);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(target.x + 20, from.y, { steps: 8 });
  const during = await page.evaluate(() => ({
    insertion: document.querySelector('[data-testid="insertion"]') !== null,
    ghost: document.querySelector('.ov-ghost') !== null,
  }));
  check(
    'insertion indicator and ghost show while dragging',
    during.insertion && during.ghost,
    JSON.stringify(during),
  );
  const mid = (await node(page, navLinks)).children;
  check('nothing is committed until release', mid[0] === l1, JSON.stringify(mid));
  await page.mouse.up();
  await settle(page);
  const after = (await node(page, navLinks)).children;
  check(
    'dropping reorders the layout',
    JSON.stringify(after) === JSON.stringify([l2, l3, l1]),
    JSON.stringify(after),
  );
  check('reorder is one undo step', (await state(page)).past.at(-1) === 'Reorder');
  await press(page, 'Control+z');
  check(
    'undo restores the order',
    JSON.stringify((await node(page, navLinks)).children) === JSON.stringify([l1, l2, l3]),
  );
});

// ---------------------------------------------------------------------------------------------
await group('inline text editing', async () => {
  await resetSample();
  const headline = await idByName(page, 'Headline');
  await lookAt(720, 300, 0.6);
  await setSelection([headline]);
  await press(page, 'Enter');
  let s = await state(page);
  check('Enter on a text node starts editing', s.editing === headline, JSON.stringify(s));
  const editable = await page.evaluate(() => {
    const el = document.querySelector('[data-editing="true"]');
    return {
      attr: el?.getAttribute('contenteditable'),
      focused: document.activeElement === el,
      selected: window.getSelection()?.toString(),
    };
  });
  check(
    'the node itself is editable, focused, text pre-selected',
    editable.attr === 'plaintext-only' &&
      editable.focused &&
      editable.selected.startsWith('Plan work'),
    JSON.stringify(editable),
  );
  const keysBefore = (await state(page)).rev;
  await page.keyboard.type('Ship it');
  await page.keyboard.press('Enter');
  await page.keyboard.type('today');
  check('nothing is dispatched while typing', (await state(page)).rev === keysBefore);
  await page.keyboard.down('Control');
  await page.keyboard.press('Enter');
  await page.keyboard.up('Control');
  await settle(page);
  const after = await node(page, headline);
  check(
    'Ctrl+Enter commits, newlines preserved',
    after.text === 'Ship it\ntoday',
    JSON.stringify(after.text),
  );
  s = await state(page);
  check('one "Edit text" history entry', s.editing === null && s.past.at(-1) === 'Edit text');
  const lines = await page.evaluate(
    (id) => document.querySelector(`[data-node-id="${id}"]`).getBoundingClientRect().height,
    headline,
  );
  check('the multi-line text renders taller than one line', lines > 40, String(lines));
  await press(page, 'Control+z');
  check(
    'undo restores the original text',
    (await node(page, headline)).text === 'Plan work your team will actually follow',
  );

  // Keys inside the editor do not trigger tool shortcuts.
  await setSelection([headline]);
  await press(page, 'Enter');
  await page.keyboard.type('rfo');
  const tool = (await state(page)).tool;
  check('typing r/f/o in the editor does not switch tools', tool === 'select', tool);
  await page.keyboard.press('Escape');
  await settle(page);

  // Blur commits too.
  await setSelection([headline]);
  await press(page, 'Enter');
  await page.keyboard.type('Blur commit');
  await page.mouse.click(40, 500); // somewhere neutral on the left panel
  await settle(page);
  check(
    'clicking away commits the edit',
    (await node(page, headline)).text === 'Blur commit',
    JSON.stringify((await node(page, headline)).text),
  );
});

// ---------------------------------------------------------------------------------------------
await group('view: pan, zoom, fit', async () => {
  await resetSample();
  const c = await canvasBox(page);
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const hero = await idByName(page, 'Hero');
  await page.mouse.move(cx + 100, cy + 50);
  const worldUnder = await page.evaluate(
    ([x, y]) => {
      const s = window.__aframe.store.getState();
      const r = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
      return {
        x: (x - r.x - s.viewport.x) / s.viewport.zoom,
        y: (y - r.y - s.viewport.y) / s.viewport.zoom,
      };
    },
    [cx + 100, cy + 50],
  );
  await page.keyboard.down('Control');
  for (let i = 0; i < 5; i += 1) await page.mouse.wheel({ deltaY: -120 });
  await page.keyboard.up('Control');
  await settle(page);
  const s = await state(page);
  check('ctrl+wheel zooms in', s.viewport.zoom > 0.5, String(s.viewport.zoom));
  const again = await worldToClient(page, worldUnder.x, worldUnder.y);
  check(
    'zoom keeps the world point under the cursor fixed',
    near(again.x, cx + 100, 1) && near(again.y, cy + 50, 1),
    JSON.stringify([again, { x: cx + 100, y: cy + 50 }]),
  );

  const vp0 = (await state(page)).viewport;
  await page.mouse.wheel({ deltaX: 40, deltaY: 80 });
  await settle(page);
  const vp1 = (await state(page)).viewport;
  check(
    'plain wheel pans',
    near(vp1.x, vp0.x - 40, 0.5) && near(vp1.y, vp0.y - 80, 0.5) && vp1.zoom === vp0.zoom,
    JSON.stringify([vp0, vp1]),
  );

  await page.keyboard.down('Space');
  await drag(page, { x: cx, y: cy }, { x: cx + 60, y: cy + 40 });
  await page.keyboard.up('Space');
  const vp2 = (await state(page)).viewport;
  check(
    'space+drag pans',
    near(vp2.x, vp1.x + 60, 1) && near(vp2.y, vp1.y + 40, 1),
    JSON.stringify([vp1, vp2]),
  );
  check(
    'space+drag does not change the selection or document',
    (await state(page)).past.length === 0,
  );

  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx - 30, cy - 30, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await settle(page);
  const vp3 = (await state(page)).viewport;
  check('middle mouse drag pans', near(vp3.x, vp2.x - 30, 1), JSON.stringify([vp2, vp3]));

  await setTool('hand');
  await drag(page, { x: cx, y: cy }, { x: cx + 25, y: cy });
  await setTool('select');
  check('hand tool pans', near((await state(page)).viewport.x, vp3.x + 25, 1));

  await press(page, 'Control+0');
  check('Ctrl+0 is 100%', (await state(page)).viewport.zoom === 1);
  await press(page, '+');
  check('+ steps the zoom in', (await state(page)).viewport.zoom === 1.5);
  await press(page, '-');
  await press(page, '-');
  check('- steps the zoom out', (await state(page)).viewport.zoom === 0.75);

  await press(page, 'Shift+1');
  const fit = await Promise.all(
    ['Landing - Desktop', 'Pricing - Needs Work'].map(async (n) =>
      elementRect(page, await idByName(page, n)),
    ),
  );
  const inside = fit.every(
    (e) =>
      e.x >= c.x - 1 && e.y >= c.y - 1 && e.x + e.w <= c.x + c.w + 1 && e.y + e.h <= c.y + c.h + 1,
  );
  check('Shift+1 fits every artboard inside the canvas', inside, JSON.stringify([fit, c]));

  await setSelection([hero]);
  await press(page, 'Shift+2');
  const heroFit = await elementRect(page, hero);
  check(
    'Shift+2 fills the view with the selection',
    heroFit.w > c.w * 0.6 || heroFit.h > c.h * 0.6,
    JSON.stringify(heroFit),
  );

  await page.click('[data-testid="zoom-level"]');
  await page.click('.menu__item:nth-child(3)'); // zoom to 100%
  await settle(page);
  check('zoom menu works (100%)', (await state(page)).viewport.zoom === 1);
  const label = await page.$eval('[data-testid="zoom-level"]', (e) => e.textContent);
  check('zoom label shows the percentage', label?.includes('100%'), String(label));
});

// ---------------------------------------------------------------------------------------------
await group('edit commands via shortcuts', async () => {
  await resetSample();
  const ids = await page.evaluate(() => {
    const s = window.__aframe.store.getState();
    return s.dispatch(
      [
        {
          op: 'create',
          parentId: s.doc.rootId,
          node: {
            type: 'frame',
            tempId: 'f',
            name: 'Scratch',
            x: 0,
            y: 1400,
            w: 700,
            h: 400,
            layout: 'none',
            fill: '#ffffff',
          },
        },
        {
          op: 'create',
          parentId: '$f',
          node: {
            type: 'rect',
            tempId: 'a',
            name: 'A',
            x: 20,
            y: 20,
            w: 100,
            h: 60,
            fill: '#C96442',
          },
        },
        {
          op: 'create',
          parentId: '$f',
          node: {
            type: 'rect',
            tempId: 'b',
            name: 'B',
            x: 160,
            y: 20,
            w: 100,
            h: 60,
            fill: '#6B6A65',
          },
        },
        {
          op: 'create',
          parentId: '$f',
          node: {
            type: 'rect',
            tempId: 'c',
            name: 'C',
            x: 300,
            y: 20,
            w: 100,
            h: 60,
            fill: '#E8E6DC',
          },
        },
      ],
      { label: 'Scratch' },
    ).idMap;
  });
  await lookAt(350, 1600, 1);
  const count = async () => (await state(page)).nodeCount;
  const n0 = await count();

  await setSelection([ids.a]);
  await press(page, 'Control+d');
  const copy = (await state(page)).selection[0];
  check(
    'Ctrl+D duplicates and selects the copy, offset by 16',
    copy !== ids.a && (await node(page, copy)).x === 36 && (await count()) === n0 + 1,
  );
  await press(page, 'Delete');
  check('Delete removes it', (await count()) === n0);

  await setSelection([ids.b]);
  await press(page, 'Control+c');
  await press(page, 'Control+v');
  const pasted = (await state(page)).selection[0];
  check(
    'Ctrl+C / Ctrl+V pastes a copy next to the original',
    pasted !== ids.b && (await node(page, pasted)).parentId === (await node(page, ids.b)).parentId,
    JSON.stringify(await node(page, pasted)),
  );
  await press(page, 'Control+z');

  await setSelection([ids.a]);
  await press(page, ']');
  const order = (await node(page, (await node(page, ids.a)).parentId)).children;
  check('] brings forward one step', order.indexOf(ids.a) === 1, JSON.stringify(order));
  await press(page, 'Control+[');
  check(
    'Ctrl+[ sends to back',
    (await node(page, (await node(page, ids.a)).parentId)).children[0] === ids.a,
  );

  await setSelection([ids.a, ids.b, ids.c]);
  await press(page, 'Control+g');
  const wrapper = (await state(page)).selection[0];
  const w = await node(page, wrapper);
  check(
    'Ctrl+G wraps the selection in a frame that fits it',
    w.type === 'frame' && w.children.length === 3 && near(w.w, 380, 0.5),
    JSON.stringify(w),
  );
  check(
    'wrapped nodes did not move on screen',
    near((await elementRect(page, ids.c)).x - (await elementRect(page, ids.a)).x, 280, 1),
  );

  await press(page, 'Control+Alt+a');
  const afterLayout = await node(page, wrapper);
  check(
    'Ctrl+Alt+A turns it into a row with the detected gap',
    afterLayout.layout === 'row' && afterLayout.gap === 40,
    JSON.stringify(afterLayout),
  );
  check('auto layout is one undo step', (await state(page)).past.at(-1) === 'Add auto layout');
  await press(page, 'Control+z');
  check('undo returns to free positioning', (await node(page, wrapper)).layout === 'none');

  await press(page, 'Control+Shift+z');
  await setSelection([ids.a]);
  // Tab selects the next sibling while the canvas has focus (a click gives it focus). With nothing
  // focused it enters the interface instead, so keyboard users are never trapped on the canvas.
  await page.focus('[data-testid="canvas"]');
  await press(page, 'Tab');
  check('Tab moves to the next sibling', (await state(page)).selection[0] !== ids.a);
});

// ---------------------------------------------------------------------------------------------
await group('more gestures: alt-drag copy, multi-move, locked nodes, hover', async () => {
  await resetSample();
  const ids = await page.evaluate(() => {
    const s = window.__aframe.store.getState();
    return s.dispatch(
      [
        {
          op: 'create',
          parentId: s.doc.rootId,
          node: {
            type: 'frame',
            tempId: 'f',
            name: 'Scratch',
            x: 0,
            y: 1400,
            w: 700,
            h: 400,
            layout: 'none',
            fill: '#ffffff',
          },
        },
        {
          op: 'create',
          parentId: '$f',
          node: {
            type: 'rect',
            tempId: 'a',
            name: 'A',
            x: 40,
            y: 40,
            w: 100,
            h: 60,
            fill: '#C96442',
          },
        },
        {
          op: 'create',
          parentId: '$f',
          node: {
            type: 'rect',
            tempId: 'b',
            name: 'B',
            x: 200,
            y: 40,
            w: 100,
            h: 60,
            fill: '#6B6A65',
          },
        },
      ],
      { label: 'Scratch' },
    ).idMap;
  });
  await lookAt(350, 1600, 1);
  const count = async () => (await state(page)).nodeCount;

  // Hover outline follows the pointer.
  const over = await centerOf(page, ids.a);
  await page.mouse.move(over.x, over.y);
  await settle(page);
  check('hovering a node draws a hover outline', (await page.$('.ov-hover')) !== null);

  // Alt-drag duplicates and moves the copy.
  await setSelection([ids.a]);
  const n0 = await count();
  const from = await centerOf(page, ids.a);
  await page.keyboard.down('Control'); // no snapping, so the numbers are exact
  await drag(page, from, { x: from.x, y: from.y + 120 }, { hold: ['Alt'] });
  await page.keyboard.up('Control');
  const sel = (await state(page)).selection;
  const copy = await node(page, sel[0]);
  const orig = await node(page, ids.a);
  check(
    'alt-drag leaves the original and moves a copy',
    (await count()) === n0 + 1 && sel[0] !== ids.a && orig.y === 40 && near(copy.y, 160, 1),
    JSON.stringify([orig.y, copy.y]),
  );
  check('alt-drag duplicate is one undo step', (await state(page)).past.at(-1) === 'Move');
  await press(page, 'Control+z');
  check('undo removes the copy', (await count()) === n0 && (await node(page, ids.a)).y === 40);

  // Multi-select drag moves both together.
  await setSelection([ids.a, ids.b]);
  const f2 = await centerOf(page, ids.a);
  await page.keyboard.down('Control');
  await drag(page, f2, { x: f2.x + 30, y: f2.y + 20 });
  await page.keyboard.up('Control');
  const [ma, mb] = await Promise.all([node(page, ids.a), node(page, ids.b)]);
  check(
    'dragging a multi-selection moves every node by the same delta',
    near(ma.x, 70, 1) && near(mb.x, 230, 1) && near(ma.y, 60, 1) && near(mb.y, 60, 1),
    JSON.stringify([ma, mb]),
  );
  check(
    'multi-selection shows individual boxes plus a group box',
    (await page.$$('.ov-selected')).length === 2 && (await page.$('.ov-group')) !== null,
  );
  check('no resize handles for a multi-selection', (await page.$('[data-handle]')) === null);

  // Locked nodes: selectable, never moved, no handles, arrows ignored.
  await page.evaluate(
    (id) =>
      window.__aframe.store.getState().dispatch([{ op: 'update', id, set: { locked: true } }]),
    ids.b,
  );
  await setSelection([ids.b]);
  const lockedBefore = await node(page, ids.b);
  const lf = await centerOf(page, ids.b);
  await page.keyboard.down('Control');
  await drag(page, lf, { x: lf.x + 50, y: lf.y + 50 });
  await page.keyboard.up('Control');
  await press(page, 'ArrowRight');
  const lockedAfter = await node(page, ids.b);
  check(
    'a locked node does not move by drag or arrows',
    lockedAfter.x === lockedBefore.x && lockedAfter.y === lockedBefore.y,
  );
  check('a locked node shows no resize handles', (await page.$('[data-handle]')) === null);
  check('a locked node is still selectable', (await state(page)).selection[0] === ids.b);
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
  r.failures === 0 ? '\nAll canvas checks passed.' : `\n${r.failures} canvas check(s) failed.`,
);
process.exit(r.failures === 0 ? 0 : 1);
