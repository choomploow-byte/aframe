import { Redo2, Undo2 } from 'lucide-react';
import { BRAND } from './brand';
import { Canvas } from './canvas/Canvas';
import { STRINGS } from './strings';
import { store, useAtelier } from './store/store';

/** App shell. Layers and Properties are placeholders until Phase 3; the canvas is live. */
export function App() {
  const canUndo = useAtelier((s) => s.history.past.length > 0);
  const canRedo = useAtelier((s) => s.history.future.length > 0);
  const name = useAtelier((s) => s.doc.name);

  return (
    <div className="shell">
      <header className="topbar">
        <span className="topbar__logo" aria-hidden="true" />
        <span className="topbar__brand">{BRAND.name}</span>
        <span className="topbar__project">
          {name === 'Untitled' ? STRINGS.topbar.untitled : name}
        </span>
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
        <button type="button" className="pill" disabled>
          <span className="pill__dot" aria-hidden="true" />
          {STRINGS.topbar.connect}
        </button>
      </header>

      <aside className="panel panel--left" aria-label={STRINGS.panels.layers}>
        <h2 className="panel__title">{STRINGS.panels.layers}</h2>
        <p className="panel__empty">{STRINGS.panels.layersEmpty}</p>
      </aside>

      <Canvas />

      <aside className="panel panel--right" aria-label={STRINGS.panels.properties}>
        <h2 className="panel__title">{STRINGS.panels.properties}</h2>
        <p className="panel__empty">{STRINGS.panels.propertiesEmpty}</p>
      </aside>
    </div>
  );
}
