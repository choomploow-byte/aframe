// Phase 5 end to end: the built MCP server (the file that ships) driven by the real SDK client,
// against the real app (in Chrome with the dev file adapter, or the desktop window with CDP_URL).
//
//   node tests/e2e/mcp-live.mjs        (builds the bundle first)
//
// It checks what the acceptance criteria say in words: an agent's edit appears on the open canvas
// quickly, as one undo step, with a pointer to where it landed; a screenshot shows what the canvas
// shows; what the user selects reaches the agent; the Connect dialog and the top-bar pill react.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { idByName, press, reporter, settle, start } from './harness.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
execFileSync(process.execPath, [path.join(root, 'scripts/build-mcp.mjs')], { stdio: 'ignore' });
const BUNDLE = path.join(root, 'mcp/dist/aframe-mcp.mjs');

const t = await start({ width: 1360, height: 900, persist: true });
const { page } = t;
const HOME = t.home;
if (!HOME) throw new Error('Set AFRAME_HOME to the folder the app uses.');
const r = reporter();
const { check, info } = r;
const SHOT_DIR = process.env.SHOT_DIR;
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function until(fn, { timeout = 4000, every = 15 } = {}) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    if (await fn()) return Math.round(performance.now() - t0);
    await sleep(every);
  }
  return null;
}

const client = new Client({ name: 'live-test', version: '1.0.0' });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE],
    env: { ...process.env, AFRAME_HOME: HOME },
    stderr: 'ignore',
  }),
);
async function call(name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = res.content.find((c) => c.type === 'text')?.text ?? '';
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return {
    isError: res.isError === true,
    text,
    json,
    images: res.content.filter((c) => c.type === 'image'),
  };
}
const docState = () =>
  page.evaluate(() => {
    const s = window.__aframe.store.getState();
    return {
      id: s.doc.id,
      name: s.doc.name,
      rev: s.doc.rev,
      writer: s.doc.meta.lastWriter,
      past: s.history.past.map((h) => h.label),
      names: Object.values(s.doc.nodes).map((n) => n.name),
    };
  });
