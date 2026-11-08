import { describe, expect, it } from 'vitest';
import {
  BETA_FEATURES,
  DEFAULT_BETA,
  isBetaOn,
  parseBetaSettings,
  setBetaEnabled,
  setBetaFeature,
} from './beta';

describe('beta features', () => {
  it('everything is off by default', () => {
    for (const f of BETA_FEATURES) {
      expect(f.default).toBe(false);
      expect(isBetaOn(DEFAULT_BETA, f.id)).toBe(false);
      expect(isBetaOn(undefined, f.id)).toBe(false);
    }
  });

  it('needs the master switch and the feature switch', () => {
    let s = setBetaFeature(DEFAULT_BETA, 'pixelArt', true);
    expect(isBetaOn(s, 'pixelArt')).toBe(false); // master still off
    s = setBetaEnabled(s, true);
    expect(isBetaOn(s, 'pixelArt')).toBe(true);
    expect(isBetaOn(setBetaFeature(s, 'pixelArt', false), 'pixelArt')).toBe(false);
    expect(isBetaOn(setBetaEnabled(s, false), 'pixelArt')).toBe(false);
  });

  it('with the master on and no choice made, a feature follows its default (off)', () => {
    expect(isBetaOn({ enabled: true, features: {} }, 'pixelArt')).toBe(false);
  });

  it('an unknown feature is never on', () => {
    expect(isBetaOn({ enabled: true, features: {} }, 'nope' as never)).toBe(false);
  });

  it('reads stored settings tolerantly', () => {
    expect(parseBetaSettings(undefined)).toEqual(DEFAULT_BETA);
    expect(parseBetaSettings('yes')).toEqual(DEFAULT_BETA);
    expect(parseBetaSettings([])).toEqual(DEFAULT_BETA);
    expect(parseBetaSettings({ enabled: 'true' })).toEqual(DEFAULT_BETA);
    expect(parseBetaSettings({ enabled: true, features: { pixelArt: true, other: true } })).toEqual(
      {
        enabled: true,
        features: { pixelArt: true },
      },
    );
    expect(parseBetaSettings({ enabled: true, features: { pixelArt: 'on' } })).toEqual({
      enabled: true,
      features: {},
    });
  });

  it('ids are unique', () => {
    const ids = BETA_FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
