import { describe, expect, it } from 'vitest';
import sampleJson from '../../fixtures/sample-doc.json';
import transcript from '../../fixtures/sample-tool-transcript.json';
import { createMemoryContext } from './memory-context';
import { loadDoc } from './doc';
import { normalizeDoc, type LooseDoc } from './normalize';
import { getOutline } from './outline';
import { cssToString, nodeToCss } from './style';
import { runTool } from './tools';
import type { TokenIssue } from './tokens';
import type { Doc, Node } from './types';
import { validateDoc } from './validate';

const raw = (): unknown => JSON.parse(JSON.stringify(sampleJson));

function load(): Doc {
  const r = loadDoc(raw());
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.doc;
}

describe('fixtures/sample-doc.json', () => {
  it('validates as-is (it is already a normalised document)', () => {
    expect(validateDoc(raw())).toEqual({ ok: true, warnings: [] });
  });

  it('loads through migrate -> normalize -> validate without warnings', () => {
    const r = loadDoc(raw());
    expect(r).toMatchObject({ ok: true, migrated: false, warnings: [] });
  });

  it('round-trips: JSON -> normalize -> JSON is identical', () => {
    const before = raw() as LooseDoc;
    const after: unknown = JSON.parse(JSON.stringify(normalizeDoc(before)));
    expect(after).toEqual(before);
  });

  it('has every node reachable and consistent with its parent', () => {
    const doc = load();
    for (const node of Object.values(doc.nodes)) {
      for (const childId of node.children) {
        expect(doc.nodes[childId]?.parentId).toBe(node.id);
      }
    }
    expect(Object.keys(doc.nodes)).toHaveLength(55);
  });

  it('renders every node to CSS with all tokens resolved and nothing unsafe', () => {
    const doc = load();
    const issues: TokenIssue[] = [];
    for (const node of Object.values(doc.nodes)) {
      const parent = node.parentId ? doc.nodes[node.parentId] : undefined;
      const css = nodeToCss(node, parent, doc.tokens, issues);
      const text = cssToString(css);
      expect(text, node.id).not.toMatch(/url\(|\$/);
      if (node.type !== 'page') expect(text.length, node.id).toBeGreaterThan(0);
    }
    expect(issues).toEqual([]);
  });

  it('expresses the hero the way the layout contract says', () => {
    const doc = load();
    const find = (name: string): Node => {
      const n = Object.values(doc.nodes).find((x) => x.name === name);
      if (!n) throw new Error(`no node named ${name}`);
      return n;
    };
    const hero = find('Hero');
    expect(nodeToCss(hero, doc.nodes[hero.parentId ?? ''], doc.tokens)).toMatchObject({
      flex: '0 0 auto',
      alignSelf: 'stretch',
      display: 'flex',
      flexDirection: 'column',
      gap: '24px',
      padding: '112px 64px 112px 64px',
      alignItems: 'center',
    });
    const headline = find('Headline');
    expect(nodeToCss(headline, hero, doc.tokens)).toMatchObject({
      width: '820px',
      fontFamily: '"Fraunces", Georgia, serif',
      fontSize: '60px',
      letterSpacing: '-0.02em',
      whiteSpace: 'pre-wrap',
    });
    const landing = find('Landing - Desktop');
    expect(nodeToCss(landing, doc.nodes[landing.parentId ?? ''], doc.tokens)).toMatchObject({
      position: 'absolute',
      left: '0px',
      top: '0px',
      width: '1440px',
      backgroundColor: '#FAF9F5',
    });
  });

  it('yields an outline small enough for an agent to read in one go', () => {
    const doc = load();
    const whole = getOutline(doc, { depth: 8 });
    expect(whole.truncated).toBe(false);
    expect(whole.shownNodes).toBe(55);
    expect(whole.counts.openAnnotations).toBe(1);
    expect(JSON.stringify(whole).length).toBeLessThan(15_000);
    // The default depth cuts the cards' contents and says so.
    const shallow = getOutline(doc);
    expect(shallow.truncated).toBe(true);
    expect(JSON.stringify(shallow).length).toBeLessThan(JSON.stringify(whole).length);
  });
});

describe('fixtures/sample-tool-transcript.json (mock agent through the real tool handlers)', () => {
  it('applies the recorded improve-pricing batch cleanly', async () => {
    const doc = load();
    const ctx = createMemoryContext(doc, { now: () => '2026-02-02T00:00:00.000Z' });
    const idByName = (name: string): string => {
      const matches = Object.values(doc.nodes).filter((n) => n.name === name);
      if (matches.length !== 1)
        throw new Error(`expected one node named ${name}, got ${matches.length}`);
      return (matches[0] as Node).id;
    };
    const resolve = (value: unknown): unknown => {
      if (typeof value === 'string') {
        const m = /^<(.+)>$/.exec(value);
        return m ? idByName(m[1] as string) : value;
      }
      if (Array.isArray(value)) return value.map(resolve);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
      }
      return value;
    };

    const step = transcript.steps.find((s) => s.tool === 'apply_changes');
    expect(step).toBeDefined();
    const before = ctx.current();

    const design = await runTool(ctx, 'get_design', resolve({ depth: 3 }));
    expect(design.ok).toBe(true);

    const result = await runTool(ctx, 'apply_changes', resolve(step?.args));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const data = result.data as { rev: number; changed: string[]; warnings: unknown[] };
    expect(data.rev).toBe(before.rev + 1); // transcript expectation: docRevIncreased
    expect(data.changed).toHaveLength(6);
    expect(data.warnings).toEqual([]); // transcript expectation: usedTokens, all defined

    const after = ctx.current();
    const pricing = after.nodes[idByName('Pricing - Needs Work')];
    expect(pricing).toMatchObject({ fill: '$surface', gap: 48, padding: [96, 64, 96, 64] });
    expect(after.nodes[idByName('Plan - Pro')]).toMatchObject({
      stroke: '$primary',
      strokeWidth: 2,
    });
    expect(ctx.commits).toHaveLength(1);
    expect(ctx.commits[0]?.meta).toEqual({ source: 'agent', label: 'Improve pricing layout' });
    expect(validateDoc(after)).toMatchObject({ ok: true });
  });
});
