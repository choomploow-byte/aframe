import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { store } from '../store/store';
import { showToast } from '../ui/toast';
import { openDialog } from '../ui/ui-state';

export type ExportMode = 'code' | 'image';

interface ExportTarget {
  nodeId: string | null;
  mode: ExportMode;
}

/** What the Export dialog is about. UI-only state: never saved with the design. */
export const exportTarget = createStore<ExportTarget>()(() => ({ nodeId: null, mode: 'code' }));

export const useExportTarget = (): ExportTarget => useStore(exportTarget, (s) => s);

/** The frame an export means: the selection if it is one thing, else the first top-level frame. */
export function defaultExportNode(): string | null {
  const s = store.getState();
  const root = s.doc.nodes[s.doc.rootId];
  const picked = s.selection.length === 1 ? s.selection[0] : undefined;
  const node = picked === undefined ? undefined : s.doc.nodes[picked];
  if (node && node.type !== 'page' && node.visible) return node.id;
  const first = root?.children.find((id) => s.doc.nodes[id]?.visible);
  return first ?? null;
}

export function openExportDialog(mode: ExportMode, nodeId?: string): void {
  const target = nodeId ?? defaultExportNode();
  if (target === null) {
    showToast('Add a frame to the canvas first: there is nothing to export yet.', {
      kind: 'error',
    });
    return;
  }
  exportTarget.setState({ nodeId: target, mode });
  openDialog('export');
}
