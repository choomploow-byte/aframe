import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsError } from '../../src/platform/fs-types';
import { acquireLock, HomeFs, parseRev, sweepTempFiles } from '../../mcp/home-fs';

const P = 'projects/p_test1/project.atelier.json';
const doc = (rev: number, marker = 'm'): string =>
  JSON.stringify({ schema: 1, rev, id: 'p_test1', marker });

let dir: string;
let home: HomeFs;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atelier-node-'));
  home = new HomeFs(path.join(dir, 'home'), { lockStaleMs: 300, lockWaitMs: 1500 });
  await home.ensure();
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('confinement', () => {
  it('accepts nested relative paths', () => {
    expect(() => home.confine('projects/p_abc12/project.atelier.json')).not.toThrow();
    expect(() => home.confine('./a/./b.txt')).not.toThrow();
    expect(() => home.confine('')).not.toThrow();
  });

  it('rejects traversal, absolute paths, colons and NUL', () => {
    const bad = [
      '../x',
      'a/../../x',
      '..',
      'a\\..\\..\\x',
      '/etc/passwd',
      '\\windows\\system32',
      'C:\\Windows\\win.ini',
      'a.json:stream',
      'a\0b',
    ];
    for (const p of bad) expect(() => home.confine(p), p).toThrow(FsError);
  });

  it('refuses the home itself as a write or delete target', async () => {
    for (const p of ['', '.', './', 'a/..']) {
      await expect(home.remove(p), JSON.stringify(p)).rejects.toThrow(FsError);
      await expect(home.write(p, 'x'), JSON.stringify(p)).rejects.toThrow(FsError);
    }
    await expect(fs.stat(home.root)).resolves.toBeTruthy();
  });

  it('refuses a symlink that leads outside (skipped where symlinks are not allowed)', async () => {
    const outside = path.join(dir, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'secret.txt'), 'x');
    try {
      await fs.symlink(outside, path.join(home.root, 'link'), 'junction');
    } catch {
      return; // cannot create links here
    }
    expect(() => home.confine('link')).toThrow(FsError);
    expect(() => home.confine('link/secret.txt')).toThrow(FsError);
    await expect(home.read('link/secret.txt')).rejects.toThrow(FsError);
    await expect(home.write('link/new.txt', 'x')).rejects.toThrow(FsError);
  });
});

describe('basic operations', () => {
  it('round-trips write, read, head, stat, list, remove', async () => {
    expect(await home.read('a/b.txt')).toBeNull();
    const st = await home.write('a/b.txt', 'hello');
    expect(st.size).toBe(5);
    expect(await home.read('a/b.txt')).toBe('hello');
    expect((await home.stat('a/b.txt'))?.size).toBe(5);
    expect((await home.list('a')).map((e) => e.name)).toEqual(['b.txt']);
    expect(await home.list('missing')).toEqual([]);
    await home.write('big.txt', 'y'.repeat(50_000));
    expect((await home.readHead('big.txt', 100))?.length).toBe(100);
    await home.remove('a/b.txt');
    expect(await home.read('a/b.txt')).toBeNull();
    await home.remove('a/b.txt'); // nothing to remove is fine
  });

  it('leaves no temp files behind', async () => {
    await home.write('a.txt', '1');
    await home.write('a.txt', '22');
    expect((await home.list('')).map((e) => e.name)).toEqual(['a.txt']);
  });

  it('parseRev only trusts a numeric rev', () => {
    expect(parseRev('{"rev":3}')).toBe(3);
    expect(parseRev('{"rev":"3"}')).toBeNull();
    expect(parseRev('{"rev":-1}')).toBeNull();
    expect(parseRev('{"sche')).toBeNull();
    expect(parseRev('null')).toBeNull();
  });
});