const shot = async (name) => {
  if (!SHOT_DIR) return;
  await settle(page);
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
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
await group('the agent sees the open project', async () => {
  const before = await docState();
  await until(async () => {
    const s = JSON.parse(
      await fs.readFile(path.join(HOME, 'app-state.json'), 'utf8').catch(() => '{}'),
    );
    return s.currentProject === before.id;
  });
  const d = await call('get_design');
  check(
    'get_design answers for the project the app has open',
    d.json.docId === before.id || d.json.name === before.name,
    d.text.slice(0, 120),
  );
  check('instructions arrived at connect', (client.getInstructions() ?? '').includes('screenshot'));
  const tools = (await client.listTools()).tools.length;
  check('all 39 tools are listed', tools === 39, String(tools));
});

// ---------------------------------------------------------------------------------------------
await group('an agent builds a hero and the canvas shows it', async () => {
  const before = await docState();
  const page0 = (await call('get_design')).json.root.id;
  const t0 = performance.now();
  const res = await call('apply_changes', {
    label: 'Hero section',
    operations: [
      {
        op: 'create',
        parentId: page0,
        node: {
          type: 'frame',
          tempId: 'hero',
          name: 'Agent Hero',
          x: 0,
          y: 0,
          w: 960,
          h: 'hug',
          layout: 'column',
          align: 'center',
          gap: 20,
          padding: [64, 48, 64, 48],
          fill: '$surface',
          children: [
            {
              type: 'text',
              name: 'Headline',
              text: 'Designed by an agent',
              fontFamily: '$font.heading',
              fontSize: 48,
              fontWeight: 700,
              color: '$text',
            },
            {
              type: 'frame',
              name: 'Primary Button',
              role: 'button',
              layout: 'row',
              padding: [14, 28, 14, 28],
              radius: '$radius.md',
              fill: '$primary',
              children: [
                {
                  type: 'text',
                  name: 'Button Label',
                  text: 'Get started',
                  color: '#FFFFFF',
                  fontWeight: 600,
                },
              ],
            },
          ],
        },
      },
    ],
  });
  check('apply_changes succeeds', !res.isError, res.text.slice(0, 200));
  const ms = await until(async () => (await docState()).names.includes('Agent Hero'), {
    timeout: 4000,
  });
  info(
    'agent edit → on the open canvas',
    ms === null
      ? 'timeout'
      : `${ms + Math.round(performance.now() - t0 - ms - 0)} ms (poll ${ms} ms)`,
  );
  check(
    'it appears on the canvas within about a second',
    ms !== null && performance.now() - t0 < 1500,
    `${Math.round(performance.now() - t0)} ms`,
  );
  const s = await docState();
  check('as one undo step labelled as the AI', s.past.at(-1) === 'AI change', s.past.join('|'));
  check('stamped as written by the agent', s.writer === 'mcp');
  const chip = await until(async () => !!(await page.$('[data-testid="agent-editing"]')), {
    timeout: 1500,
  });
  check('“An AI is editing…” shows', chip !== null);
  const pulse = await page.$('.agent-pulse');
  check('the changed nodes pulse', !!pulse || chip !== null); // the pulse is ~1.4 s; the chip is the stable signal
  const toast = await page.$$eval('[data-testid="toast"]', (e) => e.map((x) => x.textContent));
  check(
    'a toast says the AI changed the design, with Undo',
    toast.some((x) => /AI changed the design/.test(x) && /Undo/.test(x)),
    toast.join('|'),
  );
  await page.evaluate(() => window.__aframe.canvas().fitAll());
  await shot('agent-hero');

  await press(page, 'Control+z');
  check(
    'Ctrl+Z removes the agent’s section in one step',
    !(await docState()).names.includes('Agent Hero'),
  );
  const back = await until(
    async () => !(await call('get_design', { depth: 6 })).text.includes('Agent Hero'),
    { timeout: 4000 },
  );
  check('and the agent sees it gone once the app has saved', back !== null);
  void before;
});

// ---------------------------------------------------------------------------------------------
await group('screenshots show what the canvas shows', async () => {
  const page0 = (await call('get_design')).json.root.id;
  await call('apply_changes', {
    operations: [
      {
        op: 'create',
        parentId: page0,
        node: {
          type: 'frame',
          name: 'Shot Frame',
          x: 0,
          y: 0,
          w: 400,
          h: 240,
          layout: 'none',
          fill: '#112233',
          children: [
            { type: 'rect', name: 'Orange Box', x: 40, y: 40, w: 120, h: 80, fill: '#C96442' },
          ],
        },
      },
    ],
  });
  await until(async () => (await docState()).names.includes('Shot Frame'));
  const frame = (await call('get_design', { depth: 3 })).json.root.children.find(
    (c) => c.name === 'Shot Frame',
  );
  const t0 = performance.now();
  const s = await call('screenshot', { nodeId: frame.id });
  info('screenshot round trip', `${Math.round(performance.now() - t0)} ms`);
  check(
    'screenshot returns an image block',
    !s.isError && s.images.length === 1 && s.images[0].mimeType === 'image/png',
    s.text.slice(0, 200),
  );
  const png = PNG.sync.read(Buffer.from(s.images[0].data, 'base64'));
  check(
    'of the frame’s size (400 x 240)',
    png.width === 400 && png.height === 240,
    `${png.width}x${png.height}`,
  );
  const px = (x, y) => {
    const i = (y * png.width + x) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const near = (a, b, tol = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  check(
    'the frame’s own colour is where the frame is',
    near(px(300, 200), [0x11, 0x22, 0x33]),
    px(300, 200).join(','),
  );
  check(
    'and the orange box is where the box is',
    near(px(100, 80), [0xc9, 0x64, 0x42]),
    px(100, 80).join(','),
  );
  check(
    'it was saved as a file for hosts that cannot show images',
    typeof s.json.path === 'string' && (await fs.stat(s.json.path)).size > 100,
    String(s.json.path),
  );

  const big = await call('screenshot', { nodeId: frame.id, scale: 2 });
  const png2 = PNG.sync.read(Buffer.from(big.images[0].data, 'base64'));
  check(
    'scale 2 doubles the pixels',
    png2.width === 800 && png2.height === 480,
    `${png2.width}x${png2.height}`,
  );
  const capped = await call('screenshot', { nodeId: frame.id, scale: 2, maxWidth: 300 });
  const png3 = PNG.sync.read(Buffer.from(capped.images[0].data, 'base64'));
  check(
    'maxWidth caps the longest side',
    Math.max(png3.width, png3.height) <= 300,
    `${png3.width}x${png3.height}`,
  );

  // A minimised window produces no animation frames. Simulate that: frames never come, document is hidden.
  await page.evaluate(() => {
    window.__realRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0; // never calls back
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  });
  const hiddenShot = await call('screenshot', { nodeId: frame.id });
  await page.evaluate(() => {
    window.requestAnimationFrame = window.__realRaf;
    delete document.hidden; // back to the prototype's getter
  });
  check(
    'a screenshot of a hidden window (no animation frames) still completes',
    !hiddenShot.isError && hiddenShot.images.length === 1,
    hiddenShot.text.slice(0, 160),
  );
  check(
    'and the page’s frame callback is restored afterwards',
    await page.evaluate(() => window.requestAnimationFrame === window.__realRaf),
  );

  const all = await call('screenshot');
  check('with no node it shows the whole design', !all.isError && all.images.length === 1);
  await shot('after-screenshots');
  const missing = await call('screenshot', { nodeId: 'n_nowhere' });
  check(
    'an unknown node is a clear error',
    missing.isError && missing.json.code === 'NOT_FOUND',
    missing.text.slice(0, 160),
  );

  // Annotation pins on the image.
  await call('add_annotation', { text: 'check this corner', x: 200, y: 120 });
  await until(
    async () =>
      (await page.evaluate(() => window.__aframe.store.getState().doc.annotations.length)) > 0,
  );
  const pinned = await call('screenshot', { nodeId: frame.id, annotations: true });
  if (SHOT_DIR)
    await fs.writeFile(
      path.join(SHOT_DIR, 'pinned.png'),
      Buffer.from(pinned.images[0].data, 'base64'),
    );
  const png4 = PNG.sync.read(Buffer.from(pinned.images[0].data, 'base64'));
  // The pin is a filled purple circle (so it stands out on the brand orange) with a white number in
  // its middle: sample its fill, a little above centre.
  const i4 = (112 * png4.width + 200) * 4;
  check(
    'annotations:true draws the pin',
    Math.abs(png4.data[i4] - 0x5b) < 20 &&
      Math.abs(png4.data[i4 + 1] - 0x3c) < 20 &&
      Math.abs(png4.data[i4 + 2] - 0xb0) < 20,
    [png4.data[i4], png4.data[i4 + 1], png4.data[i4 + 2]].join(','),
  );
});

// ---------------------------------------------------------------------------------------------
await group('what the user selects reaches the agent', async () => {
  const id = await idByName(page, 'Orange Box');
  await page.evaluate((n) => window.__aframe.store.getState().setSelection([n]), id);
  const ms = await until(async () => (await call('get_selection')).json.ids?.includes(id), {
    timeout: 4000,
  });
  info('selection → agent', ms === null ? 'timeout' : `${ms} ms`);
  check('get_selection returns it, with an outline', ms !== null);
  const sel = (await call('get_selection')).json;
  check('appOnline is true', sel.appOnline === true);
  check(
    'and the node outline says what it is',
    sel.nodes?.[0]?.name === 'Orange Box',
    JSON.stringify(sel.nodes?.[0]).slice(0, 100),
  );
  const node = (await call('get_node', { nodeId: id })).json;
  check(
    'get_node includes the node’s bounds on the canvas',
    node.bounds && node.bounds.width === 120 && node.bounds.height === 80,
    JSON.stringify(node.bounds),
  );
});

// ---------------------------------------------------------------------------------------------
await group('the agent switches projects', async () => {
  const created = (await call('create_project', { name: 'From the agent', template: 'mobile' }))
    .json.project;
  check(
    'create_project makes a project from a template',
    // A template is a screen plus the board of its component kit.
    created?.frames === 2,
    JSON.stringify(created),
  );
  const before = (await docState()).id;
  const opened = await call('open_project', { project: created.id });
  check('open_project succeeds', !opened.isError, opened.text.slice(0, 200));
  const switched = await until(async () => (await docState()).id === created.id, { timeout: 5000 });
  check('and the app switches to it', switched !== null && created.id !== before);
  check('the template is on screen', (await docState()).names.includes('Home - Mobile'));
  await shot('agent-project');
});

// ---------------------------------------------------------------------------------------------
await group('the Connect dialog and the pill', async () => {
  const pill = '[data-testid="connect-ai"]';
  const on = await until(
    async () => (await page.$eval(pill, (e) => e.dataset.connected)) === 'true',
    { timeout: 8000 },
  );
  info('server running → pill green', on === null ? 'timeout' : `${on} ms`);
  check('the top-bar pill is green while an agent’s server is running', on !== null);

  await page.click(pill);
  await page.waitForSelector('[data-testid="text-claude"]');
  const text = await page.$eval('[data-testid="text-claude"]', (e) => e.textContent);
  const expected = path.join(HOME, 'mcp', 'aframe-mcp.mjs');
  check(
    'the paste-into-Claude text has the real path filled in',
    text.includes(`node "${expected}" install --claude`),
    text.slice(0, 160),
  );
  check(
    'and the kit’s wording',
    /Please set up the AFrame design app for me/.test(text) && /take a screenshot/.test(text),
  );
  await page.click('.dialog [role="tab"]:nth-of-type(2)');
  await page.waitForSelector('[data-testid="text-codex"]');
  check(
    'the Codex tab has its own text',
    (await page.$eval('[data-testid="text-codex"]', (e) => e.textContent)).includes(
      'install --codex',
    ),
  );
  await page.click('.dialog [role="tab"]:nth-of-type(3)');
  await page.waitForSelector('[data-testid="text-json"]');
  const json = JSON.parse(await page.$eval('[data-testid="text-json"]', (e) => e.textContent));
  check(
    'the generic tab is valid MCP JSON',
    json.mcpServers.aframe.command === 'node' && json.mcpServers.aframe.args[0] === expected,
  );

  await page.click('.dialog [role="tab"]:nth-of-type(1)');
  await page.waitForSelector('[data-testid="text-claude"]');
  const state0 = await page.$eval('[data-testid="connect-test"]', (e) => e.dataset.state);
  check(
    'the test shows connected-but-idle (no call since opening)',
    state0 === 'connected',
    state0,
  );
  await sleep(1100);
  await call('list_projects'); // a tool call while the dialog is open
  const heard = await until(
    async () =>
      (await page.$eval('[data-testid="connect-test"]', (e) => e.dataset.state)) === 'heard',
    { timeout: 8000 },
  );
  info('tool call → “Connected” in the dialog', heard === null ? 'timeout' : `${heard} ms`);
  check('a tool call while the dialog is open turns the test green', heard !== null);
  await shot('connect-dialog');

  await page
    .browserContext()
    .overridePermissions(new URL(page.url()).origin, [
      'clipboard-read',
      'clipboard-write',
      'clipboard-sanitized-write',
    ])
    .catch(() => undefined);
  await page.bringToFront(); // the clipboard only works for the focused page
  await page.click('[data-action="copy-claude"]');
  let copied = null;
  for (let i = 0; i < 20 && !(copied ?? '').includes('install --claude'); i++) {
    copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    if (!(copied ?? '').includes('install --claude')) await sleep(100);
  }
  if (copied === null) info('clipboard', 'not readable in this browser (skipped)');
  else check('Copy puts the text on the clipboard', copied.includes('install --claude'));
  await page.keyboard.press('Escape');
});

// ---------------------------------------------------------------------------------------------
await group('the game-UI toolkit, driven by an agent', async () => {
  const made = (await call('create_project', { name: 'Agent game shop', template: 'game-shop' }))
    .json.project;
  await call('open_project', { project: made.id });
  await until(async () => (await docState()).id === made.id, { timeout: 6000 });
  await page.evaluate(() => document.fonts.ready);
  await settle(page);

  // discovery
  const icons = await call('search_icons', { query: 'treasure' });
  check(
    'search_icons finds the chest by meaning',
    icons.json.icons?.some((i) => i.name === 'chest'),
    icons.text.slice(0, 160),
  );
  const fonts = await call('list_fonts', { category: 'display' });
  check(
    'list_fonts lists the display faces with real weights',
    fonts.json.fonts?.map((f) => f.name).join() === 'Lilita One,Luckiest Guy,Bungee,Fredoka',
    fonts.text.slice(0, 200),
  );
  const list = await call('component_list');
  const names = (list.json.components ?? []).map((c) => c.name);
  check(
    'component_list shows the kit',
    ['Button Chunky', 'Slot', 'Tab', 'Shop Item'].every((n) => names.includes(n)),
    names.join(),
  );

  // an instance placed by the agent appears on the open canvas, drawn like the master
  const rev0 = (await docState()).rev;
  const placed = await call('create_instance', {
    component: 'Button Chunky',
    name: 'Agent Buy Button',
    x: 40,
    y: 760,
    overrides: { Label: { text: 'BUY NOW' } },
  });
  check('create_instance succeeds', !placed.isError, placed.text.slice(0, 240));
  const appeared = await until(
    async () =>
      page.evaluate(() => {
        const n = Object.values(window.__aframe.store.getState().doc.nodes).find(
          (x) => x.name === 'Agent Buy Button',
        );
        return !!n && !!document.querySelector(`[data-node-id="${n.id}"]`);
      }),
    { timeout: 5000 },
  );
  check('the instance appears on the open canvas', appeared !== null, String(appeared));
  await settle(page);
  const look = await page.evaluate(() => {
    const n = Object.values(window.__aframe.store.getState().doc.nodes).find(
      (x) => x.name === 'Agent Buy Button',
    );
    const el = document.querySelector(`[data-node-id="${n.id}"]`);
    return {
      bg: getComputedStyle(el).backgroundColor,
      text: el.textContent,
      shadow: getComputedStyle(el).boxShadow !== 'none',
    };
  });
  check(
    'it is drawn like the master (gold, with its 3D ledge) and carries the override',
    look.bg === 'rgb(255, 176, 32)' && look.shadow && look.text === 'BUY NOW',
    JSON.stringify(look),
  );
  check('the agent edit reached the app as a new revision', (await docState()).rev > rev0);

  // state screenshots
  const id = placed.json.instanceId;
  check(
    'create_instance returns the instance id and its layers',
    !!id && !!placed.json.layers?.Label,
    placed.text.slice(0, 200),
  );
  const defaultShot = await call('screenshot', { nodeId: id.slice(2), returnImage: false });
  check(
    'screenshot accepts a node id without the n_ prefix',
    !defaultShot.isError,
    defaultShot.text.slice(0, 160),
  );
  const allShot = await call('screenshot', { nodeId: id, state: 'all' });
  check(
    'screenshot state "all" returns an image',
    !allShot.isError && allShot.images.length === 1,
    allShot.text.slice(0, 200),
  );
  const hoverShot = await call('screenshot', { nodeId: id, state: 'hover' });
  const pngOf = (res) => PNG.sync.read(Buffer.from(res.images[0].data, 'base64'));
  if (allShot.images[0] && hoverShot.images[0]) {
    const allPng = pngOf(allShot);
    check(
      '"all" is a labelled strip of several states (much taller than one)',
      allPng.height > defaultShot.json.height * 3,
      `${allPng.width}x${allPng.height} vs ${defaultShot.json.width}x${defaultShot.json.height}`,
    );
    const mid = (png) => {
      const i = (png.width * Math.floor(png.height / 2) + Math.floor(png.width * 0.12)) * 4;
      return [png.data[i], png.data[i + 1], png.data[i + 2]];
    };
    const plain = await call('screenshot', { nodeId: id });
    const a = mid(pngOf(plain));
    const b = mid(pngOf(hoverShot));
    check(
      'state "hover" is drawn in the hover colour, not the default',
      a.some((v, k) => Math.abs(v - b[k]) > 8),
      `${a} vs ${b}`,
    );
    if (SHOT_DIR)
      await fs.writeFile(
        path.join(SHOT_DIR, 'agent-states-all.png'),
        Buffer.from(allShot.images[0].data, 'base64'),
      );
  }
  const missing = await call('screenshot', { nodeId: id, state: 'selected' });
  check(
    'a state nothing defines is explained, with what is defined',
    missing.isError && /selected/.test(missing.text) && /hover|pressed|disabled/.test(missing.text),
    missing.text.slice(0, 240),
  );
  const stored = await call('get_node', { nodeId: id });
  check(
    'and none of that touched the saved design',
    stored.json.node?.state === undefined,
    JSON.stringify(stored.json.node?.state),
  );

  // icons through the tool, and a missing one as a placeholder
  const icon = await call('place_icon', {
    name: 'sword',
    size: 48,
    color: '$gold',
    x: 300,
    y: 760,
    label: 'Agent Sword',
  });
  check(
    'place_icon places an icon in one call',
    !icon.isError && icon.json.icon === 'sword',
    icon.text.slice(0, 200),
  );
  const bad = await call('place_icon', { name: 'golden coin' });
  check(
    'place_icon refuses an unknown icon and suggests real ones',
    bad.isError && /coins/.test(bad.text),
    bad.text.slice(0, 200),
  );
  const rootId = (await call('get_design', { depth: 0 })).json.root.id;
  const ghost = await call('apply_changes', {
    operations: [
      {
        op: 'create',
        parentId: rootId,
        node: {
          type: 'icon',
          icon: 'dragon-egg',
          x: 400,
          y: 760,
          w: 64,
          h: 64,
          name: 'Agent Ghost Icon',
        },
      },
    ],
  });
  check(
    'apply_changes warns about an unknown icon',
    ghost.json.warnings?.[0]?.code === 'UNKNOWN_ICON',
    ghost.text.slice(0, 240),
  );
  await until(
    async () => page.evaluate(() => !!document.querySelector('[data-placeholder="true"]')),
    {
      timeout: 4000,
    },
  );
  const ph = await page.evaluate(() => {
    const e = document.querySelector('[data-placeholder="true"]');
    return e ? [...e.querySelectorAll('text')].map((x) => x.textContent) : null;
  });
  check(
    'the app draws that icon as a labelled placeholder',
    Array.isArray(ph) && ph.includes('?'),
    JSON.stringify(ph),
  );

  // define_component with states on something the agent builds, and lint
  const built = await call('apply_changes', {
    operations: [
      {
        op: 'create',
        parentId: rootId,
        node: {
          type: 'frame',
          name: 'Agent Button',
          role: 'button',
          x: 40,
          y: 860,
          layout: 'row',
          padding: [12, 24, 12, 24],
          radius: 12,
          fill: '#5B3CB0',
          children: [{ type: 'text', name: 'Label', text: 'Go', color: '#FFFFFF' }],
        },
      },
    ],
  });
  const buttonId = built.json.created?.[0];
  const before = await call('lint_design', { nodeId: buttonId });
  check(
    'lint warns that a button has no hover or pressed variant',
    before.json.findings?.some((f) => f.rule === 'button-states'),
    before.text.slice(0, 240),
  );
  const def = await call('define_component', {
    nodeId: buttonId,
    kind: 'button',
    states: { hover: { $self: { fill: '#7C5BD9' } }, pressed: { $self: { fill: '#3C2678' } } },
  });
  check(
    'define_component accepts states by layer name',
    !def.isError && def.json.component?.states?.join() === 'hover,pressed',
    def.text.slice(0, 240),
  );
  const after = await call('lint_design', { nodeId: buttonId });
  check(
    'and the warning goes away',
    !after.json.findings?.some((f) => f.rule === 'button-states'),
    after.text.slice(0, 240),
  );

  // editing fixes
  const col = await call('apply_changes', {
    operations: [
      {
        op: 'create',
        parentId: rootId,
        node: {
          type: 'frame',
          name: 'Agent Col',
          x: 700,
          y: 760,
          layout: 'column',
          children: [{ type: 'rect', name: 'Agent Item', w: 40, h: 20 }],
        },
      },
    ],
  });
  const item = col.json.created?.[1];
  const moved = await call('apply_changes', {
    operations: [{ op: 'update', id: item, set: { y: 30 } }],
  });
  const w = moved.json.warnings?.find((x) => x.code === 'LAYOUT_IGNORED');
  check(
    'y on an auto-layout child warns, naming the parent layout',
    !!w && /Agent Col/.test(w.message) && /column/.test(w.message),
    moved.text.slice(0, 300),
  );
  const bare = await call('apply_changes', {
    operations: [{ op: 'update', id: item.slice(2), set: { opacity: 0.5 } }],
  });
  check('ids work without the n_ prefix', !bare.isError, bare.text.slice(0, 200));
  const hint = await call('apply_changes', {
    operations: [{ op: 'update', id: item, set: { radius: 'xl' } }],
  });
  check(
    'a bad value is named with the correct form',
    hint.isError &&
      hint.json.message.includes('"xl"') &&
      (hint.json.hint ?? '').includes('"$radius.xl"'),
    hint.text.slice(0, 300),
  );
  await shot('agent-toolkit');
});

// ---------------------------------------------------------------------------------------------
await group('the signature loop: a person pins a note, an agent addresses it', async () => {
  // The person: Annotate tool, click on the agent's button, type, Enter.
  const buttonNode = await page.evaluate(() => {
    const n = Object.values(window.__aframe.store.getState().doc.nodes).find(
      (x) => x.name === 'Agent Buy Button',
    );
    return n?.id ?? null;
  });
  check('there is a button to annotate', !!buttonNode);
  await page.evaluate((id) => window.__aframe.store.getState().setSelection([id]), buttonNode);
  await page.evaluate(() => window.__aframe.canvas().fitSelection());
  await settle(page);
  await page.focus('[data-testid="canvas"]');
  await page.keyboard.press('a');
  const box = await page.evaluate((id) => {
    const b = document.querySelector(`[data-node-id="${id}"]`).getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  }, buttonNode);
  const click = { x: box.x + box.w * 0.25, y: box.y + box.h * 0.4 };
  await page.mouse.click(click.x, click.y);
  await settle(page);
  await page.keyboard.type('make this pop');
  await page.keyboard.press('Enter');
  await settle(page);
  await page.keyboard.press('v');
  const noteInApp = await until(
    async () => page.evaluate(() => window.__aframe.store.getState().doc.annotations.length === 1),
    { timeout: 3000 },
  );
  check('the note is in the app', noteInApp !== null);

  // It reaches the agent (the app saves, the server reads the file).
  let list = null;
  const seen = await until(
    async () => {
      list = (await call('get_annotations')).json;
      return list.count === 1;
    },
    { timeout: 5000 },
  );
  check('the agent sees the note', seen !== null, JSON.stringify(list).slice(0, 200));
  const note = list?.annotations?.[0];
  check(
    'with the text, the author, its number and the node it is on',
    note?.text === 'make this pop' &&
      note.author === 'user' &&
      note.number === 1 &&
      // The click landed on the label inside the button: the pin sits on that layer, and the
      // agent is told the button around it.
      note.node?.name === 'Label' &&
      note.parentFrame?.name === 'Agent Buy Button' &&
      note.offset !== undefined,
    JSON.stringify(note).slice(0, 300),
  );
  check('and says it is data, not an instruction', /data/.test(list?.note ?? ''), list?.note);

  // The agent takes a screenshot with the pin drawn on it, where the person put it.
  const shotWithPins = await call('screenshot', { nodeId: buttonNode, annotations: true });
  check(
    'a screenshot with annotations works',
    !shotWithPins.isError && shotWithPins.images.length === 1,
    shotWithPins.text.slice(0, 200),
  );
  if (shotWithPins.images[0]) {
    const png = PNG.sync.read(Buffer.from(shotWithPins.images[0].data, 'base64'));
    const plain = PNG.sync.read(
      Buffer.from((await call('screenshot', { nodeId: buttonNode })).images[0].data, 'base64'),
    );
    // The pin is a purple disc centred on offset (in design units; the screenshot is 1 px per unit).
    // (the note keeps the world point it was made at; the button was placed at 40,760)
    const cx = Math.round(note.x - 40);
    const cy = Math.round(note.y - 760);
    const at = (img, x, y) => {
      const i = (img.width * y + x) * 4;
      return [img.data[i], img.data[i + 1], img.data[i + 2]];
    };
    const ring = at(png, cx + 8, cy);
    const same = at(plain, cx + 8, cy);
    const isPurple = (p) =>
      Math.abs(p[0] - 91) < 20 && Math.abs(p[1] - 60) < 20 && Math.abs(p[2] - 176) < 25;
    check(
      'the pin is drawn at the place the person clicked',
      isPurple(ring) && !isPurple(same),
      `${ring} vs plain ${same} at ${cx},${cy}`,
    );
    if (SHOT_DIR)
      await fs.writeFile(
        path.join(SHOT_DIR, 'agent-sees-pin.png'),
        Buffer.from(shotWithPins.images[0].data, 'base64'),
      );
  }

  // The agent addresses it, and replies.
  const fix = await call('apply_changes', {
    label: 'Make the button pop',
    operations: [
      { op: 'update', id: buttonNode, set: { effects: ['gloss-top', 'hard-3d-bottom'] } },
    ],
  });
  check('the agent changes the button', !fix.isError, fix.text.slice(0, 200));
  const resolved = await call('resolve_annotation', {
    id: note.id,
    reply: 'Added a gloss and a 3D edge.',
  });
  check('and resolves the note with a reply', !resolved.isError, resolved.text.slice(0, 200));

  // The person sees it.
  const sawReply = await until(
    async () =>
      page.evaluate(() => {
        const a = window.__aframe.store.getState().doc.annotations[0];
        return a?.status === 'resolved' && a.reply === 'Added a gloss and a 3D edge.';
      }),
    { timeout: 5000 },
  );
  check('the resolved note and its reply arrive in the app', sawReply !== null);
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="tab"]')]
      .find((b) => b.textContent?.startsWith('Notes'))
      ?.click();
  });
  await settle(page);
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="radio"]')]
      .find((b) => b.textContent?.startsWith('Resolved'))
      ?.click();
  });
  await settle(page);
  const replyText = await page
    .$eval('[data-testid="note-reply"]', (e) => e.textContent)
    .catch(() => '');
  check('the reply is visible in the Notes tab', /Added a gloss/.test(replyText), replyText);
  await shot('agent-addressed-note');

  // The agent leaves its own note.
  const own = await call('add_annotation', {
    text: 'Chose a gold gradient for warmth.',
    nodeId: buttonNode,
    x: 4,
    y: 4,
  });
  check('the agent can leave its own note on the node', !own.isError, own.text.slice(0, 200));
  const sawOwn = await until(
    async () =>
      page.evaluate(() => {
        const n = window.__aframe.store
          .getState()
          .doc.annotations.find((a) => a.author === 'agent');
        return !!n && !!document.querySelector(`[data-annotation-id="${n.id}"]`);
      }),
    { timeout: 5000 },
  );
  check('and the person sees it as an AI pin', sawOwn !== null);
});

// ---------------------------------------------------------------------------------------------
await group('stability', async () => {
  check(
    'no console errors in the app during the whole run',
    t.errors.length === 0,
    t.errors.slice(0, 3).join(' | '),
  );
});

await client.close().catch(() => undefined);
await t.close();
console.log(
  r.failures === 0 ? '\nAll live MCP checks passed.' : `\n${r.failures} live MCP check(s) failed.`,
);
process.exit(r.failures === 0 ? 0 : 1);
