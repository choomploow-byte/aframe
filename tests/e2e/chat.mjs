// Phase 7 e2e: the built-in assistant, driven like a person in real Chrome, against a SCRIPTED provider
// (no network, no real key). Covers the privacy notice, setup states, "improve the selected frame"
// with self-screenshot, one undo for the whole turn, Stop, friendly errors, the settings dialog, image
// attach, "Ask AI to address notes", and that no key ever reaches the page, storage or a request body.
// Live provider calls are not made here: run them yourself with your own key.
// SHOT_DIR=<dir> saves screenshots. Run: node tests/e2e/chat.mjs
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { press, reporter, settle, start } from './harness.mjs';

const t = await start({ width: 1500, height: 940 });
const { page } = t;
const r = reporter();
const { check } = r;
const SHOT_DIR = process.env.SHOT_DIR;
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const shot = async (name) => {
  if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
};
const SECRET = 'sk-ant-TESTSECRET-do-not-leak-123';

const docNow = () =>
  page.evaluate(() => JSON.parse(JSON.stringify(window.__atelier.store.getState().doc)));
const q = (sel) => page.$(sel);
const text = (sel) => page.$eval(sel, (el) => el.textContent ?? '').catch(() => null);
const click = async (sel) => {
  await page.click(sel);
  await settle(page);
};
const waitIdle = async (ms = 8000) => {
  await page
    .waitForFunction(() => document.querySelector('[data-testid="chat-working"]') === null, {
      timeout: ms,
    })
    .catch(() => undefined);
  await settle(page);
};
const items = () =>
  page.evaluate(() =>
    window.__chat.session.chatStore
      .getState()
      .items.map((i) => ({ kind: i.kind, text: i.text ?? i.name ?? '', state: i.state })),
  );
const script = (steps) => page.evaluate((s) => void (window.__script = s), steps);
const sent = () => page.evaluate(() => window.__sent);
const reset = () =>
  page.evaluate(() => {
    window.__sent = [];
    window.__script = [];
    window.__chat.session.resetChat();
  });

const toolUse = (id, name, input, text) => ({
  body: {
    content: [...(text ? [{ type: 'text', text }] : []), { type: 'tool_use', id, name, input }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 1500, output_tokens: 80 },
  },
});
const finalText = (words) => ({
  body: {
    content: [{ type: 'text', text: words }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 2000, output_tokens: 120 },
  },
});

// ---- a design, and a scripted provider in the page ---------------------------------------------------
await page.evaluate(() => window.__atelier.loadTemplate('pricing'));
await page.evaluate(() => document.fonts.ready);
await settle(page);
await page.evaluate(async () => {
  const chat = await window.__atelier.chat();
  window.__chat = chat;
  window.__sent = [];
  window.__script = [];
  window.__keys = {};
  chat.transport.setTransportForTests(async (_provider, body, signal) => {
    window.__sent.push(JSON.parse(JSON.stringify(body)));
    const step = window.__script.shift() ?? {
      body: {
        content: [{ type: 'text', text: '(nothing scripted)' }],
        stop_reason: 'end_turn',
        usage: {},
      },
    };
    if (step.hang) {
      await new Promise((res) => signal.addEventListener('abort', res, { once: true }));
      throw new DOMException('aborted', 'AbortError');
    }
    if (step.throws) throw new Error('offline');
    return { status: step.status ?? 200, text: JSON.stringify(step.body ?? {}) };
  });
  chat.keys.setKeyStoreForTests({
    available: true,
    has: (p) => Promise.resolve(Boolean(window.__keys[p])),
    set: (p, k) => {
      window.__keys[p] = k;
      return Promise.resolve();
    },
    clear: (p) => {
      delete window.__keys[p];
      return Promise.resolve();
    },
  });
  chat.settings.settingsStore.getState().update({ acknowledged: false, provider: 'anthropic' });
});
const screenId = await page.evaluate(() => {
  const s = window.__atelier.store.getState();
  return s.doc.nodes[s.doc.rootId].children.find((id) => s.doc.nodes[id].name !== 'Components');
});
const original = await docNow();
const gapBefore = original.nodes[screenId].gap;

