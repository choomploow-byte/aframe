// Killing the real desktop app in the middle of saving must never corrupt a project.
//
// Launches the built Atelier executable (Windows, WebView2) against a throwaway home folder, fills a
// project with a multi-megabyte image so each save takes real time, keeps editing so saves are always
// in flight, then terminates the process abruptly (TerminateProcess, no chance to clean up) at
// random moments. After every kill the project file and its backup must be complete documents,
// and the next launch must open the project and save again (a lock left by the dead process has to
// expire, not wedge the app).
//
// Build the exe first:   $env:VITE_DEVTOOLS='1'; npm run tauri:build -- --debug --no-bundle
// Run:                   node tests/e2e/tauri-kill.mjs        (KILLS=8 for more rounds)
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';
import { reporter } from './harness.mjs';

if (process.platform !== 'win32') {
  console.log('SKIP  this test drives the Windows (WebView2) build');
  process.exit(0);
}
const EXE = process.env.ATELIER_EXE ?? 'src-tauri/target/debug/atelier.exe';
if (!existsSync(EXE)) {
  console.error(`No executable at ${EXE}. Build it first (see the header of this file).`);
  process.exit(2);
}
const ROUNDS = Number(process.env.KILLS ?? 6);
const home = mkdtempSync(join(tmpdir(), 'atelier-kill-'));
const r = reporter();
const { check, info } = r;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

let child = null;
const killTree = () => {
  if (!child?.pid) return;
  try {
    execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
  } catch {
    /* already gone */
  }
  child = null;
};

const webviewProcesses = () => {
  try {
    const out = execFileSync(
      'tasklist',
      ['/FI', 'IMAGENAME eq msedgewebview2.exe', '/FO', 'CSV', '/NH'],
      { encoding: 'utf8' },
    );
    return out.split(String.fromCharCode(10)).filter((l) => l.includes('msedgewebview2')).length;
  } catch {
    return -1;
  }
};

