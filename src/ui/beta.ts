import {
  DEFAULT_BETA,
  isBetaOn,
  parseBetaSettings,
  setBetaEnabled,
  setBetaFeature,
  type BetaFeatureId,
  type BetaSettings,
} from '@core/beta';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { getFs } from '../platform/fs';
import { readBetaSettings, writeBetaSettings } from '../projects/projects';

/**
 * The beta switches as the app sees them. They are saved in `settings.json` in the AFrame home (the
 * file the AI tool server reads, so a feature that is off has no AI tools either) and mirrored in
 * local storage, which is what a browser without the desktop app has and what shows instantly at
 * startup before the file is read.
 */
const KEY = 'aframe.beta.v1';

function fromLocal(): BetaSettings {
  try {
    return parseBetaSettings(JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null'));
  } catch {
    return DEFAULT_BETA;
  }
}

export const betaStore = createStore<{ beta: BetaSettings }>()(() => ({ beta: fromLocal() }));

function remember(beta: BetaSettings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(beta));
  } catch {
    /* blocked storage: the choice lasts for this session */
  }
}

/** Saves a new set of switches everywhere they live. Failing to write the file never loses the choice. */
export function updateBeta(change: (current: BetaSettings) => BetaSettings): void {
  const next = change(betaStore.getState().beta);
  betaStore.setState({ beta: next });
  remember(next);
  void getFs()
    .then((fs) => writeBetaSettings(fs, next))
    .catch(() => undefined);
}

export const setMasterBeta = (on: boolean): void => updateBeta((b) => setBetaEnabled(b, on));
export const setFeatureBeta = (id: BetaFeatureId, on: boolean): void =>
  updateBeta((b) => setBetaFeature(b, id, on));

/** Reads the settings file once the home is reachable (it is the copy the tool server sees). */
export async function hydrateBeta(): Promise<void> {
  try {
    const fs = await getFs();
    const stored = await readBetaSettings(fs);
    // A browser with local choices but no file yet writes them out, so the tool server learns them.
    const file = await fs.readText('settings.json').catch(() => null);
    const hasFile = file !== null && file.includes('"beta"');
    const local = betaStore.getState().beta;
    if (!hasFile && (local.enabled || Object.keys(local.features).length > 0)) {
      await writeBetaSettings(fs, local);
      return;
    }
    betaStore.setState({ beta: stored });
    remember(stored);
  } catch {
    /* no file system here (a plain browser): the local copy stands */
  }
}

/** Whether a beta feature is on right now (for code outside React). */
export const betaOn = (id: BetaFeatureId): boolean => isBetaOn(betaStore.getState().beta, id);

/** For components: re-renders when the feature is switched. A feature that is off renders nothing. */
export function useBetaFeature(id: BetaFeatureId): boolean {
  return useStore(betaStore, (s) => isBetaOn(s.beta, id));
}

export const useBetaSettings = (): BetaSettings => useStore(betaStore, (s) => s.beta);
