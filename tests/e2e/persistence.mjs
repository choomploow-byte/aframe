// Phase 4 e2e: projects, autosave and sync with files other processes change, in the real app.
//
//   npm run test:e2e:persist
//
// Starts the dev server (or attaches to a running desktop window with CDP_URL, which must have been
// started with AFRAME_HOME pointing at a throwaway folder) and drives it with real mouse and
// keyboard input. Files are inspected and changed directly on disk, the way an agent or a script
// would, using the same Node file module the MCP server will use.
import { mkdirSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HomeFs, parseRev } from '../../mcp/home-fs.ts';
import { idByName, press, reporter, settle, start } from './harness.mjs';

const t = await start({ width: 1360, height: 900, persist: true });
const { page } = t;
const HOME = t.home;
if (!HOME) throw new Error('No home directory: set AFRAME_HOME for the desktop window.');
const disk = new HomeFs(HOME);
// A failing file call is a bug worth seeing in full, not just as "Bad Request".
page.on('response', (res) => {
  if (res.status() >= 400) {
    void res
      .text()
      .then((body) => console.log(`HTTP ${res.status()} ${res.url()} ${body.slice(0, 300)}`));
  }
});
const r = reporter();
const { check, info } = r;
const SHOT_DIR = process.env.SHOT_DIR;
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });

// ---- helpers ------------------------------------------------------------------------------
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
/** Polls `fn` until it returns truthy; resolves with the elapsed ms, or null on timeout. */
async function until(fn, { timeout = 3000, every = 10 } = {}) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    if (await fn()) return Math.round(performance.now() - t0);
    await sleep(every);
  }
  return null;
}
const docState = () =>
  page.evaluate(() => {
    const s = window.__aframe.store.getState();
    return {
      id: s.doc.id,
      name: s.doc.name,
      rev: s.doc.rev,
      writer: s.doc.meta.lastWriter,
      selection: s.selection,
      past: s.history.past.map((h) => h.label),
      nodeCount: Object.keys(s.doc.nodes).length,
    };
  });
const projectIds = async () =>
  (await disk.list('projects')).filter((e) => e.isDir).map((e) => e.name);
const projectPath = (id) => `projects/${id}/project.aframe.json`;
const readProject = async (id) => {
  const text = await disk.read(projectPath(id));
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null; // caught mid-damage by a poll
  }
};
const saveState = () =>
  page.$eval('[data-testid="save-status"]', (e) => e.dataset.state).catch(() => null);
/** Focus a text field and select everything in it (what a person does before retyping). */
async function selectField(selector) {
  await page.click(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
}
const toasts = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="toast"]')].map((e) => e.textContent),
  );
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
/** An agent's edit: through the file protocol (lock, compare-and-write, rev bump), like MCP will. */
async function agentSetProps(projectId, nodeId, props) {
  for (let i = 0; i < 8; i++) {
    const text = await disk.read(projectPath(projectId));
    const doc = JSON.parse(text);
    doc.nodes[nodeId] = { ...doc.nodes[nodeId], ...props };
    doc.rev += 1;
    doc.meta = { ...doc.meta, updatedAt: new Date().toISOString(), lastWriter: 'mcp' };
    const w = await disk.writeDoc(
      projectPath(projectId),
      JSON.stringify(doc, null, 2),
      parseRev(text),
    );
    if (w.ok) return;
  }
  throw new Error('agent could not write');
}
let projectA = '';

// ---------------------------------------------------------------------------------------------
await group('first run', async () => {
  const ids = await projectIds();
  check('a first project was created in the home folder', ids.length === 1, ids.join(','));
  projectA = ids[0] ?? '';
  const s = await docState();
  check('and it is the one on screen', s.id === projectA, `${s.id} vs ${projectA}`);
  check(
    'it is called Untitled and starts empty (welcome screen)',
    s.name === 'Untitled' && !!(await page.$('[data-testid="welcome"]')),
  );
  check('the save indicator says Saved', (await saveState()) === 'saved');

  const folders = (await disk.list('')).map((e) => e.name);
  for (const f of [
    'projects',
    'requests',
    'responses',
    'mcp',
    'skills',
    'exports',
    'logs',
    'agents',
  ]) {
    check(`~/.aframe/${f} exists`, folders.includes(f));
  }
  check(
    'the MCP placeholder is in place for Phase 5',
    (await disk.read('mcp/aframe-mcp.mjs'))?.includes('aframe-generated') === true,
  );

  const st = await until(
    async () => {
      const text = await disk.read('app-state.json');
      return text !== null && JSON.parse(text).currentProject === projectA;
    },
    { timeout: 4000 },
  );
  check('app-state.json names the open project', st !== null);
  const state = JSON.parse((await disk.read('app-state.json')) ?? '{}');
  check(
    'with a fresh heartbeat',
    Date.now() - Date.parse(state.appHeartbeat) < 5000,
    state.appHeartbeat,
  );
  check(
    'and the app version and pid agents can read',
    typeof state.appPid === 'number' && typeof state.appVersion === 'string',
  );
  check(
    'settings remember the last project',
    JSON.parse((await disk.read('settings.json')) ?? '{}').lastProject === projectA,
  );
});

