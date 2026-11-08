import { describe, expect, it } from 'vitest';
import sample from '../../../fixtures/figma-sample.json';
import { createEmptyDoc } from '../doc';
import { validateDoc } from '../validate';
import { applyImport } from './apply';
import { figmaPictureNeeds, importFigma, listFigmaFrames, parseFigmaUrl } from './figma';
import { summarise, type ReportEntry } from './types';
import type { NodeSpec } from '../types';

const what = (r: ReportEntry[], kind: ReportEntry['kind']): string[] =>
  r.filter((e) => e.kind === kind).map((e) => e.what);

describe('parseFigmaUrl', () => {
  it('reads the file key and node id from design and file links', () => {
    expect(
      parseFigmaUrl('https://www.figma.com/design/AbCdEfGhIjKlMn/My-file?node-id=1-23&t=x'),
    ).toEqual({
      key: 'AbCdEfGhIjKlMn',
      nodeId: '1:23',
    });
    expect(parseFigmaUrl('https://figma.com/file/AbCdEfGhIjKlMn/x')).toEqual({
      key: 'AbCdEfGhIjKlMn',
    });
  });
  it('refuses anything that is not a figma.com file link', () => {
    for (const bad of [
      '',
      'figma.com/file/AbCdEfGhIjKlMn',
      'https://evil.com/file/AbCdEfGhIjKlMn/x',
      'http://www.figma.com/file/AbCdEfGhIjKlMn',
      'https://www.figma.com.evil.com/file/AbCdEfGhIjKlMn/x',
      'https://www.figma.com/file/short/x',
    ]) {
      expect(parseFigmaUrl(bad), bad).toBeNull();
    }
  });
});

describe('the recorded sample file', () => {
  it('lists its frames', () => {
    expect(listFigmaFrames(sample)).toEqual([
      { id: '1:2', name: 'Hero', page: 'Page 1', width: 1440, height: 640 },
    ]);
  });

  it('imports the hero with auto-layout, text styles, fills, radii and shadows', () => {
    const r = importFigma(sample, { frameId: '1:2' });
    const hero = r.spec as NodeSpec;
    expect(hero).toMatchObject({
      type: 'frame',
      name: 'Hero',
      w: 1440,
      h: 'hug',
      layout: 'column',
      gap: 24,
      padding: [112, 64, 112, 64],
      justify: 'center',
      align: 'center',
      clip: true,
      fill: '#faf9f5',
    });
    const [headline, button, image, squiggle] = hero.children as NodeSpec[];
    expect(headline).toMatchObject({
      type: 'text',
      text: 'Plan work your team will follow',
      fontFamily: 'Fraunces',
      fontWeight: 700,
      fontSize: 60,
      lineHeight: 1.1,
      letterSpacing: -0.02,
      textAlign: 'center',
      color: '#1f1e1d',
    });
    expect(button).toMatchObject({
      type: 'frame',
      layout: 'row',
      w: 'hug',
      h: 'hug',
      radius: 10,
      fill: '#c96442',
      padding: [14, 24, 14, 24],
      shadow: [{ x: 0, y: 4, blur: 12, spread: 0, color: '#0000001f' }],
    });
    expect((button?.children as NodeSpec[])[0]).toMatchObject({
      type: 'text',
      text: 'Get started',
      fontWeight: 600,
      color: '#ffffff',
    });
    expect(image).toMatchObject({
      type: 'rect',
      radius: 20,
      stroke: '#e8e6dc',
      strokeWidth: 1,
      strokeAlign: 'inside',
      fill: 'linear-gradient(180deg, #f6e6df 0%, #fcf7f3 100%)',
    });
    // Children of an auto-layout frame carry no x/y: the layout places them.
    expect(headline?.x).toBeUndefined();
    expect(squiggle).toMatchObject({ type: 'rect', fill: '#e5e5e5' });
  });

  it('reports what the fixture says it should', () => {
    const r = importFigma(sample, { frameId: '1:2' });
    const expected = sample.expectedImportReport;
    for (const item of expected.converted) {
      expect(what(r.report, 'converted'), item).toContain(item.replace('(', ' ').replace(')', ''));
    }
    expect(what(r.report, 'fallback').join('|')).toContain('Decorative squiggle');
    expect(what(r.report, 'approximated').join('|')).toContain('gradient');
    expect(summarise(r.report).editablePct).toBeGreaterThanOrEqual(80);
  });

  it('draws the vector as the image Figma exports when it is supplied', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="24"><path d="M0 12 Q15 0 30 12 T60 12" stroke="#000" fill="none"/></svg>';
    const r = importFigma(sample, { frameId: '1:2', vectorSvgs: { '1:7': svg } });
    const squiggle = (r.spec?.children as NodeSpec[])[3];
    expect(squiggle).toMatchObject({ type: 'image', w: 60, h: 24 });
    expect(r.assets).toHaveLength(1);
    expect(new TextDecoder().decode(r.assets[0]?.bytes)).toContain('<path');
  });

  it('refuses a vector "picture" that carries script', () => {
    const r = importFigma(sample, {
      frameId: '1:2',
      vectorSvgs: { '1:7': '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>' },
    });
    expect((r.spec?.children as NodeSpec[])[3]?.type).toBe('rect');
    expect(r.assets).toHaveLength(0);
  });

  it('applies to a document as one valid batch', () => {
    const r = importFigma(sample, { frameId: '1:2' });
    const out = applyImport(createEmptyDoc(), r);
    expect(out.doc.nodes[out.nodeId]?.name).toBe('Hero');
    expect(validateDoc(out.doc).ok).toBe(true);
  });

  it('says which pictures it needs from Figma', () => {
    expect(figmaPictureNeeds(sample, '1:2')).toEqual({ vectorIds: ['1:7'], imageRefs: [] });
  });
});

