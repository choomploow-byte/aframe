import { describe, expect, it } from 'vitest';
import { createEmptyDoc } from '../doc';
import { validateDoc } from '../validate';
import { applyImport } from './apply';
import { cssColor, importDom, type DomNode, type DomSnapshot } from './dom';
import type { NodeSpec } from '../types';

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const node = (
  tag: string,
  b: ReturnType<typeof box>,
  style: DomNode['style'] = {},
  extra: Partial<DomNode> = {},
): DomNode => ({
  tag,
  box: b,
  style,
  ...extra,
});
const snapshot = (root: DomNode, title = 'Demo'): DomSnapshot => ({
  url: 'http://localhost:3000/',
  title,
  width: root.box.w,
  height: root.box.h,
  root,
});

describe('cssColor', () => {
  it('reads rgb, rgba and hex, and treats transparent as nothing', () => {
    expect(cssColor('rgb(201, 100, 66)')).toBe('#c96442');
    expect(cssColor('rgba(0, 0, 0, 0.5)')).toBe('#00000080');
    expect(cssColor('rgba(0, 0, 0, 0)')).toBeUndefined();
    expect(cssColor('transparent')).toBeUndefined();
    expect(cssColor('#abc')).toBe('#aabbcc');
    expect(cssColor(undefined)).toBeUndefined();
  });
});

