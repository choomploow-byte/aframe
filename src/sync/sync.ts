/**
 * Keeps the open project and its file in step (docs/06).
 *
 *  - SAVE: every local change schedules a save 250 ms after the last one. A save is a
 *    compare-and-write on `rev` under the project lock (done natively), so it can never overwrite a
 *    change it has not seen.
 *  - WATCH: every 400 ms the file's (mtime, size) is compared with what this app last read or wrote.
 *    A difference means someone else wrote it (an agent, a script, git): read it, merge it with any
 *    unsaved local edits (`mergeDocs`), and put the result on screen as ONE undo step.
 *  - REPORT: the current project and selection go to the native side, which publishes them in
 *    `app-state.json` (the heartbeat itself runs natively; see src-tauri/src/appstate.rs).
 *
 * The service never throws into the UI: problems become `status` and notices. Everything it touches
 * on disk goes through the `HomeApi` it is given, so tests drive it against real temp directories.
 */
import { serializeDoc } from '@core/doc';
import { changedNodeIds, mergeDocs, sameContent } from '@core/merge';
import type { Doc } from '@core/types';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { HomeApi } from '../platform/fs';
import { FsError, type FileStat } from '../platform/fs-types';
import { parseProjectText, projectFile, revOf, type Opened } from '../projects/projects';
import type { AtelierState } from '../store/store';

export type SaveState = 'detached' | 'saved' | 'dirty' | 'saving' | 'error';

export interface SyncStatus {
  state: SaveState;
  projectId: string | null;
  lastSavedAt: number | null;
  /** Plain-language reason when `state` is 'error'. */
  message: string | null;
}

export type SyncNotice =
  /** Someone else changed the file and it is now on screen. */
  | {
      kind: 'external';
      writer: Doc['meta']['lastWriter'];
      /** Names of nodes where a different change of yours was overruled. */
      overruled: string[];
      /** The two versions could not be combined, so the file's version was taken (undo returns yours). */
      tookTheirs: boolean;
      /** Your unsaved edits were combined with the change. */
      merged: boolean;
      /** Nodes the change touched (at most 50), so the UI can point at them. */
      changedIds: string[];
    }
  /** The file was deleted or replaced by something unreadable; yours is being written back. */
  | { kind: 'file-recreated' }
  | { kind: 'file-invalid' };

export interface SyncOptions {
  saveDebounceMs?: number;
  /**
   * The longest unsaved edits wait while the user keeps editing. A pure debounce never fires during
   * a long drag (events arrive faster than the delay), so a crash would lose all of it.
   */
  saveMaxWaitMs?: number;
  pollMs?: number;
  /** How often the open project/selection is re-reported even if nothing changed. */
  reportEveryMs?: number;
  /** Start the timers. Tests turn this off and call `flush()` / `poll()` themselves. */
  autoStart?: boolean;
}

export interface SyncDeps {
  fs: HomeApi;
  store: StoreApi<AtelierState>;
  notify?: (notice: SyncNotice) => void;
  options?: SyncOptions;
}

const MAX_SAVE_ATTEMPTS = 5;

export class SyncService {
  readonly status: StoreApi<SyncStatus> = createStore<SyncStatus>()(() => ({
    state: 'detached',
    projectId: null,
    lastSavedAt: null,
    message: null,
  }));

  private readonly fs: HomeApi;
  private readonly store: StoreApi<AtelierState>;
  private readonly notify: (n: SyncNotice) => void;
  private readonly opts: Required<SyncOptions>;

  private projectId: string | null = null;
  /** The document as last known to be on disk. `null` = the file needs (re)creating. */
  private base: Doc | null = null;
  private diskRev: number | null = null;
  private lastStat: FileStat | null = null;