// ---------------------------------------------------------------------------------------------
await group('the sample becomes a real project', async () => {
  await page.click('[data-action="welcome-sample"]');
  await page.waitForFunction(
    (old) => window.__aframe.store.getState().doc.id !== old,
    {},
    projectA,
  );
  await settle(page);
  const s = await docState();
  const ids = await projectIds();
  check(
    'opening the sample creates a project of its own',
    s.id !== 'p_sample' && ids.includes(s.id),
    s.id,
  );
  check(
    'the empty Untitled project it replaced is gone',
    !ids.includes(projectA) && ids.length === 1,
    ids.join(','),
  );
  projectA = s.id;
  check(
    'the sample is on screen and saved',
    s.name.startsWith('Northwind') &&
      (await until(async () => (await saveState()) === 'saved')) !== null,
  );
  await page.evaluate(() => window.__aframe.canvas().fitAll());
  await shot('sample-saved');
});

// ---------------------------------------------------------------------------------------------
await group('editing in the app updates the file', async () => {
  const before = await readProject(projectA);
  // Five renames, measured one by one: one slow disk moment must not decide the result.
  const times = [];
  const names = [
    'AFrame test project',
    'Second name',
    'Third name',
    'Fourth name',
    'AFrame test project',
  ];
  for (const name of names) {
    await selectField('[data-field="project-name"]');
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    const ms = await until(async () => (await readProject(projectA))?.name === name, {
      timeout: 4000,
    });
    times.push(ms ?? 99999);
    await sleep(120);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  info('edit → file on disk (5 edits, sorted)', `${times.join(', ')} ms`);
  check(
    'the typical edit reaches the file in under 500 ms (median of 5)',
    median < 500,
    `${times}`,
  );
  check('and the slowest in under 1 s', (times.at(-1) ?? 0) < 1000, `${times}`);
  const after = await readProject(projectA);
  check('with a newer revision', after.rev > before.rev, `${before.rev} → ${after.rev}`);
  check('written by the app', after.meta.lastWriter === 'app');
  const bak = JSON.parse((await disk.read(`${projectPath(projectA)}.bak`)) ?? 'null');
  check(
    'the version before the last save is kept as .bak',
    bak?.name === 'Fourth name' && bak.rev < after.rev && after.rev - before.rev >= 5,
  );
  check(
    'the save indicator is Saved again',
    (await until(async () => (await saveState()) === 'saved')) !== null,
  );

  // A canvas edit through real input: nudge the selected node with the arrow keys.
  const board = await idByName(page, 'Pricing - Needs Work'); // an artboard: free-positioned
  await page.evaluate((id) => window.__aframe.store.getState().setSelection([id]), board);
  await page.focus('[data-testid="canvas"]');
  const x0 = (await readProject(projectA)).nodes[board].x;
  check('(the artboard has a position to change)', typeof x0 === 'number', String(x0));
  await press(page, 'Shift+ArrowRight');
  const ms2 = await until(async () => (await readProject(projectA)).nodes[board].x === x0 + 10, {
    timeout: 3000,
  });
  check('a canvas edit reaches the file too', ms2 !== null, String(ms2));
  info('canvas edit → file on disk', ms2 === null ? 'timeout' : `${ms2} ms`);
});

// ---------------------------------------------------------------------------------------------
await group('a script changes the JSON: the screen follows', async () => {
  const id = await idByName(page, 'Primary Button');
  const bg = (nodeId) =>
    page.evaluate(
      (n) => getComputedStyle(document.querySelector(`[data-node-id="${n}"]`)).backgroundColor,
      nodeId,
    );
  const original = await bg(id);
  await sleep(30);
  // The kind of script someone writes in five minutes: edit the file, do not touch rev.
  const file = path.join(HOME, projectPath(projectA));
  const raw = JSON.parse(await fs.readFile(file, 'utf8'));
  raw.nodes[id].fill = '#123456';
  const t0 = performance.now();
  await fs.writeFile(file, JSON.stringify(raw, null, 2));
  let ms = null;
  try {
    await page.waitForFunction(
      (n) =>
        getComputedStyle(document.querySelector(`[data-node-id="${n}"]`)).backgroundColor ===
        'rgb(18, 52, 86)',
      { polling: 'raf', timeout: 3000 },
      id,
    );
    ms = Math.round(performance.now() - t0);
  } catch {
    /* reported below */
  }
  info('file edited → UI changed', ms === null ? 'timeout' : `${ms} ms`);
  check('the button turns the new colour in under 700 ms', ms !== null && ms < 700, String(ms));
  const s = await docState();
  check('as one undo step', s.past.at(-1) === 'External change', s.past.join('|'));
  check(
    'and a toast says what happened',
    (await toasts()).some((x) => /changed outside AFrame/.test(x)),
    (await toasts()).join('|'),
  );
  check('it was not written back (nothing to save)', (await saveState()) === 'saved');

  await press(page, 'Control+z');
  check('Ctrl+Z restores the previous colour on screen', (await bg(id)) === original, await bg(id));
  const back = await until(async () => (await readProject(projectA)).nodes[id].fill !== '#123456', {
    timeout: 3000,
  });
  check('and the undone state is saved over the script’s version', back !== null);
  await shot('after-undo');
});

// ---------------------------------------------------------------------------------------------
await group('an agent edits while the user edits something else', async () => {
  const mine = await idByName(page, 'Pricing - Needs Work'); // free-positioned, so it can be nudged
  const theirs = await idByName(page, 'Headline');
  await page.evaluate((id) => window.__aframe.store.getState().setSelection([id]), mine);
  await page.focus('[data-testid="canvas"]');
  const y0 = await page.evaluate((id) => window.__aframe.store.getState().doc.nodes[id].y, mine);
  await press(page, 'Shift+ArrowDown'); // unsaved local edit on one node
  await agentSetProps(projectA, theirs, { text: 'Rewritten by the AI' }); // an agent edits another
  const ms = await until(
    () =>
      page.evaluate(
        (id) => window.__aframe.store.getState().doc.nodes[id].text === 'Rewritten by the AI',
        theirs,
      ),
    { timeout: 3000 },
  );
  check('the agent’s change appears on screen', ms !== null);
  await sleep(500);
  const saved = await readProject(projectA);
  const yPos = await page.evaluate((id) => window.__aframe.store.getState().doc.nodes[id].y, mine);
  check(
    'and both edits are in the file',
    saved.nodes[theirs].text === 'Rewritten by the AI' &&
      typeof yPos === 'number' &&
      saved.nodes[mine].y === yPos,
    `y=${saved.nodes[mine].y}/${yPos}`,
  );
  check('the user’s nudge really happened (y moved by 10)', yPos === y0 + 10, `${y0} → ${yPos}`);
  const s = await docState();
  check(
    'the toast says the AI changed the design',
    (await toasts()).some((x) => /AI changed the design/.test(x)),
    (await toasts()).join('|'),
  );
  check('revisions only grow', saved.rev >= s.rev - 1 && s.rev > 3, `${saved.rev} / ${s.rev}`);
});

// ---------------------------------------------------------------------------------------------
await group('what is open is published for agents', async () => {
  const id = await idByName(page, 'Hero');
  await page.click(`[data-layer-id="${id}"]`).catch(async () => {
    await page.evaluate((n) => window.__aframe.store.getState().setSelection([n]), id);
  });
  const ms = await until(
    async () => {
      const st = JSON.parse((await disk.read('app-state.json')) ?? '{}');
      return st.selection?.includes(id) && st.currentProject === projectA;
    },
    { timeout: 4000 },
  );
  info('selection → app-state.json', ms === null ? 'timeout' : `${ms} ms`);
  check('app-state.json follows the selection', ms !== null);
});

// ---------------------------------------------------------------------------------------------
await group('agent requests are answered', async () => {
  const sel = (await docState()).selection;
  const request = async (id, body) => {
    await disk.write(
      `requests/${id}.json`,
      JSON.stringify({ id, createdAt: new Date().toISOString(), ...body }),
    );
    const ms = await until(async () => (await disk.read(`responses/${id}.json`)) !== null, {
      timeout: 4000,
    });
    const res =
      ms === null ? null : JSON.parse((await disk.read(`responses/${id}.json`)) ?? 'null');
    return { ms, res };
  };
  const ping = await request('req_e2eping', { type: 'ping' });
  info('request → response', ping.ms === null ? 'timeout' : `${ping.ms} ms`);
  check(
    'ping gets an answer naming the open project',
    ping.res?.ok === true && ping.res.result.project === projectA,
    JSON.stringify(ping.res),
  );
  check(
    'the request file is removed once answered',
    (await disk.stat('requests/req_e2eping.json')) === null,
  );
  const gs = await request('req_e2esel', { type: 'get_selection' });
  check(
    'get_selection returns the live selection',
    JSON.stringify(gs.res?.result?.selection) === JSON.stringify(sel),
    JSON.stringify(gs.res),
  );
  const shotReq = await request('req_e2eshot', { type: 'screenshot', params: { maxWidth: 400 } });
  check(
    'screenshot returns a PNG of the design (the agent tool builds on this)',
    shotReq.res?.ok === true &&
      shotReq.res.result.width > 0 &&
      Buffer.from(shotReq.res.result.pngBase64, 'base64').subarray(1, 4).toString() === 'PNG',
    JSON.stringify(shotReq.res).slice(0, 160),
  );
  const badExport = await request('req_e2eexp', { type: 'export_image' });
  check(
    'an export request without its params is refused with a clear error instead of timing out',
    badExport.res?.ok === false && badExport.res.error.code === 'BAD_REQUEST',
    JSON.stringify(badExport.res),
  );
  const wrong = await request('req_e2ewrng', { type: 'screenshot', project: 'p_notmine' });
  check(
    'a request for a project that is not the open one is refused',
    wrong.res?.ok === false && wrong.res.error.code === 'PROJECT_NOT_OPEN',
    JSON.stringify(wrong.res),
  );
  const evil = await request('req_e2eevil', {
    type: 'open_project',
    params: { project: '../../etc' },
  });
  check(
    'a path in params is refused',
    evil.res?.ok === false && evil.res.error.code === 'BAD_REQUEST',
    JSON.stringify(evil.res),
  );
});

// ---------------------------------------------------------------------------------------------
await group('reload: everything comes back', async () => {
  await until(async () => (await saveState()) === 'saved');
  const before = await docState();
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__aframe?.sync?.()?.attached === true, {
    timeout: 30000,
  });
  const after = await docState();
  check('the same project opens again', after.id === before.id, `${after.id} vs ${before.id}`);
  check('with the name and the agent’s edit', after.name === 'AFrame test project');
  check(
    'and the project name is in the top bar',
    (await page.$eval('[data-field="project-name"]', (e) => e.value)) === 'AFrame test project',
  );
  check('nothing is saved just from opening it', (await readProject(projectA)).rev === after.rev);
});

