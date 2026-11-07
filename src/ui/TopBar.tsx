import { Check, ChevronDown, FolderOpen, Monitor, Moon, Redo2, Sun, Undo2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { BRAND } from '../brand';
import { useConnect } from '../connect/agents';
import { openExportDialog } from '../export/dialog-state';
import { exportProjectFile, useProjects } from '../projects/session';
import { renameProject } from '../store/panel-commands';
import { store, useAtelier } from '../store/store';
import { STRINGS } from '../strings';
import { LogoMark, Wordmark } from './Brand';
import { ContextMenu } from './ContextMenu';
import { TextField } from './fields';
import { nextTheme, setThemePreference, useThemePreference } from './theme';
import { openDialog } from './ui-state';

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;
const THEME_LABEL = { system: 'the system setting', light: 'light', dark: 'dark' } as const;

/** Whether the open project is safely on disk. Hidden while no project is attached. */
function SaveStatus() {
  const save = useProjects((s) => s.save);
  const fatal = useProjects((s) => s.fatal);
  const t = STRINGS.projects.save;
  if (fatal !== null) {
    return (
      <span
        className="save save--error"
        role="status"
        title={fatal}
        data-testid="save-status"
        data-state="error"
      >
        {t.unsaved}
      </span>
    );
  }
  if (save.state === 'detached') return null;
  const state = save.state === 'dirty' ? 'saving' : save.state; // 250 ms of "dirty" is not worth flashing
  const label = state === 'saved' ? t.saved : state === 'saving' ? t.saving : t.error;
  return (
    <span
      className={`save save--${state}`}
      role="status"
      aria-live="polite"
      title={save.message ?? undefined}
      data-testid="save-status"
      data-state={state}
    >
      {state === 'saved' && <Check size={12} strokeWidth={2} aria-hidden="true" />}
      {label}
    </span>
  );
}

/** Projects, project name and save status, undo/redo, export menu (a stub until Phase 8), theme and Connect AI. */
export function TopBar() {
  const canUndo = useAtelier((s) => s.history.past.length > 0);
  const canRedo = useAtelier((s) => s.history.future.length > 0);
  const name = useAtelier((s) => s.doc.name);
  const theme = useThemePreference();
  const connected = useConnect((s) => s.connected);
  const ThemeIcon = THEME_ICON[theme];
  const exportButton = useRef<HTMLButtonElement>(null);
  const [exportAt, setExportAt] = useState<{ x: number; y: number } | null>(null);

  return (
    <header className="topbar">
      <LogoMark size={22} />
      <Wordmark height={18} label={BRAND.name} />
      <button
        type="button"
        className="icon-btn"
        aria-label={STRINGS.projects.title}
        title={`${STRINGS.projects.title} (Ctrl+O)`}
        data-testid="open-projects"
        onClick={() => openDialog('projects')}
      >
        <FolderOpen size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <div className="topbar__project">
        <TextField
          ariaLabel="Project name"
          field="project-name"
          value={name === 'Untitled' ? '' : name}
          placeholder={STRINGS.topbar.untitled}
          maxLength={120}
          onCommit={(v) => renameProject(store, v)}
        />
      </div>
      <SaveStatus />
      <span className="topbar__group">
        <button
          type="button"
          className="icon-btn"
          aria-label={STRINGS.topbar.undo}
          title={`${STRINGS.topbar.undo} (Ctrl+Z)`}
          disabled={!canUndo}
          data-testid="undo"
          onClick={() => void store.getState().undo()}
        >
          <Undo2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={STRINGS.topbar.redo}
          title={`${STRINGS.topbar.redo} (Ctrl+Shift+Z)`}
          disabled={!canRedo}
          data-testid="redo"
          onClick={() => void store.getState().redo()}
        >
          <Redo2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </span>
      <span className="topbar__spacer" />
      <button
        type="button"
        className="btn btn--ghost btn--small"
        aria-label="Command palette"
        title="Command palette (Ctrl+K)"
        data-testid="open-palette"
        onClick={() => openDialog('palette')}
      >
        Ctrl K
      </button>
      <button
        ref={exportButton}
        type="button"
        className="btn btn--secondary btn--small"
        aria-haspopup="menu"
        data-testid="export-menu"
        onClick={() => {
          const r = exportButton.current?.getBoundingClientRect();
          if (r) setExportAt({ x: r.right - 200, y: r.bottom + 4 });
        }}
      >
        {STRINGS.topbar.export}
        <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      {exportAt && (
        <ContextMenu
          x={exportAt.x}
          y={exportAt.y}
          label="Export"
          onClose={() => setExportAt(null)}
          items={[
            {
              id: 'code',
              label: 'Design as code…',
              shortcut: 'Ctrl+Shift+E',
              run: () => openExportDialog('code'),
            },
            { id: 'image', label: 'Image (PNG or SVG)…', run: () => openExportDialog('image') },
            { kind: 'separator' },
            { id: 'project', label: 'Project file (.atelier.json)', run: exportProjectFile },
          ]}
        />
      )}
      <button
        type="button"
        className="icon-btn"
        aria-label={`Theme: ${THEME_LABEL[theme]}. Switch theme`}
        title={`Theme: ${THEME_LABEL[theme]}`}
        data-testid="theme-toggle"
        data-theme-pref={theme}
        onClick={() => setThemePreference(nextTheme(theme))}
      >
        <ThemeIcon size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="pill"
        data-testid="connect-ai"
        data-connected={connected}
        title={connected ? 'An AI tool is connected' : 'No AI tool connected yet'}
        onClick={() => openDialog('connect')}
      >
        <span className={`pill__dot${connected ? ' pill__dot--on' : ''}`} aria-hidden="true" />
        {STRINGS.topbar.connect}
      </button>
    </header>
  );
}