  private unsubscribe: (() => void) | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reportTimer: ReturnType<typeof setInterval> | null = null;
  private reportThrottle: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  /** When the oldest unsaved change was made (drives the maximum wait). */
  private dirtySince: number | null = null;
  /** One operation at a time: a save, a merge and a poll never interleave. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor({ fs, store, notify, options }: SyncDeps) {
    this.fs = fs;
    this.store = store;
    this.notify = notify ?? ((): void => undefined);
    this.opts = {
      saveDebounceMs: options?.saveDebounceMs ?? 250,
      saveMaxWaitMs: options?.saveMaxWaitMs ?? 2000,
      pollMs: options?.pollMs ?? 400,
      reportEveryMs: options?.reportEveryMs ?? 2000,
      autoStart: options?.autoStart ?? true,
    };
  }

  get attached(): boolean {
    return this.projectId !== null;
  }

  get currentProjectId(): string | null {
    return this.projectId;
  }

  // ---- lifecycle ------------------------------------------------------------------------------

  /** Starts syncing an opened project and puts its document on screen. */
  attach(opened: Opened): void {
    this.detach();
    this.projectId = opened.id;
    this.base = opened.doc;
    this.diskRev = opened.diskRev;
    this.lastStat = opened.stat;
    this.store.getState().loadDoc(opened.doc);

    if (opened.migrated) {
      // The file is an older schema: the upgraded document is a new revision that must be saved.
      const doc = this.store.getState().doc;
      this.store
        .getState()
        .adoptExternal({ ...doc, rev: doc.rev + 1 }, 'Upgrade', { history: false });
    }

    this.unsubscribe = this.store.subscribe((s, prev) => {
      if (s.doc !== prev.doc) this.onDocChange();
      if (s.selection !== prev.selection) this.reportSoon();
    });
    this.setStatus({
      projectId: opened.id,
      state: this.dirty() ? 'dirty' : 'saved',
      message: null,
    });
    if (this.dirty()) this.scheduleSave();

    if (this.opts.autoStart) {
      this.pollTimer = setInterval(() => void this.poll(), this.opts.pollMs);
      this.reportTimer = setInterval(() => this.report(), this.opts.reportEveryMs);
    }
    this.report();
  }