// ---- first use: the tab, the privacy notice ------------------------------------------------------------
await page.evaluate(() => {
  [...document.querySelectorAll('[role="tab"]')]
    .find((b) => b.textContent?.startsWith('Chat'))
    ?.click();
});
await settle(page);
check('the right panel has a Chat tab', (await q('[data-testid="chat-panel"]')) !== null);
check(
  'the first thing shown is the privacy notice',
  (await q('[data-testid="chat-privacy"]')) !== null,
);
check(
  'the notice says where the data goes and where the key lives',
  /Anthropic/.test((await text('[data-testid="chat-privacy"]')) ?? '') &&
    /keychain/.test((await text('[data-testid="chat-privacy"]')) ?? ''),
);
await shot('chat-privacy');
await click('[data-action="chat-acknowledge"]');
check(
  'after "Got it" the conversation view shows',
  (await q('[data-testid="chat-input"]')) !== null,
);

// ---- no key yet -------------------------------------------------------------------------------------------
await sleep(300);
const setup = await text('[data-testid="chat-setup"]');
check('with no key it says what to do', /API key/.test(setup ?? ''), String(setup));
check(
  'the suggested prompts wait until it is set up',
  await page.$$eval('[data-action="chat-suggestion"]', (b) => b.every((x) => x.disabled)),
);
await shot('chat-setup');

// ---- settings: save the key, test the connection --------------------------------------------------------------
await click('[data-action="chat-settings"]');
check('AI settings open from the panel', (await q('[data-testid="settings-dialog"]')) !== null);
check(
  'the model list has the current Claude models',
  (
    await page.$$eval(
      '[data-field="chat-model"] option, select[data-field="chat-model"] option',
      (o) => o.map((x) => x.value),
    )
  ).includes('claude-sonnet-5-5'),
);
await page.type('[data-field="chat-key"]', SECRET);
check(
  'the key field is masked',
  (await page.$eval('[data-field="chat-key"]', (el) => el.type)) === 'password',
);
await click('[data-action="chat-key-save"]');
check(
  'saving shows it is kept in the keychain',
  /keychain/.test((await text('[data-testid="chat-key-saved"]')) ?? ''),
);
check(
  'the key is not left in the page',
  !(await page.evaluate(() => document.body.innerText)).includes('TESTSECRET'),
);
await script([{ status: 401, body: { error: { message: 'invalid x-api-key' } } }]);
await click('[data-action="chat-test"]');
await sleep(200);
check(
  'a rejected key is reported in plain words',
  /rejected your API key/.test((await text('[data-testid="chat-test-result"]')) ?? ''),
  String(await text('[data-testid="chat-test-result"]')),
);
await script([finalText('ok')]);
await click('[data-action="chat-test"]');
await sleep(200);
check(
  'a working key says connected',
  /Connected/.test((await text('[data-testid="chat-test-result"]')) ?? ''),
);
await shot('chat-settings');
await page.keyboard.press('Escape');
await settle(page);

// ---- improve the selected frame -----------------------------------------------------------------------------------
await page.evaluate((id) => window.__atelier.store.getState().setSelection([id]), screenId);
await settle(page);
await reset();
await script([
  toolUse('tu1', 'get_design', {}, 'Let me look at the design first.'),
  toolUse('tu2', 'apply_changes', {
    label: 'More room',
    operations: [{ op: 'update', id: screenId, set: { gap: 48 } }],
  }),
  toolUse('tu3', 'screenshot', { nodeId: screenId, maxWidth: 600 }),
  finalText('I gave the sections more breathing room so each plan reads on its own.'),
]);
await click('[data-action="chat-suggestion"]');
await waitIdle(30000);
const log = await items();
const toolRows = await page.$$eval('[data-testid="chat-tool"]', (els) =>
  els.map((e) => e.textContent ?? ''),
);
check(
  'the transcript shows what the assistant did, in plain words',
  ['Looked at the design', 'Edited the design', 'Took a screenshot'].every((label) =>
    toolRows.some((row) => row.includes(label)),
  ),
  toolRows.join(' | '),
);
check(
  'it ends with its words about the result',
  log.at(-1)?.kind === 'assistant' && /breathing room/.test(log.at(-1)?.text ?? ''),
  JSON.stringify(log.at(-1)),
);
const after = await docNow();
check(
  'the design changed',
  after.nodes[screenId].gap === 48 && gapBefore !== 48,
  `gap ${gapBefore} -> ${after.nodes[screenId].gap}`,
);
const requests = await sent();
check('it made one request per step', requests.length === 4, String(requests.length));
const firstText = requests[0].messages[0].content[0].text;
check(
  'the first message carries the selection and the project',
  firstText.includes('Selection:') &&
    firstText.includes(screenId) &&
    firstText.includes('Project:'),
  firstText.slice(0, 160),
);
check(
  'the tool list and the system prompt were sent',
  requests[0].tools.length > 10 && /Atelier's design assistant/.test(requests[0].system),
);
check(
  'the in-app tool list leaves out file and project tools',
  !requests[0].tools.some((x) => ['export_code', 'import_image', 'open_project'].includes(x.name)),
);
check(
  'the last request carries the screenshot the tool took',
  JSON.stringify(requests[3]).includes('"type":"image"'),
);
check(
  'a screenshot shows in the transcript',
  (await q('.chat__shot')) !== null ||
    (await page.$$eval('[data-testid="chat-tool"] img', (i) => i.length)) > 0,
);
const usage = await text('[data-testid="chat-usage"]');
check('it shows token use for the reply', /tokens in/.test(usage ?? ''), String(usage));
await shot('chat-improve');

