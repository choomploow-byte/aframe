/**
 * The asset library on disk: `<aframe home>/library/` holds the user's images plus an `index.json`
 * the tools search. `add` copies a folder of images in; `read` hands one back as bytes for
 * `use_library_asset`. Everything stays inside the home folder; nothing is ever read from a path an
 * agent supplies (an agent names an id, never a file).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_IMAGE_BYTES, sniffImage } from '../src/core/assets';
import {
  categorize,
  cleanName,
  packOf,
  slugify,
  svgSize,
  tagsOf,
  type LibraryEntry,
} from '../src/core/library';

const EXT: Record<LibraryEntry['mime'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};
const SAFE_FILE = /^[a-z0-9][a-z0-9-]*\.(png|jpg|webp|gif|svg)$/;
/** Icon packs nest deep: pack / group / item / size folder / file. */
const MAX_DEPTH = 6;
const MAX_FILES = 5000;
const SVG_DIR = /^svgs?$/i;
const SIZE_DIR = /^(\d+)\s?(?:px|w)$/i;
const IGNORED_FILES = /^(?:\.DS_Store|\._.*|thumbs\.db|desktop\.ini)$/i;

export interface AddReport {
  added: LibraryEntry[];
  /** Identical to an image already in the library (by content). */
  duplicates: string[];
  /** Left out because a better copy of the same picture came with it: a PNG next to its SVG, or a 64px next to a 256px. */
  twins: string[];
  skipped: { file: string; reason: string }[];
}

interface Found {
  full: string;
  /** Folders below the source folder, in order. */
  dirs: string[];
  name: string;
}

const stemOf = (name: string): string => name.replace(/\.[^.]+$/, '').toLowerCase();

export class Library {
  readonly dir: string;
  private readonly indexPath: string;

  constructor(aframeHome: string) {
    this.dir = path.join(aframeHome, 'library');
    this.indexPath = path.join(this.dir, 'index.json');
  }