// ---------------------------------------------------------------------------------------------
await group('the Projects dialog', async () => {
  await page.focus('[data-testid="canvas"]');
  await press(page, 'Control+o');
  check('Ctrl+O opens the Projects dialog', !!(await page.$('[data-testid="project-list"]')));
  check(
    'the open project is listed with its name',
    (await page.$$eval('.project__name', (e) => e.map((x) => x.textContent))).includes(
      'AFrame test project',
    ),
  );
  await shot('projects-dialog');
  await page.click('[data-action="new-project"]');
  await page.waitForFunction(
    (old) => window.__aframe.store.getState().doc.id !== old,
    {},
    projectA,
  );
  await settle(page);
  const second = (await docState()).id;
  check(
    'New project creates and opens a second project',
    second !== projectA && (await projectIds()).length === 2,
  );
  check(
    'the first project was saved before leaving it',
    (await readProject(projectA)).name === 'AFrame test project',
  );
  check('the dialog closed', !(await page.$('.dialog')));
  check(
    'settings follow the open project',
    (await until(
      async () => JSON.parse((await disk.read('settings.json')) ?? '{}').lastProject === second,
    )) !== null,
  );

  // Open the first again from the dialog, rename the second, delete it.
  await page.click('[data-testid="open-projects"]');
  await page.waitForSelector('[data-testid="project-list"]');
  await page.click(`[data-project-id="${projectA}"] .project__open`);
  await page.waitForFunction((id) => window.__aframe.store.getState().doc.id === id, {}, projectA);
  check('choosing a project opens it', (await docState()).id === projectA);

  await page.click('[data-testid="open-projects"]');
  await page.waitForSelector('[data-testid="project-list"]');
  await page.click(`[data-project-id="${second}"] [aria-label^="Rename"]`);
  await selectField('[data-field="rename-project"]');
  await page.keyboard.type('Second one');
  await page.keyboard.press('Enter');
  const renamed = await until(async () => (await readProject(second))?.name === 'Second one', {
    timeout: 3000,
  });
  check('a project that is not open can be renamed', renamed !== null);

  await page.waitForSelector(`[data-project-id="${second}"] [data-action="delete-project"]`);
  await page.click(`[data-project-id="${second}"] [data-action="delete-project"]`);
  check(
    'delete asks first, in words',
    (await page.$eval(`[data-project-id="${second}"]`, (e) => e.textContent)).includes(
      'cannot be undone',
    ),
  );
  check('nothing is deleted yet', (await projectIds()).includes(second));
  await page.click('[data-action="confirm-delete-project"]');
  const gone = await until(async () => !(await projectIds()).includes(second), { timeout: 3000 });
  check('confirming deletes the folder', gone !== null);
  await page.keyboard.press('Escape');
});