  /** Stops syncing (call `flush()` first to save pending work). */
  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const t of [this.saveTimer, this.retryTimer, this.reportThrottle]) if (t) clearTimeout(t);
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reportTimer) clearInterval(this.reportTimer);
    this.saveTimer = this.retryTimer = this.reportThrottle = null;
    this.pollTimer = this.reportTimer = null;
    this.projectId = null;
    this.base = null;
    this.diskRev = null;
    this.lastStat = null;
    this.setStatus({ state: 'detached', projectId: null, message: null });
  }

  // ---- saving ---------------------------------------------------------------------------------

  private dirty(): boolean {
    return this.attached && this.store.getState().doc !== this.base;
  }

  private onDocChange(): void {
    if (!this.attached) return;
    if (this.dirty()) {
      this.setStatus({ state: 'dirty' });
      this.scheduleSave();
    } else if (this.status.getState().state !== 'saving') {
      this.setStatus({ state: 'saved', message: null });
    }
  }

  private scheduleSave(delay = this.opts.saveDebounceMs): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const now = Date.now();
    this.dirtySince ??= now;
    const untilMaxWait = Math.max(0, this.dirtySince + this.opts.saveMaxWaitMs - now);
    this.saveTimer = setTimeout(() => void this.flush(), Math.min(delay, untilMaxWait));
  }

  /** Saves now if there is anything to save, and waits for it (also used before answering agents). */
  flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.dirtySince = null;
    return this.run(() => this.saveLoop());
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async saveLoop(): Promise<void> {
    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt++) {
      const id = this.projectId;
      if (id === null) return;
      let doc = this.store.getState().doc;
      if (doc === this.base) {
        this.setStatus({ state: 'saved', message: null });
        return;
      }
      // A write must be a newer revision than the file it replaces.
      if (this.diskRev !== null && doc.rev <= this.diskRev) {
        doc = { ...doc, rev: this.diskRev + 1 };
        this.store.getState().adoptExternal(doc, '', { history: false });
      }
      this.setStatus({ state: 'saving', message: null });
      let result;
      try {
        result = await this.fs.writeDoc(projectFile(id), serializeDoc(doc), this.diskRev);
      } catch (e) {
        const locked = e instanceof FsError && e.code === 'LOCKED';
        this.setStatus({
          state: 'error',
          message: locked
            ? 'Another program is saving this project right now. Trying again…'
            : `Could not save: ${e instanceof Error ? e.message : String(e)}`,
        });
        this.retry(locked ? 1000 : 3000);
        return;
      }
      if (this.projectId !== id) return; // switched projects while writing
      if (result.ok) {
        this.base = doc;
        this.diskRev = result.diskRev;
        this.lastStat = result.stat;
        const behind = this.store.getState().doc !== doc;
        this.setStatus({
          state: behind ? 'dirty' : 'saved',
          lastSavedAt: Date.now(),
          message: null,
        });
        if (behind) this.scheduleSave();
        return;
      }
      // Someone else wrote first: merge what they wrote, then write again.
      const outcome = await this.reconcile();
      if (outcome === 'deferred') await new Promise((r) => setTimeout(r, 100));
    }
    this.setStatus({
      state: 'error',
      message: 'This project keeps changing on disk, so saving was postponed. Trying again…',
    });
    this.retry(2000);
  }

  private retry(ms: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.flush(), ms);
  }

  // ---- watching -------------------------------------------------------------------------------

  /** One look at the file (what the 400 ms timer does). Exposed for tests. */
  async poll(): Promise<void> {
    if (!this.attached || this.polling) return;
    this.polling = true;
    try {
      await this.run(async () => {
        const id = this.projectId;
        if (id === null) return;
        const stat = await this.fs.stat(projectFile(id));
        if (stat === null) {
          if (this.lastStat !== null || this.base !== null) {
            this.lastStat = null;
            this.diskRev = null;
            this.base = null; // forces a write of the current document
            this.notify({ kind: 'file-recreated' });
            this.scheduleSave(0);
          }
          return;
        }
        const last = this.lastStat;
        if (last !== null && last.mtimeMs === stat.mtimeMs && last.size === stat.size) return;
        await this.reconcile();
      });
    } catch {
      /* a transient read error: the next tick looks again */
    } finally {
      this.polling = false;
    }
  }

  /**
   * Reads the file and brings the screen up to date with it. Returns 'deferred' if the user is in
   * the middle of a gesture or typing (the next poll will look again).
   */
  private async reconcile(): Promise<'done' | 'deferred'> {
    const id = this.projectId;
    if (id === null) return 'done';
    const path = projectFile(id);
    const [text, stat] = await Promise.all([this.fs.readText(path), this.fs.stat(path)]);

    if (text === null || stat === null) {
      this.base = null;
      this.diskRev = null;
      this.lastStat = null;
      this.notify({ kind: 'file-recreated' });
      this.scheduleSave(0); // nothing on screen changed, so nothing else would write it back
      return 'done';
    }
    const parsed = parseProjectText(text);
    if (!parsed.ok) {
      // Unreadable on disk: our copy is the only good one. Write it over (the .bak is untouched).
      this.base = null;
      this.diskRev = null;
      this.lastStat = stat;
      this.notify({ kind: 'file-invalid' });
      this.scheduleSave(0);
      return 'done';
    }

    const s = this.store.getState();
    if (s.transaction !== null || s.editingTextId !== null) return 'deferred';

    const remote = parsed.doc;
    const remoteRev = revOf(text);
    if (sameContent(remote, s.doc)) {
      // The file already says what the screen says (e.g. our own write read back).
      this.base = s.doc;
      this.diskRev = remoteRev;
      this.lastStat = stat;
      return 'done';
    }

    const merge = mergeDocs(this.base ?? remote, s.doc, remote);
    this.base = remote;
    this.diskRev = remoteRev;
    this.lastStat = stat;

    const label = remote.meta.lastWriter === 'app' ? 'External change' : 'AI change';
    if (merge.mode === 'local') {
      // Nothing to take; if the revision had to move past the file's, restamp without an undo step.
      if (merge.doc !== s.doc)
        this.store.getState().adoptExternal(merge.doc, label, { history: false });
      return 'done';
    }
    const changedIds = changedNodeIds(s.doc, merge.doc).filter(
      (id) => merge.doc.nodes[id] !== undefined,
    );
    this.store.getState().adoptExternal(merge.doc, label);
    const names = merge.conflicts.map(
      (cid) => s.doc.nodes[cid]?.name ?? remote.nodes[cid]?.name ?? cid,
    );
    this.notify({
      kind: 'external',
      writer: remote.meta.lastWriter,
      overruled: names,
      tookTheirs: merge.mode === 'remote-fallback',
      merged: merge.mode === 'merged',
      changedIds: changedIds.slice(0, 50),
    });
    return 'done';
  }

  // ---- reporting what is open -----------------------------------------------------------------

  private report(): void {
    if (!this.attached) return;
    void this.fs
      .reportAppState({
        currentProject: this.projectId,
        selection: this.store.getState().selection,
      })
      .catch(() => undefined);
  }

  private reportSoon(): void {
    if (this.reportThrottle) return;
    this.reportThrottle = setTimeout(() => {
      this.reportThrottle = null;
      this.report();
    }, 200);
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status.setState(patch);
  }
}
