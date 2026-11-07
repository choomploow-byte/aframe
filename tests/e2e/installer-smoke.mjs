// The Windows installer installs, the installed app launches and boots, and the uninstaller removes it.
//
// Build the installer first:  npm run tauri:build -- --bundles nsis
// Run:                        node tests/e2e/installer-smoke.mjs
//
// Installs silently into a throwaway folder (per-user, no admin), starts the installed
// executable against a throwaway ATELIER_HOME, checks the window and the product metadata, then
// runs the uninstaller. Windows only.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { reporter } from './harness.mjs';

if (process.platform !== 'win32') {
  console.log('SKIP  the NSIS installer test runs on Windows');
  process.exit(0);
}
const bundleDir = 'src-tauri/target/release/bundle/nsis';
const setup = existsSync(bundleDir)
  ? readdirSync(bundleDir).find((n) => n.endsWith('-setup.exe'))
  : undefined;
if (!setup) {
  console.error(`No installer in ${bundleDir}. Run: npm run tauri:build -- --bundles nsis`);
  process.exit(2);
}
const r = reporter();
const { check, info } = r;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const work = mkdtempSync(join(tmpdir(), 'atelier-install-'));
const installDir = join(work, 'app');
const home = join(work, 'home');
const ps = (command) =>
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
  }).trim();

let app = null;
const killApp = () => {
  if (!app?.pid) return;
  try {
    execFileSync('taskkill', ['/F', '/T', '/PID', String(app.pid)], { stdio: 'ignore' });
  } catch {
    /* gone */
  }
  app = null;
};

try {
  console.log(`\n# install ${setup}`);
  const installer = resolve(bundleDir, setup);
  info('installer size', `${(readFileSize(installer) / 1024 / 1024).toFixed(2)} MB`);
  // NSIS: /S silent, /D=<dir> must be the last argument and unquoted.
  execFileSync(installer, ['/S', `/D=${installDir}`], {
    stdio: 'ignore',
    windowsVerbatimArguments: true,
  });
  const exe = join(installDir, 'atelier.exe');
  for (let i = 0; i < 40 && !existsSync(join(installDir, 'uninstall.exe')); i++) await sleep(250);
  check('the program was installed', existsSync(exe), exe);
  check('with an uninstaller', existsSync(join(installDir, 'uninstall.exe')));

  const meta = JSON.parse(
    ps(
      `$v=(Get-Item '${exe}').VersionInfo; @{name=$v.ProductName; version=$v.ProductVersion; desc=$v.FileDescription} | ConvertTo-Json -Compress`,
    ),
  );
  check('the product name is Atelier', meta.name === 'Atelier', JSON.stringify(meta));
  check('the version is 0.1.0', String(meta.version).startsWith('0.1.0'), JSON.stringify(meta));
  const icon = ps(
    `Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Icon]::ExtractAssociatedIcon('${exe}'); "$($i.Width)x$($i.Height)"`,
  );
  check('the executable carries an icon', /^\d+x\d+$/.test(icon), icon);

  console.log('\n# launch the installed app');
  app = spawn(exe, [], {
    env: {
      ...process.env,
      ATELIER_HOME: home,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9411',
    },
    stdio: 'ignore',
  });
  let page = null;
  let browser = null;
  for (let i = 0; i < 100 && !page; i++) {
    try {
      browser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:9411',
        defaultViewport: null,
      });
      page = (await browser.pages()).find((p) => !p.url().startsWith('devtools')) ?? null;
    } catch {
      await sleep(300);
    }
  }
  check('the window opened', page !== null);
  if (page) {
    await page.waitForSelector('.shell', { timeout: 20_000 });
    check('the window is titled Atelier', (await page.title()) === 'Atelier', await page.title());
    await page
      .waitForSelector('[data-testid="save-status"]', { timeout: 20_000 })
      .catch(() => undefined);
    const state = await page
      .$eval('[data-testid="save-status"]', (e) => e.dataset.state)
      .catch(() => null);
    check('it opened a project and shows it is saved', state === 'saved', String(state));
    check(
      'the first project was created in the home folder',
      existsSync(join(home, 'projects')) && readdirSync(join(home, 'projects')).length === 1,
    );
    check('and the heartbeat file is there for agents', existsSync(join(home, 'app-state.json')));
    const csp = await page.evaluate(
      () => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? null,
    );
    info('CSP in the page', csp === null ? 'set by the shell (no meta tag)' : csp.slice(0, 60));
    const theme = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(
      'styles loaded (the page has a themed background)',
      /^rgb/.test(theme) && theme !== 'rgba(0, 0, 0, 0)',
      theme,
    );
    await browser?.disconnect();
  }
  killApp();
  await sleep(1000);

  console.log('\n# uninstall');
  execFileSync(join(installDir, 'uninstall.exe'), ['/S', `_?=${installDir}`], {
    stdio: 'ignore',
    windowsVerbatimArguments: true,
  });
  for (let i = 0; i < 40 && existsSync(exe); i++) await sleep(250);
  check('the uninstaller removed the program', !existsSync(exe));
  check('and left the user’s projects alone', existsSync(join(home, 'projects')));
} finally {
  killApp();
  await sleep(500);
  rmSync(work, { recursive: true, force: true });
}
console.log(
  r.failures === 0
    ? '\nAll installer checks passed.'
    : `\n${r.failures} installer check(s) failed.`,
);
process.exit(r.failures === 0 ? 0 : 1);

function readFileSize(path) {
  return Number(ps(`(Get-Item '${path}').Length`));
}