describe('importDom', () => {
  it('turns a flex row into auto-layout with its gap, padding and alignment', () => {
    const root = node(
      'body',
      box(0, 0, 400, 100),
      {},
      {
        children: [
          node(
            'nav',
            box(0, 0, 400, 60),
            {
              display: 'flex',
              flexDirection: 'row',
              columnGap: '24px',
              paddingTop: '10px',
              paddingRight: '16px',
              paddingBottom: '10px',
              paddingLeft: '16px',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'rgb(255, 255, 255)',
            },
            {
              children: [
                node(
                  'span',
                  box(16, 20, 40, 20),
                  { color: 'rgb(0, 0, 0)', fontSize: '16px' },
                  { text: 'Home' },
                ),
              ],
            },
          ),
        ],
      },
    );
    const r = importDom(snapshot(root));
    const nav = (r.spec?.children as NodeSpec[])[0];
    expect(nav).toMatchObject({
      type: 'frame',
      layout: 'row',
      gap: 24,
      padding: [10, 16, 10, 16],
      justify: 'between',
      align: 'center',
      fill: '#ffffff',
      role: 'nav',
    });
    expect((nav?.children as NodeSpec[])[0]).toMatchObject({
      type: 'text',
      text: 'Home',
      fontSize: 16,
      color: '#000000',
    });
    // The layout places children: they carry no coordinates.
    expect((nav?.children as NodeSpec[])[0]?.x).toBeUndefined();
  });

  it('turns evenly stacked blocks into a column and says so', () => {
    const root = node(
      'body',
      box(0, 0, 300, 200),
      {},
      {
        children: [
          node(
            'div',
            box(10, 10, 280, 40),
            { backgroundColor: 'rgb(200, 0, 0)' },
            { children: [node('p', box(10, 10, 100, 20), {}, { text: 'A' })] },
          ),
          node(
            'div',
            box(10, 70, 280, 40),
            { backgroundColor: 'rgb(0, 200, 0)' },
            { children: [node('p', box(10, 70, 100, 20), {}, { text: 'B' })] },
          ),
          node(
            'div',
            box(10, 130, 280, 40),
            { backgroundColor: 'rgb(0, 0, 200)' },
            { children: [node('p', box(10, 130, 100, 20), {}, { text: 'C' })] },
          ),
        ],
      },
    );
    const r = importDom(snapshot(root));
    expect(r.spec).toMatchObject({ layout: 'column', gap: 20, padding: [10, 0, 0, 10] });
    expect(r.report.some((e) => e.what === 'stacked blocks')).toBe(true);
  });

  it('places blocks that overlap or sit side by side by coordinates', () => {
    const root = node(
      'body',
      box(0, 0, 300, 100),
      {},
      {
        children: [
          node('div', box(10, 10, 100, 80), { backgroundColor: 'rgb(200, 0, 0)' }),
          node('div', box(150, 10, 100, 80), { backgroundColor: 'rgb(0, 200, 0)' }),
        ],
      },
    );
    const r = importDom(snapshot(root));
    expect(r.spec?.layout).toBe('none');
    expect(r.spec?.children).toMatchObject([
      { x: 10, y: 10 },
      { x: 150, y: 10 },
    ]);
    expect(r.report.some((e) => e.what === 'positioned layers')).toBe(true);
  });

  it('keeps radius, border, shadow, opacity and a text-on-box as a frame with its label', () => {
    const root = node(
      'body',
      box(0, 0, 300, 100),
      {},
      {
        children: [
          node(
            'div',
            box(10, 10, 120, 44),
            {
              backgroundColor: 'rgb(201, 100, 66)',
              borderTopLeftRadius: '10px',
              borderTopRightRadius: '10px',
              borderBottomRightRadius: '10px',
              borderBottomLeftRadius: '10px',
              borderTopWidth: '2px',
              borderTopStyle: 'solid',
              borderTopColor: 'rgb(0, 0, 0)',
              boxShadow: 'rgba(0, 0, 0, 0.15) 0px 4px 12px 0px',
              opacity: '0.9',
              paddingTop: '12px',
              paddingLeft: '22px',
              paddingRight: '22px',
              color: 'rgb(255, 255, 255)',
              fontSize: '16px',
              fontWeight: '600',
            },
            { text: 'Go', attrs: { class: 'btn' } },
          ),
        ],
      },
    );
    const r = importDom(snapshot(root));
    const btn = (r.spec?.children as NodeSpec[])[0];
    expect(btn).toMatchObject({
      type: 'frame',
      name: 'Btn',
      fill: '#c96442',
      radius: 10,
      stroke: '#000000',
      strokeWidth: 2,
      opacity: 0.9,
      shadow: [{ x: 0, y: 4, blur: 12, spread: 0, color: '#00000026' }],
    });
    expect((btn?.children as NodeSpec[])[0]).toMatchObject({
      type: 'text',
      text: 'Go',
      color: '#ffffff',
      fontWeight: 600,
      x: 22,
      y: 12,
    });
  });

  it('turns pictures and inline svg into placeholders and never loads them', () => {
    const root = node(
      'body',
      box(0, 0, 300, 200),
      {},
      {
        children: [
          node(
            'img',
            box(10, 10, 100, 80),
            {},
            { attrs: { src: 'https://tracker.example/x.png', alt: 'Team photo' } },
          ),
          node('svg', box(150, 10, 40, 40)),
        ],
      },
    );
    const r = importDom(snapshot(root));
    const [img, svg] = r.spec?.children as NodeSpec[];
    expect(img).toMatchObject({ type: 'rect', fill: '#e5e5e5', name: 'Team photo' });
    expect(svg).toMatchObject({ type: 'rect', fill: '#e5e5e5' });
    expect(JSON.stringify(r.spec)).not.toContain('tracker.example');
    expect(r.report.filter((e) => e.kind === 'fallback')).toHaveLength(2);
  });

  it('draws a form field as a box with its placeholder', () => {
    const root = node(
      'body',
      box(0, 0, 300, 100),
      {},
      {
        children: [
          node(
            'input',
            box(10, 10, 200, 36),
            {
              borderTopWidth: '1px',
              borderTopColor: 'rgb(200, 200, 200)',
              borderTopStyle: 'solid',
              paddingLeft: '10px',
              paddingRight: '10px',
              fontSize: '14px',
            },
            { attrs: { placeholder: 'you@example.com' } },
          ),
        ],
      },
    );
    const field = (importDom(snapshot(root)).spec?.children as NodeSpec[])[0];
    expect(field).toMatchObject({ role: 'input', children: [{ text: 'you@example.com' }] });
  });

  it('skips scripts, styles and invisible boxes, and names the frame from the page title', () => {
    const root = node(
      'body',
      box(0, 0, 300, 100),
      { backgroundColor: 'rgb(250, 250, 250)' },
      {
        children: [
          node('script', box(0, 0, 10, 10), {}, { text: 'alert(1)' }),
          node('div', box(0, 0, 0, 0), { backgroundColor: 'rgb(0, 0, 0)' }),
        ],
      },
    );
    const r = importDom(snapshot(root, 'My app'));
    expect(r.name).toBe('My app');
    expect(r.spec?.name).toBe('My app');
    expect(r.spec?.children).toBeUndefined();
  });

  it('applies to a document and stays valid', () => {
    const root = node(
      'body',
      box(0, 0, 300, 100),
      { backgroundColor: 'rgb(250, 250, 250)' },
      {
        children: [
          node(
            'h1',
            box(10, 10, 280, 40),
            { fontSize: '32px', color: 'rgb(0, 0, 0)' },
            { text: 'Hello' },
          ),
        ],
      },
    );
    const out = applyImport(createEmptyDoc(), importDom(snapshot(root)));
    expect(validateDoc(out.doc).ok).toBe(true);
    const heading = Object.values(out.doc.nodes).find((n) => n.type === 'text');
    expect(heading).toMatchObject({ role: 'heading', props: { level: '1' } });
  });

  it('refuses something that is not a capture, and a page nested too deeply', () => {
    expect(() => importDom({} as DomSnapshot)).toThrow(/page capture/);
    let deep = node('div', box(0, 0, 10, 10), { backgroundColor: 'rgb(1, 1, 1)' });
    for (let i = 0; i < 40; i += 1)
      deep = node(
        'div',
        box(0, 0, 10, 10),
        { backgroundColor: 'rgb(1, 1, 1)' },
        { children: [deep] },
      );
    expect(() => importDom(snapshot(deep))).toThrow(/deeply/);
  });
});
