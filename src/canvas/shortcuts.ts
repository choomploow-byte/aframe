import {
  addAutoLayout,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  enterSelection,
  nudgeSelection,
  pasteClipboard,
  reorderSelection,
  selectAll,
  selectParent,
  selectSibling,
  wrapSelectionInFrame,
  type Env,
  type Store,
} from '../store/commands';
import type { ToolId } from '../store/store';
import { openDialog } from '../ui/ui-state';
import type { CanvasApi } from './canvas-api';

/**
 * One registry of keyboard shortcuts (docs/07). The key handler runs it today; the command
 * palette will list and run the very same entries (Phase 3), so nothing is defined twice.
 */
export interface ShortcutContext {
  store: Store;
  env: Env;
  api: CanvasApi | null;
}

export interface Shortcut {
  id: string;
  label: string;
  /** Display string, e.g. "Ctrl+Shift+Z". */
  keys: string;
  match: (e: KeyboardEvent) => boolean;
  run: (ctx: ShortcutContext, mods: { shift: boolean }) => void;
  /** Whether holding the key repeats the action. */
  repeat?: boolean;
  /** Runs even while a text field has focus (the command palette, the shortcut sheet). */
  global?: boolean;
}

const mod = (e: KeyboardEvent): boolean => e.ctrlKey || e.metaKey;
const plain = (e: KeyboardEvent): boolean => !mod(e) && !e.altKey && !e.shiftKey;

const tool = (id: string, label: string, key: string, tool: ToolId): Shortcut => ({
  id,
  label,
  keys: key.toUpperCase(),
  match: (e) => plain(e) && e.key.toLowerCase() === key,
  run: ({ store }) => store.getState().setTool(tool),
});

const arrow = (name: string, dx: number, dy: number): Shortcut => ({
  id: `nudge.${name}`,
  label: `Nudge ${name}`,
  keys: `Arrow ${name}`,
  match: (e) => !mod(e) && !e.altKey && e.key === `Arrow${name}`,
  run: ({ store }, mods) => {
    const step = mods.shift ? 10 : 1;
    nudgeSelection(store, dx * step, dy * step);
  },
  repeat: true,
});

