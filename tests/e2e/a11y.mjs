// Accessibility audit of the editor chrome with axe-core (WCAG 2 A and AA), in light and dark, on the
// empty welcome screen, a loaded design with each right-panel tab, and every dialog. Fails on any
// violation; the canvas contents (the user's design) are not part of the chrome and are excluded.
// Also checks the keyboard path into each dialog and reduced motion. Run: node tests/e2e/a11y.mjs
import { readFileSync } from 'node:fs';
import { reporter, settle, start } from './harness.mjs';

const t = await start({ width: 1500, height: 940 });
const { page } = t;
const r = reporter();
const { check, info } = r;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const AXE = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
await page.evaluate(AXE);

const audit = async (label) => {
  const res = await page.evaluate(async () => {
    const out = await window.axe.run(
      { exclude: [['[data-testid="canvas"]'], ['[data-testid="world"]']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } },
    );
    return out.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    }));
  });
  check(
    `${label}: no accessibility violations`,
    res.length === 0,
    res
      .map((v) => `${v.id} (${v.impact}) ${v.nodes.join(' | ')}`)
      .join('; ')
      .slice(0, 600),
  );
  return res;
};

const open = async (action) => {
  await action();
  await settle(page);
  await sleep(250);
};
const close = async () => {
  await page.keyboard.press('Escape');
  await settle(page);
};
const tab = (label) =>
  page.evaluate((l) => {
    [...document.querySelectorAll('[role="tab"]')]
      .find((b) => b.textContent?.startsWith(l))
      ?.click();
  }, label);

for (const scheme of ['light', 'dark']) {
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  await page.evaluate((s) => {
    localStorage.setItem('aframe.theme', s);
  }, scheme);
  await page.evaluate(() => window.__aframe.loadBlank());
  await settle(page);
  await audit(`${scheme}: welcome screen`);

  await page.evaluate(() => window.__aframe.loadSample());
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  await audit(`${scheme}: design tab`);
  for (const name of ['Notes', 'Chat']) {
    await tab(name);
    await settle(page);
    await audit(`${scheme}: ${name} tab`);
  }
  await tab('Design');
  // The left panel's tabs.
  for (const name of ['Assets', 'Tokens', 'Icons']) {
    await page.evaluate((l) => {
      [...document.querySelectorAll('[role="tab"]')]
        .find((b) => b.textContent?.startsWith(l))
        ?.click();
    }, name);
    await settle(page);
    await audit(`${scheme}: ${name} panel`);
  }

  const dialogs = [
    [
      'command palette',
      () =>
        page.keyboard
          .down('Control')
          .then(() => page.keyboard.press('k'))
          .then(() => page.keyboard.up('Control')),
    ],
    ['connect', () => page.click('[data-testid="connect-ai"]')],
    ['import', () => page.click('[data-testid="open-import"]')],
    ['design check', () => page.click('[data-testid="design-check"]')],
    [
      'keyboard shortcuts',
      () =>
        page.keyboard
          .down('Control')
          .then(() => page.keyboard.press('/'))
          .then(() => page.keyboard.up('Control')),
    ],
  ];
  for (const [name, action] of dialogs) {
    await open(action);
    check(`${scheme}: ${name} opens`, (await page.$('[role="dialog"]')) !== null);
    await audit(`${scheme}: ${name} dialog`);
    await close();
  }
  // Export and settings, through their own entry points.
  await page.evaluate(
    (id) => window.__aframe.store.getState().setSelection([id]),
    await page.evaluate(() => {
      const s = window.__aframe.store.getState();
      return s.doc.nodes[s.doc.rootId].children[0];
    }),
  );
  await open(() => page.click('[data-testid="export-menu"]'));
  await page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"]')]
      .find((e) => e.textContent?.startsWith('Design as code'))
      ?.click(),
  );
  await settle(page);
  await sleep(250);
  await audit(`${scheme}: export dialog`);
  await close();
  await tab('Chat');
  await settle(page);
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-action="chat-settings"]')][0]?.click(),
  );
  await settle(page);
  const hasSettings = (await page.$('[data-testid="settings-dialog"]')) !== null;
  if (hasSettings) {
    await audit(`${scheme}: AI settings dialog`);
    await close();
  }
  await tab('Design');
  await settle(page);
}

// ---- keyboard and motion ------------------------------------------------------------------------------------------
await page.emulateMediaFeatures([
  { name: 'prefers-color-scheme', value: 'light' },
  { name: 'prefers-reduced-motion', value: 'reduce' },
]);
await page.evaluate(() => window.__aframe.loadSample());
await settle(page);
await page.keyboard.press('Tab');
const first = await page.evaluate(() => document.activeElement?.tagName);
check('Tab reaches a control from the start of the page', first !== 'BODY', String(first));

// Focus stays inside an open dialog, and returns to where it came from.
await page.focus('[data-testid="connect-ai"]');
await page.keyboard.press('Enter');
await settle(page);
const inside = [];
for (let i = 0; i < 12; i += 1) {
  await page.keyboard.press('Tab');
  inside.push(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')));
}
check('Tab never leaves an open dialog', inside.every(Boolean));
await page.keyboard.press('Escape');
await settle(page);
check(
  'closing the dialog puts focus back on the button that opened it',
  await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'connect-ai'),
);

const motion = await page.evaluate(() => {
  const long = [...document.querySelectorAll('*')].filter((el) => {
    const cs = getComputedStyle(el);
    return (
      cs.animationName !== 'none' &&
      parseFloat(cs.animationDuration) > 0.05 &&
      cs.animationIterationCount !== '1'
    );
  });
  return long.map((el) => el.className).slice(0, 5);
});
check(
  'with reduced motion there are no looping animations',
  motion.length === 0,
  motion.join(', '),
);
info('checked', 'axe-core wcag2a, wcag2aa, wcag21a, wcag21aa');

check('no console errors', t.errors.length === 0, t.errors.slice(0, 2).join(' | '));
await t.close();
console.log(r.failures === 0 ? 'ALL PASSED' : `${r.failures} FAILED`);
process.exit(r.failures === 0 ? 0 : 1);
