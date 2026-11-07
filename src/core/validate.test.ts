import { describe, expect, it } from 'vitest';
import { bumpRev, createEmptyDoc } from './doc';
import { seededRng } from './ids';
import { normalizeNode } from './normalize';
import { isValidColor, isValidHref, propIssues, validateDoc } from './validate';
import type { Doc } from './types';

describe('isValidColor', () => {
  it('accepts supported forms', () => {
    for (const ok of [
      '#fff',
      '#ffff',
      '#C96442',
      '#C96442CC',
      'rgb(1,2,3)',
      'rgba(0, 0, 0, 0.5)',
      'rgb(0 0 0 / 50%)',
      'hsl(20, 50%, 40%)',
      'hsla(20, 50%, 40%, 0.3)',
      'transparent',
      '$primary',
      'linear-gradient(90deg, #fff, #000)',
      'linear-gradient(to right, $primary, rgba(0,0,0,0.2))',
      'radial-gradient(circle at center, #fff 0%, #000 100%)',
    ]) {
      expect(isValidColor(ok), ok).toBe(true);
    }
  });

  it('rejects hostile and unsupported values', () => {
    for (const bad of [
      '',
      'red',
      '#ggg',
      '#12345',
      'url(javascript:alert(1))',
      'url(https://evil.test/x.png)',
      'expression(alert(1))',
      'var(--x)',
      'rgb(1,2,3); background: url(x)',
      'rgb(1,2,3)}</style><script>',
      "rgb(1,2,3)'",
      'rgb(1,2,3',
      'linear-gradient(red, url(x))',
      'linear-gradient(red, $font.body)',
      'linear-gradient(red, $)',
      '$font.body',
      '$',
      '$a.b.c',
      'rgb(1,2,3) !important',
      'calc(1px)',
      'x'.repeat(501),
      42,
      null,
      undefined,
    ]) {
      expect(isValidColor(bad), String(bad)).toBe(false);
    }
  });
});

describe('isValidHref', () => {
  it('allows safe link targets only', () => {
    for (const ok of [
      'https://a.test',
      'http://a.test',
      'mailto:a@b.c',
      'tel:+1',
      '/pricing',
      './a',
      '../a',
      '#top',
    ]) {
      expect(isValidHref(ok), ok).toBe(true);
    }
    for (const bad of [
      'javascript:alert(1)',
      ' javascript:alert(1)',
      'data:text/html,x',
      'ftp://x',
      'pricing',
      '',
      3,
    ]) {
      expect(isValidHref(bad), String(bad)).toBe(false);
    }
  });
});

