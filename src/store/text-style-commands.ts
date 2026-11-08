import { CoreError } from '@core/errors';
import { mergeTokens } from '@core/token-edit';
import { TEXT_STYLE_KEYS, type Doc, type Node, type TextStyle } from '@core/types';
import { TEXT_STYLE_NAME } from '@core/validate';
import type { Store } from './commands';
import type { EditResult } from './store';

/**
 * Shared text styles ("Title Outline"): make one from a layer, apply it, detach it, rename it,
 * delete it. Each is ONE undo step. A layer that uses a style takes its font, size, colour, outline
 * and shadow from it; detaching copies those values back onto the layer so it looks the same.
 */

/** The style a text layer currently looks like (only the settings it actually has). */
export function styleOf(node: Node): TextStyle {
  const out: Record<string, unknown> = {};
  for (const key of TEXT_STYLE_KEYS) {
    const v = node[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

function freeName(doc: Doc, base: string): string {
  const have = doc.tokens.textStyles ?? {};
  for (let i = 1; ; i += 1) {
    const name = `${base} ${i}`;
    if (!(name in have)) return name;
  }
}

/** Replaces `textStyle` on a layer by the values it stands for, so the layer looks the same without it. */
function detached(doc: Doc, node: Node): Node {
  const style = node.textStyle === undefined ? undefined : doc.tokens.textStyles?.[node.textStyle];
  const { textStyle: _gone, ...rest } = node;
  void _gone;
  return { ...rest, ...(style ?? {}) };
}

/** Saves the layer's look as a new style and makes the layer use it. Returns the new name. */
export function createTextStyleFromNode(
  store: Store,
  id: string,
): { result: EditResult; name: string | null } {
  let name: string | null = null;
  const result = store.getState().edit((doc) => {
    const node = doc.nodes[id];
    if (!node || node.type !== 'text') throw new CoreError('INVALID_VALUE', 'Select a text layer.');
    name = freeName(doc, 'Style');
    const tokens = mergeTokens(doc.tokens, { textStyles: { [name]: styleOf(node) } });
    return { ...doc, tokens, nodes: { ...doc.nodes, [id]: { ...node, textStyle: name } } };
  }, 'New text style');
  return { result, name };
}

/** Points text layers at a style, or (with null) detaches them from theirs. */
export function applyTextStyle(
  store: Store,
  ids: readonly string[],
  name: string | null,
): EditResult {
  return store.getState().edit(
    (doc) => {
      const nodes = { ...doc.nodes };
      for (const id of ids) {
        const node = nodes[id];
        if (!node || node.type !== 'text') continue;
        if (name === null) nodes[id] = detached(doc, node);
        else {
          if (!doc.tokens.textStyles?.[name])
            throw new CoreError('NOT_FOUND', `No text style "${name}".`);
          nodes[id] = { ...node, textStyle: name };
        }
      }
      return { ...doc, nodes };
    },
    name === null ? 'Detach text style' : `Apply text style ${name}`,
  );
}

/** Makes the style match this layer's look (every layer using the style follows). */
export function updateTextStyleFromNode(store: Store, name: string, id: string): EditResult {
  return store.getState().edit((doc) => {
    const node = doc.nodes[id];
    if (!node || node.type !== 'text') throw new CoreError('INVALID_VALUE', 'Select a text layer.');
    // The layer shows the style, so its own values are what the style says; read them through it.
    const look = { ...node, ...(doc.tokens.textStyles?.[name] ?? {}) };
    return {
      ...doc,
      tokens: mergeTokens(doc.tokens, { textStyles: { [name]: styleOf(look) } }),
    };
  }, `Update text style ${name}`);
}

export function renameTextStyle(store: Store, from: string, to: string): EditResult {
  return store.getState().edit((doc) => {
    const style = doc.tokens.textStyles?.[from];
    if (!style) throw new CoreError('NOT_FOUND', `No text style "${from}".`);
    if (to !== from && doc.tokens.textStyles?.[to]) {
      throw new CoreError('INVALID_VALUE', `There is already a text style "${to}".`);
    }
    if (!TEXT_STYLE_NAME.test(to))
      throw new CoreError('INVALID_VALUE', 'That is not a valid name.');
    const tokens = mergeTokens(doc.tokens, { textStyles: { [from]: null, [to]: style } });
    const nodes = Object.fromEntries(
      Object.entries(doc.nodes).map(([k, n]) => [
        k,
        n.textStyle === from ? { ...n, textStyle: to } : n,
      ]),
    );
    return { ...doc, tokens, nodes };
  }, 'Rename text style');
}

/** Deletes a style; layers that used it keep the look it gave them. */
export function deleteTextStyle(store: Store, name: string): EditResult {
  return store.getState().edit((doc) => {
    const nodes = Object.fromEntries(
      Object.entries(doc.nodes).map(([k, n]) => [k, n.textStyle === name ? detached(doc, n) : n]),
    );
    return { ...doc, nodes, tokens: mergeTokens(doc.tokens, { textStyles: { [name]: null } }) };
  }, 'Delete text style');
}

/** How many layers use each style. */
export function textStyleUsage(doc: Doc): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of Object.values(doc.nodes)) {
    if (n.textStyle !== undefined) out[n.textStyle] = (out[n.textStyle] ?? 0) + 1;
  }
  return out;
}
