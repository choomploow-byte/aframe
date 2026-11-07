import { validateDoc } from '@core/validate';
import { describe, expect, it } from 'vitest';
import { generateStressDoc } from './stress';

describe('generateStressDoc', () => {
  it('builds a valid document of about the requested size', () => {
    for (const requested of [25, 500, 2000]) {
      const doc = generateStressDoc(requested);
      const count = Object.keys(doc.nodes).length - 2; // minus the page and the artboard
      expect(count).toBeGreaterThanOrEqual(requested);
      expect(count).toBeLessThan(requested + 25);
      expect(validateDoc(doc)).toMatchObject({ ok: true });
    }
  });

  it('is deterministic and always has at least one row', () => {
    expect(generateStressDoc(500)).toEqual(generateStressDoc(500));
    expect(Object.keys(generateStressDoc(0).nodes).length).toBeGreaterThan(20);
  });
});
