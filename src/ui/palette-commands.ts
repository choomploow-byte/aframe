import { TEMPLATE_INFO, TEMPLATES } from '@core/templates';
import { DEVICE_PRESETS } from '../canvas/presets';
import { SHORTCUTS } from '../canvas/shortcuts';
import { currentShortcutContext } from '../canvas/useShortcuts';
import { addArtboard } from '../store/commands';
import {
  createNewProject,
  createSampleProject,
  exportProjectFile,
  importProjectFile,
} from '../projects/session';
import { store } from '../store/store';
import { importFiles } from './image-import';
import { setThemePreference, type ThemePreference } from './theme';
import { openExportDialog } from '../export/dialog-state';
import { openChat } from '../chat/focus';
import { openDialog } from './ui-state';

/**
 * Everything the command palette (Ctrl+K) can run: every keyboard shortcut from the one registry,
 * plus actions that have no key (frame sizes, theme, images, sample project).
 */
export interface PaletteCommand {
  id: string;
  label: string;
  /** Display shortcut, if any. */
  keys?: string;
  group: string;
  run: () => void;
}

const GROUPS: Record<string, string> = {
  tool: 'Tools',
  file: 'File',
  edit: 'Edit',
  structure: 'Structure',
  order: 'Arrange',
  nudge: 'Move',
  select: 'Select',
  view: 'View',
  help: 'Help',
  debug: 'Debug',
};

export const groupOf = (id: string): string => GROUPS[id.split('.')[0] ?? ''] ?? 'Other';

function pickImages(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
  input.multiple = true;
  input.onchange = () => void importFiles([...(input.files ?? [])], { insert: true });
  input.click();
}

export function buildPaletteCommands(): PaletteCommand[] {
  const fromShortcuts: PaletteCommand[] = SHORTCUTS.filter((s) => !s.id.startsWith('nudge.')).map(
    (s) => ({
      id: s.id,
      label: s.label,
      keys: s.keys,
      group: groupOf(s.id),
      run: () => s.run(currentShortcutContext(), { shift: false }),
    }),
  );

  const frames: PaletteCommand[] = DEVICE_PRESETS.map((p) => ({
    id: `frame.${p.id}`,
    label: `Add ${p.label} frame (${p.w} × ${p.h})`,
    group: 'Create',
    run: () => addArtboard(store, p, currentShortcutContext().api?.viewCenter() ?? { x: 0, y: 0 }),
  }));

  const themes: PaletteCommand[] = (['system', 'light', 'dark'] as ThemePreference[]).map((t) => ({
    id: `theme.${t}`,
    label: t === 'system' ? 'Theme: follow the system' : `Theme: ${t}`,
    group: 'View',
    run: () => setThemePreference(t),
  }));

  const pickProjectFile = (): void => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void importProjectFile(file);
    };
    input.click();
  };

  const other: PaletteCommand[] = [
    { id: 'file.new', label: 'New project', group: 'File', run: () => void createNewProject() },
    ...TEMPLATES.filter((tpl) => tpl !== 'blank').map((tpl): PaletteCommand => ({
      id: `file.new.${tpl}`,
      label: `New project: ${TEMPLATE_INFO[tpl].label}`,
      group: 'File',
      run: () => void createNewProject(tpl),
    })),
    { id: 'file.import', label: 'Import a project file…', group: 'File', run: pickProjectFile },
    {
      id: 'export.code',
      label: 'Export design as code…',
      group: 'File',
      run: () => openExportDialog('code'),
    },
    {
      id: 'export.image',
      label: 'Export image (PNG or SVG)…',
      group: 'File',
      run: () => openExportDialog('image'),
    },
    {
      id: 'file.export',
      label: 'Export this project as a file',
      group: 'File',
      run: exportProjectFile,
    },
    { id: 'images.add', label: 'Add images…', group: 'Create', run: pickImages },
    {
      id: 'file.sample',
      label: 'Open the sample project',
      group: 'File',
      run: () => void createSampleProject(),
    },
    { id: 'ai.connect', label: 'Connect your AI', group: 'Help', run: () => openDialog('connect') },
    {
      id: 'design.check',
      label: 'Check the design…',
      group: 'Help',
      run: () => openDialog('lint'),
    },
    { id: 'ai.chat', label: 'Open the AI chat', group: 'Help', run: openChat },
    { id: 'ai.settings', label: 'AI settings…', group: 'Help', run: () => openDialog('settings') },
  ];
  return [...fromShortcuts, ...frames, ...themes, ...other];
}
