/**
 * The running app's connection to its projects: picks and opens the project to show, keeps it saved
 * and in sync (SyncService), answers agent requests (BridgeService), and offers the project
 * operations the UI needs (new, open, import, export, rename, delete, restore).
 *
 * One session per app. Everything below is async and never throws into the UI: failures become
 * toasts or the recovery dialog.
 */
import { loadDoc, serializeDoc } from '@core/doc';
import { createTemplateDoc, TEMPLATE_INFO, type TemplateName } from '@core/templates';
import type { Doc } from '@core/types';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { getCanvasApi } from '../canvas/canvas-api';
import { pulseNodes } from '../canvas/pulse';
import { startAgentPolling } from '../connect/agents';
import { getFs, type HomeApi } from '../platform/fs';
import { renameProject } from '../store/panel-commands';
import { store } from '../store/store';
import { BridgeService, RequestError } from '../sync/requests';
import { SyncService, type SyncNotice, type SyncStatus } from '../sync/sync';
import { showToast } from '../ui/toast';
import { closeDialog, openDialog } from '../ui/ui-state';
import {
  backupFile,
  deleteProject,
  listProjects,
  nameFromHead,
  newProject,
  newProjectFrom,
  openProject,
  parseProjectText,
  readSettings,
  renameProjectOnDisk,
  restoreBackup,
  writeSettings,
  type ProjectInfo,
} from './projects';

const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

export interface RecoverInfo {
  id: string;
  name: string;
  reason: 'invalid' | 'too-new' | 'missing';
  messages: string[];
  canRestore: boolean;
}

interface ProjectsState {
  list: ProjectInfo[];
  loading: boolean;
  recover: RecoverInfo | null;
  /** Set when the file system itself could not be reached (nothing can be saved). */
  fatal: string | null;
  /** Whether the open project is saved (mirrors SyncService.status for the top bar). */
  save: SyncStatus;
}

export const projectsStore = createStore<ProjectsState>()(() => ({
  list: [],
  loading: false,
  recover: null,
  fatal: null,
  save: { state: 'detached', projectId: null, lastSavedAt: null, message: null },
}));

export const useProjects = <T>(select: (s: ProjectsState) => T): T =>
  useStore(projectsStore, select);

/**
 * Browser tests of the canvas run without any persistence (`?nopersist`). Only honoured in the dev
 * server and the dev-hooks build; a normal build always saves.
 */
export function persistenceEnabled(): boolean {
  const testBuild = import.meta.env.DEV || import.meta.env.VITE_DEVTOOLS === '1';
  return !(testBuild && new URLSearchParams(window.location.search).has('nopersist'));
}

interface Session {
  fs: HomeApi;
  sync: SyncService;
  bridge: BridgeService;
}

let session: Promise<Session> | null = null;
/** The live sync service, readable synchronously (dev hooks detach it before loading test documents). */
let liveSync: SyncService | null = null;

export const activeSync = (): SyncService | null => liveSync;

/** Dev/test hook: stop saving and watching so a test can load any document into the store. */
export function detachForTests(): void {
  liveSync?.detach();
}

export function describeNotice(n: SyncNotice): {
  message: string;
  error?: boolean;
  undo?: boolean;
} {
  switch (n.kind) {
    case 'file-recreated':
      return { message: 'The project file was removed from disk, so it was saved again.' };
    case 'file-invalid':
      return {
        message:
          'The project file on disk was damaged, so your version was saved over it. The previous good copy is kept as a backup.',
        error: true,
      };
    case 'external': {
      const who =
        n.writer === 'app'
          ? 'The project file was changed outside AFrame.'
          : 'The AI changed the design.';
      if (n.tookTheirs) {
        return {
          message: `${who} It could not be combined with your latest edits, so the new version is shown. Undo brings yours back.`,
          undo: true,
        };
      }
      const kept = n.merged ? ' Your unsaved edits were kept.' : '';
      const overruled =
        n.overruled.length > 0
          ? ` It also changed ${n.overruled.slice(0, 3).join(', ')}${n.overruled.length > 3 ? '…' : ''}, so that version won. Undo brings yours back.`
          : '';
      return { message: `${who}${kept}${overruled}`, undo: true };
    }
  }
}

