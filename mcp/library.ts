/**
 * The asset library on disk: `<atelier home>/library/` holds the user's images plus an `index.json`
 * the tools search. `add` copies a folder of images in; `read` hands one back as bytes for
 * `use_library_asset`. Everything stays inside the home folder; nothing is ever read from a path an
 * agent supplies (an agent names an id, never a file).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_IMAGE_BYTES, sniffImage } from '../src/core/assets';
import { categorize, cleanName, slugify, tagsOf, type LibraryEntry } from '../src/core/library';

const EXT: Record<LibraryEntry['mime'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};
const SAFE_FILE = /^[a-z0-9][a-z0-9-]*\.(png|jpg|webp|gif|svg)$/;
const MAX_DEPTH = 3;
const MAX_FILES = 5000;

export interface AddReport {
  added: LibraryEntry[];
  /** Identical to an image already in the library (by content). */
  duplicates: string[];
  skipped: { file: string; reason: string }[];
}

export class Library {
  readonly dir: string;
  private readonly indexPath: string;

  constructor(atelierHome: string) {
    this.dir = path.join(atelierHome, 'library');
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

  /**
   * Copies every image under `sourceDir` (a few levels deep, regular files only, never following
   * links) into the library. Files are checked by their bytes, not their names; non-images, oversize
   * files and exact duplicates are reported, not added. Safe to run again: it adds only what is new.
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
    const report: AddReport = { added: [], duplicates: [], skipped: [] };

    const queue: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];
    let seen = 0;
    while (queue.length > 0) {
      const { dir, depth } = queue.shift() as { dir: string; depth: number };
      for (const dirent of fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        const full = path.join(dir, dirent.name);
        if (dirent.isSymbolicLink()) {
          report.skipped.push({ file: dirent.name, reason: 'a link (links are never followed)' });
          continue;
        }
        if (dirent.isDirectory()) {
          if (depth < MAX_DEPTH) queue.push({ dir: full, depth: depth + 1 });
          continue;
        }
        if (!dirent.isFile()) continue;
        if (++seen > MAX_FILES) {
          report.skipped.push({ file: dirent.name, reason: `more than ${MAX_FILES} files` });
          continue;
        }
        const size = fs.statSync(full).size;
        if (size > MAX_IMAGE_BYTES) {
          report.skipped.push({ file: dirent.name, reason: 'larger than 20 MB' });
          continue;
        }
        const bytes = new Uint8Array(fs.readFileSync(full));
        const info = sniffImage(bytes);
        if (!info) {
          report.skipped.push({ file: dirent.name, reason: 'not a PNG, JPEG, GIF, WebP or SVG' });
          continue;
        }
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (hashes.has(sha256)) {
          report.duplicates.push(dirent.name);
          continue;
        }
        const name = cleanName(dirent.name);
        let id = slugify(name);
        for (let n = 2; ids.has(id); n += 1) id = `${slugify(name)}-${n}`;
        const file = `${id}.${EXT[info.mime]}`;
        if (!SAFE_FILE.test(file) || files.has(file)) {
          report.skipped.push({ file: dirent.name, reason: 'could not be given a safe name' });
          continue;
        }
        fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(path.join(this.dir, file), bytes);
        const category = categorize(name);
        const entry: LibraryEntry = {
          id,
          name,
          file,
          category,
          tags: tagsOf(name, category),
          mime: info.mime,
          width: info.width,
          height: info.height,
          bytes: bytes.length,
          sha256,
        };
        hashes.add(sha256);
        ids.add(id);
        files.add(file);
        entries.push(entry);
        report.added.push(entry);
      }
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