describe('propIssues', () => {
  it('accepts valid frame, text and image props', () => {
    expect(
      propIssues(
        {
          layout: 'row',
          gap: 8,
          padding: [1, 2, 3, 4],
          align: 'center',
          justify: 'between',
          wrap: true,
          clip: true,
          w: 'fill',
          h: 'hug',
          fill: '$surface',
          radius: '$radius.md',
          shadow: [{ x: 0, y: 2, blur: 8, spread: 0, color: 'rgba(0,0,0,.1)' }],
        },
        'frame',
      ),
    ).toEqual([]);
    expect(
      propIssues(
        {
          text: 'Hi',
          fontFamily: '$font.heading',
          fontSize: 20,
          fontWeight: 600,
          lineHeight: 1.3,
          letterSpacing: -0.02,
          textAlign: 'center',
          color: '#111',
          textTransform: 'uppercase',
        },
        'text',
      ),
    ).toEqual([]);
    expect(propIssues({ assetId: 'img_abcde', fit: 'contain' }, 'image')).toEqual([]);
  });

  it('reports bad values with a path, message and hint', () => {
    const issues = propIssues(
      { opacity: 2, w: 0, fill: 'url(x)', radius: -1, padding: [1, 2] },
      'frame',
      { path: 'set' },
    );
    expect(issues.map((i) => i.path)).toEqual([
      'set.opacity',
      'set.w',
      'set.fill',
      'set.radius',
      'set.padding',
    ]);
    expect(issues[0]).toMatchObject({
      code: 'INVALID_VALUE',
      message: "Invalid value for 'opacity': 2.",
    });
    expect(issues[0]?.hint).toMatch(/0 to 1/);
  });

  it('covers every value check', () => {
    const bad: Record<string, unknown> = {
      name: '   ',
      x: Number.NaN,
      y: 'a',
      h: 'wide',
      rotation: 'a',
      visible: 'yes',
      locked: 1,
      stroke: 'nope',
      strokeWidth: -1,
      strokeAlign: 'middle',
      shadow: [{ x: 0, y: 0, blur: -1, spread: 0, color: '#fff' }],
      blur: -2,
      backdropBlur: 'a',
      role: 'banner',
      href: 'javascript:x',
      props: { 'bad key': 'v' },
      layout: 'grid',
      gap: -1,
      align: 'baseline',
      justify: 'around',
      wrap: 'no',
      clip: 'no',
    };
    const issues = propIssues(bad, 'frame');
    expect(issues.map((i) => i.path).sort()).toEqual(Object.keys(bad).sort());

    const badText: Record<string, unknown> = {
      text: 5,
      fontFamily: 'Bad;Font{}',
      fontSize: 0,
      fontWeight: 950,
      lineHeight: 0,
      letterSpacing: 99,
      textAlign: 'start',
      color: 'rgb(',
      textTransform: 'lowercase',
    };
    expect(
      propIssues(badText, 'text')
        .map((i) => i.path)
        .sort(),
    ).toEqual(Object.keys(badText).sort());
    expect(propIssues({ assetId: 'n_abcde', fit: 'tile' }, 'image')).toHaveLength(2);
    expect(propIssues({ fontFamily: '$primary' }, 'text')).toHaveLength(1);
    expect(propIssues({ radius: '$primary' }, 'rect')).toHaveLength(1);
    expect(propIssues({ shadow: 'x' }, 'rect')).toHaveLength(1);
    expect(
      propIssues({ shadow: [{ x: 0, y: 0, blur: 1, spread: 0, color: '#fff', extra: 1 }] }, 'rect'),
    ).toHaveLength(1);
    expect(
      propIssues(
        { shadow: [{ x: 0, y: 0, blur: 1, spread: 0, color: '#fff', inset: 'y' }] },
        'rect',
      ),
    ).toHaveLength(1);
    expect(propIssues({ props: 'x' }, 'rect')).toHaveLength(1);
    expect(propIssues({ radius: [1, 2, 3, 4] }, 'rect')).toEqual([]);
    expect(propIssues({ radius: 'x' }, 'rect')).toHaveLength(1);
    expect(propIssues({ radius: true }, 'rect')).toHaveLength(1);
  });

  it('rejects unknown, inapplicable and structural keys with helpful hints', () => {
    const issues = propIssues(
      {
        colour: '#fff',
        fontSize: 12,
        layout: 'row',
        assetId: 'img_abcde',
        id: 'n_x',
        parentId: 'n_y',
        children: [],
        type: 'frame',
      },
      'rect',
    );
    expect(issues.map((i) => i.message)).toEqual([
      "Unknown property 'colour'.",
      "'fontSize' does not apply to rect nodes.",
      "'layout' does not apply to rect nodes.",
      "'assetId' does not apply to rect nodes.",
      "'id' cannot be set here.",
      "'parentId' cannot be set here.",
      "'children' cannot be set here.",
      "'type' cannot be set here.",
    ]);
    expect(issues[1]?.hint).toBe("'fontSize' only applies to text nodes.");
    expect(issues[5]?.hint).toMatch(/move/);
  });

  it('shows page restrictions and ignores undefined values', () => {
    expect(propIssues({ fill: '#fff' }, 'page')).toHaveLength(1);
    expect(propIssues({ name: 'Home', fill: undefined }, 'page')).toEqual([]);
  });

  it('handles null only for optional props when allowNull', () => {
    expect(propIssues({ fill: null, stroke: null }, 'rect', { allowNull: true })).toEqual([]);
    expect(propIssues({ fill: null }, 'rect')[0]?.message).toBe("'fill' cannot be removed.");
    const required = propIssues({ opacity: null, text: null }, 'text', { allowNull: true });
    expect(required.map((i) => i.message)).toEqual([
      "'opacity' cannot be removed.",
      "'text' cannot be removed.",
    ]);
    expect(required[0]?.hint).toMatch(/required/);
  });

  it('truncates long values in messages', () => {
    const issues = propIssues({ fill: 'x'.repeat(200) }, 'rect');
    expect(issues[0]?.message.length).toBeLessThan(120);
  });
});

