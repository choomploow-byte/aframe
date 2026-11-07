import { loadDoc } from '@core/doc';
import { getCanvasApi } from '../canvas/canvas-api';
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
  if (loaded.ok) store.getState().loadDoc(loaded.doc);
  else console.error('Sample document failed to load', loaded.errors);

  (window as unknown as { __atelier: unknown }).__atelier = {
    store,
    commands,
    canvas: getCanvasApi,
    loadSample: () => {
      if (loaded.ok) store.getState().loadDoc(loaded.doc);
    },
    /** "Generate N nodes" for perf checks (docs/19). */
    loadStress: (nodes: number) => {
      store.getState().loadDoc(generateStressDoc(nodes));
      getCanvasApi()?.fitAll();
    },
  };
}
