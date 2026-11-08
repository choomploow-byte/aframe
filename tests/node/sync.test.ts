import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyChanges } from '../../src/core/apply';
import { bumpRev, loadDoc, serializeDoc } from '../../src/core/doc';
import { FsError } from '../../src/platform/fs-types';
import type { Doc, Op } from '../../src/core/types';
import { sampleDoc } from '../../src/core/testing';
import { newProjectFrom, openProject, projectFile, revOf } from '../../src/projects/projects';
import { createAFrameStore } from '../../src/store/store';
import { SyncService, type SyncNotice } from '../../src/sync/sync';
import { createTestAdapter, type TestAdapter } from './helpers/node-adapter';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const set = (id: string, props: Record<string, unknown>): Op => ({ op: 'update', id, set: props });

let dir: string;
let fsx: TestAdapter;
let id: string;
let store: ReturnType<typeof createAFrameStore>;
let sync: SyncService;
let notices: SyncNotice[];

const file = (): string => fsx.home_.confine(projectFile(id));
const onDisk = async (): Promise<Doc> => {
  const r = loadDoc(JSON.parse(await fs.readFile(file(), 'utf8')));
  if (!r.ok) throw new Error('the file on disk is not a valid project');
  return r.doc;
};
const local = (): Doc => store.getState().doc;
const edit = (ops: Op[], label = 'Edit'): void => {
  const r = store.getState().dispatch(ops, { label });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
};

/** What an MCP server does: read, change through core, bump rev, compare-and-write. */
async function agentEdit(ops: Op[]): Promise<void> {
  await sleep(15); // a distinct modified time
  for (let attempt = 0; attempt < 8; attempt++) {
    const text = await fsx.readText(projectFile(id));
    const loaded = loadDoc(JSON.parse(text ?? '{}'));
    if (!loaded.ok) throw new Error('agent could not read the project');
    const applied = applyChanges(loaded.doc, ops);
    if (!applied.ok) throw new Error(JSON.stringify(applied.errors));
    const next = bumpRev(applied.doc, 'mcp');
    const r = await fsx.writeDoc(projectFile(id), serializeDoc(next), loaded.doc.rev);
    if (r.ok) return; // otherwise the app saved in between: read again, like a real writer
  }
  throw new Error('agent write kept conflicting');
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aframe-sync-'));
  fsx = createTestAdapter(path.join(dir, 'home'));
  await fsx.home_.ensure();
  const created = await newProjectFrom(fsx, sampleDoc(), 'Synced');
  id = created.id;
  const opened = await openProject(fsx, id);
  if (!opened.ok) throw new Error('should open');
  let t = 0;
  store = createAFrameStore({ now: () => (t += 1000) });
  notices = [];
  sync = new SyncService({
    fs: fsx,
    store,
    notify: (n) => notices.push(n),
    options: { autoStart: false, saveDebounceMs: 60_000 }, // saves happen when a test says so
  });
  sync.attach(opened);
});

