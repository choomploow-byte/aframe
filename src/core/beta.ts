/**
 * Beta features: things that are built but not finished enough to be on for everyone. One master
 * switch in Settings, then one switch per feature. A feature that is off is fully hidden: no menu
 * entry, no panel, and no AI tools.
 *
 * To add a beta feature, add ONE entry to `BETA_FEATURES` below, then gate its UI with
 * `useBetaFeature(id)` (src/ui/beta.ts) and its AI tools with `requireBeta(ctx, id)`. Settings lists
 * every entry automatically.
 *
 * The switches are stored in the app's small settings file (`settings.json` in the AFrame home) as
 * `{ "beta": { "enabled": true, "features": { "pixelArt": true } } }`, so the AI tool server, which
 * is a separate process, can read them too.
 */

export interface BetaFeature {
  /** Stable id: used in the settings file and in code. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Whether it is on when the master switch is on and the person has not chosen. Beta = off. */
  readonly default: boolean;
}

export const BETA_FEATURES = [
  {
    id: 'pixelArt',
    name: 'Pixel Art Editor',
    description:
      'Draw pixel art on a grid with a palette, or ask the AI to generate and improve it. Adds a Pixel Art view and AI tools to read and draw on the canvas.',
    default: false,
  },
] as const satisfies readonly BetaFeature[];

export type BetaFeatureId = (typeof BETA_FEATURES)[number]['id'];

export interface BetaSettings {
  /** The master switch. Off hides every beta feature, whatever the individual switches say. */
  enabled: boolean;
  /** The person's choice per feature; missing means "use the feature's default". */
  features: Partial<Record<BetaFeatureId, boolean>>;
}

export const DEFAULT_BETA: BetaSettings = { enabled: false, features: {} };

/** Reads the stored value tolerantly: anything unreadable means everything off. */
export function parseBetaSettings(raw: unknown): BetaSettings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_BETA;
  const v = raw as Record<string, unknown>;
  const features: Partial<Record<BetaFeatureId, boolean>> = {};
  if (typeof v.features === 'object' && v.features !== null && !Array.isArray(v.features)) {
    const stored = v.features as Record<string, unknown>;
    for (const f of BETA_FEATURES) {
      if (typeof stored[f.id] === 'boolean') features[f.id] = stored[f.id] as boolean;
    }
  }
  return { enabled: v.enabled === true, features };
}

/** Whether a feature is on: the master switch and the feature's own switch (or its default). */
export function isBetaOn(settings: BetaSettings | undefined, id: BetaFeatureId): boolean {
  if (settings?.enabled !== true) return false;
  const feature = BETA_FEATURES.find((f) => f.id === id);
  if (!feature) return false;
  return settings.features[id] ?? feature.default;
}

export function setBetaEnabled(settings: BetaSettings, enabled: boolean): BetaSettings {
  return { ...settings, enabled };
}

export function setBetaFeature(
  settings: BetaSettings,
  id: BetaFeatureId,
  on: boolean,
): BetaSettings {
  return { ...settings, features: { ...settings.features, [id]: on } };
}
