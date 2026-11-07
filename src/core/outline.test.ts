import { describe, expect, it } from 'vitest';
import { CoreError } from './errors';
import { getOutline } from './outline';
import { buildDoc, deepFreeze, sampleDoc } from './testing';
import type { Doc } from './types';

const doc = (): Doc => deepFreeze(sampleDoc());

describe('getOutline', () => {
  it('describes the page, artboards and children with only meaningful keys', () => {
    const out = getOutline(doc());
    expect(out.root).toMatchObject({ id: 'n_page1', type: 'page' });
    const [card, other] = out.root.children ?? [];
    expect(card).toMatchObject({
      id: 'n_frame',
      name: 'Card',
      x: 0,
      y: 0,
      w: 400,
      h: 'hug',
      layout: 'column',
      gap: 8,
    });
    expect(other).toMatchObject({ id: 'n_other', x: 500, y: 0 });
    const title = card?.children?.[0];
    // Inside an auto-layout parent x/y are meaningless, so they are left out.
    expect(title).toEqual({
      id: 'n_title',
      type: 'text',
      name: 'Title',
      w: 'hug',
      h: 'hug',
      text: 'Title',
      fontSize: 24,
      fontWeight: 400,
    });
    expect(out.rev).toBe(1);
    expect(out.docId).toBe('p_test1');
    expect(out.truncated).toBe(false);
    expect(out.shownNodes).toBe(7);
  });

  it('counts nodes, open annotations and references, and lists token names', () => {
    const base = sampleDoc();
    const withNotes = deepFreeze({
      ...base,
      annotations: [
        {
          id: 'a_one11',
          x: 0,
          y: 0,
          text: 'a',
          author: 'user' as const,
          status: 'open' as const,
          createdAt: 't',
        },
        {
          id: 'a_two22',
          x: 0,
          y: 0,
          text: 'b',
          author: 'user' as const,
          status: 'resolved' as const,
          createdAt: 't',
        },
      ],
    });
    const out = getOutline(withNotes);
    expect(out.counts).toEqual({
      nodes: 7,
      byType: { page: 1, frame: 3, text: 1, rect: 2 },
      openAnnotations: 1,
      references: 0,
    });
    expect(out.tokens.colors).toContain('primary');
    expect(out.tokens.fonts).toEqual(['heading', 'body', 'mono']);
    expect(out.tokens.spacing).toEqual([4, 8, 12, 16, 24, 32, 48, 64, 96]);
    expect(out.tokens.radii).toContain('md');
  });

  it('limits depth and says how many children were cut', () => {
    const out = getOutline(doc(), { depth: 1 });
    const card = out.root.children?.[0];
    expect(card?.childCount).toBe(2);
    expect(card).not.toHaveProperty('children');
    expect(out.truncated).toBe(true);
    expect(getOutline(doc(), { depth: 0 }).root.childCount).toBe(2);
  });

  it('clamps silly depths', () => {
    expect(getOutline(doc(), { depth: -5 }).root.children).toBeUndefined();
    expect(getOutline(doc(), { depth: 999 }).truncated).toBe(false);
  });

  it('can start at any node', () => {
    const out = getOutline(doc(), { nodeId: 'n_row1' });
    expect(out.root).toMatchObject({ id: 'n_row1', layout: 'row' });
    expect(out.root.children?.map((c) => c.id)).toEqual(['n_recta', 'n_rectb']);
    // The page and siblings still count towards the totals.
    expect(out.counts.nodes).toBe(7);
  });

  it('full detail returns every property, nested, without ids lists or parentId', () => {
    const out = getOutline(doc(), { nodeId: 'n_frame', detail: 'full', depth: 1 });
    expect(out.root).toMatchObject({
      id: 'n_frame',
      type: 'frame',
      layout: 'column',
      gap: 8,
      w: 400,
      visible: true,
      opacity: 1,
    });
    expect(out.root).not.toHaveProperty('parentId');
    expect(out.root.children).toHaveLength(2);
    expect(out.root.children?.[1]).toMatchObject({ id: 'n_row1', childCount: 2 });
    expect(out.root.children?.[1]).not.toHaveProperty('children');
  });

  it('caps the number of nodes breadth-first and marks what is missing', () => {
    const out = getOutline(doc(), { maxNodes: 4 });
    expect(out.shownNodes).toBe(4);
    expect(out.truncated).toBe(true);
    // Top levels survive: page, both artboards, and the card's first child.
    expect(out.root.children?.map((c) => c.id)).toEqual(['n_frame', 'n_other']);
    const card = out.root.children?.[0];
    expect(card?.children?.map((c) => c.id)).toEqual(['n_title']);
    expect(card?.moreChildren).toBe(1);
  });

  it('adds status flags only when they differ from the defaults', () => {
    const d = deepFreeze(
      buildDoc([
        {
          id: 'n_flags',
          type: 'frame',
          layout: 'row',
          align: 'center',
          justify: 'between',
          wrap: true,
          clip: true,
          padding: [1, 2, 3, 4],
          fill: '$primary',
          stroke: '#000',
          radius: 8,
          role: 'card',
          opacity: 0.5,
          visible: false,
          locked: true,
          shadow: [{ x: 0, y: 1, blur: 2, spread: 0, color: '#000' }],
          children: [
            { id: 'n_img01', type: 'image', assetId: 'img_abcde' },
            {
              id: 'n_long1',
              type: 'text',
              text: `${'word '.repeat(40)}`,
              fontFamily: '$font.body',
              fontWeight: 600,
              color: '$text',
            },
            { id: 'n_empty', type: 'text', text: '' },
          ],
        },
      ]),
    );
    const flagged = getOutline(d, { nodeId: 'n_flags' });
    expect(flagged.root).toMatchObject({
      layout: 'row',
      align: 'center',
      justify: 'between',
      wrap: true,
      clip: true,
      padding: [1, 2, 3, 4],
      fill: '$primary',
      stroke: '#000',
      radius: 8,
      role: 'card',
      opacity: 0.5,
      visible: false,
      locked: true,
      shadows: 1,
    });
    const [img, long, empty] = flagged.root.children ?? [];
    expect(img).toMatchObject({ assetId: 'img_abcde' });
    expect((long?.text as string).length).toBeLessThanOrEqual(81);
    expect(long?.text).toMatch(/…$/);
    expect(long).toMatchObject({ fontFamily: '$font.body', fontWeight: 600, color: '$text' });
    expect(empty?.text).toBe('');
  });

  it('throws NOT_FOUND with a hint for an unknown node', () => {
    try {
      getOutline(doc(), { nodeId: 'n_gone1' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CoreError);
      expect((e as CoreError).code).toBe('NOT_FOUND');
      expect((e as CoreError).hint).toMatch(/get_design/);
    }
  });
});

describe('outline shows the game-UI toolkit', () => {
  it('icons, effects, patterns, masters and instances are visible to an agent', async () => {
    const { createTemplateDoc } = await import('./templates');
    const doc = createTemplateDoc('game-shop', {
      name: 'x',
      id: 'p_out01',
      now: '2026-01-01T00:00:00.000Z',
    });
    const everything = getOutline(doc, { depth: 8, maxNodes: 1000 });
    const flat: Record<string, unknown>[] = [];
    const walk = (n: Record<string, unknown>): void => {
      flat.push(n);
      for (const c of (n.children as Record<string, unknown>[] | undefined) ?? []) walk(c);
    };
    walk(everything.root);
    expect(flat.some((n) => n.type === 'icon' && n.icon === 'gem' && n.color === '$gem')).toBe(
      true,
    );
    expect(flat.some((n) => Array.isArray(n.effects))).toBe(true);
    expect(
      flat.some(
        (n) =>
          typeof n.fill === 'object' && (n.fill as { pattern?: string }).pattern === 'halftone',
      ),
    ).toBe(true);
    const master = flat.find((n) => n.name === 'Button Chunky' && n.component);
    expect(master?.component).toEqual({ kind: 'button', states: ['hover', 'pressed', 'disabled'] });
    const inst = flat.find((n) => n.name === 'Tab Featured');
    expect(inst).toMatchObject({ instanceOf: expect.any(String) as string, state: 'selected' });
    expect(flat.some((n) => typeof n.from === 'string')).toBe(true);
  });
});
