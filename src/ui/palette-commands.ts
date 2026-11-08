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
import { GAME_THEMES } from '@core/themes';
import { WIDGET_INFO, WIDGET_KINDS } from '@core/widgets';
import {
  applyGameTheme,
  distributeSelection,
  gridSelection,
  insertWidget,
  matchSizeSelection,
  repeatSelection,
  type CommandResult,
} from '../store/game-commands';
import { showToast } from './toast';
import { betaOn } from './beta';
import { openPixelEditor } from '../pixelart/state';
import { setSnapSettings, useSnapSettings } from '../canvas/snap-settings';

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
      id: 'file.import.design',
      label: 'Import an SVG, Figma frame or web page…',
      group: 'File',
      run: () => openDialog('import'),
    },
    {
      id: 'design.check',
      label: 'Check the design…',
      group: 'Help',
      run: () => openDialog('lint'),
    },
    { id: 'ai.chat', label: 'Open the AI chat', group: 'Help', run: openChat },
    { id: 'ai.settings', label: 'AI settings…', group: 'Help', run: () => openDialog('settings') },
  ];
  const said = (result: CommandResult, done?: string): void => {
    if (!result.ok) showToast(result.reason, { kind: 'error' });
    else if (done) showToast(done);
  };
  const ctx = (): ReturnType<typeof currentShortcutContext> => currentShortcutContext();

  const gameWidgets: PaletteCommand[] = WIDGET_KINDS.map((kind) => ({
    id: `widget.${kind}`,
    label: `Insert widget: ${WIDGET_INFO[kind].label}`,
    group: 'Game UI',
    run: () => said(insertWidget(store, kind, ctx().api?.viewCenter() ?? null)),
  }));
  const gameThemes: PaletteCommand[] = GAME_THEMES.map((t) => ({
    id: `gametheme.${t.id}`,
    label: `Game theme: ${t.label}`,
    group: 'Game UI',
    run: () => said(applyGameTheme(store, t.id), `Theme: ${t.label}`),
  }));
  const arrange: PaletteCommand[] = [
    {
      id: 'arrange.distributeH',
      label: 'Distribute horizontally',
      group: 'Arrange',
      run: () => said(distributeSelection(ctx().env, 'horizontal')),
    },
    {
      id: 'arrange.distributeV',
      label: 'Distribute vertically',
      group: 'Arrange',
      run: () => said(distributeSelection(ctx().env, 'vertical')),
    },
    {
      id: 'arrange.grid',
      label: 'Arrange selection in a grid',
      group: 'Arrange',
      run: () =>
        said(
          gridSelection(
            ctx().env,
            Math.max(1, Math.ceil(Math.sqrt(store.getState().selection.length))),
          ),
        ),
    },
    {
      id: 'arrange.sameWidth',
      label: 'Match width of selection',
      group: 'Arrange',
      run: () => said(matchSizeSelection(ctx().env, 'w')),
    },
    {
      id: 'arrange.sameHeight',
      label: 'Match height of selection',
      group: 'Arrange',
      run: () => said(matchSizeSelection(ctx().env, 'h')),
    },
    ...[3, 5, 9].map((n) => ({
      id: `arrange.repeat${n}`,
      label: `Repeat selected layer ×${n} in a ${n === 9 ? 'grid' : 'row'}`,
      group: 'Arrange',
      run: () =>
        said(repeatSelection(ctx().env, n, n === 9 ? 'grid' : 'row', n === 9 ? 3 : undefined)),
    })),
  ];
  const snapping: PaletteCommand[] = [
    {
      id: 'snap.objects',
      label: 'Snapping: toggle snap to layers',
      group: 'View',
      run: () => setSnapSettings({ objects: !useSnapSettings.getState().objects }),
    },
    {
      id: 'snap.spacing',
      label: 'Snapping: toggle equal spacing guides',
      group: 'View',
      run: () => setSnapSettings({ spacing: !useSnapSettings.getState().spacing }),
    },
    ...[0, 4, 8, 16].map((n) => ({
      id: `snap.grid.${n}`,
      label: n === 0 ? 'Snapping: grid off' : `Snapping: grid ${n} px`,
      group: 'View',
      run: () => setSnapSettings({ grid: n, enabled: true }),
    })),
  ];
  // A beta feature that is off has no menu entry.
  const beta: PaletteCommand[] = betaOn('pixelArt')
    ? [
        {
          id: 'beta.pixelart',
          label: 'Open the Pixel Art editor (beta)',
          group: 'Create',
          run: openPixelEditor,
        },
      ]
    : [];
  return [
    ...fromShortcuts,
    ...beta,
    ...snapping,
    ...frames,
    ...themes,
    ...other,
    ...gameWidgets,
    ...gameThemes,
    ...arrange,
  ];
}
