import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serializeDoc } from '../../src/core/doc';
import { sampleDoc } from '../../src/core/testing';
import {
  backupFile,
  createProject,
  deleteProject,
  isProjectId,
  listProjects,
  nameFromHead,
  newProject,
  newProjectFrom,
  openProject,
  projectFile,
  readSettings,
  renameProjectOnDisk,
  restoreBackup,
  writeSettings,
} from '../../src/projects/projects';
import { createTestAdapter, type TestAdapter } from './helpers/node-adapter';

let dir: string;
let fsx: TestAdapter;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aframe-proj-'));
  fsx = createTestAdapter(path.join(dir, 'home'));
  await fsx.home_.ensure();
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('ids and names', () => {
  it('only well-formed project ids are accepted (they become folder names)', () => {
    for (const ok of ['p_abc12', 'p_sample', 'p_A1b2C3']) expect(isProjectId(ok), ok).toBe(true);
    for (const bad of ['', 'p_', 'p_a', '../x', 'p_a/../b', 'n_abc12', 'p_ab cd', 'p_a.b.c']) {
      expect(isProjectId(bad), bad).toBe(false);
    }
  });

  it('reads the name from the start of a project file, even with escapes', () => {
    expect(
      nameFromHead('{"schema":1,"rev":3,"id":"p_x","name":"My \\"best\\" work","rootId":'),
    ).toBe('My "best" work');
    expect(nameFromHead('{"schema":1}')).toBeNull();
    expect(nameFromHead('{"name":"cut off')).toBeNull();
  });

  it('serialised projects keep name and rev at the top, bulky data last', () => {
    const doc = {
      ...sampleDoc(),
      name: 'Top',
      assets: { a_big01: `data:image/png;base64,${'A'.repeat(500_000)}` },
    };
    const text = serializeDoc(doc);
    expect(nameFromHead(text.slice(0, 4096))).toBe('Top');
    expect(text.indexOf('"nodes"')).toBeLessThan(text.indexOf('"assets"'));
    expect(text.indexOf('"name"')).toBeLessThan(400);
  });
});

