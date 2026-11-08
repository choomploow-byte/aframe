// Beta features and the Pixel Art editor, in real Chrome with the real mouse and keyboard:
// the switches in Settings, the view appearing and disappearing, drawing with every tool, undo as
// one step per stroke, the palette, PNG/JSON export and opening a file, the keyboard cursor, and the
// AI tools drawing on the live canvas as one undo step. SHOT_DIR=<dir> saves PNGs.
// Run: node tests/e2e/pixelart.mjs
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

const F = (name) => `[data-field="${name}"]`;
const A = (name) => `[data-action="${name}"]`;
const canvasState = () =>
  page.evaluate(() => {
    const c = window.__aframe.store.getState().doc.pixelArt;
    return c ? JSON.parse(JSON.stringify(c)) : null;
  });
const pastCount = () => page.evaluate(() => window.__aframe.store.getState().history.past.length);
const cellCenter = (x, y) =>
  page.evaluate(
    (cx, cy) => {
      const el = document.querySelector('[data-testid="pixel-canvas"]');
      const b = el.getBoundingClientRect();
      const c = window.__aframe.store.getState().doc.pixelArt;
      return {
        x: b.left + ((cx + 0.5) / c.width) * b.width,
        y: b.top + ((cy + 0.5) / c.height) * b.height,
      };
    },
    x,
    y,
  );
const at = (c, x, y) => c.pixels[y * c.width + x];

await page.evaluate(() => {
  localStorage.removeItem('aframe.beta.v1');
  window.__aframe.loadBlank();
});
await settle(page);
const openSettings = async () => {
  await page.evaluate(async () => (await import('/src/ui/ui-state.ts')).openDialog('settings'));
  await page.waitForSelector('[data-testid="beta-section"]');
};
const closeSettings = async () => {
  await page.evaluate(async () => (await import('/src/ui/ui-state.ts')).closeDialog());
  await settle(page);
};

// ---- the switches --------------------------------------------------------------------------------
check(
  'off by default: no Pixel Art button anywhere',
  (await page.$('[data-testid="open-pixelart"]')) === null,
);
check(
  'off by default: the AI assistant has no pixel art tools',
  await page.evaluate(async () => {
    const m = await import('/src/chat/tool-context.ts');
    return m.chatToolDefs().every((d) => !d.name.startsWith('pixelart_'));
  }),
);
await openSettings();
check(
  'Settings has a Beta features section with a master switch',
  (await page.$(F('beta-master'))) !== null,
);
check(
  'the feature list is hidden until the master switch is on',
  (await page.$('[data-testid="beta-list"]')) === null,
);
await page.click(F('beta-master'));
await settle(page);
check(
  'turning on the master switch lists the features',
  (await page.$('[data-beta-feature="pixelArt"]')) !== null,
);
const listed = await page.$eval('[data-beta-feature="pixelArt"]', (el) => el.textContent ?? '');
check(
  'each feature shows its name and a short description',
  listed.includes('Pixel Art Editor') && listed.length > 40,
  listed,
);
await closeSettings();
check(
  'master on, feature still off: still no button',
  (await page.$('[data-testid="open-pixelart"]')) === null,
);
await openSettings();
await page.click(F('beta-pixelArt'));
await closeSettings();
check(
  'feature on: the Pixel Art button appears',
  (await page.$('[data-testid="open-pixelart"]')) !== null,
);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aframe.beta.v1')));
check(
  'the choice is saved',
  stored.enabled === true && stored.features.pixelArt === true,
  JSON.stringify(stored),
);
check(
  'on: the assistant gets the pixel art tools',
  await page.evaluate(async () => {
    const m = await import('/src/chat/tool-context.ts');
    return m.chatToolDefs().filter((d) => d.name.startsWith('pixelart_')).length === 9;
  }),
);

