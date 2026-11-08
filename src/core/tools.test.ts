import { describe, expect, it } from 'vitest';
import { createMemoryContext } from './memory-context';
import { seededRng } from './ids';
import { applyChanges } from './apply';
import { findTool, getToolDefinitions, runTool, TOOLS, ToolFailure } from './tools';
import { sampleDoc } from './testing';
import type { Doc, Op, ToolContext } from './types';

const ctx = (doc: Doc = sampleDoc(), extras?: Partial<ToolContext>) =>
  createMemoryContext(doc, {
    now: () => '2026-03-03T00:00:00.000Z',
    ...(extras ? { extras } : {}),
  });

describe('read tools', () => {
  it('get_design returns the outline, honouring depth and nodeId', async () => {
    const c = ctx();
    const full = await runTool(c, 'get_design', {});
    expect(full).toMatchObject({ ok: true, data: { rev: 1, root: { id: 'n_page1' } } });

    const zoom = await runTool(c, 'get_design', { nodeId: 'n_row1', depth: 0 });
    expect(zoom).toMatchObject({ ok: true, data: { root: { id: 'n_row1', childCount: 2 } } });

    const detail = await runTool(c, 'get_design', { nodeId: 'n_title', detail: 'full' });
    expect(detail).toMatchObject({ ok: true, data: { root: { id: 'n_title', fontSize: 24 } } });
  });

  it('get_design reports unknown nodes and bad input as structured errors', async () => {
    const c = ctx();
    expect(await runTool(c, 'get_design', { nodeId: 'n_gone1' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    const bad = await runTool(c, 'get_design', { depth: 99 });
    expect(bad).toMatchObject({ ok: false, error: { code: 'INVALID_VALUE' } });
    if (!bad.ok) expect(bad.error.message).toMatch(/^Invalid input: depth: /);
    expect(await runTool(c, 'get_design', { detail: 'huge' })).toMatchObject({ ok: false });
  });

  it('get_node returns the full node, with bounds only when the app can measure', async () => {
    expect(await runTool(ctx(), 'get_node', { nodeId: 'n_title' })).toMatchObject({
      ok: true,
      data: { node: { id: 'n_title', text: 'Title' }, bounds: null, boundsAvailable: false },
    });
    const measured = ctx(sampleDoc(), {
      getNodeBounds: (id) =>
        Promise.resolve(id === 'n_title' ? { x: 1, y: 2, width: 3, height: 4 } : null),
    });
    expect(await runTool(measured, 'get_node', { nodeId: 'n_title' })).toMatchObject({
      ok: true,
      data: { bounds: { x: 1, y: 2, width: 3, height: 4 }, boundsAvailable: true },
    });
    expect(await runTool(ctx(), 'get_node', { nodeId: 'n_gone1' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', hint: expect.stringMatching(/get_design/) as string },
    });
    expect(await runTool(ctx(), 'get_node', {})).toMatchObject({
      ok: false,
      error: { code: 'INVALID_VALUE' },
    });
  });

  it('get_tokens returns the tokens', async () => {
    const r = await runTool(ctx(), 'get_tokens', undefined);
    expect(r).toMatchObject({ ok: true, data: { colors: { primary: '#5B3CB0' } } });
  });
});

describe('apply_changes', () => {
  const create: Op = {
    op: 'create',
    parentId: 'n_other',
    node: {
      type: 'frame',
      tempId: 'box',
      layout: 'column',
      children: [{ type: 'text', text: 'Hi' }],
    },
  };

  it('commits once, labelled as an agent change, and reports the outcome', async () => {
    const c = ctx();
    const r = await runTool(c, 'apply_changes', {
      label: 'Add box',
      operations: [create, { op: 'update', id: '$box', set: { gap: 12 } }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as {
      rev: number;
      created: string[];
      changed: string[];
      idMap: Record<string, string>;
      warnings: unknown[];
    };
    expect(data.rev).toBe(2);
    expect(data.created).toHaveLength(2);
    expect(data.idMap.box).toBe(data.created[0]);
    expect(data.changed).toEqual(['n_other']);
    expect(data.warnings).toEqual([]);
    expect(c.commits).toHaveLength(1);
    expect(c.commits[0]?.meta).toEqual({ source: 'agent', label: 'Add box' });
    expect(c.current().nodes[data.idMap.box as string]).toMatchObject({ gap: 12 });
  });

  it('omits the label from commit metadata when none is given', async () => {
    const c = ctx();
    await runTool(c, 'apply_changes', { operations: [create] });
    expect(c.commits[0]?.meta).toEqual({ source: 'agent' });
  });

  it('matches calling applyChanges directly (one implementation, two environments)', async () => {
    const direct = applyChanges(sampleDoc(), [create], { rng: seededRng(1) });
    expect(direct.ok).toBe(true);
    const c = ctx();
    const viaTool = await runTool(c, 'apply_changes', { operations: [create] });
    expect(viaTool.ok).toBe(true);
    if (direct.ok && viaTool.ok) {
      const data = viaTool.data as { created: string[] };
      expect(data.created).toHaveLength(direct.created.length);
      expect(Object.keys(c.current().nodes)).toHaveLength(Object.keys(direct.doc.nodes).length);
    }
  });

  it('does not commit a batch that changes nothing', async () => {
    const c = ctx();
    const r = await runTool(c, 'apply_changes', {
      operations: [{ op: 'update', id: 'n_title', set: { text: 'Title' } }],
    });
    expect(r).toMatchObject({ ok: true, data: { rev: 1, changed: [], created: [] } });
    expect(c.commits).toHaveLength(0);
  });

  it('fails atomically with the op index, path and hint, and commits nothing', async () => {
    const c = ctx();
    const r = await runTool(c, 'apply_changes', {
      operations: [create, { op: 'update', id: 'n_title', set: { opacity: 7 } }],
    });
    expect(r).toMatchObject({
      ok: false,
      error: { code: 'INVALID_VALUE', op: 1, path: 'set.opacity', details: [{ op: 1 }] },
    });
    if (!r.ok) expect(r.error.hint).toMatch(/0 to 1/);
    expect(c.commits).toHaveLength(0);
    expect(c.current().rev).toBe(1);
  });

  it('explains common agent mistakes', async () => {
    const c = ctx();
    const wrongKey = await runTool(c, 'apply_changes', {
      operations: [{ op: 'update', id: 'n_title', properties: { fill: '#fff' } }],
    });
    expect(wrongKey).toMatchObject({ ok: false });
    const unknownProp = await runTool(c, 'apply_changes', {
      operations: [{ op: 'update', id: 'n_title', set: { colour: '#fff' } }],
    });
    expect(unknownProp).toMatchObject({
      ok: false,
      error: { code: 'INVALID_VALUE', message: "Unknown property 'colour'." },
    });
    const badParent = await runTool(c, 'apply_changes', {
      operations: [{ op: 'create', parentId: 'n_title', node: { type: 'rect' } }],
    });
    expect(badParent).toMatchObject({ ok: false, error: { code: 'BAD_PARENT', op: 0 } });
  });

  it('rejects malformed input before touching the document', async () => {
    const c = ctx();
    expect(await runTool(c, 'apply_changes', {})).toMatchObject({
      ok: false,
      error: { code: 'INVALID_VALUE' },
    });
    expect(await runTool(c, 'apply_changes', { operations: [] })).toMatchObject({ ok: false });
    expect(await runTool(c, 'apply_changes', { operations: [{ op: 'explode' }] })).toMatchObject({
      ok: false,
    });
    expect(
      await runTool(c, 'apply_changes', { operations: [create], label: 'x'.repeat(101) }),
    ).toMatchObject({ ok: false });
    expect(c.commits).toHaveLength(0);
  });

  it('enforces the 500-op limit with LIMIT_EXCEEDED', async () => {
    const ops = Array.from({ length: 501 }, () => ({
      op: 'update',
      id: 'n_title',
      set: { text: 'x' },
    }));
    expect(await runTool(ctx(), 'apply_changes', { operations: ops })).toMatchObject({
      ok: false,
      error: { code: 'LIMIT_EXCEEDED' },
    });
  });

  it('surfaces warnings (locked nodes, unknown tokens) alongside success', async () => {
    const r = await runTool(ctx(), 'apply_changes', {
      operations: [{ op: 'update', id: 'n_title', set: { color: '$nope' } }],
    });
    expect(r).toMatchObject({
      ok: true,
      data: { warnings: [{ code: 'UNKNOWN_TOKEN', nodeId: 'n_title' }] },
    });
  });

  it('turns a failing context into an INTERNAL error instead of throwing', async () => {
    const broken: ToolContext = {
      getDoc: () => {
        throw new Error('disk on fire');
      },
      commit: () => undefined,
    };
    expect(await runTool(broken, 'get_tokens', {})).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'disk on fire' },
    });
    const throwsString: ToolContext = {
      getDoc: () => Promise.reject(new Error('x')),
      commit: () => undefined,
    };
    expect(await runTool(throwsString, 'get_design', {})).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' },
    });
  });

  it('keeps ToolFailure usable on its own', () => {
    const f = new ToolFailure({ code: 'TIMEOUT', message: 'slow', op: 3 });
    expect(f).toMatchObject({ code: 'TIMEOUT', op: 3, details: undefined });
  });
});

describe('set_tokens', () => {
  it('merges tokens, commits once with a label, and returns the new tokens', async () => {
    const c = ctx();
    const r = await runTool(c, 'set_tokens', {
      label: 'Warmer palette',
      colors: { primary: '#112233', brand: '$primary', muted: null },
      radii: { pill: 999 },
    });
    expect(r).toMatchObject({ ok: true, data: { rev: 2 } });
    const tokens = c.current().tokens;
    expect(tokens.colors.primary).toBe('#112233');
    expect(tokens.colors.brand).toBe('$primary');
    expect(tokens.colors).not.toHaveProperty('muted');
    expect(tokens.radii.pill).toBe(999);
    expect(c.commits).toHaveLength(1);
    expect(c.commits[0]?.meta).toEqual({ source: 'agent', label: 'Warmer palette' });
  });

  it('uses a default label and skips the commit when nothing changes', async () => {
    const c = ctx();
    await runTool(c, 'set_tokens', { colors: { extra: '#fff' } });
    expect(c.commits[0]?.meta?.label).toBe('Update tokens');
    const same = ctx();
    expect(await runTool(same, 'set_tokens', {})).toMatchObject({ ok: true, data: { rev: 1 } });
    expect(same.commits).toHaveLength(0);
  });

  it('reports invalid tokens as INVALID_VALUE and changes nothing', async () => {
    const c = ctx();
    const r = await runTool(c, 'set_tokens', { colors: { 'bad name': '#fff' } });
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_VALUE' } });
    expect(await runTool(c, 'set_tokens', { colors: { x: 'url(evil)' } })).toMatchObject({
      ok: false,
    });
    expect(c.commits).toHaveLength(0);
  });

  it('a token set in one call can be used in the next apply_changes without a warning', async () => {
    const c = ctx();
    await runTool(c, 'set_tokens', { colors: { sunrise: '#FF8800' } });
    const r = await runTool(c, 'apply_changes', {
      operations: [{ op: 'update', id: 'n_other', set: { fill: '$sunrise' } }],
    });
    expect(r).toMatchObject({ ok: true, data: { warnings: [] } });
  });
});

describe('registry', () => {
  it('lists the tools and finds them by name', () => {
    // Every tool in docs/05, nothing more (the docs, SKILL.md and server instructions name these).
    expect(TOOLS.map((t) => t.name).sort()).toEqual(
      [
        'add_annotation',
        'add_reference',
        'apply_changes',
        'apply_theme',
        'arrange_nodes',
        'compare_reference',
        'component_list',
        'create_instance',
        'create_project',
        'create_widget',
        'define_component',
        'export_code',
        'export_image',
        'find_nodes',
        'get_annotations',
        'get_design',
        'get_node',
        'get_reference',
        'get_selection',
        'get_tokens',
        'group_nodes',
        'import_image',
        'lint_design',
        'list_fonts',
        'list_projects',
        'list_references',
        'list_skills',
        'list_themes',
        'load_skill',
        'open_project',
        'place_icon',
        'resolve_annotation',
        'repeat_node',
        'screenshot',
        'search_icons',
        'search_library',
        'set_tokens',
        'ungroup_node',
        'update_where',
        'use_library_asset',
      ].sort(),
    );
    expect(findTool('get_tokens')?.name).toBe('get_tokens');
    expect(findTool('nope')).toBeUndefined();
  });

  it('answers unknown tools with the list of valid ones', async () => {
    const r = await runTool(ctx(), 'make_it_pop', {});
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    if (!r.ok)
      expect(r.error.hint).toBe(`Available tools: ${TOOLS.map((t) => t.name).join(', ')}.`);
  });

  it('exports JSON Schema definitions an MCP server or LLM provider can use', () => {
    const defs = getToolDefinitions();
    expect(defs.map((d) => d.name)).toEqual(TOOLS.map((t) => t.name));
    for (const d of defs) {
      expect(d.description.length).toBeGreaterThan(40);
      expect(d.inputSchema.type).toBe('object');
      expect(() => JSON.stringify(d.inputSchema)).not.toThrow();
    }
    const schema = JSON.stringify(defs.find((d) => d.name === 'apply_changes')?.inputSchema);
    for (const needle of [
      'operations',
      'tempId',
      'strokeAlign',
      'fontWeight',
      'padding',
      'duplicate',
      'children',
    ]) {
      expect(schema, needle).toContain(needle);
    }
  });
});