describe('create, list, open', () => {
  it('creates a project, lists it newest first without loading images, and opens it', async () => {
    const a = await newProject(fsx, 'First');
    await new Promise((r) => setTimeout(r, 20));
    const bigSource = {
      ...sampleDoc(),
      assets: { a_big01: `data:image/png;base64,${'A'.repeat(2_000_000)}` },
    };
    const b = await newProjectFrom(fsx, bigSource, 'Second');
    expect(b.id).not.toBe(bigSource.id);

    fsx.calls.length = 0;
    const list = await listProjects(fsx);
    expect(list.map((p) => p.name)).toEqual(['Second', 'First']);
    expect(list.every((p) => !p.unreadable)).toBe(true);
    expect(
      fsx.calls.some((c) => c.startsWith('readText')),
      'the list must not read whole files',
    ).toBe(false);

    const opened = await openProject(fsx, a.id);
    expect(opened).toMatchObject({ ok: true, id: a.id, migrated: false });
    if (opened.ok) {
      expect(opened.doc.name).toBe('First');
      expect(opened.diskRev).toBe(1);
      expect(opened.stat?.size).toBeGreaterThan(0);
    }
  });

  it('refuses to overwrite an existing project and rejects bad ids before touching the disk', async () => {
    const a = await newProject(fsx);
    await expect(createProject(fsx, a)).rejects.toThrow('already exists');
    await expect(openProject(fsx, '../../etc')).rejects.toThrow('not a project id');
    await expect(deleteProject(fsx, 'p_a/../..')).rejects.toThrow('not a project id');
  });

  it('a missing project is reported, not thrown', async () => {
    expect(await openProject(fsx, 'p_nothing')).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('damaged files', () => {
  async function twoSaves() {
    const doc = await newProject(fsx, 'Precious');
    const r = await fsx.writeDoc(
      projectFile(doc.id),
      serializeDoc({ ...doc, rev: 2, name: 'Precious v2' }),
      1,
    );
    expect(r.ok).toBe(true);
    return doc.id;
  }

  it('a truncated file opens as invalid and offers the backup when it is good', async () => {
    const id = await twoSaves();
    await fs.writeFile(fsx.home_.confine(projectFile(id)), '{"schema":1,"re');
    const r = await openProject(fsx, id);
    expect(r).toMatchObject({ ok: false, reason: 'invalid', canRestore: true });
    const listed = (await listProjects(fsx)).find((p) => p.id === id);
    expect(listed?.unreadable).toBe(true);

    expect(await restoreBackup(fsx, id)).toBe(true);
    const back = await openProject(fsx, id);
    expect(back).toMatchObject({ ok: true });
    if (back.ok) expect(back.doc.name).toBe('Precious'); // the version before the last save
  });

  it('a deleted project file with an intact backup is recoverable', async () => {
    const id = await twoSaves();
    await fs.rm(fsx.home_.confine(projectFile(id)));
    expect(await openProject(fsx, id)).toMatchObject({
      ok: false,
      reason: 'invalid',
      canRestore: true,
    });
    expect(await restoreBackup(fsx, id)).toBe(true);
  });

  it('with no usable backup, restore says so and changes nothing', async () => {
    const doc = await newProject(fsx);
    await fs.writeFile(fsx.home_.confine(projectFile(doc.id)), 'garbage');
    expect(await openProject(fsx, doc.id)).toMatchObject({
      ok: false,
      reason: 'invalid',
      canRestore: false,
    });
    expect(await restoreBackup(fsx, doc.id)).toBe(false);
    expect(await fs.readFile(fsx.home_.confine(projectFile(doc.id)), 'utf8')).toBe('garbage');
  });

  it('a file from a newer AFrame is refused with its own reason, not treated as damage', async () => {
    const doc = await newProject(fsx);
    await fs.writeFile(
      fsx.home_.confine(projectFile(doc.id)),
      JSON.stringify({ ...doc, schema: 99 }),
    );
    expect(await openProject(fsx, doc.id)).toMatchObject({ ok: false, reason: 'too-new' });
  });

  it('a file with a bad node is invalid and says where', async () => {
    const doc = await newProject(fsx);
    const bad = { ...doc, nodes: { ...doc.nodes, n_evil1: { id: 'n_evil1', type: 'script' } } };
    await fs.writeFile(fsx.home_.confine(projectFile(doc.id)), JSON.stringify(bad));
    const r = await openProject(fsx, doc.id);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === 'invalid') expect(r.errors[0]?.path).toBe('nodes.n_evil1');
  });

  it('the backup of a project is never replaced by a corrupt main file', async () => {
    const id = await twoSaves();
    await fs.writeFile(fsx.home_.confine(projectFile(id)), '{"sch');
    await fsx.writeDoc(
      projectFile(id),
      serializeDoc({ ...sampleDoc(), id, rev: 9, name: 'Mine' }),
      null,
    );
    expect(await fsx.readText(backupFile(id))).toContain('Precious');
  });
});

describe('rename, delete, settings', () => {
  it('renames a project on disk with a newer revision', async () => {
    const doc = await newProject(fsx, 'Old');
    expect(await renameProjectOnDisk(fsx, doc.id, 'New')).toBe(true);
    const opened = await openProject(fsx, doc.id);
    if (!opened.ok) throw new Error('should open');
    expect(opened.doc.name).toBe('New');
    expect(opened.doc.rev).toBe(2);
    expect(await renameProjectOnDisk(fsx, 'p_nothing', 'x')).toBe(false);
  });

  it('deletes the whole project folder, backup included', async () => {
    const doc = await newProject(fsx);
    await fsx.writeDoc(projectFile(doc.id), serializeDoc({ ...doc, rev: 2 }), 1);
    await deleteProject(fsx, doc.id);
    expect(await listProjects(fsx)).toEqual([]);
    expect(await fsx.stat(backupFile(doc.id))).toBeNull();
  });

  it('settings survive a round trip and a damaged settings file never blocks startup', async () => {
    const doc = await newProject(fsx);
    expect(await readSettings(fsx)).toEqual({});
    await writeSettings(fsx, { lastProject: doc.id });
    expect(await readSettings(fsx)).toEqual({ lastProject: doc.id });
    await fsx.writeText('settings.json', '{"lastProject":"../../x"}');
    expect(await readSettings(fsx)).toEqual({});
    await fsx.writeText('settings.json', 'not json');
    expect(await readSettings(fsx)).toEqual({});
  });
});
