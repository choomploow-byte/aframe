import { ChevronDown, Monitor, Moon, Redo2, Sun, Undo2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { BRAND } from '../brand';
import { renameProject } from '../store/panel-commands';
import { store, useAtelier } from '../store/store';
import { STRINGS } from '../strings';
import { ContextMenu } from './ContextMenu';
import { TextField } from './fields';
import { nextTheme, setThemePreference, useThemePreference } from './theme';
import { openDialog } from './ui-state';

const THEME_ICON = { system: Monitor, light: Sun, dark: Moon } as const;
const THEME_LABEL = { system: 'the system setting', light: 'light', dark: 'dark' } as const;

/** Project name, undo/redo, export menu (a stub until Phase 8), theme and the Connect AI pill. */
export function TopBar() {
  const canUndo = useAtelier((s) => s.history.past.length > 0);
  const canRedo = useAtelier((s) => s.history.future.length > 0);
  const name = useAtelier((s) => s.doc.name);
  const theme = useThemePreference();
  const ThemeIcon = THEME_ICON[theme];
  const exportButton = useRef<HTMLButtonElement>(null);
  const [exportAt, setExportAt] = useState<{ x: number; y: number } | null>(null);

  return (
    <header className="topbar">
      <span className="topbar__logo" aria-hidden="true" />
      <span className="topbar__brand">{BRAND.name}</span>
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
            { id: 'png', label: 'PNG image (coming later)', disabled: true, run: () => undefined },
            {
              id: 'html',
              label: 'HTML + CSS (coming later)',
              disabled: true,
              run: () => undefined,
            },
            {
              id: 'react',
              label: 'React component (coming later)',
              disabled: true,
              run: () => undefined,
            },
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
        onClick={() => openDialog('connect')}
      >
        <span className="pill__dot" aria-hidden="true" />
        {STRINGS.topbar.connect}
      </button>
    </header>
  );
}