function baseDoc(): Doc {
  return createEmptyDoc({ rng: seededRng(1), now: '2026-01-01T00:00:00.000Z', id: 'p_test1' });
}

function withFrame(): { doc: Doc; frameId: string; rootId: string } {
  const doc = baseDoc();
  const rootId = doc.rootId;
  const frameId = 'n_frame';
  const frame = normalizeNode({ id: frameId, type: 'frame', parentId: rootId });
  return {
    rootId,
    frameId,
    doc: {
      ...doc,
      nodes: {
        ...doc.nodes,
        [rootId]: { ...doc.nodes[rootId]!, children: [frameId] },
        [frameId]: frame,
      },
    },
  };
}

describe('validateDoc', () => {
  it('accepts an empty and a small document', () => {
    expect(validateDoc(baseDoc())).toEqual({ ok: true, warnings: [] });
    expect(validateDoc(withFrame().doc).ok).toBe(true);
  });

  it('bumpRev keeps a document valid', () => {
    const next = bumpRev(baseDoc(), 'mcp', '2026-02-02T00:00:00.000Z');
    expect(next.rev).toBe(2);
    expect(next.meta).toMatchObject({ lastWriter: 'mcp', updatedAt: '2026-02-02T00:00:00.000Z' });
    expect(validateDoc(next).ok).toBe(true);
  });

  const failures = (input: unknown): string[] => {
    const r = validateDoc(input);
    return r.ok ? [] : r.errors.map((e) => `${e.code}:${e.path ?? ''}`);
  };

  it('rejects non-objects and bad top-level fields', () => {
    expect(failures(null)).toEqual(['INVALID_VALUE:']);
    expect(failures([])).toEqual(['INVALID_VALUE:']);
    const d = baseDoc() as unknown as Record<string, unknown>;
    expect(failures({ ...d, schema: 2 })).toEqual(['SCHEMA_NEWER:schema']);
    expect(failures({ ...d, schema: 'x' })).toEqual(['INVALID_VALUE:schema']);
    expect(failures({ ...d, rev: -1, id: '', name: 1, rootId: 3 })).toEqual(
      expect.arrayContaining([
        'INVALID_VALUE:rev',
        'INVALID_VALUE:id',
        'INVALID_VALUE:name',
        'INVALID_VALUE:rootId',
      ]),
    );
    expect(failures({ ...d, nodes: 'x' })).toContain('INVALID_VALUE:nodes');
    expect(failures({ ...d, meta: null })).toEqual(['INVALID_VALUE:meta']);
    expect(failures({ ...d, assets: { a: 1 } })).toEqual(['INVALID_VALUE:assets']);
  });

  it('checks tokens, annotations and references', () => {
    const d = baseDoc() as unknown as Record<string, unknown>;
    expect(failures({ ...d, tokens: 3 })).toEqual(['INVALID_VALUE:tokens']);
    expect(
      failures({
        ...d,
        tokens: { colors: { a: 'url(x)' }, fonts: { a: 1 }, spacing: ['x'], radii: { a: 'x' } },
      }),
    ).toEqual([
      'INVALID_VALUE:tokens.colors',
      'INVALID_VALUE:tokens.fonts',
      'INVALID_VALUE:tokens.spacing',
      'INVALID_VALUE:tokens.radii',
    ]);

    expect(failures({ ...d, annotations: 'x' })).toEqual(['INVALID_VALUE:annotations']);
    expect(failures({ ...d, annotations: [5] })).toEqual(['INVALID_VALUE:annotations.0']);
    expect(
      failures({
        ...d,
        annotations: [
          {
            id: 'bad',
            text: 1,
            x: 'a',
            y: 1,
            author: 'bot',
            status: 'done',
            nodeId: 3,
            reply: 4,
            createdAt: 5,
          },
        ],
      }).length,
    ).toBe(8);
    const goodAnnotation = {
      id: 'a_0001',
      text: 'hi',
      x: 1,
      y: 2,
      author: 'user',
      status: 'open',
      createdAt: 'now',
    };
    expect(failures({ ...d, annotations: [goodAnnotation] })).toEqual([]);

    expect(failures({ ...d, references: 'x' })).toEqual(['INVALID_VALUE:references']);
    expect(failures({ ...d, references: [1] })).toEqual(['INVALID_VALUE:references.0']);
    expect(
      failures({ ...d, references: [{ id: 'x', name: 1, assetId: 2, scope: 'all' }] }).length,
    ).toBe(4);
    expect(
      failures({ ...d, references: [{ id: 'r_abcde', name: 'a', assetId: 'img_zzzzz' }] }),
    ).toEqual(['INVALID_VALUE:references.0.assetId']);
    expect(
      failures({
        ...d,
        assets: { img_zzzzz: 'data:image/png;base64,AA==' },
        references: [{ id: 'r_abcde', name: 'a', assetId: 'img_zzzzz', scope: 'style' }],
      }),
    ).toEqual([]);
  });

  it('checks node structure', () => {
    const { doc, frameId, rootId } = withFrame();
    const nodes = doc.nodes;
    const mutate = (fn: (n: Doc['nodes']) => Doc['nodes']): string[] =>
      failures({ ...doc, nodes: fn({ ...nodes }) });

    expect(mutate((n) => ({ ...n, [frameId]: 5 as never }))).toContain(
      'INVALID_VALUE:nodes.n_frame',
    );
    expect(mutate((n) => ({ ...n, [frameId]: { ...n[frameId]!, id: 'n_other' } }))).toContain(
      'INVALID_VALUE:nodes.n_frame.id',
    );
    expect(mutate((n) => ({ ...n, BAD: { ...n[frameId]!, id: 'BAD' } }))).toEqual(
      expect.arrayContaining(['INVALID_VALUE:nodes.BAD.id']),
    );
    expect(
      mutate((n) => ({ ...n, [frameId]: { ...n[frameId]!, type: 'blob' as never } })),
    ).toContain('INVALID_VALUE:nodes.n_frame.type');
    expect(mutate((n) => ({ ...n, [frameId]: { ...n[frameId]!, type: 'page' } }))).toContain(
      'INVALID_VALUE:nodes.n_frame.type',
    );
    expect(
      mutate((n) => ({ ...n, [frameId]: { ...n[frameId]!, children: 'x' as never } })),
    ).toContain('INVALID_VALUE:nodes.n_frame.children');
    expect(
      mutate((n) => ({ ...n, [frameId]: { ...n[frameId]!, parentId: 5 as never } })),
    ).toContain('INVALID_VALUE:nodes.n_frame.parentId');
    expect(mutate((n) => ({ ...n, [frameId]: { ...n[frameId]!, w: -5 } }))).toContain(
      'INVALID_VALUE:nodes.n_frame.w',
    );
    expect(mutate((n) => ({ ...n, [frameId]: { ...n[frameId]!, parentId: 'n_zzzzz' } }))).toContain(
      'INVALID_VALUE:nodes.n_frame.parentId',
    );
    expect(mutate((n) => ({ ...n, [rootId]: { ...n[rootId]!, parentId: frameId } }))).toContain(
      `INVALID_VALUE:nodes.${rootId}.parentId`,
    );
    expect(
      mutate((n) => ({ ...n, [rootId]: { ...n[rootId]!, children: [frameId, 'n_gone1'] } })),
    ).toContain(`NOT_FOUND:nodes.${rootId}.children`);
    expect(
      mutate((n) => ({ ...n, [rootId]: { ...n[rootId]!, children: [frameId, frameId] } })),
    ).toContain(`INVALID_VALUE:nodes.${rootId}.children`);
  });

  it('allows page w/h of 0 but rejects other page props', () => {
    const doc = baseDoc();
    const root = doc.nodes[doc.rootId]!;
    expect(root).toMatchObject({ w: 0, h: 0 });
    expect(validateDoc(doc).ok).toBe(true);
    expect(failures({ ...doc, nodes: { [doc.rootId]: { ...root, fill: '#fff' } } })).toContain(
      `INVALID_VALUE:nodes.${doc.rootId}.fill`,
    );
  });

  it('rejects leaves with children, a non-page root, orphans and cycles', () => {
    const { doc, frameId, rootId } = withFrame();
    const rect = normalizeNode({ id: 'n_rect1', type: 'rect', parentId: frameId });
    const text = normalizeNode({ id: 'n_text1', type: 'text', parentId: 'n_rect1' });
    const nodes = {
      ...doc.nodes,
      [frameId]: { ...doc.nodes[frameId]!, children: ['n_rect1'] },
      n_rect1: { ...rect, children: ['n_text1'] },
      n_text1: text,
    };
    const errs = failures({ ...doc, nodes });
    expect(errs).toContain('BAD_PARENT:nodes.n_rect1.children');

    expect(failures({ ...doc, rootId: frameId })).toContain('NOT_FOUND:rootId');
    expect(failures({ ...doc, rootId: 'n_gone1' })).toContain('NOT_FOUND:rootId');

    const orphan = normalizeNode({ id: 'n_orphn', type: 'rect', parentId: rootId });
    expect(failures({ ...doc, nodes: { ...doc.nodes, n_orphn: orphan } })).toContain(
      'CYCLE:nodes.n_orphn',
    );

    const a = normalizeNode({
      id: 'n_cyca1',
      type: 'frame',
      parentId: 'n_cycb1',
      children: ['n_cycb1'],
    });
    const b = normalizeNode({
      id: 'n_cycb1',
      type: 'frame',
      parentId: 'n_cyca1',
      children: ['n_cyca1'],
    });
    expect(failures({ ...doc, nodes: { ...doc.nodes, n_cyca1: a, n_cycb1: b } })).toEqual(
      expect.arrayContaining(['CYCLE:nodes.n_cyca1', 'CYCLE:nodes.n_cycb1']),
    );
  });

  it('warns about images that point at missing assets', () => {
    const { doc, frameId } = withFrame();
    const img = normalizeNode({
      id: 'n_img01',
      type: 'image',
      parentId: frameId,
      assetId: 'img_gone1',
    });
    const nodes = {
      ...doc.nodes,
      [frameId]: { ...doc.nodes[frameId]!, children: ['n_img01'] },
      n_img01: img,
    };
    const result = validateDoc({ ...doc, nodes });
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      {
        code: 'MISSING_ASSET',
        message: 'Image n_img01 points to missing asset img_gone1.',
        nodeId: 'n_img01',
      },
    ]);
  });

  it('caps the number of reported errors', () => {
    const { doc } = withFrame();
    const nodes: Doc['nodes'] = { ...doc.nodes };
    for (let i = 0; i < 80; i += 1) nodes[`n_bad${i.toString().padStart(2, '0')}`] = 7 as never;
    const r = validateDoc({ ...doc, nodes });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(50);
  });
});