// ---- starting a canvas ------------------------------------------------------------------------------
await page.click('[data-testid="open-pixelart"]');
await page.waitForSelector('[data-testid="pixel-start"]');
check(
  'first time: the start screen offers sizes and opening a file',
  (await page.$(A('pixel-new-16'))) !== null &&
    (await page.$('[data-testid="pixel-open-input"]')) !== null,
);
await page.type(F('pixel-custom-w'), '0'); // 320: too big
await page.click(A('pixel-new-custom'));
await settle(page);
check(
  'a size over 128 is refused with a message',
  (await page.$('[data-testid="pixel-start-error"]')) !== null,
);
await page.click(A('pixel-new-16'));
await page.waitForSelector('[data-testid="pixel-canvas"]');
let c = await canvasState();
check(
  'a blank 16 x 16 canvas is made, all transparent',
  c?.width === 16 && c.height === 16 && c.pixels.every((p) => p === 0),
);
check(
  'the size is shown',
  (await page.$eval('[data-testid="pixel-size"]', (e) => e.textContent)).includes('16 × 16'),
);
check(
  'the canvas draws crisp pixels',
  (await page.$eval('[data-testid="pixel-canvas"]', (e) => getComputedStyle(e).imageRendering)) ===
    'pixelated',
);
await shot('pixel-blank');

// ---- drawing -----------------------------------------------------------------------------------------
const before = await pastCount();
let p0 = await cellCenter(2, 2);
let p1 = await cellCenter(8, 2);
await page.mouse.move(p0.x, p0.y);
await page.mouse.down();
await page.mouse.move(p1.x, p1.y, { steps: 12 });
await page.mouse.up();
await settle(page);
c = await canvasState();
check(
  'the pencil draws a continuous line of pixels',
  [2, 3, 4, 5, 6, 7, 8].every((x) => at(c, x, 2) === 1),
  JSON.stringify(c.pixels.slice(32, 48)),
);
check(
  'a whole stroke is one undo step',
  (await pastCount()) === before + 1,
  `${before} -> ${await pastCount()}`,
);
await page.keyboard.down('Control');
await page.keyboard.press('KeyZ');
await page.keyboard.up('Control');
await settle(page);
c = await canvasState();
check(
  'Ctrl+Z takes the whole stroke back',
  c.pixels.every((p) => p === 0),
);
await page.keyboard.down('Control');
await page.keyboard.press('KeyY');
await page.keyboard.up('Control');
await settle(page);
check('Ctrl+Y brings it back', at(await canvasState(), 5, 2) === 1);

// colour 2, rectangle, fill
await page.click('[data-swatch="2"]');
await page.keyboard.press('KeyR');
p0 = await cellCenter(10, 8);
p1 = await cellCenter(14, 12);
await page.mouse.move(p0.x, p0.y);
await page.mouse.down();
await page.mouse.move(p1.x, p1.y, { steps: 6 });
await page.mouse.up();
await settle(page);
c = await canvasState();
check(
  'the rectangle tool draws an outline',
  at(c, 10, 8) === 2 && at(c, 14, 12) === 2 && at(c, 12, 10) === 0 && at(c, 10, 10) === 2,
);
await page.click('[data-swatch="3"]');
await page.keyboard.press('KeyF');
const inside = await cellCenter(12, 10);
await page.mouse.click(inside.x, inside.y);
await settle(page);
c = await canvasState();
check(
  'flood fill fills the enclosed area only',
  at(c, 12, 10) === 3 && at(c, 11, 9) === 3 && at(c, 0, 0) === 0 && at(c, 10, 8) === 2,
);
await page.keyboard.press('KeyL');
await page.click('[data-swatch="4"]');
p0 = await cellCenter(0, 15);
p1 = await cellCenter(7, 15);
await page.mouse.move(p0.x, p0.y);
await page.mouse.down();
await page.mouse.move(p1.x, p1.y, { steps: 5 });
await page.mouse.up();
await settle(page);
const lineState = await canvasState();
check(
  'the line tool draws a straight line',
  [0, 3, 7].every((x) => at(lineState, x, 15) === 4),
);

