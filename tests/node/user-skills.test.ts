import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allSkills, readUserSkills } from '../../mcp/user-skills';
import { MAX_SKILL_BYTES } from '../../src/core/skills';

let home: string;
const skill = (name: string): string =>
  `---\nname: ${name}\ndescription: about ${name}\n---\nbody of ${name}`;
const put = (file: string, text: string): void => {
  fs.mkdirSync(path.join(home, 'skills'), { recursive: true });
  fs.writeFileSync(path.join(home, 'skills', file), text);
};

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-skills-'));
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

describe('readUserSkills', () => {
  it('finds nothing when there is no folder', () => {
    expect(readUserSkills(home)).toEqual([]);
  });

  it('reads valid skills and ignores everything else', () => {
    put('mine.md', skill('mine'));
    put('README.md', skill('readme'));
    put('notes.txt', skill('notes'));
    put('no-description.md', '# nothing');
    put('Bad Name.md', skill('Bad Name'));
    put('huge.md', skill('huge') + 'x'.repeat(MAX_SKILL_BYTES));
    fs.mkdirSync(path.join(home, 'skills', 'folder.md'));
    const found = readUserSkills(home);
    expect(found.map((s) => s.name)).toEqual(['mine']);
    expect(found[0]?.source).toBe('user');
  });

  it('does not follow links', () => {
    const outside = path.join(home, 'outside.md');
    fs.writeFileSync(outside, skill('sneaky'));
    fs.mkdirSync(path.join(home, 'skills'), { recursive: true });
    try {
      fs.symlinkSync(outside, path.join(home, 'skills', 'sneaky.md'), 'file');
    } catch {
      return; // no permission to make file links here
    }
    expect(readUserSkills(home)).toEqual([]);
  });

  it("puts the person's skill over a shipped one with the same name", () => {
    put('typography.md', skill('typography'));
    const merged = allSkills(home, [
      { name: 'typography', description: 'shipped', body: 'shipped body', source: 'shipped' },
      { name: 'color', description: 'shipped', body: 'c', source: 'shipped' },
    ]);
    expect(merged.map((s) => `${s.name}:${s.source}`)).toEqual([
      'color:shipped',
      'typography:user',
    ]);
  });
});
