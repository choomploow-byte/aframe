import { describe, expect, it } from 'vitest';
import { createEmptyDoc, loadDoc, serializeDoc } from './doc';
import { seededRng } from './ids';
import { migrate, MIGRATIONS, type Migration } from './migrate';
import { sampleDoc } from './testing';

const raw = (): Record<string, unknown> =>
  JSON.parse(JSON.stringify(sampleDoc())) as Record<string, unknown>;

describe('migrate', () => {
  it('has no steps while schema 1 is the baseline', () => {
    expect(Object.keys(MIGRATIONS)).toEqual([]);
  });

  it('passes a current-schema document through unchanged', () => {
    expect(migrate(raw())).toMatchObject({ ok: true, migrated: false, fromSchema: 1 });
  });

  it('refuses newer schemas with an update hint', () => {
    expect(migrate({ ...raw(), schema: 2 })).toMatchObject({
      ok: false,
      error: { code: 'SCHEMA_NEWER', hint: 'Update Atelier.' },
    });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'x'],
  ])('rejects %s', (_name, input) => {
    expect(migrate(input)).toMatchObject({ ok: false, error: { code: 'INVALID_VALUE' } });
  });

  it.each([undefined, 0, -1, 1.5, '1'])('rejects schema %s', (schema) => {
    expect(migrate({ ...raw(), schema })).toMatchObject({ ok: false, error: { path: 'schema' } });
  });

  it('requires a nodes object', () => {
    expect(migrate({ schema: 1, nodes: [] })).toMatchObject({
      ok: false,
      error: { path: 'nodes' },
    });
  });

  it('runs the chain step by step up to the target', () => {
    const calls: number[] = [];
    const steps: Record<number, Migration> = {
      1: (d) => {
        calls.push(1);
        return { ...d, name: `${String(d.name)}+v2` };
      },
      2: (d) => {
        calls.push(2);
        return { ...d, name: `${String(d.name)}+v3` };
      },
    };
    const r = migrate(raw(), { target: 3, steps });
    expect(calls).toEqual([1, 2]);
    expect(r).toMatchObject({ ok: true, migrated: true, fromSchema: 1 });
    if (r.ok) expect(r.doc).toMatchObject({ schema: 3, name: 'Untitled+v2+v3' });
  });

  it('reports a missing step instead of guessing', () => {
    const r = migrate(raw(), { target: 3, steps: { 1: (d) => d } });
    expect(r).toMatchObject({
      ok: false,
      error: { message: 'No migration from schema 2 to 3.' },
    });
    expect(migrate(raw(), { target: 2, steps: {} })).toMatchObject({ ok: false });
  });
});

describe('loadDoc / serializeDoc', () => {
  it('loads and validates a good document, and round-trips through JSON text', () => {
    const doc = createEmptyDoc({ rng: seededRng(4), now: '2026-01-01T00:00:00.000Z' });
    const text = serializeDoc(doc);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "schema": 1');
    const r = loadDoc(JSON.parse(text));
    expect(r).toMatchObject({ ok: true, migrated: false });
    if (r.ok) expect(r.doc).toEqual(doc);
  });

  it('fills defaults on sparse input', () => {
    const base = raw();
    const nodes = base.nodes as Record<string, Record<string, unknown>>;
    delete nodes.n_title?.visible;
    delete nodes.n_title?.opacity;
    const r = loadDoc(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.nodes.n_title).toMatchObject({ visible: true, opacity: 1 });
  });

  it('returns errors, never throws, for hostile input', () => {
    expect(loadDoc(null)).toMatchObject({ ok: false });
    expect(loadDoc({ schema: 9 })).toMatchObject({ ok: false, errors: [{ code: 'SCHEMA_NEWER' }] });

    const bad = raw();
    (bad.nodes as Record<string, unknown>).n_oops1 = 'not a node';
    (bad.nodes as Record<string, unknown>).n_oops2 = { id: 'n_oops2', type: 'blob' };
    expect(loadDoc(bad)).toMatchObject({
      ok: false,
      errors: [{ path: 'nodes.n_oops1' }, { path: 'nodes.n_oops2' }],
    });

    const invalid = raw();
    (invalid.nodes as Record<string, Record<string, unknown>>).n_title!.opacity = 9;
    expect(loadDoc(invalid)).toMatchObject({
      ok: false,
      errors: [{ path: 'nodes.n_title.opacity' }],
    });
  });

  it('passes validation warnings through', () => {
    const base = raw();
    const nodes = base.nodes as Record<string, Record<string, unknown>>;
    nodes.n_img01 = { id: 'n_img01', type: 'image', parentId: 'n_other', assetId: 'img_gone1' };
    nodes.n_other = { ...nodes.n_other, children: ['n_img01'] };
    const r = loadDoc(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings[0]?.code).toBe('MISSING_ASSET');
  });
});
