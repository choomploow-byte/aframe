import { loadDoc } from '@core/doc';
import { getCanvasApi } from './canvas/canvas-api';
import { store } from './store/store';
import { showToast } from './ui/toast';

/**
 * Loads the bundled sample project (a landing page and a deliberately rough pricing page). Fetched
 * lazily so it adds nothing to the first load, and it works in every build, not just dev.
 */
export async function loadSampleProject(): Promise<boolean> {
  const sample = (await import('../fixtures/sample-doc.json')).default as unknown;
  const loaded = loadDoc(sample);
  if (!loaded.ok) {
    showToast('The sample project could not be opened.', { kind: 'error' });
    return false;
  }
  store.getState().loadDoc(loaded.doc);
  // Wait a frame so the artboards exist in the DOM before fitting the view to them.
  requestAnimationFrame(() => requestAnimationFrame(() => getCanvasApi()?.fitAll()));
  return true;
}
