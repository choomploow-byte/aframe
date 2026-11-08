import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { zipStore } from '../../src/core/export/zip';

const entries = [
  { path: 'index.html', content: '<p>héllo</p>' },
  { path: 'assets/a.bin', content: Uint8Array.from([0, 1, 2, 255]) },
  { path: 'empty.txt', content: '' },
];

describe('zipStore with a real unzip tool', () => {
  it('is accepted by a real unzip tool', () => {
    fs.mkdirSync(path.resolve('.shots'), { recursive: true });
    const dir = fs.mkdtempSync(path.resolve('.shots', 'zip-'));
    try {
      const file = path.join(dir, 'x.zip');
      fs.writeFileSync(file, zipStore(entries));
      // Python is a dependency of the repository's other checks; skip quietly where it is missing.
      let python = 'python';
      try {
        execFileSync(python, ['--version'], { stdio: 'ignore' });
      } catch {
        python = 'python3';
        try {
          execFileSync(python, ['--version'], { stdio: 'ignore' });
        } catch {
          return;
        }
      }
      const out = execFileSync(
        python,
        [
          '-c',
          'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(",".join(z.namelist()))',
          file,
        ],
        { encoding: 'utf8' },
      );
      expect(out.trim()).toBe('index.html,assets/a.bin,empty.txt');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
