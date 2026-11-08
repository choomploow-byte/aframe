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
    /** A genre template as the open document (never saved). */
    loadTemplate: async (name: string) => {
      const { createTemplateDoc, TEMPLATES } = await import('@core/templates');
      if (!(TEMPLATES as readonly string[]).includes(name)) throw new Error(`no template ${name}`);
      projects.detachForTests();
      store
        .getState()
        .loadDoc(createTemplateDoc(name as (typeof TEMPLATES)[number], { name, id: 'p_tpl00' }));
      getCanvasApi()?.fitAll();
    },
    /** The in-app assistant, with hooks for scripted providers (tests never use a real key). */
    chat: async () => {
      const [transport, keys, settings, session] = await Promise.all([
        import('../chat/transport'),
        import('../chat/keys'),
        import('../chat/settings'),
        import('../chat/session'),
      ]);
      return { transport, keys, settings, session };
    },
    /** Makes the app throw while rendering, to see the recovery page. */
    crash: async () => (await import('../ui/ErrorBoundary')).requestTestCrash(),
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
