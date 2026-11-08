// The eval runner (evals/README.md). Drives the real in-app assistant in headless Chrome on each task:
// the same loop, tools, system prompt and screenshots as in the desktop app. The provider is one of:
//   --reference           the scripted lint-fix baseline (no key, no network: proves the harness)
//   --replay <dir>        responses recorded by an earlier live run (no key, no network)
//   --provider <id>       a live provider; the key is read from the environment and stays in this
//                         process (the page only asks this process to send a request)
// Usage: node --import tsx evals/run.mjs --reference [--task id] [--out dir]
//        ANTHROPIC_API_KEY=... node --import tsx evals/run.mjs --provider anthropic --model claude-sonnet-5-5
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { start, settle } from '../tests/e2e/harness.mjs';
import { measure, verdict, changedNodes } from './metrics.ts';
import { referenceAgent } from './reference-agent.ts';
import { TASKS, prepare } from './tasks.ts';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const mode = flag('reference')
  ? 'reference'
  : value('replay')
    ? 'replay'
    : value('provider')
      ? 'live'
      : null;
if (mode === null) {
  console.error(
    'Choose a mode: --reference, --replay <dir> or --provider <anthropic|openai|custom>.',
  );
  process.exit(2);
}
const provider = value('provider') ?? 'anthropic';
const model = value('model') ?? (provider === 'anthropic' ? 'claude-sonnet-5-5' : '');
const baseUrl = value('base-url') ?? '';
const only = value('task');
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const out = value('out') ?? join('evals', 'out', `${mode}-${stamp}`);
mkdirSync(out, { recursive: true });

const KEYS = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', custom: 'EVAL_API_KEY' };
let apiKey = '';
if (mode === 'live') {
  apiKey = process.env[KEYS[provider]] ?? '';
  if (apiKey === '' && provider !== 'custom') {
    console.error(`Set ${KEYS[provider]} in the environment (it is never written anywhere).`);
    process.exit(2);
  }
  if (model === '') {
    console.error('Give --model for this provider.');
    process.exit(2);
  }
}

