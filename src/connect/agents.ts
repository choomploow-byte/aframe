/**
 * Who is connected: each running MCP server writes `agents/<pid>.json` (mcp/presence.ts) and keeps
 * it fresh while it lives. The app only reads them. A file that has not been refreshed for a while
 * belongs to a process that is gone.
 */
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { HomeApi } from '../platform/fs';

export interface AgentInfo {
  pid: number;
  version: string;
  lastAgentSeen: number;
  lastToolCall: number | null;
}

/** The server refreshes its file every 30 s; three missed beats means it is gone. */
export const CONNECTED_WITHIN_MS = 95_000;

const num = (v: unknown): number | null => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

export async function readAgents(fs: HomeApi): Promise<AgentInfo[]> {
  const out: AgentInfo[] = [];
  let entries;
  try {
    entries = await fs.list('agents');
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.isDir || !/^\d{1,10}\.json$/.test(e.name)) continue;
    try {
      const text = await fs.readText(`agents/${e.name}`);
      if (text === null) continue;
      const v = JSON.parse(text) as Record<string, unknown>;
      const seen = num(v.lastAgentSeen);
      if (seen === null || typeof v.pid !== 'number') continue;
      out.push({
        pid: v.pid,
        version: typeof v.version === 'string' ? v.version : '?',
        lastAgentSeen: seen,
        lastToolCall: num(v.lastToolCall),
      });
    } catch {
      /* half-written or unreadable: the next poll will see it */
    }
  }
  return out;
}

export interface ConnectState {
  agents: AgentInfo[];
  /** At least one agent server is running (its file is fresh). */
  connected: boolean;
  /** The newest tool call from any agent (ms), if any. */
  lastToolCall: number | null;
}

export const connectStore = createStore<ConnectState>()(() => ({
  agents: [],
  connected: false,
  lastToolCall: null,
}));

export const useConnect = <T>(select: (s: ConnectState) => T): T => useStore(connectStore, select);

export function summarise(agents: AgentInfo[], now: number): ConnectState {
  const live = agents.filter((a) => now - a.lastAgentSeen < CONNECTED_WITHIN_MS);
  const calls = agents.map((a) => a.lastToolCall).filter((t): t is number => t !== null);
  return {
    agents: live,
    connected: live.length > 0,
    lastToolCall: calls.length ? Math.max(...calls) : null,
  };
}

/** Polls the agents folder every few seconds while the app runs. Returns a stop function. */
export function startAgentPolling(fs: HomeApi, everyMs = 3000): () => void {
  let stopped = false;
  const tick = async (): Promise<void> => {
    const next = summarise(await readAgents(fs), Date.now());
    if (!stopped) connectStore.setState(next);
  };
  void tick();
  const timer = setInterval(() => void tick(), everyMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
