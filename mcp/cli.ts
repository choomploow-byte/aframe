/**
 * The command line of `atelier-mcp.mjs`:
 *   (no arguments)                          run the MCP server over stdio (what hosts do)
 *   install [--claude|--codex|--cursor|--all] [--force]
 *   uninstall [same host flags]
 *   doctor            check everything is wired up
 *   print-config      the JSON snippet for any other MCP host
 *   --version, --help
 */
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { McpEnv } from './env';
import { createAtelierServer } from './server';
import { MCP_VERSION } from './generated';
import { HomeFs, resolveHomeDir, sweepTempFiles } from './home-fs';
import {
  detectHosts,
  doctor,
  HOSTS,
  install,
  printConfig,
  realEnv,
  uninstall,
  type Check,
  type Host,
  type HostReport,
  type InstallEnv,
  type Step,
} from './install';
import { Presence } from './presence';

const HELP = `Atelier MCP server v${MCP_VERSION}

Usage: node atelier-mcp.mjs [command]

  (no command)            run the server over stdio (hosts start it this way)
  install [hosts]         register with Claude Code, Codex and/or Cursor
  uninstall [hosts]       remove exactly what install added
  doctor                  check Node, the app, and each host's registration
  print-config            JSON for any other MCP host
  --version

hosts: --claude --codex --cursor --all   (default: every host found on this machine)
       --force replaces an existing "atelier" entry that is not ours
`;

const MARK: Record<Step['level'], string> = {
  ok: '[ok]  ',
  info: '[i]   ',
  warn: '[!]   ',
  fail: '[x]   ',
};

function printSteps(out: (s: string) => void, steps: Step[]): void {
  for (const s of steps) out(`${MARK[s.level]}${s.text}`);
}

function hostsFromFlags(args: string[], env: InstallEnv): Host[] {
  if (args.includes('--all')) return [...HOSTS];
  const picked = HOSTS.filter((h) => args.includes(`--${h}`));
  return picked.length > 0 ? picked : detectHosts(env);
}

export interface CliIo {
  out: (line: string) => void;
}

/** Everything except serving. Returns the process exit code. */
export function runCommand(args: string[], env: InstallEnv, io: CliIo): number {
  const [cmd, ...rest] = args;
  switch (cmd ?? '') {
    case '--version':
    case '-v':
      io.out(MCP_VERSION);
      return 0;
    case '--help':
    case '-h':
    case 'help':
      io.out(HELP);
      return 0;
    case 'print-config':
      io.out(printConfig(env));
      return 0;
    case 'install': {
      const hosts = hostsFromFlags(rest, env);
      if (hosts.length === 0) {
        io.out(
          'No Claude Code, Codex or Cursor found on this machine. Add this to your MCP host by hand:\n',
        );
        io.out(printConfig(env));
        return 1;
      }
      const { steps, reports } = install(env, hosts, { force: rest.includes('--force') });
      printSteps(io.out, steps);
      for (const r of reports) {
        io.out(`\n${r.host}:`);
        printSteps(io.out, r.steps);
      }
      const failed = reports.filter((r: HostReport) => !r.ok);
      io.out(
        failed.length === 0
          ? '\nDone. Run `doctor` to check everything.'
          : `\n${failed.map((f) => f.host).join(', ')} could not be set up; see above.`,
      );
      return failed.length === 0 ? 0 : 1;
    }
    case 'uninstall': {
      const hosts = hostsFromFlags(rest, env);
      for (const r of uninstall(env, hosts)) {
        io.out(`${r.host}:`);
        printSteps(io.out, r.steps);
      }
      return 0;
    }
    case 'doctor': {
      const checks = doctor(env);
      const sign: Record<Check['status'], string> = {
        ok: '[ok]  ',
        warn: '[!]   ',
        fail: '[x]   ',
      };
      for (const c of checks) {
        io.out(`${sign[c.status]}${c.name}: ${c.detail}`);
        if (c.status !== 'ok' && c.fix) io.out(`       fix: ${c.fix}`);
      }
      const bad = checks.filter((c) => c.status === 'fail').length;
      io.out(bad === 0 ? '\nAll good.' : `\n${bad} problem${bad === 1 ? '' : 's'} to fix.`);
      return bad === 0 ? 0 : 1;
    }
    default:
      io.out(`Unknown command "${cmd ?? ''}".\n`);
      io.out(HELP);
      return 2;
  }
}

/** Runs the MCP server on stdio until the host closes the connection. */
export async function serve(selfPath: string): Promise<void> {
  // stdout is the protocol channel: anything that prints there would corrupt it.
  console.log = (...a: unknown[]): void => console.error(...a);
  console.info = console.log;
  console.debug = console.log;

  const home = new HomeFs(resolveHomeDir());
  await home.ensure();
  await sweepTempFiles(home.root).catch(() => undefined);
  const presence = new Presence(home);
  const env = new McpEnv(home, { onProjectChange: (id) => presence.touch(id) });
  await presence.start();

  const handle = serveStdio(() => createAtelierServer(env, presence));
  console.error(
    `atelier-mcp v${MCP_VERSION} serving (home: ${home.root}; started from ${selfPath})`,
  );

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await presence.stop();
    await handle.close().catch(() => undefined);
  };
  process.once('SIGINT', () => void stop().then(() => process.exit(0)));
  process.once('SIGTERM', () => void stop().then(() => process.exit(0)));
  process.once('beforeExit', () => void stop());
}

export async function main(args: string[], selfPath: string): Promise<number> {
  if (args.length === 0) {
    await serve(selfPath);
    return 0;
  }
  const home = resolveHomeDir();
  return runCommand(args, realEnv(selfPath, home), { out: (l) => process.stdout.write(`${l}\n`) });
}