/** One live request from this process. The key is added here and never reaches the page. */
async function liveSend(body) {
  const url =
    provider === 'anthropic'
      ? 'https://api.anthropic.com/v1/messages'
      : provider === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
        : `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers = { 'content-type': 'application/json' };
  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (apiKey !== '') headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, text: await res.text() };
}

await prepare();
const tasks = TASKS.filter((t) => only === undefined || t.id === only);
if (tasks.length === 0) {
  console.error(`No task "${only}". Tasks: ${TASKS.map((t) => t.id).join(', ')}`);
  process.exit(2);
}

const t = await start({ width: 1500, height: 940 });
const { page } = t;
let current = { responses: [], replay: [], replayAt: 0, edits: true, key: '' };

await page.exposeFunction('__evalSend', async (providerId, body) => {
  if (mode === 'reference') {
    const reply = referenceAgent(body, { edits: current.edits });
    return { status: 200, text: JSON.stringify(reply) };
  }
  if (mode === 'replay') {
    const next = current.replay[current.replayAt];
    current.replayAt += 1;
    return (
      next ?? { status: 500, text: '{"error":{"message":"the recording has no more responses"}}' }
    );
  }
  const res = await liveSend(body);
  current.responses.push(res);
  return res;
});
await page.evaluate(
  async (cfg) => {
    const chat = await window.__atelier.chat();
    window.__chat = chat;
    chat.transport.setTransportForTests((p, body) => window.__evalSend(p, body));
    chat.keys.setKeyStoreForTests({
      available: true,
      has: () => Promise.resolve(true),
      set: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    });
    chat.settings.settingsStore.getState().update({
      acknowledged: true,
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      models: {
        ...chat.settings.settingsStore.getState().settings.models,
        [cfg.provider]: cfg.model,
      },
      maxSteps: 25,
    });
  },
  {
    provider: mode === 'live' ? provider : 'anthropic',
    baseUrl,
    model: mode === 'live' ? model : 'claude-sonnet-5-5',
  },
);

const rows = [];
for (const task of tasks) {
  const before = task.build();
  current = {
    responses: [],
    replay:
      mode === 'replay'
        ? JSON.parse(readFileSync(join(value('replay'), `${task.id}.responses.json`), 'utf8'))
        : [],
    replayAt: 0,
    edits: task.kind !== 'unchanged',
    key: '',
  };
  await page.evaluate((d) => {
    window.__atelier.projects.detachForTests();
    window.__atelier.store.getState().loadDoc(d);
    window.__atelier.canvas()?.fitAll();
  }, before);
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  const selected = task.select
    ? Object.values(before.nodes).find((n) => n.name === task.select)?.id
    : undefined;
  if (selected) {
    await page.evaluate((id) => window.__atelier.store.getState().setSelection([id]), selected);
  }
  await page.evaluate(() => window.__chat.session.resetChat());
  const startedAt = Date.now();
  await page.evaluate((prompt) => {
    window.__evalDone = false;
    void window.__chat.session.sendChat(prompt).finally(() => {
      window.__evalDone = true;
    });
  }, task.prompt);
  await page.waitForFunction(() => window.__evalDone === true, {
    timeout: mode === 'live' ? 15 * 60_000 : 90_000,
    polling: 500,
  });
  const result = await page.evaluate(() => {
    const s = window.__chat.session.chatStore.getState();
    return {
      doc: JSON.parse(JSON.stringify(window.__atelier.store.getState().doc)),
      items: s.items.map((i) => ({
        kind: i.kind,
        text: i.text ?? '',
        name: i.name ?? '',
        state: i.state ?? '',
      })),
      usage: s.totalUsage,
    };
  });
  const after = result.doc;
  const m0 = measure(before, selected);
  const m1 = measure(after, selected);
  const changed = changedNodes(before, after);
  const v = verdict(m1, task.bars);
  const errors = result.items.filter((i) => i.kind === 'error').map((i) => i.text);
  // An edit task must change something, then meet the bars; a critique must change nothing.
  const pass =
    task.kind === 'unchanged'
      ? changed === 0 && errors.length === 0
      : changed > 0 && v.pass && errors.length === 0;
  const tools = result.items.filter((i) => i.kind === 'tool');
  const shots = tools.filter((i) => i.name === 'screenshot' && i.state === 'ok').length;

  // A picture of the result for the human rating.
  const png = await page.evaluate(async () => {
    const { captureScreenshot } = await import('/src/canvas/screenshot.ts');
    const s = window.__atelier.store.getState();
    try {
      return (await captureScreenshot(s.doc, s.viewport.zoom, { maxWidth: 1400 })).pngBase64;
    } catch {
      return null;
    }
  });
  if (png) writeFileSync(join(out, `${task.id}.png`), Buffer.from(png, 'base64'));
  if (mode === 'live')
    writeFileSync(join(out, `${task.id}.responses.json`), JSON.stringify(current.responses));
  writeFileSync(
    join(out, `${task.id}.json`),
    JSON.stringify(
      {
        task: task.id,
        mode,
        model: mode === 'live' ? model : mode,
        before: m0,
        after: m1,
        verdict: v,
        changedNodes: changed,
        tools: tools.map((x) => x.name),
        screenshots: shots,
        usage: result.usage,
        errors,
        seconds: (Date.now() - startedAt) / 1000,
        transcript: result.items.filter((i) => i.kind === 'assistant').map((i) => i.text),
      },
      null,
      2,
    ),
  );
  rows.push({ task, m0, m1, changed, v, pass, shots, usage: result.usage, errors });
  console.log(
    `${pass ? 'PASS' : 'FAIL'}  ${task.id}: layout ${m0.autoLayoutPct}->${m1.autoLayoutPct}%  spacing ${m0.spacingOnScalePct}->${m1.spacingOnScalePct}%  contrast errors ${m0.contrastErrors}->${m1.contrastErrors}  changed ${changed}  screenshots ${shots}${errors.length ? `  error: ${errors[0]}` : ''}`,
  );
}

const avg = (f) => (rows.reduce((s, r) => s + f(r), 0) / rows.length).toFixed(1);
const lines = [
  `# Eval run: ${mode}${mode === 'live' ? ` (${provider} ${model})` : ''}`,
  '',
  '| Task | Auto-layout % | On-scale spacing % | Contrast errors | Nodes changed | Screenshots | Tokens in/out | Automatic bars |',
  '|---|---|---|---|---|---|---|---|',
  ...rows.map(
    (r) =>
      `| ${r.task.id} | ${r.m0.autoLayoutPct} -> ${r.m1.autoLayoutPct} | ${r.m0.spacingOnScalePct} -> ${r.m1.spacingOnScalePct} | ${r.m0.contrastErrors} -> ${r.m1.contrastErrors} | ${r.changed} | ${r.shots} | ${r.usage.input}/${r.usage.output} | ${r.pass ? 'met' : 'not met'} |`,
  ),
  '',
  `Mean after: auto-layout ${avg((r) => r.m1.autoLayoutPct)}%, on-scale spacing ${avg((r) => r.m1.spacingOnScalePct)}%, contrast errors ${avg((r) => r.m1.contrastErrors)}. Tasks meeting every automatic bar: ${rows.filter((r) => r.pass).length}/${rows.length}.`,
  '',
  'Human ratings (1-5, see RUBRIC.md) go in ratings.csv beside this file.',
];
writeFileSync(join(out, 'summary.md'), `${lines.join('\n')}\n`);
if (!existsSync(join(out, 'ratings.csv'))) {
  writeFileSync(
    join(out, 'ratings.csv'),
    `task,rating_1_to_5,notes\n${rows.map((r) => `${r.task.id},,`).join('\n')}\n`,
  );
}
console.log(`\nWrote ${out}`);
await t.close();
process.exit(0);