describe('project document writes', () => {
  it('keeps the previous version as .bak, one deep', async () => {
    expect((await home.writeDoc(P, doc(1, 'one'))).ok).toBe(true);
    expect(await home.read(`${P}.bak`)).toBeNull();
    await home.writeDoc(P, doc(2, 'two'), 1);
    await home.writeDoc(P, doc(3, 'three'), 2);
    expect(await home.read(P)).toContain('three');
    expect(await home.read(`${P}.bak`)).toContain('two');
  });

  it('refuses when the file moved on, and tells the caller where it is', async () => {
    await home.writeDoc(P, doc(1));
    await home.writeDoc(P, doc(2, 'agent'), 1);
    const mine = await home.writeDoc(P, doc(2, 'app'), 1);
    expect(mine).toMatchObject({ ok: false, conflict: true, diskRev: 2 });
    expect(await home.read(P)).toContain('agent');
  });

  it('never lets a corrupt file replace a good backup', async () => {
    await home.writeDoc(P, doc(1, 'good'));
    await home.writeDoc(P, doc(2, 'better'), 1);
    await fs.writeFile(home.confine(P), '{"sche'); // truncated by something else
    await home.writeDoc(P, doc(3, 'mine'));
    expect(await home.read(`${P}.bak`)).toContain('good');
  });

  it.each(['during-tmp', 'after-tmp', 'after-backup'] as const)(
    'a crash %s leaves the old, complete document and does not block the next save',
    async (crash) => {
      await home.writeDoc(P, doc(1, 'before'));
      await expect(home.writeDoc(P, doc(2, 'after'), 1, crash)).rejects.toThrow('simulated');
      const text = await home.read(P);
      expect(parseRev(text ?? '')).toBe(1);
      expect(text).toContain('before');
      expect((await home.writeDoc(P, doc(2, 'retry'), 1)).ok).toBe(true);
      expect(await home.read(P)).toContain('retry');
    },
  );

  it('sweeps temp files left by crashed writes', async () => {
    await home.writeDoc(P, doc(1));
    await expect(home.writeDoc(P, doc(2), 1, 'after-tmp')).rejects.toThrow();
    const folder = path.dirname(home.confine(P));
    const tmpFiles = () => fs.readdir(folder).then((n) => n.filter((x) => x.endsWith('.tmp')));
    expect(await tmpFiles()).toHaveLength(1);
    expect(await sweepTempFiles(home.root, 0)).toBe(1);
    expect(await tmpFiles()).toHaveLength(0);
  });

  it('serialises many concurrent in-process writers: every update lands once, in order', async () => {
    await home.writeDoc(P, doc(1, 'start'));
    const worker = async (n: number): Promise<void> => {
      let applied = 0;
      while (applied < 10) {
        const text = (await home.read(P)) ?? '';
        const rev = parseRev(text);
        if (rev === null) throw new Error('read a half-written or corrupt document');
        const r = await home.writeDoc(P, doc(rev + 1, `w${n}`), rev);
        if (r.ok) applied += 1;
      }
    };
    await Promise.all([worker(1), worker(2), worker(3), worker(4)]);
    expect(parseRev((await home.read(P)) ?? '')).toBe(41);
  });
});

describe('locks', () => {
  it('is exclusive, released on request, and a stale one is taken over', async () => {
    const lock = path.join(home.root, 'x.lock');
    const release = await acquireLock(lock, { waitMs: 60, staleMs: 60_000 });
    await expect(acquireLock(lock, { waitMs: 60, staleMs: 60_000 })).rejects.toMatchObject({
      code: 'LOCKED',
    });
    await release();
    const again = await acquireLock(lock, { waitMs: 60 });
    await again();

    await fs.writeFile(lock, '{"pid":1}'); // left behind by a crashed process
    await new Promise((r) => setTimeout(r, 40));
    const stolen = await acquireLock(lock, { waitMs: 500, staleMs: 20 });
    await stolen();
  });
});

describe('real processes', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const writer = path.join(here, 'helpers', 'writer.ts');
  const children: ChildProcess[] = [];

  const run = (homeDir: string, mode: string, count?: number): ChildProcess => {
    const args = ['--import', 'tsx', writer, homeDir, P, mode];
    if (count !== undefined) args.push(String(count));
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    children.push(child);
    return child;
  };
  const exited = (c: ChildProcess): Promise<number | null> =>
    new Promise((resolve) => c.once('exit', (code) => resolve(code)));

  afterEach(() => {
    for (const c of children.splice(0)) c.kill();
  });

  it('four separate processes incrementing one project never lose or corrupt an update', async () => {
    const live = new HomeFs(home.root);
    await live.writeDoc(P, doc(1));
    const procs = [1, 2, 3, 4].map(() => run(home.root, 'count', 12));
    const codes = await Promise.all(procs.map(exited));
    expect(codes).toEqual([0, 0, 0, 0]);
    expect(parseRev((await live.read(P)) ?? '')).toBe(1 + 4 * 12);
  }, 120_000);

  it('hard-killing a writer mid-save never corrupts the project (6 kills)', async () => {
    const live = new HomeFs(home.root, { lockStaleMs: 600, lockWaitMs: 8000 });
    await live.writeDoc(P, doc(1));
    let lastRev = 1;
    for (let i = 0; i < 6; i++) {
      const child = run(home.root, 'forever');
      await new Promise((r) => setTimeout(r, 400 + i * 90)); // kills land at different moments
      child.kill('SIGKILL');
      await exited(child);

      const text = await live.read(P);
      const rev = parseRev(text ?? '');
      expect(
        rev,
        `after kill ${i + 1}: the project file must be a complete document`,
      ).not.toBeNull();
      expect(rev as number).toBeGreaterThanOrEqual(lastRev);
      lastRev = rev as number;
      const bak = await live.read(`${P}.bak`);
      if (bak !== null) expect(parseRev(bak), 'the backup is complete too').not.toBeNull();
    }
    // A save after the carnage works (a lock left by a killed process expires and is taken over).
    const text = (await live.read(P)) ?? '';
    const final = await live.writeDoc(P, doc((parseRev(text) ?? 0) + 1, 'after'), parseRev(text));
    expect(final.ok).toBe(true);
    expect(await sweepTempFiles(home.root, 0)).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
