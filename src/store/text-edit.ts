import type { Store } from './commands';

/**
 * Inline text editing is one undo step: the user types straight into the DOM (nothing is
 * dispatched while typing), and committing writes the final text once. Creating a text node with
 * the Text tool opens a transaction that this commit (or cancel) closes, so "create + type" also
 * undoes in one go.
 */

/** Starts editing `id`. */
export function beginTextEdit(store: Store, id: string): void {
  store.getState().setEditingTextId(id);
}

/**
 * Finishes editing with the text now in the DOM. Empty text removes the node (a text layer with
 * nothing in it is invisible and unselectable); for a node created in this same gesture that
 * means cancelling the creation entirely.
 */
export function commitTextEdit(store: Store, id: string, text: string): void {
  const s = store.getState();
  if (s.editingTextId !== id) return; // already committed (blur after Escape, for instance)
  s.setEditingTextId(null);
  const node = s.doc.nodes[id];
  if (!node) {
    s.endTransaction();
    return;
  }
  if (text.trim() === '') {
    if (s.transaction !== null) s.cancelTransaction();
    else s.dispatch([{ op: 'delete', id }], { label: 'Delete empty text' });
    return;
  }
  if (node.text !== text) {
    s.dispatch([{ op: 'update', id, set: { text } }], { label: 'Edit text' });
  }
  s.endTransaction();
}

/** Abandons an edit without changing the text (used when the node disappears under the editor). */
export function cancelTextEdit(store: Store): void {
  const s = store.getState();
  s.setEditingTextId(null);
  s.endTransaction();
}