// eyedropper and eraser
await page.keyboard.press('KeyI');
const onTwo = await cellCenter(10, 8);
await page.mouse.click(onTwo.x, onTwo.y);
check(
  'the colour picker takes the colour under it',
  (await page.evaluate(
    async () => (await import('/src/pixelart/state.ts')).usePixelUi.getState().color,
  )) === 2,
);
await page.keyboard.press('KeyE');
const eraseAt = await cellCenter(5, 2);
await page.mouse.click(eraseAt.x, eraseAt.y);
await settle(page);
check('the eraser makes a pixel transparent', at(await canvasState(), 5, 2) === 0);

// mirror
await page.keyboard.press('KeyP');
await page.click('[data-swatch="5"]');
await page.keyboard.press('KeyM');
const mir = await cellCenter(1, 5);
await page.mouse.click(mir.x, mir.y);
await settle(page);
c = await canvasState();
check('mirror draw also paints the opposite pixel', at(c, 1, 5) === 5 && at(c, 14, 5) === 5);
await page.keyboard.press('KeyM');

// grid toggle and zoom
const gridOn = await page.$eval('.pixel__sheet', (e) => e.classList.contains('pixel__sheet--grid'));
await page.keyboard.press('KeyG');
const gridOff = await page.$eval('.pixel__sheet', (e) =>
  e.classList.contains('pixel__sheet--grid'),
);
check('the grid can be turned on and off', gridOn === true && gridOff === false);
await page.keyboard.press('KeyG');
const z0 = await page.$eval('[data-testid="pixel-canvas"]', (e) => e.getBoundingClientRect().width);
await page.click(A('pixel-zoom-in'));
const z1 = await page.$eval('[data-testid="pixel-canvas"]', (e) => e.getBoundingClientRect().width);
check('zoom in makes the canvas bigger', z1 > z0, `${z0} -> ${z1}`);
await shot('pixel-drawn');

// design shortcuts do not fire while the editor has focus
const nodesBefore = await page.evaluate(
  () => Object.keys(window.__aframe.store.getState().doc.nodes).length,
);
await page.keyboard.press('Delete');
await page.keyboard.press('KeyF');
check(
  'design shortcuts stay out of the editor',
  (await page.evaluate(() => Object.keys(window.__aframe.store.getState().doc.nodes).length)) ===
    nodesBefore && (await page.evaluate(() => window.__aframe.store.getState().tool)) === 'select',
);

// ---- the keyboard ----------------------------------------------------------------------------------------
await page.keyboard.press('KeyP');
await page.click('[data-swatch="6"]');
await page.focus('.pixel');
for (const k of ['ArrowLeft', 'ArrowDown']) await page.keyboard.press(k); // first arrow places the cursor at 0,0
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowRight');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await settle(page);
c = await canvasState();
check(
  'arrow keys move a cursor and Enter draws',
  (await page.$('[data-testid="pixel-cursor"]')) !== null &&
    c.pixels.filter((p) => p === 6).length === 1,
);

// ---- the palette ------------------------------------------------------------------------------------------
const paletteBefore = c.palette.length;
await page.click(A('pixel-add-colour'));
await settle(page);
c = await canvasState();
check('Add a colour appends to the palette', c.palette.length === paletteBefore + 1);
await page.click(F('pixel-colour-hex')); // focusing selects the text
await page.type(F('pixel-colour-hex'), '#ff00aa');
await page.keyboard.press('Enter');
await settle(page);
c = await canvasState();
check('a colour can be edited by hex', c.palette.at(-1) === '#FF00AA', c.palette.at(-1));
await page.click(A('pixel-remove-colour'));
await settle(page);
check('a colour can be removed', (await canvasState()).palette.length === paletteBefore);

