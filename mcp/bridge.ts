/**
 * The MCP server's side of the app bridge (docs/06): is the app alive, what is it looking at, and
 * "do this for me" requests (screenshots and other things only the live app can do).
 *
 * Liveness is the native heartbeat in `app-state.json` (refreshed every 2 s; fresh = under 5 s).
 * Requests are files: write `requests/req_<id>.json`, poll `responses/<id>.json` every 100 ms.
 */
import { CoreError } from '../src/core/errors';
import type { ErrorCode } from '../src/core/types';
import type { HomeFs } from './home-fs';

export const HEARTBEAT_FRESH_MS = 5_000;
export const POLL_MS = 100;
export const DEFAULT_TIMEOUT_MS = 15_000;

export interface AppState {
  appHeartbeat: string;
  appPid: number;
  appVersion: string;
  currentProject: string | null;
  selection: string[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const randomId = (): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 10; i += 1) id += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `req_${id}`;
};

/** Error codes the app may answer with; anything else is reported as INTERNAL with the app's words. */
const APP_ERROR_CODES: readonly ErrorCode[] = [
  'NOT_FOUND',
  'INVALID_VALUE',
  'LIMIT_EXCEEDED',
  'NOT_IMPLEMENTED',
  'TIMEOUT',
];

export class BridgeClient {
  constructor(
    private readonly home: HomeFs,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The app's published state, or null if it never ran, or the file is unreadable. */
  async readState(): Promise<AppState | null> {
    try {
      const text = await this.home.read('app-state.json');
      if (text === null) return null;
      const v = JSON.parse(text) as Partial<AppState>;
      if (typeof v.appHeartbeat !== 'string') return null;
      return {
        appHeartbeat: v.appHeartbeat,
        appPid: typeof v.appPid === 'number' ? v.appPid : 0,
        appVersion: typeof v.appVersion === 'string' ? v.appVersion : '',
        currentProject: typeof v.currentProject === 'string' ? v.currentProject : null,
        selection: Array.isArray(v.selection)
          ? v.selection.filter((s): s is string => typeof s === 'string')
          : [],
      };
    } catch {
      return null;
    }
  }

  /** The state, only if the app is alive right now. */
  async live(): Promise<AppState | null> {
    const state = await this.readState();
    if (!state) return null;
    const age = this.now() - Date.parse(state.appHeartbeat);
    return Number.isFinite(age) && age < HEARTBEAT_FRESH_MS ? state : null;
  }

  async appOnline(): Promise<boolean> {
    return (await this.live()) !== null;
  }

  /** Asks the running app to do something. Rejects with APP_NOT_RUNNING / TIMEOUT / the app's own error. */
  async request(
    type: string,
    params: Record<string, unknown> = {},
    options: { timeoutMs?: number; project?: string | null } = {},
  ): Promise<unknown> {
    const live = await this.live();
    if (!live) {
      throw new CoreError(
        'APP_NOT_RUNNING',
        'The Atelier app is not running, so it cannot do that.',
        'Ask the user to open Atelier (and keep its window visible), then retry. Tools that only read or edit the design still work without the app.',
      );
    }
    const id = randomId();
    const file = `requests/${id}.json`;
    await this.home.write(
      file,
      JSON.stringify({
        id,
        type,
        createdAt: new Date(this.now()).toISOString(),
        ...(options.project ? { project: options.project } : {}),
        params,
      }),
    );
    const deadline = this.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      while (this.now() < deadline) {
        const text = await this.home.read(`responses/${id}.json`);
        if (text !== null) {
          await this.home.remove(`responses/${id}.json`).catch(() => undefined);
          return this.unwrap(type, text);
        }
        await sleep(POLL_MS);
      }
    } finally {
      await this.home.remove(file).catch(() => undefined);
    }
    throw new CoreError(
      'TIMEOUT',
      `The Atelier app did not answer the ${type} request in time.`,
      'The app may be minimised or busy. Ask the user to bring the Atelier window to the front and retry.',
    );
  }

  private unwrap(type: string, text: string): unknown {
    let res: { ok?: boolean; result?: unknown; error?: { code?: string; message?: string } };
    try {
      res = JSON.parse(text) as typeof res;
    } catch {
      throw new CoreError('INTERNAL', `The app sent an unreadable answer to ${type}.`);
    }
    if (res.ok === true) return res.result;
    const code = res.error?.code ?? 'INTERNAL';
    const message = res.error?.message ?? `The app could not do ${type}.`;
    if (code === 'PROJECT_NOT_OPEN') {
      throw new CoreError(
        'NOT_FOUND',
        message,
        'That project is not the one open in Atelier. Call open_project first, or ask the user to open it.',
      );
    }
    throw new CoreError(
      (APP_ERROR_CODES as readonly string[]).includes(code) ? (code as ErrorCode) : 'INTERNAL',
      message,
    );
  }
}
