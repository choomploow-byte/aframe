import { describe, expect, it } from 'vitest';
import {
  categorize,
  cleanName,
  describeEntry,
  libraryFacets,
  packOf,
  searchLibrary,
  slugify,
  svgSize,
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

describe('game UI pack names', () => {
  it('turns PascalCase names into words and fixes typos in the pack', () => {
    expect(cleanName('IconButton_Large_Blue_Circle.png')).toBe('Icon Button Large Blue Circle');
    expect(cleanName('ButtonText_Geen_OnOffButton.png')).toBe('Button Text Green On Off Button');
    expect(cleanName('ButtonText_Small_ROund.png')).toBe('Button Text Small Round');
    expect(cleanName('WideSLider_Green_Scroller.png')).toBe('Wide Slider Green Scroller');
    expect(cleanName('SlimSlider_Green_Scoller.svg')).toBe('Slim Slider Green Scroller');
    expect(cleanName('Banner_WhiteOutine.png')).toBe('Banner White Outline');
    expect(cleanName('Icon_Large_StarSrey_SeethroughOutline.png')).toBe(
      'Icon Large Star Grey Seethrough Outline',
    );
    expect(cleanName('Golden Heart 1st Outline 256px.png')).toBe('Golden Heart 1st Outline');
    expect(cleanName('Egg 64px.png')).toBe('Egg');
  });

  it('reads pack, group and sub-group from the folders', () => {
    expect(packOf(['newassets', 'Basic_GUI_Bundle', 'BoxesBanners'])).toEqual({
      pack: 'Basic GUI',
      group: 'Boxes Banners',
    });
    expect(packOf(['newassets', 'Free Icon Pack v3.1 (Basic)', 'Main', 'Heart'])).toEqual({
      pack: 'Free Icon Pack',
      group: 'Main',
      sub: 'Heart',
    });
    expect(packOf(['Eggs Icon Pack v2 (Basic)', 'Dragon Egg'])).toEqual({
      pack: 'Eggs',
      group: 'Dragon Egg',
    });
    expect(packOf(['x', 'Events Icon Pack v3 (Basic)', "Valentine's Day"])).toEqual({
      pack: 'Events',
      group: "Valentine's Day",
    });
    expect(packOf(['Currency_Icons_512_PNG', 'GoldCoins']).pack).toBe('Currency');
    expect(packOf(['FREE_Icons']).pack).toBe('Free Icons');
    // a folder we do not know: two folders are pack and group, one is a group, none is nothing
    expect(packOf(['assets', 'Kenney', 'Panels'])).toEqual({ pack: 'Kenney', group: 'Panels' });
    expect(packOf(['assets', 'nested'])).toEqual({ group: 'nested' });
    expect(packOf(['assets'])).toEqual({});
  });

  it('sorts game UI parts by their folder first and their name second', () => {
    const want: [string, string, string, string][] = [
      ['Box Blue Rounded', 'Basic GUI', 'Boxes Banners', 'panel'],
      ['Banner Blue', 'Basic GUI', 'Boxes Banners', 'banner'],
      ['Text Box Middle', 'Basic GUI', 'Boxes Banners', 'panel'],
      ['Button Text Large Blue Round', 'Basic GUI', 'Buttons Text', 'button'],
      ['Icon Button Small Red Circle', 'Basic GUI', 'Buttons Icons', 'button'],
      ['Icon Small Coin', 'Basic GUI', 'Icons', 'icon'],
      ['Slim Slider Frame', 'Basic GUI', 'Sliders', 'slider'],
      ['Golden Coin 1st', 'Free Icon Pack', 'Currency', 'currency'],
      ['Axe 1st', 'Free Icon Pack', 'Item', 'item'],
      ['Heart 1st', 'Free Icon Pack', 'Main', 'icon'],
      ['Close Button', 'Free Icon Pack', 'UI', 'ui'],
      ['Skull', 'Free Icon Pack', 'Player', 'character'],
      ['Apple', 'Free Icon Pack', 'Nature', 'nature'],
      ['Cat', 'Free Icon Pack', 'Animal', 'animal'],
      ['Pizza', 'Free Icon Pack', 'Food', 'food'],
      ['Discord', 'Free Icon Pack', 'Social', 'social'],
      ['Dragon Egg', 'Eggs', 'Dragon Egg', 'egg'],
      ['Candycane', 'Events', 'Christmas', 'event'],
      ['Bag Brown Gold Coins', 'Currency', 'Gold Coins', 'currency'],
      ['Blue Panel', 'Free Icons', '', 'panel'],
      ['Coins Bronze', 'Free Icons', '', 'currency'],
      ['Star Bronze', 'Free Icons', '', 'icon'],
      ['Hourglass', 'Free Icons', '', 'icon'],
    ];
    for (const [name, pack, group, category] of want) {
      expect(categorize(name, { pack, group: group || undefined }), name).toBe(category);
    }
    // a texture in an unknown folder still goes by its name
    expect(categorize('halftone', { pack: 'Mine', group: 'Stuff' })).toBe('halftone');
  });

  it('tags carry colours, folder words and synonyms', () => {
    const tags = tagsOf('Golden Heart 1st Outline', 'icon', ['Free Icon Pack', 'Main', 'Heart']);
    expect(tags).toEqual(
      expect.arrayContaining(['golden', 'gold', 'heart', 'outline', 'main', 'free']),
    );
    expect(tags).not.toContain('1'); // bare numbers are noise
    expect(tags.length).toBeLessThanOrEqual(18);
    expect(tagsOf('Close', 'ui', ['X'])).toContain('close');
    expect(tagsOf('Button Text Blue On Off Button', 'button')).toEqual(
      expect.arrayContaining(['toggle', 'switch']),
    );
    expect(tagsOf('Button Text Blank Text Input', 'button')).toContain('input');
    expect(tagsOf('Music Off', 'icon')).not.toContain('toggle');
  });

  it('reads an SVG size from width and height, else the viewBox', () => {
    expect(
      svgSize(
        '<?xml version="1.0"?><svg xmlns="x" width="1508.9" height="1508.2" viewBox="0 0 10 20">',
      ),
    ).toEqual({ width: 1509, height: 1508 });
    expect(svgSize('<svg viewBox="0 0 120 40" xmlns="x"><rect/></svg>')).toEqual({
      width: 120,
      height: 40,
    });
    expect(svgSize('<svg width="24px" height="48px">')).toEqual({ width: 24, height: 48 });
    expect(svgSize('<svg stroke-width="3" viewBox="0, 0, 5, 5">')).toEqual({ width: 5, height: 5 });
    expect(svgSize('<svg xmlns="x">')).toBeNull();
    expect(svgSize('not svg')).toBeNull();
  });
});

describe('browsing and filtering', () => {
  const ctxEntry = (name: string, pack: string, group: string): LibraryEntry => {
    const category = categorize(name, { pack, group });
    return entry(name, { category, pack, group, tags: tagsOf(name, category, [pack, group]) });
  };
  const pool = [
    ctxEntry('Button Text Large Blue Round', 'Basic GUI', 'Buttons Text'),
    ctxEntry('Button Text Large Orange Round', 'Basic GUI', 'Buttons Text'),
    ctxEntry('Slim Slider Frame', 'Basic GUI', 'Sliders'),
    ctxEntry('Golden Coin 1st', 'Free Icon Pack', 'Currency'),
    ctxEntry('Gold Coin', 'Currency', 'Gold Coins'),
    ctxEntry('Dragon Egg', 'Eggs', 'Dragon Egg'),
    ctxEntry('Candycane', 'Events', 'Christmas'),
    entry('halftone'),
  ];

  it('finds game parts by colour, kind and folder words', () => {
    expect(searchLibrary(pool, 'blue button').hits.map((e) => e.name)).toEqual([
      'Button Text Large Blue Round',
    ]);
    expect(searchLibrary(pool, 'gold coin').total).toBe(2); // "Golden Coin" has the gold tag
    expect(searchLibrary(pool, 'dragon egg').hits[0]?.name).toBe('Dragon Egg');
    expect(searchLibrary(pool, 'christmas').hits[0]?.name).toBe('Candycane');
    expect(searchLibrary(pool, 'slider').hits[0]?.category).toBe('slider');
    // the thing filed as a button beats a slider's button part
    const mixed = [
      ctxEntry('Slim Slider Blue Button', 'Basic GUI', 'Sliders'),
      ctxEntry('Button Text Large Blue Round', 'Basic GUI', 'Buttons Text'),
    ];
    expect(searchLibrary(mixed, 'blue button').hits[0]?.category).toBe('button');
  });

  it('filters by pack and group (part of the name, any case) and by category', () => {
    expect(searchLibrary(pool, undefined, { pack: 'basic' }).total).toBe(3);
    expect(searchLibrary(pool, undefined, { pack: 'Basic GUI', group: 'sliders' }).total).toBe(1);
    expect(searchLibrary(pool, undefined, { group: 'christ' }).hits[0]?.name).toBe('Candycane');
    expect(searchLibrary(pool, undefined, { pack: 'nope' }).total).toBe(0);
    // an old entry without a pack is never matched by a pack filter
    expect(searchLibrary(pool, 'halftone', { pack: 'basic' }).total).toBe(0);
    expect(searchLibrary(pool, undefined, { category: 'button' }).total).toBe(2);
  });

  it('counts categories and packs with their groups', () => {
    const f = libraryFacets(pool);
    expect(f.categories).toMatchObject({
      button: 2,
      slider: 1,
      currency: 2,
      egg: 1,
      event: 1,
      halftone: 1,
    });
    expect(f.packs[0]).toEqual({
      pack: 'Basic GUI',
      count: 3,
      groups: { 'Buttons Text': 2, Sliders: 1 },
    });
    expect(f.packs.map((p) => p.pack)).toContain('Eggs');
  });

  it('describes pack and group when there are any', () => {
    expect(describeEntry(pool[0] as LibraryEntry)).toMatchObject({
      pack: 'Basic GUI',
      group: 'Buttons Text',
    });
  });
});