// ---- export and files --------------------------------------------------------------------------------------
await page.evaluate(() => {
  window.__downloads = [];
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) {
      window.__downloads.push({ name: this.download, href: this.href });
      return;
    }
    return orig.call(this);
  };
});
await page.select(F('pixel-export-scale'), '4');
await page.click(A('pixel-export'));
await page.waitForFunction(() => window.__downloads.some((d) => d.name === 'pixel-art.png'));
const png = await page.evaluate(async () => {
  const d = window.__downloads.find((x) => x.name === 'pixel-art.png');
  const bytes = new Uint8Array(await (await fetch(d.href)).arrayBuffer());
  const view = new DataView(bytes.buffer);
  return { sig: [...bytes.slice(0, 8)], w: view.getUint32(16), h: view.getUint32(20) };
});
check(
  'PNG export is a real PNG at the chosen scale',
  png.sig.join(',') === '137,80,78,71,13,10,26,10' && png.w === 64 && png.h === 64,
  JSON.stringify(png),
);
await page.click(A('pixel-save'));
await page.waitForFunction(() => window.__downloads.some((d) => d.name === 'pixel-art.json'));
const json = await page.evaluate(async () => {
  const d = window.__downloads.find((x) => x.name === 'pixel-art.json');
  return JSON.parse(await (await fetch(d.href)).text());
});
const live = await canvasState();
check(
  'Save JSON writes { width, height, palette, pixels }',
  json.width === 16 &&
    json.height === 16 &&
    JSON.stringify(json.pixels) === JSON.stringify(live.pixels) &&
    Array.isArray(json.palette),
);

const dir = mkdtempSync(join(tmpdir(), 'aframe-pixel-'));
const file = join(dir, 'tiny.json');
writeFileSync(
  file,
  JSON.stringify({ width: 2, height: 2, palette: ['#00000000', '#112233'], pixels: [1, 0, 0, 1] }),
);
await page.click(A('pixel-new'));
await page.waitForSelector('[data-testid="pixel-start"]');
await (await page.$('[data-testid="pixel-open-input"]')).uploadFile(file);
await page.waitForFunction(() => window.__aframe.store.getState().doc.pixelArt?.width === 2);
c = await canvasState();
check(
  'a saved file opens',
  c.width === 2 && c.palette[1] === '#112233' && at(c, 0, 0) === 1 && at(c, 1, 1) === 1,
);
await page.keyboard.down('Control');
await page.keyboard.press('KeyZ');
await page.keyboard.up('Control');
await settle(page);
check('opening a file is undoable', (await canvasState()).width === 16);
const bad = join(dir, 'bad.json');
writeFileSync(
  bad,
  JSON.stringify({ width: 2, height: 2, palette: ['#000000'], pixels: [0, 0, 9, 0] }),
);
await page.click(A('pixel-new'));
await page.waitForSelector('[data-testid="pixel-start"]');
await (await page.$('[data-testid="pixel-open-input"]')).uploadFile(bad);
await page.waitForSelector('[data-testid="pixel-start-error"]');
check(
  'a bad file is refused with a reason and the canvas is kept',
  (await page.$eval('[data-testid="pixel-start-error"]', (e) => e.textContent)).includes(
    'pixels[2]',
  ) && (await canvasState()).width === 16,
);
await page.click('.pixel__start button.btn--small'); // Cancel
await page.waitForSelector('[data-testid="pixel-canvas"]');

