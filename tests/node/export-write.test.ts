import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeUserFiles } from '../../mcp/export-write';
import {
  exportFilesProblem,
  exportPathProblem,
  exportRootProblem,
} from '../../src/core/export/paths';

// The system temp folder is under AppData (which exports refuse), so work inside the repository.
let dir: string;
beforeEach(async () => {
  await fs.mkdir(path.resolve('.shots'), { recursive: true });
  dir = await fs.mkdtemp(path.resolve('.shots', 'export-w-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'no error';
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

describe('exportPathProblem', () => {
  it.each([
    'index.html',
    'assets/hero-image.png',
    'src/design/Card.module.css',
    'My Card.tsx',
    'a_b-c.d.ts',
  ])('accepts %s', (p) => expect(exportPathProblem(p)).toBeNull());

  it.each([
    '',
    '../x',
    'a/../../x',
    '/etc/passwd',
    'C:/x',
    'a\\b',
    '.env',
    'a/.git/config',
    'a//b',
    'con.txt',
    'NUL',
    'aux.css',
    'a/b/c/d/e.txt',
    'trailing.',
    'trailing ',
    'x\0y',
    'a'.repeat(130),
    'name:stream',
    '~/x',
  ])('refuses %j', (p) => expect(exportPathProblem(p)).not.toBeNull());
});

describe('exportRootProblem', () => {
  it('refuses the filesystem root, a lone folder, system and credentials folders', () => {
    expect(exportRootProblem([])).not.toBeNull();
    expect(exportRootProblem(['Users'])).not.toBeNull();
    expect(exportRootProblem(['Windows', 'Temp'])).not.toBeNull();
    expect(exportRootProblem(['etc', 'app'])).not.toBeNull();
    expect(exportRootProblem(['Users', 'me', '.ssh'])).not.toBeNull();
    expect(exportRootProblem(['home', 'me', 'proj', '.git', 'hooks'])).not.toBeNull();
    expect(exportRootProblem(['Users', 'me', 'AppData', 'Local'])).not.toBeNull();
  });
  it('accepts ordinary project folders', () => {
    expect(exportRootProblem(['dev', 'app'])).toBeNull();
    expect(exportRootProblem(['Users', 'me', 'Documents', 'site', 'src'])).toBeNull();
    expect(exportRootProblem(['home', 'me', 'library-site'])).toBeNull();
  });
});

describe('exportFilesProblem', () => {
  it('checks names, counts, duplicates and sizes', () => {
    expect(exportFilesProblem({ 'a.txt': 'x' })).toBeNull();
    expect(exportFilesProblem({})).not.toBeNull();
    expect(exportFilesProblem({ '../a.txt': 'x' })).toMatch(/climbs/);
    expect(exportFilesProblem({ 'A.txt': 'x', 'a.txt': 'y' })).toMatch(/twice/);
    expect(
      exportFilesProblem(
        Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`f${i}.txt`, ''])),
      ),
    ).toMatch(/files/);
    expect(exportFilesProblem({ 'big.bin': new Uint8Array(26 * 1024 * 1024) })).toMatch(/large/);
  });
});

describe('writeUserFiles', () => {
  const home = path.resolve('.shots');

  it('writes text and bytes, creating folders', async () => {
    const r = await writeUserFiles(
      path.join(dir, 'out'),
      { 'a.txt': 'hello', 'assets/b.bin': Uint8Array.from([1, 2, 3]) },
      { home },
    );
    expect(r.written.sort()).toEqual(['a.txt', 'assets/b.bin']);
    expect(await fs.readFile(path.join(dir, 'out', 'a.txt'), 'utf8')).toBe('hello');
    expect([...(await fs.readFile(path.join(dir, 'out', 'assets', 'b.bin')))]).toEqual([1, 2, 3]);
    // No temp files are left behind.
    expect((await fs.readdir(path.join(dir, 'out'))).sort()).toEqual(['a.txt', 'assets']);
  });

  it('is quiet when the content is identical and stops on a difference', async () => {
    await writeUserFiles(dir, { 'a.txt': 'one', 'b.txt': 'two' }, { home });
    const same = await writeUserFiles(dir, { 'a.txt': 'one', 'b.txt': 'two' }, { home });
    expect(same.written).toEqual([]);
    expect(same.unchanged.sort()).toEqual(['a.txt', 'b.txt']);

    await fs.writeFile(path.join(dir, 'b.txt'), 'edited by hand');
    expect(await code(writeUserFiles(dir, { 'a.txt': 'NEW', 'b.txt': 'two' }, { home }))).toBe(
      'FILE_EXISTS',
    );
    // All or nothing: a.txt was not touched either.
    expect(await fs.readFile(path.join(dir, 'a.txt'), 'utf8')).toBe('one');
    expect(await fs.readFile(path.join(dir, 'b.txt'), 'utf8')).toBe('edited by hand');

    const forced = await writeUserFiles(
      dir,
      { 'a.txt': 'NEW', 'b.txt': 'two' },
      { home, overwrite: true },
    );
    expect(forced.written.sort()).toEqual(['a.txt', 'b.txt']);
    expect(await fs.readFile(path.join(dir, 'b.txt'), 'utf8')).toBe('two');
  });

  it('refuses relative folders, NUL bytes and folders that are files', async () => {
    expect(await code(writeUserFiles('out', { 'a.txt': 'x' }, { home }))).toBe('PATH_NOT_ALLOWED');
    expect(await code(writeUserFiles(`${dir}\0x`, { 'a.txt': 'x' }, { home }))).toBe(
      'PATH_NOT_ALLOWED',
    );
    await fs.writeFile(path.join(dir, 'file'), 'x');
    expect(await code(writeUserFiles(path.join(dir, 'file'), { 'a.txt': 'x' }, { home }))).toBe(
      'PATH_NOT_ALLOWED',
    );
  });

  it('refuses the home folder, the filesystem root and system folders', async () => {
    expect(await code(writeUserFiles(home, { 'a.txt': 'x' }, { home }))).toBe('PATH_NOT_ALLOWED');
    expect(await code(writeUserFiles(path.parse(dir).root, { 'a.txt': 'x' }, { home }))).toBe(
      'PATH_NOT_ALLOWED',
    );
    const system = process.platform === 'win32' ? 'C:\\Windows\\System32\\x' : '/etc/x';
    expect(await code(writeUserFiles(system, { 'a.txt': 'x' }, { home }))).toBe('PATH_NOT_ALLOWED');
  });

  it('refuses file names that escape, and writes nothing', async () => {
    for (const name of [
      '../escape.txt',
      'a/../../escape.txt',
      '/abs.txt',
      'C:/abs.txt',
      '.hidden',
    ]) {
      expect(await code(writeUserFiles(dir, { [name]: 'x' }, { home })), name).toBe(
        'PATH_NOT_ALLOWED',
      );
    }
    expect(await fs.readdir(dir)).toEqual([]);
    await expect(fs.access(path.join(path.dirname(dir), 'escape.txt'))).rejects.toBeTruthy();
  });

  it('never writes through a linked folder inside the export', async () => {
    const outside = await fs.mkdtemp(path.resolve('.shots', 'export-w-outside-'));
    try {
      try {
        await fs.symlink(outside, path.join(dir, 'assets'), 'junction');
      } catch {
        return; // links cannot be made here
      }
      expect(await code(writeUserFiles(dir, { 'assets/x.png': 'x' }, { home }))).toBe(
        'PATH_NOT_ALLOWED',
      );
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('never replaces a file that is a link', async () => {
    const outside = await fs.mkdtemp(path.resolve('.shots', 'export-w-outside-'));
    try {
      await fs.writeFile(path.join(outside, 'target.txt'), 'precious');
      try {
        await fs.symlink(path.join(outside, 'target.txt'), path.join(dir, 'file.txt'), 'file');
      } catch {
        return; // creating file links needs a privilege on Windows; the folder test above runs anyway
      }
      expect(
        await code(writeUserFiles(dir, { 'file.txt': 'over' }, { home, overwrite: true })),
      ).toBe('PATH_NOT_ALLOWED');
      expect(await fs.readFile(path.join(outside, 'target.txt'), 'utf8')).toBe('precious');
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('refuses a destination that is a link to a system folder', async () => {
    const link = path.join(dir, 'to-system');
    const target = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
    try {
      await fs.symlink(target, link, 'junction');
    } catch {
      return;
    }
    expect(await code(writeUserFiles(path.join(link, 'x'), { 'a.txt': 'x' }, { home }))).toBe(
      'PATH_NOT_ALLOWED',
    );
  });
});
