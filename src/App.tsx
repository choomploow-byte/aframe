import { BRAND } from './brand';

/** Phase 0 shell: static layout regions only. Real panels arrive in Phases 2 and 3. */
export function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <span className="topbar__logo" aria-hidden="true" />
        <span className="topbar__brand">{BRAND.name}</span>
        <span className="topbar__project">Untitled project</span>
        <span className="topbar__spacer" />
        <button type="button" className="pill" disabled>
          <span className="pill__dot" aria-hidden="true" />
          Connect AI
        </button>
      </header>

      <aside className="panel panel--left" aria-label="Layers">
        <h2 className="panel__title">Layers</h2>
        <p className="panel__empty">Nothing here yet. Layers will appear once you draw a frame.</p>
      </aside>

      <main className="canvas" aria-label="Canvas">
        <div className="canvas__hint">
          <h1 className="canvas__headline">Design with your AI.</h1>
          <p>The canvas arrives in Phase 2.</p>
        </div>
      </main>

      <aside className="panel panel--right" aria-label="Properties">
        <h2 className="panel__title">Properties</h2>
        <p className="panel__empty">Select something on the canvas to edit it.</p>
      </aside>
    </div>
  );
}