// ---- the AI tools draw on the live canvas, as one undo step --------------------------------------------------
await page.evaluate(() => {
  const s = window.__aframe.store.getState();
  s.beginTransaction('AI: test turn');
});
const ran = await page.evaluate(async () => {
  const { runChatTool, createChatToolContext } = await import('/src/chat/tool-context.ts');
  const ctx = createChatToolContext();
  const out = [];
  out.push(await runChatTool(ctx, 'pixelart_get_canvas', {}, { sendScreenshots: false }));
  out.push(
    await runChatTool(
      ctx,
      'pixelart_replace_grid',
      { rows: ['.11.', '1221', '1221', '.11.'], palette: ['#ff0000', '#ffff00'] },
      { sendScreenshots: false },
    ),
  );
  out.push(
    await runChatTool(
      ctx,
      'pixelart_set_pixels',
      { pixels: [{ x: 0, y: 0, color: 2 }] },
      { sendScreenshots: false },
    ),
  );
  out.push(
    await runChatTool(
      ctx,
      'pixelart_set_pixels',
      { pixels: [{ x: 99, y: 0, color: 1 }] },
      { sendScreenshots: false },
    ),
  );
  return out.map((o) => ({ ok: o.ok, text: o.text.slice(0, 160) }));
});
const pastBeforeEnd = await pastCount();
await page.evaluate(() => window.__aframe.store.getState().endTransaction());
await settle(page);
check('the AI can read the canvas', ran[0].ok && ran[0].text.includes('"rows"'));
check('the AI draws the whole image in one call', ran[1].ok);
check(
  'a bad AI call fails with a message it can read, without changing the canvas',
  ran[3].ok === false && ran[3].text.includes('outside the 4 x 4 canvas'),
  ran[3].text,
);
c = await canvasState();
check(
  'the editor shows what the AI drew',
  c.width === 4 && at(c, 0, 0) === 2 && at(c, 1, 0) === 1 && at(c, 1, 1) === 2,
);
const sizeText = await page.$eval('[data-testid="pixel-size"]', (e) => e.textContent);
check('the live editor followed along (size shown)', sizeText.includes('4 × 4'), sizeText);
const px = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="pixel-canvas"]');
  const d = el.getContext('2d').getImageData(0, 0, 1, 1).data;
  return [...d];
});
check(
  'and its pixels are on the canvas element',
  px[0] === 255 && px[1] === 255 && px[2] === 0,
  JSON.stringify(px),
);
check(
  'everything the AI did in one turn is a single undo step',
  (await pastCount()) === pastBeforeEnd + 1,
);
await page.keyboard.down('Control');
await page.keyboard.press('KeyZ');
await page.keyboard.up('Control');
await settle(page);
check('one undo reverts the whole AI turn', (await canvasState()).width === 16);
await shot('pixel-after-ai');

// ---- the AI bar -----------------------------------------------------------------------------------------------
check(
  'the AI bar has the four quick actions and a prompt box',
  (await page.$$('.pixel__aiquick button')).length === 4 &&
    (await page.$(F('pixel-ai-text'))) !== null,
);
await page.click(A('pixel-ai-improve'));
await page.waitForFunction(
  () => document.querySelector('[data-testid="pixel-ai-status"]')?.textContent?.length > 0,
  { timeout: 8000 },
);
const status = await page.$eval('[data-testid="pixel-ai-status"]', (e) => e.textContent ?? '');
check(
  'without an AI configured it says what to do and leaves the canvas alone',
  /Settings|desktop app|model|key/i.test(status) && (await canvasState()).width === 16,
  status,
);

// ---- turning it off hides everything ---------------------------------------------------------------------------
await openSettings();
await page.click(F('beta-master'));
await closeSettings();
check(
  'master off: the editor and its button are gone',
  (await page.$('[data-testid="pixel-editor"]')) === null &&
    (await page.$('[data-testid="open-pixelart"]')) === null,
);
check(
  'master off: no pixel art tools for the assistant',
  await page.evaluate(async () => {
    const m = await import('/src/chat/tool-context.ts');
    return m.chatToolDefs().every((d) => !d.name.startsWith('pixelart_'));
  }),
);
check(
  'master off: the tools refuse to run',
  await page.evaluate(async () => {
    const { runChatTool, createChatToolContext } = await import('/src/chat/tool-context.ts');
    const out = await runChatTool(
      createChatToolContext(),
      'pixelart_get_canvas',
      {},
      { sendScreenshots: false },
    );
    return out.ok === false && out.text.includes('switched off');
  }),
);
check('no console errors', t.errors.length === 0, t.errors.slice(0, 3).join(' | '));
await t.close();
console.log(
  r.failures === 0 ? '\nPixel art checks passed.' : `\n${r.failures} pixel art check(s) failed.`,
);
process.exit(r.failures === 0 ? 0 : 1);