// One undo reverts the whole turn.
check('"Undo AI change" is offered', (await q('[data-action="chat-undo"]')) !== null);
await page.evaluate(() => document.activeElement?.blur?.());
await press(page, 'Control+z');
const undone = await docNow();
check(
  'one Ctrl+Z undoes the whole turn',
  JSON.stringify(undone.nodes) === JSON.stringify(original.nodes),
  `gap ${undone.nodes[screenId].gap}`,
);
await press(page, 'Control+Shift+z');
check('and redo brings it back', (await docNow()).nodes[screenId].gap === 48);
await click('[data-action="chat-undo"]');
check('the button undoes it too', (await docNow()).nodes[screenId].gap === gapBefore);

// ---- Stop -------------------------------------------------------------------------------------------------------------
await reset();
await script([toolUse('s1', 'get_design', {}), { hang: true }]);
await page.type('[data-testid="chat-input"]', 'make everything blue');
await page.keyboard.press('Enter');
await sleep(500);
check('while it works the button says Stop', (await q('[data-action="chat-stop"]')) !== null);
const stopAt = Date.now();
await click('[data-action="chat-stop"]');
await waitIdle(3000);
const stopMs = Date.now() - stopAt;
check(`Stop frees the panel within a second (${stopMs} ms)`, stopMs < 1500);
check(
  'it says it stopped',
  (await items()).some((i) => i.kind === 'notice' && /Stopped/.test(i.text)),
);
check(
  'nothing was changed by the stopped turn',
  JSON.stringify((await docNow()).nodes) === JSON.stringify(original.nodes),
);
check(
  'and the next message can be sent',
  (await q('[data-action="chat-send"]')) !== null ||
    (await q('[data-testid="chat-input"]')) !== null,
);

// ---- errors -------------------------------------------------------------------------------------------------------------
await reset();
await script([{ status: 401, body: { error: { message: 'invalid x-api-key' } } }]);
await page.type('[data-testid="chat-input"]', 'hello');
await page.keyboard.press('Enter');
await waitIdle();
const err = await text('[data-testid="chat-error"]');
check(
  'a rejected key gives a human message with a way to fix it',
  /rejected your API key/.test(err ?? '') && /Open settings/.test(err ?? ''),
  String(err),
);
await click('[data-testid="chat-error"] button');
check('"Open settings" opens the settings', (await q('[data-testid="settings-dialog"]')) !== null);
await page.keyboard.press('Escape');
await settle(page);
await reset();
await script([{ throws: true }, { throws: true }, { throws: true }]); // it retries twice first
await page.type('[data-testid="chat-input"]', 'hello again');
await page.keyboard.press('Enter');
await waitIdle(15000);
check(
  'an unreachable network says so',
  /Could not reach the provider/.test((await text('[data-testid="chat-error"]')) ?? ''),
);
await reset();
await script([{ status: 400, body: { error: { message: 'prompt is too long: 300000 tokens' } } }]);
await page.type('[data-testid="chat-input"]', 'a very long one');
await page.keyboard.press('Enter');
await waitIdle();
check(
  'a too-long conversation says to start a new chat',
  /too long/.test((await text('[data-testid="chat-error"]')) ?? ''),
);