afterEach(async () => {
  sync.detach();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('saving', () => {
  it('loads the project into the store and starts saved', () => {
    expect(local().id).toBe(id);
    expect(sync.status.getState()).toMatchObject({ state: 'saved', projectId: id });
  });

  it('writes an edit to the file, newer rev, and keeps the previous version as .bak', async () => {
    edit([set('n_other', { x: 700 })]);
    expect(sync.status.getState().state).toBe('dirty');
    await sync.flush();
    const saved = await onDisk();
    expect(saved.nodes.n_other?.x).toBe(700);
    expect(saved.rev).toBe(local().rev);
    expect(sync.status.getState()).toMatchObject({ state: 'saved' });
    const bak = loadDoc(JSON.parse((await fsx.readText(`${projectFile(id)}.bak`)) ?? 'null'));
    expect(bak.ok && bak.doc.nodes.n_other?.x).toBe(500);
  });

  it('saves by itself 30 ms after the last change, and rapid edits make one write', async () => {
    const opened = await openProject(fsx, id);
    if (!opened.ok) throw new Error('should open');
    sync.detach();
    sync = new SyncService({ fs: fsx, store, options: { autoStart: false, saveDebounceMs: 30 } });
    sync.attach(opened);
    fsx.calls.length = 0;
    for (const x of [510, 520, 530, 540]) edit([set('n_other', { x })]);
    await sleep(150);
    expect(fsx.calls.filter((c) => c.startsWith('writeDoc'))).toHaveLength(1);
    expect((await onDisk()).nodes.n_other?.x).toBe(540);
  });

  it('keeps saving during a long continuous edit (maximum wait), not only after a pause', async () => {
    const opened = await openProject(fsx, id);
    if (!opened.ok) throw new Error('should open');
    sync.detach();
    sync = new SyncService({
      fs: fsx,
      store,
      options: { autoStart: false, saveDebounceMs: 80, saveMaxWaitMs: 250 },
    });
    sync.attach(opened);
    fsx.calls.length = 0;
    // An edit every 20 ms for about 900 ms: the 80 ms debounce alone would never fire.
    for (let i = 0; i < 45; i++) {
      edit([set('n_other', { x: 600 + i })]);
      await sleep(20);
    }
    const writes = fsx.calls.filter((c) => c.startsWith('writeDoc')).length;
    expect(writes, 'saved while the edits were still coming').toBeGreaterThanOrEqual(2);
    await sleep(200);
    expect((await onDisk()).nodes.n_other?.x).toBe(644);
  });

  it('does nothing when nothing changed', async () => {
    fsx.calls.length = 0;
    await sync.flush();
    expect(fsx.calls.filter((c) => c.startsWith('writeDoc'))).toHaveLength(0);
  });

  it('rev only ever grows on disk, through undo and redo too', async () => {
    const revs: number[] = [(await onDisk()).rev];
    edit([set('n_other', { x: 600 })]);
    await sync.flush();
    revs.push((await onDisk()).rev);
    store.getState().undo();
    await sync.flush();
    revs.push((await onDisk()).rev);
    store.getState().redo();
    await sync.flush();
    revs.push((await onDisk()).rev);
    for (let i = 1; i < revs.length; i++)
      expect(revs[i], revs.join(',')).toBeGreaterThan(revs[i - 1] as number);
    expect((await onDisk()).nodes.n_other?.x).toBe(600);
  });

  it('an edit made while a save is in flight is saved next, not lost', async () => {
    edit([set('n_other', { x: 601 })]);
    const saving = sync.flush();
    edit([set('n_other', { y: 77 })]);
    await saving;
    await sync.flush();
    const saved = await onDisk();
    expect(saved.nodes.n_other).toMatchObject({ x: 601, y: 77 });
  });

  it('a failed write shows an error and retries until it works; nothing is lost', async () => {
    fsx.failNextWrites(2, new Error('disk full'));
    edit([set('n_other', { x: 650 })]);
    await sync.flush();
    expect(sync.status.getState()).toMatchObject({ state: 'error' });
    expect(sync.status.getState().message).toContain('disk full');
    await sync.flush();
    expect(sync.status.getState().state).toBe('error');
    await sync.flush();
    expect(sync.status.getState().state).toBe('saved');
    expect((await onDisk()).nodes.n_other?.x).toBe(650);
  });

  it('a lock held by another program is reported kindly and retried', async () => {
    fsx.failNextWrites(1, new FsError('LOCKED', 'another AFrame process is writing this project'));
    edit([set('n_other', { x: 651 })]);
    await sync.flush();
    expect(sync.status.getState().message).toContain('Another program');
    await sync.flush();
    expect(sync.status.getState().state).toBe('saved');
  });
});

describe('an agent changes the file', () => {
  it('while the screen is clean: adopted, as one undo step, selection kept, not written back', async () => {
    store.getState().setSelection(['n_title']);
    await agentEdit([set('n_title', { text: 'Written by the agent' })]);
    fsx.calls.length = 0;
    await sync.poll();

    expect(local().nodes.n_title).toMatchObject({ text: 'Written by the agent' });
    expect(local().meta.lastWriter).toBe('mcp');
    expect(store.getState().selection).toEqual(['n_title']);
    expect(store.getState().history.past.map((h) => h.label)).toEqual(['AI change']);
    expect(notices).toEqual([
      {
        kind: 'external',
        writer: 'mcp',
        overruled: [],
        tookTheirs: false,
        merged: false,
        changedIds: ['n_title'],
      },
    ]);

    await sync.flush();
    expect(
      fsx.calls.filter((c) => c.startsWith('writeDoc')),
      'adopting must not trigger a save',
    ).toHaveLength(0);
    expect(sync.status.getState().state).toBe('saved');
  });

  it('undo steps back over the agent change and the undone state is saved as a newer revision', async () => {
    await agentEdit([set('n_title', { text: 'Agent' })]);
    await sync.poll();
    const agentRev = (await onDisk()).rev;
    store.getState().undo();
    await sync.flush();
    const saved = await onDisk();
    expect(saved.nodes.n_title).toMatchObject({ text: 'Title' });
    expect(saved.rev).toBeGreaterThan(agentRev);
  });

  it('a script that edits the JSON by hand without bumping rev is still picked up', async () => {
    await sleep(15);
    const raw = JSON.parse(await fs.readFile(file(), 'utf8')) as Doc;
    const other = raw.nodes.n_other;
    if (!other) throw new Error('fixture');
    raw.nodes.n_other = { ...other, fill: '#123456' };
    await fs.writeFile(file(), JSON.stringify(raw, null, 2));
    await sync.poll();
    expect(local().nodes.n_other?.fill).toBe('#123456');
    expect(notices[0]).toMatchObject({ kind: 'external' });
  });

  it('while the user has unsaved edits on a different node: both survive, on screen and on disk', async () => {
    edit([set('n_other', { x: 777 })]);
    await agentEdit([set('n_title', { text: 'Agent text' })]);
    await sync.poll();

    expect(local().nodes.n_other?.x).toBe(777);
    expect(local().nodes.n_title).toMatchObject({ text: 'Agent text' });
    expect(notices).toEqual([
      {
        kind: 'external',
        writer: 'mcp',
        overruled: [],
        tookTheirs: false,
        merged: true,
        changedIds: ['n_title'],
      },
    ]);
    await sync.flush();
    const saved = await onDisk();
    expect(saved.nodes.n_other?.x).toBe(777);
    expect(saved.nodes.n_title).toMatchObject({ text: 'Agent text' });
    expect(saved.rev).toBeGreaterThan(2);
  });

  it('while the user has unsaved edits on the same property: the agent wins and the node is named', async () => {
    edit([set('n_other', { x: 777 })]);
    await agentEdit([set('n_other', { x: 111 })]);
    await sync.poll();
    expect(local().nodes.n_other?.x).toBe(111);
    expect(notices).toEqual([
      {
        kind: 'external',
        writer: 'mcp',
        overruled: ['Other'],
        tookTheirs: false,
        merged: true,
        changedIds: ['n_other'],
      },
    ]);
    // The user's version is one undo away.
    store.getState().undo();
    expect(local().nodes.n_other?.x).toBe(777);
  });

  it('an agent write that lands between our check and our save is merged, not overwritten', async () => {
    edit([set('n_other', { x: 888 })]);
    await agentEdit([set('n_title', { text: 'Raced' })]); // not polled: the app does not know yet
    await sync.flush(); // our write conflicts, merges, and writes again
    const saved = await onDisk();
    expect(saved.nodes.n_other?.x).toBe(888);
    expect(saved.nodes.n_title).toMatchObject({ text: 'Raced' });
    expect(local().nodes.n_title).toMatchObject({ text: 'Raced' });
    expect(sync.status.getState().state).toBe('saved');
  });

  it('is not applied in the middle of a gesture or of typing; it is applied right after', async () => {
    store.getState().beginTransaction('Drag');
    await agentEdit([set('n_title', { text: 'During drag' })]);
    await sync.poll();
    expect(local().nodes.n_title).toMatchObject({ text: 'Title' });
    store.getState().endTransaction();
    await sync.poll();
    expect(local().nodes.n_title).toMatchObject({ text: 'During drag' });

    store.getState().setEditingTextId('n_title');
    await agentEdit([set('n_other', { x: 5 })]);
    await sync.poll();
    expect(local().nodes.n_other?.x).toBe(500);
    store.getState().setEditingTextId(null);
    await sync.poll();
    expect(local().nodes.n_other?.x).toBe(5);
  });

  it('several quick agent edits end up on screen', async () => {
    for (let i = 1; i <= 5; i++) await agentEdit([set('n_other', { x: 100 * i + 1 })]);
    await sync.poll();
    expect(local().nodes.n_other?.x).toBe(501);
    expect(local().rev).toBe(6);
  });
});

describe('the file is damaged or removed', () => {
  it('a deleted file is written back from the screen', async () => {
    await sleep(15);
    await fs.rm(file());
    await sync.poll();
    expect(notices).toContainEqual({ kind: 'file-recreated' });
    await sleep(80); // no flush() here: the service must write it back by itself
    expect((await onDisk()).id).toBe(id);
  });

  it('an unreadable file is overwritten with the screen version; the backup stays the last good one', async () => {
    edit([set('n_other', { x: 640 })]);
    await sync.flush(); // now a .bak exists
    const bakBefore = await fsx.readText(`${projectFile(id)}.bak`);
    await sleep(15);
    await fs.writeFile(file(), '{"schema":1,"re');
    await sync.poll();
    expect(notices).toContainEqual({ kind: 'file-invalid' });
    await sleep(80); // healed by itself, without waiting for the next edit
    expect((await onDisk()).nodes.n_other?.x).toBe(640);
    expect(await fsx.readText(`${projectFile(id)}.bak`)).toBe(bakBefore);
  });
});

describe('reporting and switching', () => {
  it('reports the open project and selection', async () => {
    store.getState().setSelection(['n_title', 'n_other']);
    await sleep(260);
    const last = fsx.reported.at(-1);
    expect(last).toEqual({ currentProject: id, selection: ['n_title', 'n_other'] });
  });

  it('detach stops saving and polling', async () => {
    sync.detach();
    edit([set('n_other', { x: 9 })]);
    await sleep(100);
    expect((await onDisk()).nodes.n_other?.x).toBe(500);
    await sync.poll(); // harmless
    expect(sync.status.getState().state).toBe('detached');
  });

  it('attaching another project flushes nothing by itself: the caller flushes first', async () => {
    edit([set('n_other', { x: 321 })]);
    await sync.flush();
    const second = await newProjectFrom(fsx, sampleDoc(), 'Second');
    const opened = await openProject(fsx, second.id);
    if (!opened.ok) throw new Error('should open');
    sync.attach(opened);
    expect(local().id).toBe(second.id);
    expect(store.getState().history.past).toHaveLength(0);
    expect(revOf((await fsx.readText(projectFile(id))) ?? '')).toBeGreaterThan(1);
  });
});
