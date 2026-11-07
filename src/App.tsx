import { Canvas } from './canvas/Canvas';
import { LeftPanel } from './panels/LeftPanel';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { STRINGS } from './strings';
import { ContextMenus } from './ui/ContextMenus';
import { Dialogs } from './ui/Dialogs';
import { useImageDropAndPaste } from './ui/image-import';
import { TopBar } from './ui/TopBar';
import { Toasts } from './ui/Toasts';

/** App shell: top bar, left panel (Layers / Assets / Tokens), canvas, right panel (Design). */
export function App() {
  useImageDropAndPaste();
  return (
    <div className="shell">
      <TopBar />

      <aside className="panel panel--left" aria-label={STRINGS.panels.left}>
        <LeftPanel />
      </aside>

      <Canvas />

      <aside className="panel panel--right" aria-label={STRINGS.panels.properties}>
        <h2 className="panel__title">{STRINGS.panels.design}</h2>
        <PropertiesPanel />
      </aside>

      <ContextMenus />
      <Dialogs />
      <Toasts />
    </div>
  );
}
