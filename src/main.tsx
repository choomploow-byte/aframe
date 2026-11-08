import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './canvas/fonts.css';
import './styles.css';
import './ui/ui.css';
import './ui/brand.css';
import './panels/panels.css';
import './pixelart/pixelart.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bootProject, persistenceEnabled } from './projects/session';
import { installErrorRecording } from './ui/diagnostics';
import { ErrorBoundary } from './ui/ErrorBoundary';

installErrorRecording();
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Open the last project (or make a first one); from here on every edit is saved.
if (persistenceEnabled()) void bootProject();

// Loads the sample document and exposes window.__aframe for tests. Off in every normal build:
// it is on for `vite dev`, and for the optimised `--mode perf` build used by the perf test
// (.env.perf), so performance is measured on minified React rather than the dev build.
if (import.meta.env.DEV || import.meta.env.VITE_DEVTOOLS === '1') {
  void import('./dev/dev').then((m) => m.installDevTools());
}
