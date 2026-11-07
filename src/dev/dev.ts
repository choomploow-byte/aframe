import { createEmptyDoc, loadDoc } from '@core/doc';
import { getCanvasApi } from '../canvas/canvas-api';
import * as projects from '../projects/session';
import * as commands from '../store/commands';
import { store } from '../store/store';
import { generateStressDoc } from './stress';

/**
 * Development-only helpers. `main.tsx` calls this only under `import.meta.env.DEV`, so none of it
 * (including the sample fixture import) ships in a production build.
 */
export async function installDevTools(): Promise<void> {
  const sample = (await import('../../fixtures/sample-doc.json')).default as unknown;
  const loaded = loadDoc(sample);
  if (!loaded.ok) console.error('Sample document failed to load', loaded.errors);
  // Without persistence (`?nopersist`, used by the canvas tests) the sample is simply on screen.
  // With it, the app opens a real project instead (see bootProject in main.tsx).
  else if (!projects.persistenceEnabled()) store.getState().loadDoc(loaded.doc);

  (window as unknown as { __atelier: unknown }).__atelier = {
    store,
    commands,
    canvas: getCanvasApi,
    /** Project operations and the live sync service, for the persistence tests. */
    projects,
    sync: projects.activeSync,
    // Loading a test document stops saving: tests must never write into a real project.
    loadSample: () => {
      projects.detachForTests();
      if (loaded.ok) store.getState().loadDoc(loaded.doc);
    },
    loadBlank: () => {
      projects.detachForTests();
      store.getState().loadDoc(createEmptyDoc());
    },
    /** "Generate N nodes" for perf checks (docs/19). */
    loadStress: (nodes: number) => {
      projects.detachForTests();
      store.getState().loadDoc(generateStressDoc(nodes));
      getCanvasApi()?.fitAll();
    },
  };
}
