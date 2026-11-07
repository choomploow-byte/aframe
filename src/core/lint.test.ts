import { describe, expect, it } from 'vitest';
import { contrastRatio, lintDesign, parseRgb } from './lint';
import { createTemplateDoc, TEMPLATES } from './templates';
import { buildDoc, sampleDoc } from './testing';
import type { Doc } from './types';
import { validateDoc } from './validate';

const rules = (doc: Doc, nodeId?: string): string[] =>
  lintDesign(doc, nodeId).findings.map((f) => f.rule);

describe('colour maths', () => {
  it('parses hex and rgb, refuses what it cannot judge', () => {
    expect(parseRgb('#fff')).toEqual({ rgb: [255, 255, 255], alpha: 1 });
    expect(parseRgb('#00000080')?.alpha).toBeCloseTo(0.5, 1);
    expect(parseRgb('rgb(10, 20, 30)')).toEqual({ rgb: [10, 20, 30], alpha: 1 });
    expect(parseRgb('rgba(10 20 30 / 50%)')?.alpha).toBe(0.5);
    expect(parseRgb('linear-gradient(#000, #fff)')).toBeNull();
    expect(parseRgb('#12')).toBeNull();
  });

  it('matches known WCAG ratios', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
    expect(contrastRatio([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 1);
  });
});

describe('rules', () => {
  const frame = (children: object[], extra: object = {}) =>
    buildDoc([
      {
        id: 'n_frame',
        type: 'frame',
        name: 'Card',
        w: 400,
        h: 300,
        layout: 'none',
        fill: '#ffffff',
        children,
        ...extra,
      } as never,
    ]);

  it('flags low contrast, with a fix, and the right severity', () => {
    const doc = frame([
      { id: 'n_weak', type: 'text', text: 'pale', color: '#8a8a8a', fontSize: 16 },
      { id: 'n_ok', type: 'text', text: 'fine', color: '#111111', fontSize: 16 },
      { id: 'n_bad', type: 'text', text: 'very pale', color: '#f4f4f4', fontSize: 16 },
    ]);
    const found = lintDesign(doc).findings.filter((f) => f.rule === 'contrast');
    expect(found.map((f) => f.nodeId).sort()).toEqual(['n_bad', 'n_weak']);
    expect(found.find((f) => f.nodeId === 'n_bad')?.severity).toBe('error');
    expect(found.find((f) => f.nodeId === 'n_weak')?.severity).toBe('warning');
    expect(found[0]?.fix).toBeTruthy();
  });

  it('uses the large-text threshold and skips backgrounds it cannot judge', () => {
    const large = frame([
      { id: 'n_big', type: 'text', text: 'Big', color: '#888888', fontSize: 32 },
    ]);
    expect(rules(large)).not.toContain('contrast'); // 3.5:1 passes the 3:1 large-text bar
    const gradient = frame([{ id: 'n_t', type: 'text', text: 'x', color: '#eeeeee' }], {
      fill: 'linear-gradient(90deg, #000, #fff)',
    });
    expect(rules(gradient)).not.toContain('contrast');
  });

  it('resolves tokens on both sides', () => {
    const doc = frame([{ id: 'n_t', type: 'text', text: 'muted on surface2', color: '$muted' }], {
      fill: '$surface2',
    });
    expect(rules(doc)).not.toContain('contrast'); // #6B6A65 on white is 5.4:1
  });

  it('flags tiny text, small tap targets, off-scale spacing, overflow, default names, missing alt, raw token colours', () => {
    const doc = frame([
      { id: 'n_tiny', type: 'text', text: 'small', fontSize: 9 },
      { id: 'n_btn', type: 'frame', name: 'Button', role: 'button', w: 80, h: 24, layout: 'none' },
      { id: 'n_gap', type: 'frame', name: 'Row', layout: 'row', gap: 7, padding: [5, 8, 8, 8] },
      { id: 'n_wide', type: 'rect', name: 'Wide', x: 300, y: 0, w: 200, h: 50 },
      {
        id: 'n_def',
        type: 'rect',
        name: 'Rectangle 2',
        x: 0,
        y: 100,
        w: 10,
        h: 10,
        fill: '#C96442',
      },
      { id: 'n_img', type: 'image', name: 'Photo', x: 0, y: 200, w: 10, h: 10 },
    ]);
    const got = new Set(rules(doc));
    for (const r of [
      'text-size',
      'tap-target',
      'spacing-scale',
      'overflow',
      'layer-name',
      'image-alt',
      'use-token',
    ]) {
      expect(got, r).toContain(r);
    }
  });

  it('flags inconsistent radii among the same role', () => {
    const doc = frame([
      { id: 'n_a', type: 'frame', name: 'Card A', role: 'card', radius: 8, w: 50, h: 50 },
      { id: 'n_b', type: 'frame', name: 'Card B', role: 'card', radius: 16, w: 50, h: 50 },
      { id: 'n_c', type: 'frame', name: 'Card C', role: 'card', radius: 8, w: 50, h: 50 },
    ]);
    const f = lintDesign(doc).findings.filter((x) => x.rule === 'radius-consistency');
    expect(f.map((x) => x.nodeId)).toEqual(['n_b']);
  });

  it('can be limited to a subtree, counts by severity and never reports the page', () => {
    const doc = sampleDoc();
    const whole = lintDesign(doc);
    const part = lintDesign(doc, 'n_row1');
    expect(part.nodesChecked).toBeLessThan(whole.nodesChecked);
    expect(whole.counts.error + whole.counts.warning + whole.counts.info).toBe(whole.total);
    expect(whole.findings.every((f) => f.nodeId !== doc.rootId)).toBe(true);
  });

  it('caps a huge report but still says how many there were', () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      id: `n_t${String(i).padStart(4, '0')}`,
      type: 'text',
      text: 'x',
      fontSize: 8,
    }));
    const r = lintDesign(frame(many));
    expect(r.total).toBeGreaterThan(100);
    expect(r.findings).toHaveLength(100);
  });
});

describe('templates', () => {
  it.each(TEMPLATES)('%s is a valid document with no lint errors', (name) => {
    const doc = createTemplateDoc(name, { name: `T ${name}`, id: 'p_tmpl1' });
    expect(validateDoc(doc).ok).toBe(true);
    expect(doc.name).toBe(`T ${name}`);
    expect(lintDesign(doc).counts.error).toBe(0);
    if (name !== 'blank') expect(Object.keys(doc.nodes).length).toBeGreaterThan(5);
  });

  it('are real structure: auto-layout frames, tokens, named layers', () => {
    const doc = createTemplateDoc('landing', { name: 'x' });
    const nodes = Object.values(doc.nodes);
    expect(nodes.some((n) => n.layout === 'row')).toBe(true);
    expect(nodes.some((n) => n.fill === '$primary')).toBe(true);
  });
});