/** Best effort only: other windows can paste this, the editor itself uses the store clipboard. */
function writeSystemClipboard(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

export const SHORTCUTS: readonly Shortcut[] = [
  tool('tool.select', 'Select tool', 'v', 'select'),
  tool('tool.frame', 'Frame tool', 'f', 'frame'),
  tool('tool.rect', 'Rectangle tool', 'r', 'rect'),
  tool('tool.ellipse', 'Ellipse tool', 'o', 'ellipse'),
  tool('tool.text', 'Text tool', 't', 'text'),
  tool('tool.hand', 'Hand tool', 'h', 'hand'),

  {
    id: 'edit.undo',
    label: 'Undo',
    keys: 'Ctrl+Z',
    match: (e) => mod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z',
    run: ({ store }) => void store.getState().undo(),
    repeat: true,
  },
  {
    id: 'edit.redo',
    label: 'Redo',
    keys: 'Ctrl+Shift+Z',
    match: (e) =>
      mod(e) &&
      !e.altKey &&
      ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y'),
    run: ({ store }) => void store.getState().redo(),
    repeat: true,
  },
  {
    id: 'edit.copy',
    label: 'Copy',
    keys: 'Ctrl+C',
    match: (e) => mod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c',
    run: ({ store }) => {
      const specs = copySelection(store);
      if (specs) writeSystemClipboard(JSON.stringify({ atelier: 1, nodes: specs }));
    },
  },
  {
    id: 'edit.cut',
    label: 'Cut',
    keys: 'Ctrl+X',
    match: (e) => mod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'x',
    run: ({ store }) => {
      const specs = cutSelection(store);
      if (specs) writeSystemClipboard(JSON.stringify({ atelier: 1, nodes: specs }));
    },
  },
  {
    id: 'edit.paste',
    label: 'Paste',
    keys: 'Ctrl+V',
    match: (e) => mod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v',
    run: ({ env }) => void pasteClipboard(env),
  },
  {
    id: 'edit.duplicate',
    label: 'Duplicate',
    keys: 'Ctrl+D',
    match: (e) => mod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd',
    run: ({ env }) => void duplicateSelection(env),
  },
  {
    id: 'edit.delete',
    label: 'Delete',
    keys: 'Delete',
    match: (e) => !mod(e) && !e.altKey && (e.key === 'Delete' || e.key === 'Backspace'),
    run: ({ store }) => void deleteSelection(store),
  },
  {
    id: 'edit.selectAll',
    label: 'Select all',
    keys: 'Ctrl+A',
    match: (e) => mod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a',
    run: ({ store }) => selectAll(store),
  },
  {
    id: 'structure.wrap',
    label: 'Wrap in frame',
    keys: 'Ctrl+G',
    match: (e) => mod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'g',
    run: ({ env }) => void wrapSelectionInFrame(env),
  },
  {
    id: 'structure.autoLayout',
    label: 'Add auto layout',
    keys: 'Ctrl+Alt+A',
    // `code`, not `key`: with Alt held, macOS reports a different character for the A key.
    match: (e) => mod(e) && e.altKey && !e.shiftKey && e.code === 'KeyA',
    run: ({ env }) => void addAutoLayout(env),
  },
  {
    id: 'order.forward',
    label: 'Bring forward',
    keys: ']',
    match: (e) => !mod(e) && !e.altKey && !e.shiftKey && e.code === 'BracketRight',
    run: ({ store }) => void reorderSelection(store, 'forward'),
  },
  {
    id: 'order.backward',
    label: 'Send backward',
    keys: '[',
    match: (e) => !mod(e) && !e.altKey && !e.shiftKey && e.code === 'BracketLeft',
    run: ({ store }) => void reorderSelection(store, 'backward'),
  },
  {
    id: 'order.front',
    label: 'Bring to front',
    keys: 'Ctrl+]',
    match: (e) => mod(e) && !e.altKey && !e.shiftKey && e.code === 'BracketRight',
    run: ({ store }) => void reorderSelection(store, 'front'),
  },
  {
    id: 'order.back',
    label: 'Send to back',
    keys: 'Ctrl+[',
    match: (e) => mod(e) && !e.altKey && !e.shiftKey && e.code === 'BracketLeft',
    run: ({ store }) => void reorderSelection(store, 'back'),
  },

  arrow('Left', -1, 0),
  arrow('Right', 1, 0),
  arrow('Up', 0, -1),
  arrow('Down', 0, 1),

  {
    id: 'select.next',
    label: 'Select next sibling',
    keys: 'Tab',
    match: (e) => !mod(e) && !e.altKey && !e.shiftKey && e.key === 'Tab',
    run: ({ store }) => void selectSibling(store, 1),
    repeat: true,
  },
  {
    id: 'select.previous',
    label: 'Select previous sibling',
    keys: 'Shift+Tab',
    match: (e) => !mod(e) && !e.altKey && e.shiftKey && e.key === 'Tab',
    run: ({ store }) => void selectSibling(store, -1),
    repeat: true,
  },
  {
    id: 'select.enter',
    label: 'Enter frame / edit text',
    keys: 'Enter',
    match: (e) => plain(e) && e.key === 'Enter',
    run: ({ store }) => void enterSelection(store),
  },
  {
    id: 'select.escape',
    label: 'Cancel / select parent',
    keys: 'Esc',
    match: (e) => e.key === 'Escape',
    run: ({ store, api }) => {
      if (api?.cancelGesture()) return;
      const s = store.getState();
      if (s.tool !== 'select') s.setTool('select');
      else selectParent(store);
    },
  },

  {
    id: 'view.fitAll',
    label: 'Zoom to fit all',
    keys: 'Shift+1',
    match: (e) => !mod(e) && !e.altKey && e.shiftKey && e.code === 'Digit1',
    run: ({ api }) => api?.fitAll(),
  },
  {
    id: 'view.fitSelection',
    label: 'Zoom to selection',
    keys: 'Shift+2',
    match: (e) => !mod(e) && !e.altKey && e.shiftKey && e.code === 'Digit2',
    run: ({ api }) => api?.fitSelection(),
  },
  {
    id: 'view.actualSize',
    label: 'Zoom to 100%',
    keys: 'Ctrl+0',
    match: (e) =>
      mod(e) && !e.altKey && !e.shiftKey && (e.code === 'Digit0' || e.code === 'Numpad0'),
    run: ({ api }) => api?.zoomTo(1),
  },
  {
    id: 'view.zoomIn',
    label: 'Zoom in',
    keys: '+',
    match: (e) => !e.altKey && (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd'),
    run: ({ api }) => api?.zoomStep(1),
    repeat: true,
  },
  {
    id: 'view.zoomOut',
    label: 'Zoom out',
    keys: '-',
    match: (e) => !e.altKey && (e.key === '-' || e.code === 'NumpadSubtract'),
    run: ({ api }) => api?.zoomStep(-1),
    repeat: true,
  },
  {
    id: 'help.palette',
    label: 'Command palette',
    keys: 'Ctrl+K',
    // Also works while a text field has focus: the palette is how you reach everything else.
    match: (e) => mod(e) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k',
    run: () => openDialog('palette'),
    global: true,
  },
  {
    id: 'help.shortcuts',
    label: 'Keyboard shortcuts',
    keys: 'Ctrl+/',
    match: (e) => mod(e) && !e.altKey && e.key === '/',
    run: () => openDialog('shortcuts'),
    global: true,
  },
  {
    id: 'debug.hud',
    label: 'Toggle performance HUD',
    keys: 'Ctrl+Alt+D',
    match: (e) => mod(e) && e.altKey && !e.shiftKey && e.code === 'KeyD',
    run: ({ store }) => store.getState().toggleHud(),
  },
];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName));
}

/**
 * Keys every focused control already uses for itself (moving between controls, activating a button,
 * walking a tree). They only mean "canvas action" when the canvas, or nothing, has focus; otherwise
 * Tab would never leave the canvas and the arrow keys in the Layers panel would nudge the node.
 */
const NAVIGATION_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Enter',
  ' ',
]);

function canvasHasFocus(target: EventTarget | null, key: string): boolean {
  const el = target as HTMLElement | null;
  // Nothing focused: Tab should walk into the interface, the other keys act on the canvas.
  if (!el || el === document.body || el === document.documentElement) return key !== 'Tab';
  return typeof el.matches === 'function' && el.matches('[data-testid="canvas"]');
}

/** Handles a keydown. Returns true if a shortcut ran (the caller stops the browser's default). */
export function handleKeyDown(e: KeyboardEvent, ctx: ShortcutContext): boolean {
  if (e.isComposing || e.defaultPrevented) return false; // a widget already handled it
  const typing = isTyping(e.target);
  const navigation = NAVIGATION_KEYS.has(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey;
  for (const shortcut of SHORTCUTS) {
    if (!shortcut.match(e)) continue;
    if (typing && !shortcut.global) continue;
    if (navigation && !shortcut.global && !canvasHasFocus(e.target, e.key)) continue;
    if (e.repeat && !shortcut.repeat) return true;
    e.preventDefault();
    shortcut.run(ctx, { shift: e.shiftKey });
    return true;
  }
  return false;
}