async function launch(basePort) {
  // Right after a kill the dead process's single-instance handle (or its WebView2 browser) can
  // linger for a moment and make a new launch exit at once or ignore the debug port: try again.
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = basePort + attempt * 100;
    let exited = false;
    const lingering = webviewProcesses();
    if (lingering > 0) info('WebView2 processes still alive before launch', String(lingering));
    child = spawn(EXE, [], {
      env: {
        ...process.env,
        ATELIER_HOME: home,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      },
      stdio: 'ignore',
    });
    const launchedAt = Date.now();
    child.once('exit', () => (exited = true));
    const deadline = Date.now() + 25_000;
    while (!exited && Date.now() < deadline) {
      try {
        const browser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${port}`,
          defaultViewport: null,
        });
        const page = (await browser.pages()).find((p) => !p.url().startsWith('devtools'));
        if (page) {
          info('debug port answered', `${Date.now() - launchedAt} ms (attempt ${attempt + 1})`);
          await page.waitForFunction(() => window.__atelier?.sync?.()?.attached === true, {
            timeout: 30_000,
          });
          return { browser, page };
        }
      } catch {
        /* not up yet */
      }
      await sleep(300);
    }
    killTree();
    await sleep(1500);
  }
  throw new Error('the app did not start');
}

function projectFiles() {
  const projects = join(home, 'projects');
  const id = readdirSync(projects).find((n) => /^p_/.test(n));
  if (!id) return null;
  return { id, dir: join(projects, id), file: join(projects, id, 'project.atelier.json') };
}
const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

function noisePngDataUrl(size) {
  const png = new PNG({ width: size, height: size });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = Math.random() * 256;
    png.data[i + 1] = Math.random() * 256;
    png.data[i + 2] = Math.random() * 256;
    png.data[i + 3] = 255;
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}

let lastRev = 0;
try {
  for (let round = 0; round < ROUNDS; round++) {
    console.log(`\n# round ${round + 1} of ${ROUNDS}`);
    const t0 = Date.now();
    const { browser, page } = await launch(9300 + round);
    info('start-up to a saved project', `${Date.now() - t0} ms`);
    check('no recovery dialog after the previous kill', !(await page.$('.dialog')));

    if (round === 0) {
      // A project big enough that a save takes real time.
      const image = noisePngDataUrl(1400);
      info('embedded image', `${(image.length / 1024 / 1024).toFixed(1)} MB as a data URL`);
      await page.evaluate((url) => {
        const s = window.__atelier.store.getState();
        const ops = [
          {
            op: 'create',
            parentId: s.doc.rootId,
            node: {
              type: 'frame',
              tempId: 'f',
              name: 'Board',
              x: 0,
              y: 0,
              w: 800,
              h: 600,
              fill: '#ffffff',
            },
          },
          ...Array.from({ length: 60 }, (_, i) => ({
            op: 'create',
            parentId: '$f',
            node: {
              type: 'rect',
              name: `Box ${i}`,
              x: (i % 10) * 70,
              y: Math.floor(i / 10) * 70,
              w: 60,
              h: 60,
              fill: '#C96442',
            },
          })),
        ];
        s.dispatch(ops, { label: 'Fill' });
        const id = `a_${Math.random().toString(36).slice(2, 8)}`;
        s.edit((doc) => ({ ...doc, assets: { ...doc.assets, [id]: url } }), 'Add image');
      }, image);
      await page.waitForFunction(
        () => window.__atelier.sync().status.getState().state === 'saved',
        { timeout: 30_000 },
      );
    }

    // Keep a save almost always in flight: edit, then save right away, over and over.
    await page.evaluate(() => {
      const ids = Object.values(window.__atelier.store.getState().doc.nodes)
        .filter((n) => n.name?.startsWith('Box'))
        .map((n) => n.id);
      window.__running = true;
      void (async () => {
        let tick = 0;
        while (window.__running) {
          tick += 1;
          const id = ids[tick % ids.length];
          if (id) {
            window.__atelier.store
              .getState()
              .dispatch([{ op: 'update', id, set: { x: tick % 400 } }], { label: 'Edit' });
          }
          await window.__atelier.sync().flush();
          await new Promise((r) => setTimeout(r, 15));
        }
      })();
    });
    await sleep(900 + Math.random() * 1400); // the kill lands at a different moment each round
    const before = readJson(projectFiles().file);
    killTree();
    await browser.disconnect().catch(() => undefined);
    await sleep(700);

    const files = projectFiles();
    const main = readJson(files.file);
    const bak = readJson(`${files.file}.bak`);
    check(
      'the project file is a complete document',
      main !== null && typeof main.rev === 'number' && !!main.nodes,
      'unreadable',
    );
    check(
      'its revision never went backwards',
      main !== null && main.rev >= lastRev,
      `${lastRev} → ${main?.rev}`,
    );
    check('the backup is a complete document too', bak !== null && typeof bak.rev === 'number');
    // (equal is a real crash state: killed after the backup was written, before the file was replaced)
    check(
      'and never newer than the project file',
      bak !== null && main !== null && bak.rev <= main.rev,
      `${bak?.rev}/${main?.rev}`,
    );
    check(
      'the image survived intact',
      main !== null &&
        Object.values(main.assets ?? {}).some((v) => typeof v === 'string' && v.length > 1_000_000),
    );
    const leftovers = readdirSync(files.dir).filter((n) => n.endsWith('.tmp') || n === '.lock');
    info('files left by the killed process', leftovers.length ? leftovers.join(', ') : 'none');
    if (main) lastRev = main.rev;
    if (before) info('revision when killed', `${before.rev} (on disk after: ${main?.rev})`);
  }

  // One more start, with a fresh lock file as a killed process leaves it: everything is there, and
  // saving works again as soon as the lock is old enough to be taken over.
  writeFileSync(join(projectFiles().dir, '.lock'), '{"pid":424242}');
  const { browser, page } = await launch(9399);
  const opened = await page.evaluate(() => {
    const s = window.__atelier.store.getState();
    return { nodes: Object.keys(s.doc.nodes).length, assets: Object.keys(s.doc.assets).length };
  });
  check(
    'after all the kills the project opens with its content',
    opened.nodes > 60 && opened.assets === 1,
    JSON.stringify(opened),
  );
  const t1 = Date.now();
  await page.evaluate(() => {
    const s = window.__atelier.store.getState();
    s.dispatch(
      [
        {
          op: 'update',
          id: Object.values(s.doc.nodes).find((n) => n.name === 'Board').id,
          set: { name: 'Board (final)' },
        },
      ],
      { label: 'Rename' },
    );
  });
  await page.waitForFunction(() => window.__atelier.sync().status.getState().state === 'saved', {
    timeout: 20_000,
  });
  const savedIn = Date.now() - t1;
  info('a save while a dead process’s lock is still fresh', `${savedIn} ms`);
  check(
    'saving resumes within 10 s of a crash (the lock expires after 5 s)',
    savedIn < 10_000,
    `${savedIn} ms`,
  );
  const finalDoc = readJson(projectFiles().file);
  check(
    'and it reaches the file',
    Object.values(finalDoc.nodes).some((n) => n.name === 'Board (final)'),
  );
  await browser.disconnect();
} finally {
  killTree();
  await sleep(500);
  rmSync(home, { recursive: true, force: true });
}
console.log(
  r.failures === 0 ? '\nAll kill checks passed.' : `\n${r.failures} kill check(s) failed.`,
);
process.exit(r.failures === 0 ? 0 : 1);
