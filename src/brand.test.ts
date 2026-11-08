import { describe, expect, it } from 'vitest';
import { BRAND } from './brand';

describe('BRAND', () => {
  it('keeps the placeholder identifiers in one place', () => {
    expect(BRAND.name).toBe('AFrame');
    expect(BRAND.homeDirName).toBe('.aframe');
    expect(BRAND.bundleId).toMatch(/^[a-z]+(\.[a-z]+)+$/);
  });
});
