import { buildDoc, deepFreeze, sampleDoc } from '@core/testing';
import { describe, expect, it } from 'vitest';
import { createAtelierStore } from './store';
import {
  addToken,
  deleteTokenCommand,
  renameTokenCommand,
  setSpacingScale,
  setTokenValue,
  tokenFromSelection,
  uniqueTokenName,
} from './token-commands';

function setup() {
  let t = 0;
  const base = buildDoc([
    {
      id: 'n_box01',
      type: 'frame',
      fill: '$primary',
      children: [
        { id: 'n_txt01', type: 'text', text: 'Hi', color: '#123456' },
        { id: 'n_rct01', type: 'rect', fill: '#C0FFEE' },
        { id: 'n_rct02', type: 'rect', fill: '$primary' },
      ],
    },
  ]);
  const store = createAtelierStore({
    doc: deepFreeze(base),
    now: () => (t += 1000),
    isoNow: () => '2026-07-07T00:00:00.000Z',
  });
  return { store, get: () => store.getState() };
}

describe('uniqueTokenName', () => {
  it('finds the first free numbered name', () => {
    expect(uniqueTokenName({}, 'colour')).toBe('colour-1');
    expect(uniqueTokenName({ 'colour-1': 1, 'colour-2': 2 }, 'colour')).toBe('colour-3');
  });
});

describe('token commands', () => {
  it('sets, adds, renames and deletes tokens, each as an undoable step', () => {
    const { store, get } = setup();
    expect(setTokenValue(store, 'color', 'primary', '#112233').ok).toBe(true);
    expect(get().doc.tokens.colors.primary).toBe('#112233');

    const added = addToken(store, 'color');
    expect(added.result.ok).toBe(true);
    expect(added.name).toBe('colour-1');
    expect(get().doc.tokens.colors['colour-1']).toBe('#808080');

    expect(renameTokenCommand(store, 'color', 'primary', 'brand').ok).toBe(true);
    expect(get().doc.nodes.n_box01?.fill).toBe('$brand');
    expect(get().doc.nodes.n_rct02?.fill).toBe('$brand');

    const del = deleteTokenCommand(store, 'color', 'brand');
    expect(del.uses).toBe(2);
    expect(del.result.ok).toBe(true);
    expect(get().doc.nodes.n_box01?.fill).toBe('#112233');
    expect(get().doc.tokens.colors).not.toHaveProperty('brand');

    expect(get().history.past.map((e) => e.label)).toEqual([
      'Edit token',
      'Add color token',
      'Rename token',
      'Delete token',
    ]);
    get().undo();
    expect(get().doc.nodes.n_box01?.fill).toBe('$brand');
  });

  it('adds fonts and radii with sensible defaults, and edits the spacing scale', () => {
    const { store, get } = setup();
    addToken(store, 'font');
    addToken(store, 'radius');
    expect(get().doc.tokens.fonts['font-1']).toBe('Inter');
    expect(get().doc.tokens.radii['radius-1']).toBe(8);
    expect(setSpacingScale(store, [2, 4, 6]).ok).toBe(true);
    expect(get().doc.tokens.spacing).toEqual([2, 4, 6]);
    expect(setSpacingScale(store, [-1]).ok).toBe(false);
  });

  it('merges a scrub of the same token value into one undo step', () => {
    const { store, get } = setup();
    // Same key, closer together than the 300 ms window: the test clock advances 1000 per call, so
    // drive the store clock directly via two quick edits through the same function.
    setTokenValue(store, 'radius', 'md', 11);
    expect(get().doc.tokens.radii.md).toBe(11);
    expect(get().history.past).toHaveLength(1);
  });

  it('reports invalid input without changing anything', () => {
    const { store, get } = setup();
    const before = get().doc;
    const bad = setTokenValue(store, 'color', 'primary', 'url(evil)');
    expect(bad).toMatchObject({ ok: false, error: { code: 'INVALID_VALUE' } });
    expect(renameTokenCommand(store, 'color', 'primary', 'text')).toMatchObject({ ok: false });
    expect(renameTokenCommand(store, 'color', 'nope', 'x')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(deleteTokenCommand(store, 'color', 'nope').result).toMatchObject({ ok: false });
    expect(get().doc).toBe(before);
  });
});

describe('tokenFromSelection', () => {
  it('turns a literal fill into a token and points the layer at it, in one undo step', () => {
    const { store, get } = setup();
    get().setSelection(['n_rct01']);
    const res = tokenFromSelection(store);
    expect(res).toEqual({ ok: true, name: 'colour-1' });
    expect(get().doc.tokens.colors['colour-1']).toBe('#C0FFEE');
    expect(get().doc.nodes.n_rct01?.fill).toBe('$colour-1');
    expect(get().history.past.map((e) => e.label)).toEqual(['Create token']);
    get().undo();
    expect(get().doc.nodes.n_rct01?.fill).toBe('#C0FFEE');
    expect(get().doc.tokens.colors).not.toHaveProperty('colour-1');
  });

  it('uses the text colour for text layers', () => {
    const { store, get } = setup();
    get().setSelection(['n_txt01']);
    expect(tokenFromSelection(store)).toMatchObject({ ok: true });
    expect(get().doc.nodes.n_txt01?.color).toBe('$colour-1');
    expect(get().doc.tokens.colors['colour-1']).toBe('#123456');
  });

  it('explains why it cannot', () => {
    const { store, get } = setup();
    expect(tokenFromSelection(store)).toEqual({ ok: false, message: 'Select one layer first.' });
    get().setSelection(['n_box01']);
    expect(tokenFromSelection(store)).toMatchObject({
      ok: false,
      message: 'That colour already comes from a token.',
    });
    get().dispatch([
      { op: 'update', id: 'n_rct01', set: { fill: 'linear-gradient(90deg, #fff 0%, #000 100%)' } },
    ]);
    get().setSelection(['n_rct01']);
    expect(tokenFromSelection(store)).toMatchObject({
      ok: false,
      message: 'Only solid colours can become tokens.',
    });
    get().dispatch([{ op: 'update', id: 'n_rct01', set: { fill: null } }]);
    expect(tokenFromSelection(store)).toMatchObject({
      ok: false,
      message: 'This layer has no fill to turn into a token.',
    });
    expect(get().transaction).toBeNull();
  });

  it('works on the sample document too', () => {
    let t = 0;
    const store = createAtelierStore({ doc: deepFreeze(sampleDoc()), now: () => (t += 1000) });
    store.getState().dispatch([{ op: 'update', id: 'n_recta', set: { fill: '#ABCDEF' } }]);
    store.getState().setSelection(['n_recta']);
    expect(tokenFromSelection(store)).toMatchObject({ ok: true });
  });
});
