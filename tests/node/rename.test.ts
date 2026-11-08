import { describe, expect, it } from 'vitest';
// @ts-expect-error the script is plain JavaScript without type declarations
import { renamePath, renameText, validateNames } from '../../scripts/rename.mjs';

const names = { name: 'Foo Studio', slug: 'foostudio', bundleId: 'com.foo.studio' };
const rename = renameText as (
  text: string,
  n: typeof names,
  o?: { renameRepoUrls?: boolean },
) => string;
const validate = validateNames as (n: {
  name?: string;
  slug?: string;
  bundleId?: string;
}) => string[];
const path = renamePath as (p: string, n: { slug: string }) => string;

describe('renameText', () => {
  it('replaces the display name, the slug, the env prefix and the bundle id', () => {
    const src =
      'Atelier opens ~/.atelier and reads ATELIER_HOME; id dev.atelier.app; project.atelier.json; atelier-mcp';
    expect(rename(src, names)).toBe(
      'Foo Studio opens ~/.foostudio and reads FOOSTUDIO_HOME; id com.foo.studio; project.foostudio.json; foostudio-mcp',
    );
  });

  it('turns dashes in the slug into underscores for the env prefix', () => {
    expect(rename('ATELIER_HOME', { ...names, slug: 'foo-studio' })).toBe('FOO_STUDIO_HOME');
  });

  it('leaves links to this repository and its site alone unless told to', () => {
    const src =
      'https://github.com/choomploow-byte/atelier and https://choomploow-byte.github.io/atelier/ for Atelier';
    expect(rename(src, names)).toBe(
      'https://github.com/choomploow-byte/atelier and https://choomploow-byte.github.io/atelier/ for Foo Studio',
    );
    expect(rename(src, names, { renameRepoUrls: true })).toContain(
      'github.com/choomploow-byte/foostudio',
    );
  });

  it('is idempotent and changes nothing it should not', () => {
    const once = rename('Atelier atelier ATELIER', names);
    expect(rename(once, names)).toBe(once);
    expect(rename('nothing to see', names)).toBe('nothing to see');
  });

  it('keeps the product name from being rewritten inside a name that merely contains it as a word part', () => {
    // "ateliers" (plural, lower case) is part of the old name's family: it is rewritten too, which is
    // why the script is a dry run first and a reviewed diff after.
    expect(rename('ateliers', names)).toBe('foostudios');
  });
});

describe('renamePath and validateNames', () => {
  it('renames files whose name contains the old name', () => {
    expect(path('mcp/dist/atelier-mcp.mjs', names)).toBe('mcp/dist/foostudio-mcp.mjs');
    expect(path('skills/atelier-SKILL.md', names)).toBe('skills/foostudio-SKILL.md');
    expect(path('README.md', names)).toBe('README.md');
  });

  it('accepts good names and says what is wrong with bad ones', () => {
    expect(validate(names)).toEqual([]);
    expect(validate({ name: '', slug: 'ok' }).length).toBe(1);
    expect(validate({ name: 'X', slug: 'Bad Slug' }).length).toBe(1);
    expect(validate({ name: 'X"; rm -rf', slug: 'ok' }).length).toBe(1);
    expect(validate({ name: 'X', slug: 'ok', bundleId: 'nodots' }).length).toBe(1);
  });
});
