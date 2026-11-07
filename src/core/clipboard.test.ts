import { describe, expect, it } from 'vitest';
import { applyChanges } from './apply';
import { extractSpec, extractSpecs, topmostIds } from './clipboard';
import { CoreError } from './errors';
import { deepFreeze, sampleDoc } from './testing';

describe('extractSpec', () => {
  const doc = deepFreeze(sampleDoc());

  it('copies a subtree without ids or parent links', () => {
    const spec = extractSpec(doc, 'n_frame');
    expect(spec).toMatchObject({ type: 'frame', name: 'Card', layout: 'column', w: 400 });
    expect(spec).not.toHaveProperty('id');
    expect(spec).not.toHaveProperty('parentId');
    const [title, row] = spec.children ?? [];
    expect(title).toMatchObject({ type: 'text', text: 'Title' });
    expect(row?.children).toHaveLength(2);
    expect(JSON.stringify(spec)).not.toMatch(/n_(title|row1|recta|rectb|frame)/);
  });

  it('round-trips through a create op into a valid, independent copy', () => {
    const spec = extractSpec(doc, 'n_frame');
    const res = applyChanges(doc, [{ op: 'create', parentId: 'n_page1', node: spec }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.created).toHaveLength(5);
    const copyRoot = res.doc.nodes[res.created[0] as string];
    expect(copyRoot).toMatchObject({ name: 'Card', layout: 'column' });
    expect(res.doc.nodes.n_frame).toBe(doc.nodes.n_frame); // the original is untouched
  });

  it('refuses the page and unknown nodes', () => {
    expect(() => extractSpec(doc, 'n_page1')).toThrow(CoreError);
    expect(() => extractSpec(doc, 'n_gone1')).toThrow(/does not exist/);
  });
});

describe('topmostIds / extractSpecs', () => {
  const doc = deepFreeze(sampleDoc());

  it('drops nodes whose ancestor is also selected', () => {
    expect(topmostIds(doc.nodes, ['n_frame', 'n_title', 'n_recta', 'n_other'])).toEqual([
      'n_frame',
      'n_other',
    ]);
    expect(topmostIds(doc.nodes, ['n_title', 'n_recta'])).toEqual(['n_title', 'n_recta']);
  });

  it('copies each top-most node once, in document order within a parent', () => {
    const specs = extractSpecs(doc, ['n_row1', 'n_title', 'n_recta']);
    expect(specs).toHaveLength(2);
    expect(specs[0]).toMatchObject({ type: 'text' });
    expect(specs[1]).toMatchObject({ type: 'frame', name: 'Row' });
  });

  it('ignores ids that no longer exist', () => {
    expect(extractSpecs(doc, ['n_gone1', 'n_title'])).toHaveLength(1);
  });
});
