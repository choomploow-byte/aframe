import { resolveFont } from '@core/tokens';
import type { Doc } from '@core/types';

/** The families bundled with the app (docs/11) and registered by `fonts.css`. */
export interface BundledFont {
  name: string;
  category: 'sans' | 'serif' | 'mono';
}

export const BUNDLED_FONTS: readonly BundledFont[] = [
  { name: 'Inter', category: 'sans' },
  { name: 'DM Sans', category: 'sans' },
  { name: 'Space Grotesk', category: 'sans' },
  { name: 'Fraunces', category: 'serif' },
  { name: 'Playfair Display', category: 'serif' },
  { name: 'JetBrains Mono', category: 'mono' },
];

/** Every family the document's text uses (tokens resolved), so they can be loaded before painting. */
export function docFontFamilies(doc: Doc): string[] {
  const names = new Set<string>();
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== 'text') continue;
    const family = resolveFont(node.fontFamily, doc.tokens);
    if (family) names.add(family);
  }
  return [...names];
}

/**
 * Waits for the fonts to load (or `timeoutMs`, so a missing font never blocks the canvas). Text is
 * measured and screenshotted from the DOM, so it must not be laid out in a fallback face first.
 */
export async function loadFonts(families: readonly string[], timeoutMs = 1500): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document) || families.length === 0) return;
  const loads = Promise.all(
    families.flatMap((f) =>
      [`400 16px "${f}"`, `700 16px "${f}"`].map((spec) =>
        document.fonts.load(spec).catch(() => [] as FontFace[]),
      ),
    ),
  );
  await Promise.race([loads, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}
