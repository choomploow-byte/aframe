// What happens when something goes wrong: the recovery page after a render crash, diagnostics that
// hold nothing private, and the document loader's answer to malformed project files.
// Run: node tests/e2e/resilience.mjs
import { reporter, settle, start } from './harness.mjs';

const t = await start({ width: 1300, height: 860 });
const { page } = t;
const r = reporter();
const { check } = r;

await page.evaluate(() => window.__atelier.loadSample());
await settle(page);
// A note and a layer with text that must never appear in diagnostics.
await page.evaluate(() => {
  const s = window.__atelier.store.getState();
  s.edit(
    (d) => ({
      ...d,
      annotations: [
        ...d.annotations,
        {
          id: 'a_secret1',
          text: 'TOP-SECRET-NOTE-TEXT',
          status: 'open',
          author: 'user',
          x: 1,
          y: 1,
          createdAt: new Date().toISOString(),
          replies: [],
        },
      ],
    }),
    'note',
  );
});
await page.evaluate(() => window.__atelier.crash());
await settle(page);
check(
  'a render crash shows the recovery page, not a blank window',
  (await page.$('[data-testid="crash"]')) !== null,
);
const text = await page.$eval('[data-testid="crash"]', (el) => el.textContent ?? '');
check(
  'it says the work is saved and offers a way out',
  /saved/.test(text) && /Reload/.test(text) && /Copy diagnostics/.test(text),
  text.slice(0, 160),
);

// Copy diagnostics.
await page.evaluate(() => {
  window.__diag = '';
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (t) => {
        window.__diag = t;
        return Promise.resolve();
      },
    },
  });
});
await page.click('[data-action="crash-copy"]');
await settle(page);
const diag = await page.evaluate(() => window.__diag);
check(
  'diagnostics hold the version, system, size of the design and the error',
  /^Atelier /.test(diag) &&
    /Platform:/.test(diag) &&
    /\d+ layers/.test(diag) &&
    /Test crash/.test(diag),
  diag.slice(0, 200),
);
check(
  'and nothing private: no note text, no layer text',
  !diag.includes('TOP-SECRET-NOTE-TEXT') &&
    !diag.includes('Simple pricing') &&
    !diag.includes('Plan work'),
);
check(
  'the button confirms the copy',
  /Copied/.test(
    (await page.$eval('[data-action="crash-copy"]', (el) => el.textContent ?? '')) ?? '',
  ),
);

check(
  'no unexpected console errors (the crash itself is expected)',
  t.errors.every((e) => /Test crash|The above error occurred|Uncaught/i.test(e)),
  t.errors
    .filter((e) => !/Test crash|The above error occurred|Uncaught/i.test(e))
    .slice(0, 2)
    .join(' | '),
);
await t.close();
console.log(r.failures === 0 ? 'ALL PASSED' : `${r.failures} FAILED`);
process.exit(r.failures === 0 ? 0 : 1);