function ensureSession(): Promise<Session> {
  session ??= (async (): Promise<Session> => {
    const fs = await getFs();
    const sync = new SyncService({
      fs,
      store,
      notify: (n) => {
        // Show where an agent's edit landed, once the new nodes are on screen.
        if (n.kind === 'external' && n.writer !== 'app') {
          requestAnimationFrame(() => requestAnimationFrame(() => pulseNodes(n.changedIds)));
        }
        const d = describeNotice(n);
        showToast(d.message, {
          kind: d.error ? 'error' : 'info',
          ...(d.undo ? { action: { label: 'Undo', run: () => void store.getState().undo() } } : {}),
        });
      },
    });
    liveSync = sync;
    sync.status.subscribe((save) => projectsStore.setState({ save }));
    const bridge = new BridgeService(fs, {
      flush: () => sync.flush(),
      currentProject: () => sync.currentProjectId,
      selection: () => store.getState().selection,
      screenshot: async (params) => {
        const { captureScreenshot, ScreenshotError } = await import('../canvas/screenshot');
        const p: Record<string, unknown> = params;
        try {
          const state = store.getState();
          return await captureScreenshot(state.doc, state.viewport.zoom, {
            ...(typeof p.nodeId === 'string' ? { nodeId: p.nodeId } : {}),
            ...(p.scale === 1 || p.scale === 2 ? { scale: p.scale } : {}),
            ...(typeof p.maxWidth === 'number' ? { maxWidth: p.maxWidth } : {}),
            ...(p.annotations === true ? { annotations: true } : {}),
            ...(typeof p.state === 'string' &&
            ['default', 'hover', 'pressed', 'disabled', 'selected', 'all'].includes(p.state)
              ? {
                  state: p.state as
                    'default' | 'hover' | 'pressed' | 'disabled' | 'selected' | 'all',
                }
              : {}),
          });
        } catch (e) {
          if (e instanceof ScreenshotError) throw new RequestError(e.code, e.message);
          throw e;
        }
      },
      exportImage: async (params) => {
        const { captureExport, ScreenshotError } = await import('../canvas/screenshot');
        const p: Record<string, unknown> = params;
        if (typeof p.nodeId !== 'string' || (p.format !== 'png' && p.format !== 'svg')) {
          throw new RequestError('BAD_REQUEST', 'params.nodeId and params.format are required.');
        }
        const scale = p.scale === 2 || p.scale === 3 ? p.scale : 1;
        try {
          const state = store.getState();
          return await captureExport(state.doc, state.viewport.zoom, {
            nodeId: p.nodeId,
            format: p.format,
            scale,
            transparent: p.transparent === true,
          });
        } catch (e) {
          if (e instanceof ScreenshotError) throw new RequestError(e.code, e.message);
          throw e;
        }
      },
      nodeBounds: async (nodeId) => {
        const { nodeBounds } = await import('../canvas/screenshot');
        return nodeBounds(nodeId, store.getState().viewport.zoom);
      },
      openProject: async (id) =>
        (await openById(id)) ? null : `Project ${id} could not be opened.`,
    });
    bridge.start();
    startAgentPolling(fs);
    // The window is closing: save what is pending, then let it go.
    fs.onCloseRequested(() => {
      void sync
        .flush()
        .catch(() => undefined)
        .finally(() => void fs.quit());
    });
    return { fs, sync, bridge };
  })();
  return session;
}

const fitSoon = (): void => {
  requestAnimationFrame(() => requestAnimationFrame(() => getCanvasApi()?.fitAll()));
};

