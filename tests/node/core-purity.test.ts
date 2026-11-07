// Mechanical check of CLAUDE.md rule 1: src/core is pure TypeScript shared by the app and the MCP
// bundle. tsconfig.core.json (no DOM/Node types) and the ESLint zone enforce it at compile and
// lint time; this test is the belt to their braces and also pins the allowed dependencies.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE_DIR = join(import.meta.dirname, '..', '..', 'src', 'core');
const sources = readdirSync(CORE_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => ({ file: f, text: readFileSync(join(CORE_DIR, f), 'utf8') }));

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\b[^'"\n;]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
/** The only bare (non-relative) specifier core may use. */
const ALLOWED_PACKAGES = new Set(['zod/v4']);

// Member access on browser/Node globals, not the bare words (error messages say "document").
const FORBIDDEN_GLOBALS =
  /\b(?:window|document|navigator|localStorage|sessionStorage|process|Buffer)\s*(?:\.|\[)\s*[A-Za-z_'"]|\btypeof\s+(?:window|document|process)\b|\brequire\s*\(|__dirname|import\.meta\.env/;

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('src/core purity', () => {
  it('finds the core sources', () => {
    expect(sources.length).toBeGreaterThan(15);
  });

  it('imports only relative modules and zod', () => {
    for (const { file, text } of sources) {
      for (const match of text.matchAll(IMPORT_RE)) {
        const specifier = match[1] ?? match[2] ?? '';
        const ok = specifier.startsWith('./') || ALLOWED_PACKAGES.has(specifier);
        expect(ok, `${file} imports '${specifier}'`).toBe(true);
      }
    }
  });

  it('never touches DOM, Node or Tauri globals', () => {
    for (const { file, text } of sources) {
      expect(FORBIDDEN_GLOBALS.test(stripComments(text)), `${file} uses a forbidden global`).toBe(
        false,
      );
    }
  });

  it('would actually catch violations (the detector itself is tested)', () => {
    for (const bad of [
      'const t = document.title;',
      'window.localStorage.getItem("k")',
      'process.env.HOME',
      "const fs = require('fs');",
      'if (typeof window !== "undefined") {}',
      "navigator['userAgent']",
    ]) {
      expect(FORBIDDEN_GLOBALS.test(bad), bad).toBe(true);
    }
    for (const fine of ['The document must be an object.', 'a "window" of time', 'processing()']) {
      expect(FORBIDDEN_GLOBALS.test(fine), fine).toBe(false);
    }
    expect([...'import fs from "node:fs";'.matchAll(IMPORT_RE)][0]?.[1]).toBe('node:fs');
  });

  it('has no dangerouslySetInnerHTML, eval or new Function', () => {
    for (const { file, text } of sources) {
      expect(/dangerouslySetInnerHTML|\beval\s*\(|new\s+Function\s*\(/.test(text), file).toBe(
        false,
      );
    }
  });
});
