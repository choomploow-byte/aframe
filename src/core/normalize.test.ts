import { describe, expect, it } from 'vitest';
import { normalizeDoc, normalizeNode, normalizeTokens } from './normalize';
import { DEFAULT_TOKENS } from './tokens';

describe('normalizeNode', () => {
  it('fills base defaults for a rect', () => {
    expect(normalizeNode({ id: 'n_rect1', type: 'rect' })).toEqual({
      id: 'n_rect1',
      type: 'rect',
      name: 'Rectangle',
      parentId: null,
      children: [],
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      visible: true,
      locked: false,
      opacity: 1,
    });
  });

  it('gives frames layout defaults and hug size when they have a flex layout', () => {
    const plain = normalizeNode({ id: 'n_fr001', type: 'frame' });
    expect(plain).toMatchObject({
      w: 100,
      h: 100,
      layout: 'none',
      gap: 0,
      padding: [0, 0, 0, 0],
      align: 'start',
      justify: 'start',
      clip: false,
    });
    expect(plain).not.toHaveProperty('wrap');

    const flex = normalizeNode({ id: 'n_fr002', type: 'frame', layout: 'column' });
    expect(flex).toMatchObject({ w: 'hug', h: 'hug', layout: 'column' });
  });

  it('gives text hug size, typography defaults and a name from its content', () => {
    const t = normalizeNode({ id: 'n_tx001', type: 'text', text: 'Hello   world' });
    expect(t).toMatchObject({
      name: 'Hello world',
      w: 'hug',
      h: 'hug',
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 1.4,
    });
    expect(t).not.toHaveProperty('fontFamily');
    expect(t).not.toHaveProperty('color');
    expect(normalizeNode({ id: 'n_tx002', type: 'text' })).toMatchObject({
      name: 'Text',
      text: '',
    });
  });

  it('truncates long text names', () => {
    const t = normalizeNode({ id: 'n_tx003', type: 'text', text: 'x'.repeat(100) });
    expect(t.name).toHaveLength(31);
    expect(t.name.endsWith('…')).toBe(true);
  });

  it('defaults line to a 100x1 bar, images to cover, page to 0x0', () => {
    expect(normalizeNode({ id: 'n_ln001', type: 'line' })).toMatchObject({ w: 100, h: 1 });
    expect(normalizeNode({ id: 'n_im001', type: 'image' })).toMatchObject({ fit: 'cover' });
    expect(normalizeNode({ id: 'n_pg001', type: 'page' })).toMatchObject({
      w: 0,
      h: 0,
      name: 'Page',
    });
  });

  it('keeps explicit values, unknown keys and drops undefined ones', () => {
    const n = normalizeNode({
      id: 'n_k0001',
      type: 'rect',
      w: 'fill',
      opacity: 0.5,
      fill: undefined,
      futureProp: 'kept',
    } as Parameters<typeof normalizeNode>[0]);
    expect(n.w).toBe('fill');
    expect(n.opacity).toBe(0.5);
    expect(n).not.toHaveProperty('fill');
    expect((n as unknown as Record<string, unknown>).futureProp).toBe('kept');
  });

  it('is idempotent', () => {
    for (const type of ['page', 'frame', 'rect', 'ellipse', 'line', 'text', 'image'] as const) {
      const once = normalizeNode({ id: 'n_idem1', type });
      expect(normalizeNode(once)).toEqual(once);
    }
  });
});

describe('normalizeTokens / normalizeDoc', () => {
  it('fills token groups, keeping provided ones', () => {
    expect(normalizeTokens(undefined)).toEqual({
      colors: {},
      fonts: {},
      spacing: DEFAULT_TOKENS.spacing,
      radii: {},
    });
    expect(normalizeTokens({ colors: { a: '#fff' } }).colors).toEqual({ a: '#fff' });
  });

  it('fills document defaults and normalises every node', () => {
    const doc = normalizeDoc(
      {
        id: 'p_x',
        rootId: 'n_root1',
        nodes: { n_root1: { id: 'n_root1', type: 'page' } },
      },
      '2026-01-01T00:00:00.000Z',
    );
    expect(doc).toMatchObject({
      schema: 1,
      rev: 1,
      name: 'Untitled',
      annotations: [],
      references: [],
      assets: {},
      meta: { createdAt: '2026-01-01T00:00:00.000Z', lastWriter: 'app' },
    });
    expect(doc.nodes.n_root1).toMatchObject({ name: 'Page', visible: true });
  });

  it('uses the epoch as the default timestamp so output is deterministic', () => {
    const doc = normalizeDoc({ nodes: {} });
    expect(doc.meta.createdAt).toBe('1970-01-01T00:00:00.000Z');
    expect(doc.id).toBe('');
  });
});
