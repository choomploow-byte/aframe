import { Canvas } from './canvas/Canvas';
import { AgentActivity } from './ui/AgentActivity';
import { LeftPanel } from './panels/LeftPanel';
import { RightPanel } from './panels/RightPanel';
import { STRINGS } from './strings';
import { ContextMenus } from './ui/ContextMenus';
import { Dialogs } from './ui/Dialogs';
import { CrashProbe } from './ui/ErrorBoundary';
import { useImageDropAndPaste } from './ui/image-import';
import { TopBar } from './ui/TopBar';
import { Toasts } from './ui/Toasts';
import { useBetaFeature } from './ui/beta';
import { PixelArtEditor } from './pixelart/PixelArtEditor';
import { usePixelUi } from './pixelart/state';
import { Preview } from './preview/Preview';
import { usePreviewUi } from './preview/state';

/** App shell: top bar, left panel (Layers / Assets / Tokens), canvas, right panel (Design / Notes). */
export function App() {
  useImageDropAndPaste();
  // Beta feature: with it off there is nothing to open, so nothing is drawn.
  const pixelArt = useBetaFeature('pixelArt');
  const pixelOpen = usePixelUi((s) => s.open);
  const previewOpen = usePreviewUi((s) => s.open);
  return (
    <div className="shell">
      <TopBar />

      <aside className="panel panel--left" aria-label={STRINGS.panels.left}>
        <LeftPanel />
      </aside>

      <Canvas />
      {pixelArt && pixelOpen && <PixelArtEditor />}
      {previewOpen && <Preview />}

      <aside className="panel panel--right" aria-label={STRINGS.panels.properties}>
        <RightPanel />
      </aside>

      <ContextMenus />
      <Dialogs />
      <Toasts />
      <AgentActivity />
      <CrashProbe />
    </div>
  );
}
