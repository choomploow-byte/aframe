import { lintDesign } from '@core/lint';
import { useEffect, useState } from 'react';
import { useAtelier } from '../store/store';

const DELAY_MS = 500;

/** Problems and warnings in the open design, recomputed shortly after edits stop (not on every drag frame). */
export function useLintCounts(): { problems: number; errors: number } {
  const doc = useAtelier((s) => s.doc);
  const [counts, setCounts] = useState({ problems: 0, errors: 0 });
  useEffect(() => {
    const t = setTimeout(() => {
      const r = lintDesign(doc);
      setCounts({ problems: r.counts.error + r.counts.warning, errors: r.counts.error });
    }, DELAY_MS);
    return () => clearTimeout(t);
  }, [doc]);
  return counts;
}
