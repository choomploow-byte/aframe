import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  pasteClipboard,
  reorderSelection,
  wrapSelectionInFrame,
  addAutoLayout,
} from '../store/commands';
import { setLayerFlag } from '../store/panel-commands';
import { store } from '../store/store';
import { currentShortcutContext } from '../canvas/useShortcuts';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { menuStore, useOpenMenu } from './context-menu-state';

/** Items for the right-click menu on the canvas and in Layers. Each entry reuses a command. */
function itemsFor(): MenuItem[] {
  const s = store.getState();
  const has = s.selection.length > 0;
  const { env } = currentShortcutContext();
  const nodes = s.selection.map((id) => s.doc.nodes[id]).filter((n) => n !== undefined);
  const allHidden = nodes.length > 0 && nodes.every((n) => !n.visible);
  const allLocked = nodes.length > 0 && nodes.every((n) => n.locked);
  return [
    {
      id: 'cut',
      label: 'Cut',
      shortcut: 'Ctrl+X',
      disabled: !has,
      run: () => void cutSelection(store),
    },
    {
      id: 'copy',
      label: 'Copy',
      shortcut: 'Ctrl+C',
      disabled: !has,
      run: () => void copySelection(store),
    },
    {
      id: 'paste',
      label: 'Paste',
      shortcut: 'Ctrl+V',
      disabled: s.clipboard === null,
      run: () => void pasteClipboard(env),
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      shortcut: 'Ctrl+D',
      disabled: !has,
      run: () => void duplicateSelection(env),
    },
    {
      id: 'delete',
      label: 'Delete',
      shortcut: 'Del',
      danger: true,
      disabled: !has,
      run: () => void deleteSelection(store),
    },
    { kind: 'separator' },
    {
      id: 'wrap',
      label: 'Wrap in frame',
      shortcut: 'Ctrl+G',
      disabled: !has,
      run: () => void wrapSelectionInFrame(env),
    },
    {
      id: 'autolayout',
      label: 'Add auto layout',
      shortcut: 'Ctrl+Alt+A',
      disabled: !has,
      run: () => void addAutoLayout(env),
    },
    { kind: 'separator' },
    {
      id: 'front',
      label: 'Bring to front',
      shortcut: 'Ctrl+]',
      disabled: !has,
      run: () => void reorderSelection(store, 'front'),
    },
    {
      id: 'forward',
      label: 'Bring forward',
      shortcut: ']',
      disabled: !has,
      run: () => void reorderSelection(store, 'forward'),
    },
    {
      id: 'backward',
      label: 'Send backward',
      shortcut: '[',
      disabled: !has,
      run: () => void reorderSelection(store, 'backward'),
    },
    {
      id: 'back',
      label: 'Send to back',
      shortcut: 'Ctrl+[',
      disabled: !has,
      run: () => void reorderSelection(store, 'back'),
    },
    { kind: 'separator' },
    {
      id: 'hide',
      label: allHidden ? 'Show' : 'Hide',
      disabled: !has,
      run: () => void setLayerFlag(store, s.selection, 'visible', allHidden),
    },
    {
      id: 'lock',
      label: allLocked ? 'Unlock' : 'Lock',
      disabled: !has,
      run: () => void setLayerFlag(store, s.selection, 'locked', !allLocked),
    },
    { kind: 'separator' },
    { id: 'code', label: 'Copy as code (coming later)', disabled: true, run: () => undefined },
    { id: 'ask', label: 'Ask AI about this… (coming later)', disabled: true, run: () => undefined },
  ];
}

/** Mounts the context menu when one is requested. */
export function ContextMenus() {
  const open = useOpenMenu();
  if (!open) return null;
  return (
    <ContextMenu
      x={open.x}
      y={open.y}
      items={itemsFor()}
      label={open.source === 'layers' ? 'Layer menu' : 'Canvas menu'}
      onClose={() => menuStore.getState().close()}
    />
  );
}
