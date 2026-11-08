// Design check e2e: the badge in the top bar, the list, Show, Fix, Fix all and Undo, on the sample
// project's deliberately cramped pricing page. Run: node tests/e2e/lint-ui.mjs
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { reporter, settle, start } from './harness.mjs';

const t = await start({ width: 1500, height: 940 });
const { page } = t;
const r = reporter();
const { check } = r;
const SHOT_DIR = process.env.SHOT_DIR;
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true });
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const rows = () => page.$$('[data-testid="lint-dialog"] .lint__row');
const doc = () =>
  page.evaluate(() => JSON.parse(JSON.stringify(window.__aframe.store.getState().doc)));

await page.evaluate(() => window.__aframe.loadSample());
await page.evaluate(() => document.fonts.ready);
await settle(page);
await sleep(800); // the badge settles shortly after edits stop
const badge = await page
  .$eval('[data-testid="check-badge"]', (el) => Number.parseInt(el.textContent ?? '0', 10))
  .catch(() => 0);
check('the top bar shows how many things need a look', badge > 0, String(badge));

await page.click('[data-testid="design-check"]');
await settle(page);
const dialog = await page.$('[data-testid="lint-dialog"]');
check('Check opens the list', dialog !== null);
const before = (await rows()).length;
check('it lists what is wrong', before > 0, String(before));
const text = await page.$eval('[data-testid="lint-dialog"]', (el) => el.textContent ?? '');
check(
  'in plain words, grouped by how much it matters',
  /Problems|Worth fixing|Polish/.test(text) && !/n_[a-z0-9]{4}/.test(text.replace(/\[|\]/g, '')),
  text.slice(0, 120),
);
if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, 'lint.png') });

// Show selects the layer.
await page.click('[data-testid="lint-dialog"] [data-action="lint-find"]');
await settle(page);
const selected = await page.evaluate(() => window.__aframe.store.getState().selection);
check('Show selects that layer', selected.length === 1);

// One Fix removes its finding and is one undo step.
const docBefore = await doc();
const fixButtons = await page.$$('[data-testid="lint-dialog"] [data-action="lint-fix"]');
check('rows with a safe fix have a Fix button', fixButtons.length > 0, String(fixButtons.length));
const firstRule = await page.$eval(
  '[data-testid="lint-dialog"] .lint__row:has([data-action="lint-fix"])',
  (el) => el.getAttribute('data-rule'),
);
await fixButtons[0].click();
await settle(page);
const afterOne = await doc();
check('Fix changes the design', JSON.stringify(afterOne.nodes) !== JSON.stringify(docBefore.nodes));
check(
  'and the list gets shorter',
  (await rows()).length < before,
  `${before} -> ${(await rows()).length} (${firstRule})`,
);
await page.evaluate(() => window.__aframe.store.getState().undo());
await settle(page);
check(
  'one undo takes that fix back',
  JSON.stringify((await doc()).nodes) === JSON.stringify(docBefore.nodes),
);

// Fix everything that can be fixed.
await page.click('[data-action="lint-fix-all"]');
await settle(page);
const remaining = (await rows()).length;
check('Fix all leaves only what needs judgement', remaining < before, `${before} -> ${remaining}`);
const stillFixable = await page.$$('[data-testid="lint-dialog"] [data-action="lint-fix"]');
check(
  'and nothing that could be fixed automatically is left',
  stillFixable.length === 0,
  String(stillFixable.length),
);
await page.evaluate(() => window.__aframe.store.getState().undo());
await settle(page);
check(
  'one undo reverts all of it',
  JSON.stringify((await doc()).nodes) === JSON.stringify(docBefore.nodes),
);
await page.keyboard.press('Escape');
await settle(page);

// A clean design says so.
await page.evaluate(() => {
  window.__aframe.loadBlank();
  const s = window.__aframe.store.getState();
  s.dispatch(
    [
      {
        op: 'create',
        parentId: s.doc.rootId,
        node: {
          type: 'frame',
          name: 'Clean',
          w: 400,
          h: 200,
          fill: '#fefefe',
          layout: 'column',
          gap: 8,
          children: [
            { type: 'text', name: 'Title', text: 'Hello', fontSize: 24, color: '#111111' },
          ],
        },
      },
    ],
    { label: 'clean' },
  );
});
await settle(page);
if (SHOT_DIR) await page.screenshot({ path: join(SHOT_DIR, 'lint-before-clean.png') });
await page.click('[data-testid="design-check"]');
await settle(page);
const cleanText = await page
  .$eval('[role="dialog"]', (el) => el.textContent ?? '')
  .catch(() => '(no dialog)');
check(
  'a clean design says nothing needs fixing',
  (await page.$('[data-testid="lint-clean"]')) !== null,
  cleanText.slice(0, 200),
);

check('no console errors', t.errors.length === 0, t.errors.slice(0, 2).join(' | '));
await t.close();
console.log(r.failures === 0 ? 'ALL PASSED' : `${r.failures} FAILED`);
process.exit(r.failures === 0 ? 0 : 1);