// ---- images ------------------------------------------------------------------------------------------------------------------
await reset();
const dir = mkdtempSync(join(tmpdir(), 'atelier-chat-'));
const png = new PNG({ width: 4, height: 4 });
png.data.fill(200);
const imagePath = join(dir, 'ref.png');
writeFileSync(imagePath, PNG.sync.write(png));
const input = await page.$('[data-testid="chat-attach"]');
await input.uploadFile(imagePath);
await sleep(300);
check('an attached image shows as a thumbnail', (await page.$$('.chat__thumb')).length === 1);
await script([finalText('I can see the reference.')]);
await page.type('[data-testid="chat-input"]', 'rebuild this screenshot');
await page.keyboard.press('Enter');
await waitIdle();
const withImage = (await sent())[0];
check(
  'the image went to the model with the message',
  JSON.stringify(withImage.messages[0]).includes('"media_type":"image/png"'),
);
check('and the thumbnail is cleared after sending', (await page.$$('.chat__thumb')).length === 0);

// ---- "Ask AI to address notes" goes to the built-in chat when it is set up -----------------------------------------------------------
await reset();
await page.evaluate((id) => {
  window.__atelier.store.getState().dispatch([{ op: 'noop' }].slice(0, 0), { label: 'noop' });
  const s = window.__atelier.store.getState();
  s.edit(
    (d) => ({
      ...d,
      annotations: [
        ...d.annotations,
        {
          id: 'a_note01',
          text: 'Make the title bigger',
          status: 'open',
          author: 'user',
          nodeId: id,
          x: 10,
          y: 10,
          createdAt: new Date().toISOString(),
          replies: [],
        },
      ],
    }),
    'add note',
  );
}, screenId);
await script([finalText('Done with the note.')]);
await page.evaluate(() => {
  [...document.querySelectorAll('[role="tab"]')]
    .find((b) => b.textContent?.startsWith('Notes'))
    ?.click();
});
await settle(page);
const askButton = await page.evaluateHandle(() =>
  [...document.querySelectorAll('button')].find((b) => /Ask AI/.test(b.textContent ?? '')),
);
if (askButton.asElement()) {
  await askButton.asElement().click();
  await waitIdle();
  const msgs = await sent();
  check(
    '"Ask AI" sends the notes to the built-in assistant',
    msgs.length >= 1 && JSON.stringify(msgs[0].messages[0]).includes('annotations'),
    String(msgs.length),
  );
  check('and opens the Chat tab', (await q('[data-testid="chat-panel"]')) !== null);
} else {
  check('"Ask AI" button exists', false, 'not found');
}

// ---- the key is nowhere it should not be ---------------------------------------------------------------------------------------------------
const leaks = await page.evaluate((secret) => {
  const places = [];
  if (document.documentElement.outerHTML.includes(secret)) places.push('dom');
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if ((localStorage.getItem(k) ?? '').includes(secret) || k.includes(secret))
      places.push(`localStorage:${k}`);
  }
  for (let i = 0; i < sessionStorage.length; i += 1) {
    if ((sessionStorage.getItem(sessionStorage.key(i)) ?? '').includes(secret))
      places.push('sessionStorage');
  }
  if (JSON.stringify(window.__sent).includes(secret)) places.push('request-bodies');
  if (JSON.stringify(window.__atelier.store.getState().doc).includes(secret))
    places.push('document');
  if (JSON.stringify(window.__chat.session.chatStore.getState()).includes(secret))
    places.push('chat-state');
  if (JSON.stringify(window.__chat.settings.settingsStore.getState()).includes(secret))
    places.push('settings-state');
  return places;
}, SECRET);
check(
  'the API key is not in the page, storage, requests, the design or the chat',
  leaks.length === 0,
  leaks.join(', '),
);
check('and it never reached the console', !t.errors.some((e) => e.includes('TESTSECRET')));

// ---- a browser build cannot keep keys --------------------------------------------------------------------------------------------------------
await page.evaluate(() => window.__chat.keys.setKeyStoreForTests(null));
await page.evaluate(() => window.__chat.keys.refreshKeys());
await page.evaluate(() => window.__atelier.chat().then((c) => c.session.resetChat()));
await settle(page);
await press(page, 'Control+k');
await page.keyboard.type('AI settings');
await sleep(150);
await page.keyboard.press('Enter');
await settle(page);
check(
  'without the desktop app, settings explain keys cannot be stored here',
  /desktop app/.test((await text('[data-testid="settings-dialog"]')) ?? ''),
);
check(
  'and the key field is disabled',
  await page.$eval('[data-field="chat-key"]', (el) => el.disabled).catch(() => true),
);
await page.keyboard.press('Escape');

check('no console errors', t.errors.length === 0, t.errors.slice(0, 2).join(' | '));
await t.close();
console.log(r.failures === 0 ? 'ALL PASSED' : `${r.failures} FAILED`);
process.exit(r.failures === 0 ? 0 : 1);
