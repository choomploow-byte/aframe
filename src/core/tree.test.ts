import { describe, expect, it } from 'vitest';
import { normalizeNode } from './normalize';
import { sampleDoc } from './testing';
import {
  ancestorIds,
  descendantIds,
  getArtboards,
  getRoot,
  isEffectivelyLocked,
  isInSubtree,
} from './tree';

describe('tree helpers', () => {
  const doc = sampleDoc();

  it('lists descendants parents-first, in sibling order', () => {
    expect(descendantIds(doc.nodes, 'n_frame')).toEqual([
      'n_title',
      'n_row1',
      'n_recta',
      'n_rectb',
    ]);
    expect(descendantIds(doc.nodes, 'n_recta')).toEqual([]);
    expect(descendantIds(doc.nodes, 'n_missing')).toEqual([]);
  });

  it('survives cycles in corrupt data', () => {
    const a = normalizeNode({
      id: 'n_cyca1',
      type: 'frame',
      children: ['n_cycb1'],
      parentId: 'n_cycb1',
    });
    const b = normalizeNode({
      id: 'n_cycb1',
      type: 'frame',
      children: ['n_cyca1'],
      parentId: 'n_cyca1',
    });
    const nodes = { n_cyca1: a, n_cycb1: b };
    expect(descendantIds(nodes, 'n_cyca1')).toEqual(['n_cycb1']);
    expect(ancestorIds(nodes, 'n_cyca1')).toEqual(['n_cycb1']);
    expect(isInSubtree(nodes, 'n_cyca1', 'n_nothere')).toBe(false);
  });

  it('answers subtree and ancestor questions', () => {
    expect(isInSubtree(doc.nodes, 'n_recta', 'n_frame')).toBe(true);
    expect(isInSubtree(doc.nodes, 'n_frame', 'n_frame')).toBe(true);
    expect(isInSubtree(doc.nodes, 'n_frame', 'n_recta')).toBe(false);
    expect(ancestorIds(doc.nodes, 'n_recta')).toEqual(['n_row1', 'n_frame', 'n_page1']);
    expect(ancestorIds(doc.nodes, 'n_page1')).toEqual([]);
  });

  it('treats a node under a locked ancestor as locked', () => {
    const locked = { ...doc.nodes, n_frame: { ...doc.nodes.n_frame!, locked: true } };
    expect(isEffectivelyLocked(locked, 'n_recta')).toBe(true);
    expect(isEffectivelyLocked(locked, 'n_frame')).toBe(true);
    expect(isEffectivelyLocked(locked, 'n_other')).toBe(false);
    expect(isEffectivelyLocked(doc.nodes, 'n_recta')).toBe(false);
  });

  it('finds the root and the artboards', () => {
    expect(getRoot(doc).id).toBe('n_page1');
    expect(getArtboards(doc).map((n) => n.id)).toEqual(['n_frame', 'n_other']);
    expect(() => getRoot({ ...doc, rootId: 'n_gone1' })).toThrow(/no root node/);
  });

  it('skips artboards whose node is missing', () => {
    const broken = {
      ...doc,
      nodes: { ...doc.nodes, n_page1: { ...doc.nodes.n_page1!, children: ['n_frame', 'n_gone1'] } },
    };
    expect(getArtboards(broken).map((n) => n.id)).toEqual(['n_frame']);
  });
});
