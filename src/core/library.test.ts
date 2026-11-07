import { describe, expect, it } from 'vitest';
import {
  categorize,
  cleanName,
  describeEntry,
  searchLibrary,
  slugify,
  tagsOf,
  type LibraryEntry,
} from './library';

const entry = (name: string, extra: Partial<LibraryEntry> = {}): LibraryEntry => {
  const category = categorize(name);
  return {
    id: slugify(name),
    name,
    file: `${slugify(name)}.png`,
    category,
    tags: tagsOf(name, category),
    mime: 'image/png',
    width: 64,
    height: 32,
    bytes: 10,
    sha256: name,
    ...extra,
  };
};

describe('library names', () => {
  it('cleans file names: the upload prefix, the extension, copies and punctuation', () => {
    expect(cleanName('0d81e230-4024-40fc-bedd-4b5f85586509_Mask_group_13.png')).toBe(
      'Mask group 13',
    );
    expect(cleanName('Halftone (1).png')).toBe('Halftone');
    expect(cleanName('C:\\Users\\me\\Downloads\\assets\\halftone 7.png')).toBe('halftone 7');
    expect(cleanName('.png')).toBe('asset');
    expect(cleanName(`${'x'.repeat(200)}.png`).length).toBe(80);
  });

  it('makes safe slugs', () => {
    expect(slugify('Mask group 13')).toBe('mask-group-13');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
    expect(slugify('***')).toBe('asset');
    expect(slugify('A'.repeat(100)).length).toBe(60);
  });

  it('sorts the pack the way it is named', () => {
    const want: Record<string, string> = {
      halftone: 'halftone',
      'Halftone BoxStroke': 'halftone',
      haltone2: 'halftone',
      'Niki Dots': 'halftone',
      Stuxburst03: 'sunburst',
      'Terry SunBurst 1': 'sunburst',
      'kek speedlines 1': 'sunburst',
      'Filled Hexagon Patternsvg': 'hexagon',
      whiteglowingstar: 'star',
      'Random star effect': 'star',
      'kek gunshot 3': 'particle',
      'Particle Sunburst': 'sunburst',
      'OldPaper2-4': 'texture',
      StudTexture3: 'texture',
      checkerboard: 'texture',
      waves2: 'pattern',
      'Mask group 13': 'shape',
      'Brush 7': 'shape',
      '4ebc63fe3a551dcf6b2ac7aa50990ccc removebg preview1': 'other',
    };
    for (const [name, category] of Object.entries(want)) {
      expect(categorize(name), name).toBe(category);
    }
  });
});

describe('library search', () => {
  const entries = [
    entry('halftone'),
    entry('halftone corner piece'),
    entry('Stuxburst01'),
    entry('sunburst1'),
    entry('white glowing star'),
    entry('Mask group 13'),
  ];

  it('finds by name, tag and category, every word required, plainer names first', () => {
    expect(searchLibrary(entries, 'halftone').hits.map((e) => e.name)).toEqual([
      'halftone',
      'halftone corner piece',
    ]);
    expect(searchLibrary(entries, 'halftone corner').hits.map((e) => e.name)).toEqual([
      'halftone corner piece',
    ]);
    expect(searchLibrary(entries, 'sunburst').hits.map((e) => e.id)).toEqual([
      'sunburst1',
      'stuxburst01',
    ]);
    expect(searchLibrary(entries, 'star').hits[0]?.name).toBe('white glowing star');
    expect(searchLibrary(entries, 'halftone zebra').total).toBe(0);
  });

  it('lists a category, honours the limit and reports the total', () => {
    const all = searchLibrary(entries, undefined, { limit: 2 });
    expect(all.total).toBe(6);
    expect(all.hits).toHaveLength(2);
    expect(searchLibrary(entries, undefined, { category: 'sunburst' }).total).toBe(2);
  });

  it('describes an entry without its hash or file name', () => {
    expect(describeEntry(entry('halftone', { width: 100, height: 50 }))).toEqual({
      id: 'halftone',
      name: 'halftone',
      category: 'halftone',
      size: '100x50',
    });
    expect(describeEntry(entry('x', { width: null, height: null })).size).toBe('unknown');
  });
});
