/**
 * `agents/<pid>.json`: "an agent is connected and was last seen at ...". One file per server process,
 * written only by that process (docs/06: one writer per file). The app's Connect dialog watches
 * these to turn green on the first tool call; a stale file means the process died.
 */
import { MCP_VERSION } from './generated';
import type { HomeFs } from './home-fs';

export interface AgentFile {
  pid: number;
  version: string;
  startedAt: string;
  /** Refreshed every 30 s while the process lives, and on every tool call: "an agent is connected". */
  lastAgentSeen: string;
  /** Set on tool calls only: "an agent just used AFrame" (the Connect dialog's test waits for it). */
  lastToolCall?: string;
  currentProject?: string;
}

const HEARTBEAT_MS = 30_000;

const MAX_AGE_MS = 24 * 3600_000;

export class Presence {
  private readonly startedAt = new Date().toISOString();
  private lastWrite = 0;
  private currentProject: string | undefined;
  private lastToolCall: string | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly home: HomeFs,
    private readonly pid: number = process.pid,
  ) {}

  private file(): string {
    return `agents/${this.pid}.json`;
  }

  private async write(): Promise<void> {
    const body: AgentFile = {
      pid: this.pid,
      version: MCP_VERSION,
      startedAt: this.startedAt,
      lastAgentSeen: new Date().toISOString(),
      ...(this.lastToolCall === undefined ? {} : { lastToolCall: this.lastToolCall }),
      ...(this.currentProject === undefined ? {} : { currentProject: this.currentProject }),
    };
    this.lastWrite = Date.now();
    await this.home.write(this.file(), JSON.stringify(body));
  }

  /** At start-up: announce this process and tidy files left by dead ones. */
  async start(): Promise<void> {
    await this.write().catch(() => undefined);
    this.timer = setInterval(() => void this.write().catch(() => undefined), HEARTBEAT_MS);
    this.timer.unref(); // never keeps the process alive
    try {
      for (const e of await this.home.list('agents')) {
        if (
          e.name.endsWith('.json') &&
          e.name !== `${this.pid}.json` &&
          Date.now() - e.mtimeMs > MAX_AGE_MS
        ) {
          await this.home.remove(`agents/${e.name}`).catch(() => undefined);
        }
      }
    } catch {
      /* housekeeping only */
    }
  }

  /** On every tool call (at most once a second). Never throws: presence must not break a tool. */
  touch(currentProject?: string): void {
    if (currentProject !== undefined) this.currentProject = currentProject;
    this.lastToolCall = new Date().toISOString();
    const wait = 1000 - (Date.now() - this.lastWrite);
    if (wait <= 0 || currentProject !== undefined) {
      void this.write().catch(() => undefined);
    } else if (!this.pending) {
      // Too soon after the last write: write once, shortly, so the latest call is never lost.
      this.pending = setTimeout(() => {
        this.pending = null;
        void this.write().catch(() => undefined);
      }, wait);
      this.pending.unref();
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.pending) clearTimeout(this.pending);
    await this.home.remove(this.file()).catch(() => undefined);
  }
}