/** Refreshes the list shown in the Projects dialog. */
export async function refreshProjects(): Promise<void> {
  try {
    const { fs } = await ensureSession();
    projectsStore.setState({ loading: true });
    projectsStore.setState({ list: await listProjects(fs), loading: false });
  } catch (e) {
    projectsStore.setState({ loading: false });
    showToast(`Could not list your projects: ${errorText(e)}`, { kind: 'error' });
  }
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Saves the current project, then opens another. Returns whether it opened. */
export async function openById(id: string, options: { quiet?: boolean } = {}): Promise<boolean> {
  const { fs, sync } = await ensureSession();
  try {
    await sync.flush();
    const result = await openProject(fs, id);
    if (!result.ok) {
      // A damaged file has no readable name; its backup usually does.
      let name = projectsStore.getState().list.find((p) => p.id === id)?.name ?? id;
      if (name === id) {
        const head = await fs.readHead(backupFile(id), 4096).catch(() => null);
        name = (head === null ? null : nameFromHead(head)) ?? 'A project';
      }
      projectsStore.setState({
        recover: {
          id,
          name,
          reason: result.reason,
          messages:
            result.reason === 'missing'
              ? ['The project could not be found.']
              : result.errors.map((e) => e.message).slice(0, 4),
          canRestore: result.reason === 'invalid' && result.canRestore,
        },
      });
      if (!options.quiet) openDialog('recover');
      return false;
    }
    sync.attach(result);
    await writeSettings(fs, { lastProject: id }).catch(() => undefined);
    projectsStore.setState({ recover: null });
    if (!options.quiet) closeDialog();
    fitSoon();
    return true;
  } catch (e) {
    showToast(`Could not open the project: ${errorText(e)}`, { kind: 'error' });
    return false;
  }
}

/** Startup: reopen the last project (or the newest that opens), or make a first one. */
export async function bootProject(): Promise<void> {
  let ctx: Session;
  try {
    ctx = await ensureSession();
  } catch (e) {
    projectsStore.setState({ fatal: errorText(e) });
    showToast(`Your projects could not be reached, so nothing will be saved: ${errorText(e)}`, {
      kind: 'error',
    });
    return;
  }
  try {
    const [settings, list] = await Promise.all([readSettings(ctx.fs), listProjects(ctx.fs)]);
    projectsStore.setState({ list });
    const order = [settings.lastProject, ...list.map((p) => p.id)].filter(
      (id, i, all): id is string =>
        id !== undefined && list.some((p) => p.id === id) && all.indexOf(id) === i,
    );
    // A project that does not open is not hidden: another one opens so the app is usable, and the
    // recovery dialog (restore the previous version, or look at the problem) is shown over it.
    let failure: RecoverInfo | null = null;
    const reportFailure = (): void => {
      if (failure === null) return;
      projectsStore.setState({ recover: failure }); // opening the fallback cleared it
      openDialog('recover');
    };
    for (const id of order) {
      if (await openById(id, { quiet: true })) {
        reportFailure();
        return;
      }
      failure ??= projectsStore.getState().recover;
      if (id !== order[0]) break; // do not walk through every broken project
    }
    await createAndOpen('Untitled');
    reportFailure();
  } catch (e) {
    projectsStore.setState({ fatal: errorText(e) });
    showToast(`Could not open your projects: ${errorText(e)}`, { kind: 'error' });
  }
}

async function createAndOpen(name: string, from?: Doc): Promise<string | null> {
  const { fs } = await ensureSession();
  try {
    const doc = from ? await newProjectFrom(fs, from, name) : await newProject(fs, name);
    return (await openById(doc.id, { quiet: true })) ? doc.id : null;
  } catch (e) {
    showToast(`Could not create the project: ${errorText(e)}`, { kind: 'error' });
    return null;
  }
}

/** A new project, blank or from one of the genre templates (token set, component kit, screens). */
export async function createNewProject(template: TemplateName = 'blank'): Promise<void> {
  if (template === 'blank') {
    if ((await createAndOpen('Untitled')) !== null) closeDialog();
    return;
  }
  const doc = createTemplateDoc(template, { name: TEMPLATE_INFO[template].label });
  if ((await createAndOpen(doc.name, doc)) !== null) closeDialog();
}

/** The sample, as a project of its own. An empty untitled project in the way is replaced by it. */
export async function createSampleProject(): Promise<boolean> {
  const raw = (await import('../../fixtures/sample-doc.json')).default as unknown;
  const loaded = loadDoc(raw);
  if (!loaded.ok) {
    showToast('The sample project could not be opened.', { kind: 'error' });
    return false;
  }
  if (!persistenceEnabled()) {
    // Browser tests without projects: just show it.
    store.getState().loadDoc(loaded.doc);
    fitSoon();
    return true;
  }
  const { fs, sync } = await ensureSession();
  const before = store.getState().doc;
  const wasBlank =
    before.name === 'Untitled' && (before.nodes[before.rootId]?.children.length ?? 1) === 0;
  const previousId = sync.currentProjectId;
  const id = await createAndOpen(loaded.doc.name, loaded.doc);
  if (id === null) return false;
  if (wasBlank && previousId !== null && previousId !== id) {
    await deleteProject(fs, previousId).catch(() => undefined);
  }
  closeDialog();
  return true;
}

export async function importProjectFile(file: File): Promise<void> {
  if (file.size > MAX_IMPORT_BYTES) {
    showToast(`${file.name} is too large to import (limit ${MAX_IMPORT_BYTES / 1024 / 1024} MB).`, {
      kind: 'error',
    });
    return;
  }
  const parsed = parseProjectText(await file.text());
  if (!parsed.ok) {
    const why = parsed.errors[0]?.message ?? 'It is not an AFrame project file.';
    showToast(`${file.name} could not be imported. ${why}`, { kind: 'error' });
    return;
  }
  const id = await createAndOpen(parsed.doc.name, parsed.doc);
  if (id !== null) {
    closeDialog();
    showToast(`Imported "${parsed.doc.name}" as a new project.`);
  }
}

/** Downloads the open project as a `.aframe.json` file (a copy to keep or share). */
export function exportProjectFile(): void {
  const doc = store.getState().doc;
  const blob = new Blob([serializeDoc(doc)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug =
    doc.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'project';
  a.href = url;
  a.download = `${slug}.aframe.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function renameById(id: string, name: string): Promise<void> {
  const { fs, sync } = await ensureSession();
  const clean = name.trim().slice(0, 120) || 'Untitled';
  if (id === sync.currentProjectId) renameProject(store, clean);
  else if (!(await renameProjectOnDisk(fs, id, clean))) {
    showToast('That project could not be renamed.', { kind: 'error' });
  }
  await refreshProjects();
}

/** Permanently deletes a project (the dialog has already asked). */
export async function removeProject(id: string): Promise<void> {
  const { fs, sync } = await ensureSession();
  try {
    if (id === sync.currentProjectId) {
      await sync.flush();
      sync.detach();
    }
    await deleteProject(fs, id);
    if (sync.currentProjectId === null) await bootProject();
    await refreshProjects();
    showToast('Project deleted.');
  } catch (e) {
    showToast(`Could not delete the project: ${errorText(e)}`, { kind: 'error' });
  }
}

/** Puts the last valid version back and opens it. */
export async function restoreProject(id: string): Promise<void> {
  const { fs } = await ensureSession();
  try {
    if (!(await restoreBackup(fs, id))) {
      showToast('There is no valid earlier version to restore.', { kind: 'error' });
      return;
    }
    if (await openById(id)) showToast('Restored the previous version.');
  } catch (e) {
    showToast(`Could not restore: ${errorText(e)}`, { kind: 'error' });
  }
}
