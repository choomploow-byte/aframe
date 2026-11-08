/**
 * Importers (docs/10 "Import"). An importer turns somebody else's design (an SVG, a Figma file, a page
 * captured from a running app) into one node spec plus a report saying, honestly, what came across.
 * Pure: nothing here reads files or the network.
 */
import type { NodeSpec } from '../types';

export type ReportKind = 'converted' | 'approximated' | 'fallback' | 'skipped';

export interface ReportEntry {
  kind: ReportKind;
  /** What it was: "FRAME Hero", "gradient on Card". */
  what: string;
  /** Why it was approximated, replaced or left out. */
  why?: string;
}

/** A picture an import wants stored in the project (a vector drawn as an image, for example). */
export interface ImportAsset {
  /** The name nodes use before the asset has a real id: `assetId: 'ref:<ref>'`. */
  ref: string;
  mime: 'image/svg+xml' | 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  bytes: Uint8Array;
}

export interface ImportResult {
  name: string;
  /** The frame to add, or null when nothing could be imported. */
  spec: NodeSpec | null;
  assets: ImportAsset[];
  report: ReportEntry[];
  /** Colours used often enough to suggest as tokens: hex -> how many times. */
  colors: Record<string, number>;
}

export interface ReportSummary {
  converted: number;
  approximated: number;
  fallback: number;
  skipped: number;
  /** Share of elements that came across as editable layers, 0 to 100. */
  editablePct: number;
}

export function summarise(report: readonly ReportEntry[]): ReportSummary {
  const count = (k: ReportKind): number => report.filter((r) => r.kind === k).length;
  const converted = count('converted');
  const approximated = count('approximated');
  const fallback = count('fallback');
  const skipped = count('skipped');
  const total = converted + fallback + skipped;
  return {
    converted,
    approximated,
    fallback,
    skipped,
    editablePct: total === 0 ? 0 : Math.round((converted / total) * 100),
  };
}

/** Limits that keep a hostile or huge file from running away. */
export const IMPORT_LIMITS = { maxNodes: 2000, maxDepth: 24, maxBytes: 8 * 1024 * 1024 } as const;

export class ImportError extends Error {}

/** Counts nodes as they are created and refuses past the limit. */
export class Budget {
  private n = 0;
  take(): void {
    this.n += 1;
    if (this.n > IMPORT_LIMITS.maxNodes) {
      throw new ImportError(
        `This file has more than ${IMPORT_LIMITS.maxNodes} elements. Import a smaller part of it.`,
      );
    }
  }
  get count(): number {
    return this.n;
  }
}

/** Counts how often each colour is used. */
export class ColorTally {
  readonly counts: Record<string, number> = {};
  add(hex: string | undefined): void {
    if (hex === undefined || !/^#[0-9a-f]{6}$/i.test(hex)) return;
    const key = hex.toLowerCase();
    this.counts[key] = (this.counts[key] ?? 0) + 1;
  }
  /** Colours used at least twice, most used first (at most 12). */
  repeated(): Record<string, number> {
    return Object.fromEntries(
      Object.entries(this.counts)
        .filter(([, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12),
    );
  }
}