  list(): LibraryEntry[] {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (e): e is LibraryEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as LibraryEntry).id === 'string' &&
          SAFE_FILE.test((e as LibraryEntry).file),
      );
    } catch {
      return [];
    }
  }

  private save(entries: LibraryEntry[]): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.indexPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(entries, null, 1)}\n`);
    fs.renameSync(tmp, this.indexPath);
  }

  /** Every regular file under `root` (a few levels deep, links never followed), in a stable order. */
  private walk(root: string, report: AddReport): Found[] {
    const out: Found[] = [];
    const queue: { dir: string; dirs: string[] }[] = [{ dir: root, dirs: [] }];
    let seen = 0;
    while (queue.length > 0) {
      const { dir, dirs } = queue.shift() as { dir: string; dirs: string[] };
      for (const dirent of fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        if (IGNORED_FILES.test(dirent.name) || dirent.name === '__MACOSX') continue;
        const full = path.join(dir, dirent.name);
        if (dirent.isSymbolicLink()) {
          report.skipped.push({ file: dirent.name, reason: 'a link (links are never followed)' });
          continue;
        }
        if (dirent.isDirectory()) {
          if (dirs.length < MAX_DEPTH) queue.push({ dir: full, dirs: [...dirs, dirent.name] });
          continue;
        }
        if (!dirent.isFile()) continue;
        if (++seen > MAX_FILES) {
          report.skipped.push({ file: dirent.name, reason: `more than ${MAX_FILES} files` });
          continue;
        }
        out.push({ full, dirs, name: dirent.name });
      }
    }
    return out.sort((a, b) =>
      [...a.dirs, a.name].join('/').localeCompare([...b.dirs, b.name].join('/')),
    );
  }

  /**
   * Files that have a better twin in the same download: a PNG whose SVG sits beside it (or in an
   * `SVG` folder next to it), and the smaller of several size folders (`64px` next to `256px`).
   */
  private findTwins(found: Found[]): Set<Found> {
    const twins = new Set<Found>();
    const key = (f: Found): string =>
      `${f.dirs.filter((d) => !SVG_DIR.test(d)).join('/')}|${stemOf(f.name)}`.toLowerCase();
    const svgKeys = new Set<string>();
    for (const f of found) {
      if (!/\.svg$/i.test(f.name)) continue;
      const head = new Uint8Array(4096);
      const fd = fs.openSync(f.full, 'r');
      try {
        const n = fs.readSync(fd, head, 0, head.length, 0);
        if (sniffImage(head.subarray(0, n))?.mime === 'image/svg+xml') svgKeys.add(key(f));
      } finally {
        fs.closeSync(fd);
      }
    }
    for (const f of found) {
      if (!/\.svg$/i.test(f.name) && svgKeys.has(key(f))) twins.add(f);
    }
    const largest = new Map<string, number>();
    const sizeOf = (f: Found): number => {
      const m = SIZE_DIR.exec(f.dirs.at(-1) ?? '');
      return m?.[1] === undefined ? 0 : Number.parseInt(m[1], 10);
    };
    const parentOf = (f: Found): string => f.dirs.slice(0, -1).join('/');
    for (const f of found) {
      const size = sizeOf(f);
      if (size > 0) largest.set(parentOf(f), Math.max(largest.get(parentOf(f)) ?? 0, size));
    }
    for (const f of found) {
      const size = sizeOf(f);
      if (size > 0 && size < (largest.get(parentOf(f)) ?? 0)) twins.add(f);
    }
    return twins;
  }

  /**
   * Copies every image under `sourceDir` (a few levels deep, regular files only, never following
   * links) into the library. Files are checked by their bytes, not their names; non-images, oversize
   * files and exact duplicates are reported, not added. The folders a file sits in become its pack and
   * group (for example "Basic GUI" / "Sliders"). Safe to run again: it adds only what is new.
   */
  add(sourceDir: string): AddReport {
    const root = path.resolve(sourceDir);
    if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`${root} is not a folder.`);
    }
    const entries = this.list();
    const hashes = new Set(entries.map((e) => e.sha256));
    const ids = new Set(entries.map((e) => e.id));
    const files = new Set(entries.map((e) => e.file));
    const report: AddReport = { added: [], duplicates: [], twins: [], skipped: [] };

    const found = this.walk(root, report);
    const twins = this.findTwins(found);
    const rootName = path.basename(root);

    for (const f of found) {
      if (twins.has(f)) {
        report.twins.push(f.name);
        continue;
      }
      const size = fs.statSync(f.full).size;
      if (size > MAX_IMAGE_BYTES) {
        report.skipped.push({ file: f.name, reason: 'larger than 20 MB' });
        continue;
      }
      const bytes = new Uint8Array(fs.readFileSync(f.full));
      const info = sniffImage(bytes);
      if (!info) {
        report.skipped.push({ file: f.name, reason: 'not a PNG, JPEG, GIF, WebP or SVG' });
        continue;
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      if (hashes.has(sha256)) {
        report.duplicates.push(f.name);
        continue;
      }
      const name = cleanName(f.name);
      let id = slugify(name);
      for (let n = 2; ids.has(id); n += 1) id = `${slugify(name)}-${n}`;
      const file = `${id}.${EXT[info.mime]}`;
      if (!SAFE_FILE.test(file) || files.has(file)) {
        report.skipped.push({ file: f.name, reason: 'could not be given a safe name' });
        continue;
      }
      let { width, height } = info;
      if (info.mime === 'image/svg+xml') {
        const dims = svgSize(Buffer.from(bytes.subarray(0, 4096)).toString('latin1'));
        width = dims?.width ?? null;
        height = dims?.height ?? null;
      }
      const trail = [rootName, ...f.dirs.filter((d) => !SVG_DIR.test(d) && !SIZE_DIR.test(d))];
      const { pack, group, sub } = packOf(trail);
      const category = categorize(name, { pack, group });
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(path.join(this.dir, file), bytes);
      const entry: LibraryEntry = {
        id,
        name,
        file,
        category,
        ...(pack === undefined ? {} : { pack }),
        ...(group === undefined ? {} : { group }),
        tags: tagsOf(name, category, [pack ?? '', group ?? '', sub ?? '']),
        mime: info.mime,
        width,
        height,
        bytes: bytes.length,
        sha256,
      };
      hashes.add(sha256);
      ids.add(id);
      files.add(file);
      entries.push(entry);
      report.added.push(entry);
    }
    entries.sort((a, b) => a.id.localeCompare(b.id));
    if (report.added.length > 0) this.save(entries);
    return report;
  }

  /** The bytes of one asset, by id. The id must be in the index; no path is ever built from input. */
  read(id: string): { entry: LibraryEntry; bytes: Uint8Array } | null {
    const entry = this.list().find((e) => e.id === id);
    if (!entry) return null;
    try {
      return { entry, bytes: new Uint8Array(fs.readFileSync(path.join(this.dir, entry.file))) };
    } catch {
      return null;
    }
  }
}