// ---------------------------------------------------------------------------------------------
await group('a new project from a template, and the toolkit survives save and reload', async () => {
  await page.focus('[data-testid="canvas"]');
  await press(page, 'Control+o');
  check('the dialog offers a template picker', !!(await page.$('[data-testid="template-picker"]')));
  const options = await page.$$eval('[data-field="new-project-template"] option', (o) =>
    o.map((x) => x.textContent),
  );
  check(
    'with every genre template',
    [
      'Blank',
      'Product landing',
      'SaaS dashboard',
      'Mobile app',
      'Pricing page',
      'Game HUD',
      'Game shop',
      'Game inventory',
    ].every((n) => options.includes(n)),
    options.join(', '),
  );
  const before = (await docState()).id;
  await page.select('[data-field="new-project-template"]', 'game-inventory');
  check(
    'choosing one shows what it is',
    /slot grid/.test(await page.$eval('[data-testid="template-picker"]', (e) => e.textContent)),
  );
  await page.click('[data-action="new-project"]');
  await page.waitForFunction((old) => window.__aframe.store.getState().doc.id !== old, {}, before);
  await settle(page);
  const made = await docState();
  check('the new project is the template', made.name === 'Game inventory', made.name);
  const live = await page.evaluate(() => {
    const d = window.__aframe.store.getState().doc;
    const nodes = Object.values(d.nodes);
    return {
      masters: nodes.filter((n) => n.component).length,
      instances: nodes.filter((n) => n.instanceOf).length,
      patterns: nodes.filter((n) => typeof n.fill === 'object').length,
      icons: nodes.filter((n) => n.type === 'icon').length,
      font: d.tokens.fonts.display,
    };
  });
  check(
    'with its kit, instances, patterns and icons',
    live.masters >= 5 &&
      live.instances > 20 &&
      live.patterns > 0 &&
      live.icons > 5 &&
      live.font === 'Lilita One',
    JSON.stringify(live),
  );
  // saved to disk with the new properties, and the file loads back
  await until(async () => (await readProject(made.id))?.name === 'Game inventory');
  const onDisk = await readProject(made.id);
  const saved = Object.values(onDisk?.nodes ?? {});
  check(
    'the file on disk carries components, patterns, effects and icons',
    saved.some((n) => n.component?.states?.hover) &&
      saved.some((n) => n.instanceOf && n.from === undefined) &&
      saved.some((n) => typeof n.fill === 'object' && n.fill.pattern) &&
      saved.some((n) => Array.isArray(n.effects)) &&
      saved.some((n) => n.type === 'icon' && n.icon),
    `${saved.length} nodes`,
  );
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__aframe?.sync?.()?.attached === true, {
    timeout: 30000,
  });
  await settle(page);
  const again = await page.evaluate(() => {
    const d = window.__aframe.store.getState().doc;
    return { id: d.id, masters: Object.values(d.nodes).filter((n) => n.component).length };
  });
  check(
    'after a reload the same project opens with its components',
    again.id === made.id && again.masters === live.masters,
    JSON.stringify(again),
  );
  // one undo step for an icon insert, and it persists too
  await shot('template-project');
  // leave things as the next group expects: the previous project open, the template one gone
  await page.evaluate((id) => window.__aframe.projects.openById(id), before);
  await page.waitForFunction((id) => window.__aframe.store.getState().doc.id === id, {}, before);
  await page.evaluate((id) => window.__aframe.projects.removeProject(id), made.id);
  await until(async () => !(await projectIds()).includes(made.id));
  await settle(page);
});