const file = (children: unknown[]): unknown => ({
  document: {
    id: '0:0',
    type: 'DOCUMENT',
    children: [{ id: '0:1', type: 'CANVAS', name: 'P', children }],
  },
});
const frame = (
  extra: Record<string, unknown>,
  children: unknown[] = [],
): Record<string, unknown> => ({
  id: '1:1',
  type: 'FRAME',
  name: 'F',
  absoluteBoundingBox: { x: 100, y: 50, width: 400, height: 300 },
  children,
  ...extra,
});

describe('more of the mapping', () => {
  it('maps alignment, sizing modes, wrap and hidden layers', () => {
    const r = importFigma(
      file([
        frame(
          {
            layoutMode: 'HORIZONTAL',
            primaryAxisAlignItems: 'SPACE_BETWEEN',
            counterAxisAlignItems: 'MAX',
            layoutWrap: 'WRAP',
            itemSpacing: 8,
          },
          [
            {
              id: '2:1',
              type: 'RECTANGLE',
              name: 'Fill me',
              layoutSizingHorizontal: 'FILL',
              layoutSizingVertical: 'FIXED',
              absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 40 },
            },
            {
              id: '2:2',
              type: 'RECTANGLE',
              name: 'Hidden',
              visible: false,
              absoluteBoundingBox: { x: 0, y: 0, width: 5, height: 5 },
            },
            {
              id: '2:3',
              type: 'RECTANGLE',
              name: 'Grow',
              layoutGrow: 1,
              absoluteBoundingBox: { x: 0, y: 0, width: 30, height: 30 },
            },
          ],
        ),
      ]),
      { frameId: '1:1' },
    );
    const f = r.spec as NodeSpec;
    expect(f).toMatchObject({
      layout: 'row',
      justify: 'between',
      align: 'end',
      wrap: true,
      gap: 8,
    });
    const kids = f.children as NodeSpec[];
    expect(kids).toHaveLength(2);
    expect(kids[0]).toMatchObject({ w: 'fill', h: 40 });
    expect(kids[1]).toMatchObject({ w: 'fill', h: 30 });
    expect(what(r.report, 'skipped')).toContain('RECTANGLE Hidden');
  });

  it('positions children of a free frame relative to it', () => {
    const r = importFigma(
      file([
        frame({}, [
          {
            id: '2:1',
            type: 'ELLIPSE',
            name: 'Dot',
            absoluteBoundingBox: { x: 130, y: 90, width: 20, height: 20 },
            fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }],
          },
        ]),
      ]),
      { frameId: '1:1' },
    );
    const dot = (r.spec?.children as NodeSpec[])[0];
    expect(dot).toMatchObject({ type: 'ellipse', x: 30, y: 40, w: 20, h: 20, fill: '#ff0000' });
    expect((r.spec as NodeSpec).layout).toBe('none');
  });

  it('uses per-corner radii, opacity, an inner shadow, blur and a solid fill with its own opacity', () => {
    const r = importFigma(
      file([
        frame({
          rectangleCornerRadii: [4, 8, 4, 8],
          opacity: 0.5,
          fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 0.5 }],
          effects: [
            {
              type: 'INNER_SHADOW',
              color: { r: 0, g: 0, b: 0, a: 0.25 },
              offset: { x: 0, y: 2 },
              radius: 4,
            },
            { type: 'LAYER_BLUR', radius: 6 },
            { type: 'BACKGROUND_BLUR', radius: 10 },
            { type: 'DROP_SHADOW', visible: false, radius: 99 },
          ],
        }),
      ]),
      { frameId: '1:1' },
    );
    expect(r.spec).toMatchObject({
      radius: [4, 8, 4, 8],
      opacity: 0.5,
      fill: '#00000080',
      blur: 6,
      backdropBlur: 10,
    });
    expect((r.spec as NodeSpec).shadow).toEqual([
      { x: 0, y: 2, blur: 4, spread: 0, color: '#00000040', inset: true },
    ]);
  });

  it('keeps an image fill as an image layer when the picture is supplied, a placeholder when not', () => {
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      ),
      (c) => c.charCodeAt(0),
    );
    const node = {
      id: '2:1',
      type: 'RECTANGLE',
      name: 'Photo',
      cornerRadius: 12,
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
      fills: [{ type: 'IMAGE', imageRef: 'abc123' }],
    };
    const doc = file([frame({}, [node])]);
    expect(figmaPictureNeeds(doc, '1:1').imageRefs).toEqual(['abc123']);
    const with_ = importFigma(doc, {
      frameId: '1:1',
      imageFills: { abc123: { mime: 'image/png', bytes: png } },
    });
    const image = (with_.spec?.children as NodeSpec[])[0];
    expect(image).toMatchObject({ type: 'image', radius: 12, w: 200, h: 100, fit: 'cover' });
    expect(with_.assets).toHaveLength(1);
    const without = importFigma(doc, { frameId: '1:1' });
    expect((without.spec?.children as NodeSpec[])[0]).toMatchObject({
      type: 'rect',
      fill: '#e5e5e5',
    });
    expect(what(without.report, 'fallback').join()).toContain('image fill');
  });

  it('approximates what it cannot carry, once per kind, and says so', () => {
    const r = importFigma(
      file([
        frame(
          {
            fills: [
              {
                type: 'GRADIENT_ANGULAR',
                gradientStops: [
                  { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
                  { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
                ],
              },
              { type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 } },
            ],
            reactions: [{ action: {} }],
          },
          [
            {
              id: '2:1',
              type: 'INSTANCE',
              name: 'Button',
              absoluteBoundingBox: { x: 100, y: 50, width: 10, height: 10 },
            },
            {
              id: '2:2',
              type: 'INSTANCE',
              name: 'Button 2',
              absoluteBoundingBox: { x: 100, y: 50, width: 10, height: 10 },
            },
            { id: '2:3', type: 'STICKY', name: 'Note' },
          ],
        ),
      ]),
      { frameId: '1:1' },
    );
    const text = r.report.map((e) => `${e.kind}:${e.what}`).join('|');
    expect(text).toContain('approximated:angular gradient');
    expect(text).toContain('approximated:fills on');
    expect(text).toContain('skipped:prototype interactions');
    expect(text).toContain('skipped:STICKY Note');
    expect(r.report.filter((e) => e.what === 'components and instances')).toHaveLength(1);
  });

  it('turns repeated colours into token suggestions', () => {
    const solid = (g: number) => [{ type: 'SOLID', color: { r: 0, g, b: 0, a: 1 } }];
    const r = importFigma(
      file([
        frame({ fills: solid(1) }, [
          {
            id: '2:1',
            type: 'RECTANGLE',
            name: 'A',
            absoluteBoundingBox: { x: 0, y: 0, width: 5, height: 5 },
            fills: solid(1),
          },
          {
            id: '2:2',
            type: 'RECTANGLE',
            name: 'B',
            absoluteBoundingBox: { x: 0, y: 0, width: 5, height: 5 },
            fills: solid(0.5),
          },
        ]),
      ]),
      { frameId: '1:1' },
    );
    expect(r.colors).toEqual({ '#00ff00': 2 });
  });
});

describe('bad input', () => {
  it('rejects a file with no document, and a frame that is not in it', () => {
    expect(() => listFigmaFrames({})).toThrow(/Figma file/);
    expect(() => importFigma(sample, { frameId: '9:9' })).toThrow(/not in the file/);
  });

  it('refuses a frame nested too deeply, or with far too many layers', () => {
    let deep: Record<string, unknown> = {
      id: 'x:0',
      type: 'RECTANGLE',
      name: 'leaf',
      absoluteBoundingBox: { x: 0, y: 0, width: 1, height: 1 },
    };
    for (let i = 0; i < 40; i += 1) deep = frame({ id: `x:${i + 1}` }, [deep]);
    expect(() => importFigma(file([deep]), { frameId: deep.id as string })).toThrow(/deeply/);
    const many = Array.from({ length: 2100 }, (_, i) => ({
      id: `r:${i}`,
      type: 'RECTANGLE',
      name: 'r',
      absoluteBoundingBox: { x: 0, y: 0, width: 1, height: 1 },
    }));
    expect(() => importFigma(file([frame({}, many)]), { frameId: '1:1' })).toThrow(/more than/);
  });
});
