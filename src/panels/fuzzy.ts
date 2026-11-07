/**
 * Subsequence fuzzy matching for the command palette and layer search. Higher is better; null
 * means no match. Rewards consecutive characters and matches at word starts.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === '') return 0;
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    const atWordStart = found === 0 || /[\s\-_/.]/.test(t.charAt(found - 1));
    streak = found === ti && streak > 0 ? streak + 1 : 1;
    score += 1 + (atWordStart ? 3 : 0) + (streak > 1 ? streak : 0);
    score -= Math.min(found - ti, 5) * 0.1; // small penalty for gaps
    ti = found + 1;
  }
  // Prefer shorter texts and prefix matches when everything else is equal.
  return score - t.length * 0.01 + (t.startsWith(q) ? 5 : 0);
}

/** Items that match, best first; stable for ties. */
export function rankItems<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, score: fuzzyScore(query, text(item)) }))
    .filter((r): r is { item: T; index: number; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item);
}