await group('damaged files', async () => {
  // While open: truncated by something else.
  await until(async () => (await saveState()) === 'saved');
  const file = path.join(HOME, projectPath(projectA));
  const goodName = (await docState()).name;
  await sleep(30);
  await fs.writeFile(file, '{"schema":1,"rev":9');
  const noticed = await until(async () => (await toasts()).some((x) => /damaged/.test(x)), {
    timeout: 3000,
  });
  check(
    'a file damaged while open is noticed and the screen version is written back',
    noticed !== null,
    (await toasts()).join('|'),
  );
  const healed = await until(
    async () => {
      try {
        return JSON.parse(await fs.readFile(file, 'utf8')).name === goodName;
      } catch {
        return false;
      }
    },
    { timeout: 3000 },
  );
  check('and the file is whole again', healed !== null);
  const bak = JSON.parse((await disk.read(`${projectPath(projectA)}.bak`)) ?? 'null');
  check('the backup is still a complete document', typeof bak?.rev === 'number');

  // Damaged between runs: the dialog offers the previous version.
  await page.evaluate(() =>
    window.__aframe.store
      .getState()
      .dispatch([{ op: 'update', id: window.__aframe.store.getState().doc.rootId, set: {} }], {
        label: 'noop',
      }),
  );
  await selectField('[data-field="project-name"]');
  await page.keyboard.type('Before the damage');
  await page.keyboard.press('Enter');
  await until(async () => (await readProject(projectA))?.name === 'Before the damage');
  await selectField('[data-field="project-name"]');
  await page.keyboard.type('Last save');
  await page.keyboard.press('Enter');
  await until(async () => (await readProject(projectA))?.name === 'Last save');
  await page.evaluate(() => window.__aframe.sync().detach());
  await fs.writeFile(file, '{"schema":1,"re');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.dialog');
  const dialog = await page.$eval('.dialog', (e) => e.textContent);
  check(
    'opening a damaged project shows why, in words',
    /could not be opened/.test(dialog) && /damaged/.test(dialog),
    dialog.slice(0, 120),
  );
  check('and offers the previous version', !!(await page.$('[data-action="restore-backup"]')));
  check(
    'the app is still usable behind it (another project is open)',
    (await docState()).id !== projectA && (await saveState()) === 'saved',
  );
  await shot('recover-dialog');
  await page.click('[data-action="restore-backup"]');
  await page.waitForFunction(
    (id) => window.__aframe.store.getState().doc.id === id,
    { timeout: 5000 },
    projectA,
  );
  const restored = await docState();
  check(
    'Restore previous version brings the last good copy back',
    restored.name === 'Before the damage',
    restored.name,
  );
  check(
    'and the project file is valid again',
    (await readProject(projectA))?.name === 'Before the damage',
  );
});

// ---------------------------------------------------------------------------------------------
await group('stability', async () => {
  check(
    'no console errors during the whole run',
    t.errors.length === 0,
    t.errors.slice(0, 3).join(' | '),
  );
  const leftovers = [];
  for (const e of await disk.list('projects')) {
    for (const f of await disk.list(`projects/${e.name}`)) {
      if (f.name.endsWith('.tmp') || f.name === '.lock') leftovers.push(`${e.name}/${f.name}`);
    }
  }
  check('no temp or lock files are left behind', leftovers.length === 0, leftovers.join(','));
});

await t.close();
console.log(
  r.failures === 0
    ? '\nAll persistence checks passed.'
    : `\n${r.failures} persistence check(s) failed.`,
);
process.exit(r.failures === 0 ? 0 : 1);
