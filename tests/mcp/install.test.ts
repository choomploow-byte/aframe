// The installer (docs/09): idempotent, backs up what it edits, never clobbers foreign config, and
// uninstall reverses it. Runs against throwaway home folders, a fake `claude`, and (when the real
// CLI is installed) the real `claude mcp add/get/list` inside an isolated config directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../../mcp/cli';
import { ATELIER_SKILL, MCP_VERSION } from '../../mcp/generated';
import {
  detectHosts,
  doctor,
  install,
  printConfig,
  realEnv,
  tomlString,
  uninstall,
  type InstallEnv,
  type RunResult,
} from '../../mcp/install';

const BUNDLE = fileURLToPath(new URL('../../mcp/dist/atelier-mcp.mjs', import.meta.url));

let root: string;
let userHome: string;
let atelierHome: string;
let claudeCalls: string[][];
let claudeServers: Map<string, string>;

/** A `claude` that remembers servers, like `claude mcp get/add/remove` do. */
function fakeClaude(args: string[]): RunResult {
  claudeCalls.push(args);
  const [mcp, verb, ...rest] = args;
  if (mcp !== 'mcp') return { code: 1, stdout: '', stderr: 'unknown' };
  if (verb === 'get') {
    const v = claudeServers.get(rest[0] ?? '');
    return v === undefined
      ? { code: 1, stdout: '', stderr: 'No MCP server found' }
      : { code: 0, stdout: `${rest[0]}:\n  Command: ${v}\n`, stderr: '' };
  }
  if (verb === 'add') {
    const dash = rest.indexOf('--');
    claudeServers.set(rest[rest.indexOf('--scope') + 2] ?? '', rest.slice(dash + 1).join(' '));
    return { code: 0, stdout: 'Added', stderr: '' };
  }
  if (verb === 'remove') {
    claudeServers.delete(rest[0] ?? '');
    return { code: 0, stdout: 'Removed', stderr: '' };
  }
  return { code: 1, stdout: '', stderr: 'nope' };
}

function makeEnv(
  options: {
    claude?: boolean;
    selfPath?: string;
    node?: string;
    now?: number;
    extraCommands?: string[];
  } = {},
): InstallEnv {
  return {
    userHome,
    atelierHome,
    selfPath: options.selfPath ?? path.join(atelierHome, 'mcp', 'atelier-mcp.mjs'),
    which: (cmd) => (cmd === 'claude' && options.claude ? '/fake/bin/claude' : null),
    run: (_cmd, args) => fakeClaude(args),
    platform: 'win32',
    nodeVersion: options.node ?? '24.1.0',
    now: () => options.now ?? Date.now(),
  };
}

const read = (...p: string[]): string => fs.readFileSync(path.join(userHome, ...p), 'utf8');
const exists = (...p: string[]): boolean => fs.existsSync(path.join(userHome, ...p));
const writeUser = (rel: string, text: string): void => {
  fs.mkdirSync(path.dirname(path.join(userHome, rel)), { recursive: true });
  fs.writeFileSync(path.join(userHome, rel), text);
};
const stableFile = (): string => path.join(atelierHome, 'mcp', 'atelier-mcp.mjs');
const levels = (reports: { steps: { level: string }[] }[]): string[] =>
  reports.flatMap((r) => r.steps.map((s) => s.level));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-install-'));
  userHome = path.join(root, 'user');
  atelierHome = path.join(userHome, '.atelier');
  fs.mkdirSync(path.join(atelierHome, 'mcp'), { recursive: true });
  fs.writeFileSync(stableFile(), '// a real server\n');
  claudeCalls = [];
  claudeServers = new Map();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('install into a clean machine', () => {
  it('writes every host config and the skills, pointing at the stable server path', () => {
    const { reports } = install(makeEnv(), ['claude', 'codex', 'cursor']);
    expect(reports.every((r) => r.ok)).toBe(true);

    // Claude Code with no CLI on PATH: the config file is edited.
    const claude = JSON.parse(read('.claude.json'));
    expect(claude.mcpServers.atelier).toEqual({
      type: 'stdio',
      command: 'node',
      args: [stableFile()],
      env: {},
    });
    expect(read('.claude', 'skills', 'atelier', 'SKILL.md')).toBe(ATELIER_SKILL);

    // Codex: a marked block, literal path (no backslash escaping), timeouts above Codex's defaults.
    const toml = read('.codex', 'config.toml');
    expect(toml).toContain('[mcp_servers.atelier]');
    expect(toml).toContain('command = "node"');
    expect(toml).toContain(`args = ['${stableFile()}']`);
    expect(toml).toMatch(/startup_timeout_sec = 20/);
    expect(toml).toMatch(/tool_timeout_sec = 120/);
    expect(read('.codex', 'AGENTS.md')).toContain('`atelier` MCP tools');
    expect(read('.agents', 'skills', 'atelier', 'SKILL.md')).toBe(ATELIER_SKILL);

    // Cursor
    expect(JSON.parse(read('.cursor', 'mcp.json')).mcpServers.atelier).toEqual({
      command: 'node',
      args: [stableFile()],
    });
  });

  it('uses `claude mcp add --scope user` when the CLI is there, with the exact documented arguments', () => {
    const { reports } = install(makeEnv({ claude: true }), ['claude']);
    expect(reports[0]?.ok).toBe(true);
    expect(claudeCalls.find((c) => c[1] === 'add')).toEqual([
      'mcp',
      'add',
      '--scope',
      'user',
      'atelier',
      '--',
      'node',
      stableFile(),
    ]);
    expect(exists('.claude.json')).toBe(false); // the CLI did it; no hand edit
    expect(exists('.claude', 'skills', 'atelier', 'SKILL.md')).toBe(true);
  });
});

describe('idempotence', () => {
  it('a second install changes nothing and says so', () => {
    install(makeEnv(), ['claude', 'codex', 'cursor']);
    const files = [
      '.claude.json',
      '.codex/config.toml',
      '.codex/AGENTS.md',
      '.cursor/mcp.json',
      '.claude/skills/atelier/SKILL.md',
    ];
    const before = files.map((f) => read(f));
    const mtimes = files.map((f) => fs.statSync(path.join(userHome, f)).mtimeMs);
    const again = install(makeEnv(), ['claude', 'codex', 'cursor']);
    expect(files.map((f) => read(f))).toEqual(before);
    expect(files.map((f) => fs.statSync(path.join(userHome, f)).mtimeMs)).toEqual(mtimes);
    expect(levels(again.reports)).not.toContain('ok'); // nothing was added or changed
    expect(again.reports.every((r) => r.ok)).toBe(true);
  });

  it('with the claude CLI: already registered means no add', () => {
    install(makeEnv({ claude: true }), ['claude']);
    claudeCalls.length = 0;
    install(makeEnv({ claude: true }), ['claude']);
    expect(claudeCalls.some((c) => c[1] === 'add')).toBe(false);
  });
});

describe('foreign configuration is never clobbered', () => {
  it('keeps other servers and comments, backs up once, and uninstall restores the originals', () => {
    const cursor = {
      mcpServers: { other: { command: 'npx', args: ['other-mcp'] } },
      extra: { keep: true },
    };
    writeUser('.cursor/mcp.json', JSON.stringify(cursor, null, 2));
    const codex =
      '# my codex settings\nmodel = "x"\n\n[mcp_servers.context7]\ncommand = "npx"\nargs = ["-y", "@upstash/context7-mcp"]\n';
    writeUser('.codex/config.toml', codex);
    writeUser('.codex/AGENTS.md', '# My rules\nBe kind.\n');
    writeUser(
      '.claude.json',
      JSON.stringify({ numStartups: 7, mcpServers: { github: { command: 'gh-mcp' } } }),
    );

    install(makeEnv(), ['claude', 'codex', 'cursor']);
    expect(JSON.parse(read('.cursor/mcp.json'))).toMatchObject({
      extra: { keep: true },
      mcpServers: { other: { command: 'npx' }, atelier: { command: 'node' } },
    });
    expect(read('.codex/config.toml').startsWith(codex.trimEnd())).toBe(true);
    expect(read('.codex/config.toml')).toContain('[mcp_servers.context7]');
    expect(read('.codex/AGENTS.md').startsWith('# My rules\nBe kind.')).toBe(true);
    expect(JSON.parse(read('.claude.json'))).toMatchObject({
      numStartups: 7,
      mcpServers: { github: { command: 'gh-mcp' }, atelier: { command: 'node' } },
    });

    // Backups hold the originals, and a later install does not overwrite them.
    expect(read('.codex/config.toml.atelier-bak')).toBe(codex);
    expect(JSON.parse(read('.cursor/mcp.json.atelier-bak'))).toEqual(cursor);
    install(makeEnv(), ['codex', 'cursor']);
    expect(read('.codex/config.toml.atelier-bak')).toBe(codex);

    uninstall(makeEnv(), ['claude', 'codex', 'cursor']);
    expect(JSON.parse(read('.cursor/mcp.json'))).toEqual(cursor);
    expect(read('.codex/config.toml').trim()).toBe(codex.trim());
    expect(read('.codex/AGENTS.md').trim()).toBe('# My rules\nBe kind.');
    expect(JSON.parse(read('.claude.json'))).toEqual({
      numStartups: 7,
      mcpServers: { github: { command: 'gh-mcp' } },
    });
    expect(exists('.claude/skills/atelier/SKILL.md')).toBe(false);
    expect(exists('.agents/skills/atelier/SKILL.md')).toBe(false);
  });

  it('refuses to replace an "atelier" entry it did not write, unless forced', () => {
    writeUser(
      '.cursor/mcp.json',
      JSON.stringify({ mcpServers: { atelier: { command: 'python', args: ['mine.py'] } } }),
    );
    writeUser('.codex/config.toml', '[mcp_servers.atelier]\ncommand = "python"\n');
    const r = install(makeEnv(), ['codex', 'cursor']);
    expect(r.reports.map((x) => x.ok)).toEqual([false, false]);
    expect(
      r.reports
        .flatMap((x) => x.steps)
        .some(
          (s) => s.level === 'fail' && /not (this one|write)|different|did not write/i.test(s.text),
        ),
    ).toBe(true);
    expect(JSON.parse(read('.cursor/mcp.json')).mcpServers.atelier.command).toBe('python');
    expect(read('.codex/config.toml')).toBe('[mcp_servers.atelier]\ncommand = "python"\n');

    const forced = install(makeEnv(), ['cursor'], { force: true });
    expect(forced.reports[0]?.ok).toBe(true);
    expect(JSON.parse(read('.cursor/mcp.json')).mcpServers.atelier.command).toBe('node');
  });

  it('leaves a config it cannot parse alone and prints the manual step', () => {
    writeUser('.cursor/mcp.json', '{ not json');
    writeUser('.claude.json', '{ also not');
    const r = install(makeEnv(), ['claude', 'cursor']);
    expect(r.reports.map((x) => x.ok)).toEqual([false, false]);
    expect(read('.cursor/mcp.json')).toBe('{ not json');
    expect(read('.claude.json')).toBe('{ also not');
    expect(
      r.reports[0]?.steps.some((s) => s.text.includes('claude mcp add --scope user atelier')),
    ).toBe(true);
  });

  it('with the claude CLI: an existing foreign "atelier" server is refused, forced is replaced', () => {
    claudeServers.set('atelier', 'python other.py');
    const r = install(makeEnv({ claude: true }), ['claude']);
    expect(r.reports[0]?.ok).toBe(false);
    expect(claudeServers.get('atelier')).toBe('python other.py');
    const forced = install(makeEnv({ claude: true }), ['claude'], { force: true });
    expect(forced.reports[0]?.ok).toBe(true);
    expect(claudeServers.get('atelier')).toContain('atelier-mcp.mjs');
  });

  it('replaces a different SKILL.md only after saving a copy of it', () => {
    writeUser('.claude/skills/atelier/SKILL.md', '---\nname: my-own\n---\nmine');
    install(makeEnv(), ['claude']);
    expect(read('.claude/skills/atelier/SKILL.md')).toBe(ATELIER_SKILL);
    expect(read('.claude/skills/atelier/SKILL.md.atelier-bak')).toContain('name: my-own');
  });

  it('uninstall leaves a skill it does not own', () => {
    writeUser('.claude/skills/atelier/SKILL.md', '---\nname: my-own\n---\nmine');
    uninstall(makeEnv(), ['claude']);
    expect(read('.claude/skills/atelier/SKILL.md')).toContain('my-own');
  });
});

describe('details', () => {
  it('TOML strings: literal for Windows paths, quoted when the path has an apostrophe', () => {
    expect(tomlString('C:\\Users\\me\\.atelier\\mcp\\atelier-mcp.mjs')).toBe(
      "'C:\\Users\\me\\.atelier\\mcp\\atelier-mcp.mjs'",
    );
    expect(tomlString("C:\\Users\\O'Brien\\x.mjs")).toBe(
      JSON.stringify("C:\\Users\\O'Brien\\x.mjs"),
    );
  });

  it('replaces the managed block instead of duplicating it when the path changes', () => {
    install(makeEnv(), ['codex']);
    const moved = { ...makeEnv(), atelierHome: path.join(root, 'elsewhere', '.atelier') };
    fs.mkdirSync(path.join(moved.atelierHome, 'mcp'), { recursive: true });
    fs.writeFileSync(path.join(moved.atelierHome, 'mcp', 'atelier-mcp.mjs'), '// real');
    install(moved, ['codex']);
    const toml = read('.codex/config.toml');
    expect(toml.match(/\[mcp_servers\.atelier\]/g)).toHaveLength(1);
    expect(toml).toContain('elsewhere');
  });

  it('adds no note to an AGENTS.md that is near Codex’s size limit', () => {
    writeUser('.codex/AGENTS.md', `${'x'.repeat(29 * 1024)}\n`);
    const r = install(makeEnv(), ['codex']);
    expect(read('.codex/AGENTS.md')).not.toContain('atelier');
    expect(r.reports[0]?.steps.some((s) => s.level === 'warn' && /32 KiB/.test(s.text))).toBe(true);
  });

  it('copies itself to the stable path when run from elsewhere, but never over a newer one or a user edit', () => {
    fs.rmSync(stableFile());
    const dev = path.join(root, 'dev', 'atelier-mcp.mjs');
    fs.mkdirSync(path.dirname(dev), { recursive: true });
    fs.writeFileSync(dev, '// the bundle');
    install(makeEnv({ selfPath: dev }), ['cursor']);
    expect(fs.readFileSync(stableFile(), 'utf8')).toBe('// the bundle');

    // The app's placeholder is replaced...
    fs.writeFileSync(stableFile(), '// atelier-generated placeholder\n');
    install(makeEnv({ selfPath: dev }), ['cursor']);
    expect(fs.readFileSync(stableFile(), 'utf8')).toBe('// the bundle');
    // ...but a newer file already there is kept.
    fs.writeFileSync(stableFile(), '// newer');
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(stableFile(), future, future);
    install(makeEnv({ selfPath: dev }), ['cursor']);
    expect(fs.readFileSync(stableFile(), 'utf8')).toBe('// newer');
  });

  it('detects hosts by their folders, and print-config is valid JSON for any host', () => {
    expect(detectHosts(makeEnv())).toEqual([]);
    fs.mkdirSync(path.join(userHome, '.cursor'), { recursive: true });
    fs.mkdirSync(path.join(userHome, '.codex'), { recursive: true });
    expect(detectHosts(makeEnv()).sort()).toEqual(['codex', 'cursor']);
    expect(JSON.parse(printConfig(makeEnv()))).toEqual({
      mcpServers: { atelier: { command: 'node', args: [stableFile()] } },
    });
  });
});

describe('doctor and the command line', () => {
  const statusOf = (env: InstallEnv, name: string) =>
    doctor(env).find((c) => c.name === name)?.status;

  it('reports problems with fixes, and goes green after install', () => {
    fs.rmSync(stableFile());
    let checks = doctor(makeEnv());
    expect(checks.find((c) => c.name === 'Server file')).toMatchObject({
      status: 'fail',
      fix: expect.stringContaining('install'),
    });

    fs.mkdirSync(path.join(userHome, '.cursor'), { recursive: true }); // Cursor is "installed" but not wired
    expect(statusOf(makeEnv(), 'cursor registration')).toBe('fail');

    fs.writeFileSync(stableFile(), '// real');
    install(makeEnv(), ['cursor']);
    checks = doctor(makeEnv());
    expect(checks.find((c) => c.name === 'Server file')?.status).toBe('ok');
    expect(checks.find((c) => c.name === 'cursor registration')?.status).toBe('ok');
  });

  it('flags an old Node and a placeholder server', () => {
    expect(statusOf(makeEnv({ node: '18.19.0' }), 'Node.js')).toBe('fail');
    fs.writeFileSync(stableFile(), '// atelier-generated placeholder\n');
    expect(doctor(makeEnv()).find((c) => c.name === 'Server file')?.detail).toContain(
      'placeholder',
    );
  });

  it('reads the app heartbeat: fresh is running, stale is a warning not a failure', () => {
    const now = Date.parse('2026-11-07T12:00:00.000Z');
    fs.writeFileSync(
      path.join(atelierHome, 'app-state.json'),
      JSON.stringify({ appHeartbeat: '2026-11-07T11:59:58.000Z' }),
    );
    expect(statusOf(makeEnv({ now }), 'Atelier app')).toBe('ok');
    expect(statusOf(makeEnv({ now: now + 60_000 }), 'Atelier app')).toBe('warn');
  });

  it('runCommand: exit codes and output', () => {
    const lines: string[] = [];
    const io = { out: (l: string) => void lines.push(l) };
    expect(runCommand(['--version'], makeEnv(), io)).toBe(0);
    expect(lines.at(-1)).toBe(MCP_VERSION);
    expect(runCommand(['bogus'], makeEnv(), io)).toBe(2);
    expect(runCommand(['install'], makeEnv(), io)).toBe(1); // no host found: prints the generic JSON
    expect(lines.join('\n')).toContain('"mcpServers"');
    fs.mkdirSync(path.join(userHome, '.cursor'), { recursive: true });
    lines.length = 0;
    expect(runCommand(['install'], makeEnv(), io)).toBe(0); // detects Cursor
    expect(lines.join('\n')).toContain('cursor:');
    expect(runCommand(['uninstall', '--cursor'], makeEnv(), io)).toBe(0);
    expect(runCommand(['doctor'], makeEnv(), io)).toBeGreaterThanOrEqual(0);
  });
});

// The real thing: the actual Claude Code CLI, in a config directory of its own.
const REAL_CLAUDE = [
  path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
  path.join(os.homedir(), '.local', 'bin', 'claude'),
].find((p) => fs.existsSync(p));

describe.skipIf(!REAL_CLAUDE)('the real Claude Code CLI (isolated config directory)', () => {
  it('registers, is found, connects to the real bundle, and unregisters', () => {
    const sandbox = path.join(root, 'claude-sandbox');
    fs.mkdirSync(path.join(sandbox, '.claude'), { recursive: true });
    const isolated = {
      HOME: sandbox,
      USERPROFILE: sandbox,
      CLAUDE_CONFIG_DIR: path.join(sandbox, '.claude'),
      ATELIER_HOME: path.join(sandbox, '.atelier'),
    };
    const env: InstallEnv = {
      ...realEnv(BUNDLE, path.join(sandbox, '.atelier')),
      userHome: sandbox,
      which: (c) => (c === 'claude' ? (REAL_CLAUDE as string) : null),
      run: (cmd, args) => {
        const r = spawnSync(cmd, args, {
          encoding: 'utf8',
          env: { ...process.env, ...isolated },
          timeout: 90_000,
        });
        return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
      },
    };
    const { reports } = install(env, ['claude']);
    expect(reports[0]?.ok, JSON.stringify(reports[0]?.steps)).toBe(true);
    expect(fs.existsSync(path.join(sandbox, '.atelier', 'mcp', 'atelier-mcp.mjs'))).toBe(true);

    const get = env.run(REAL_CLAUDE as string, ['mcp', 'get', 'atelier']);
    expect(get.code, get.stderr).toBe(0);
    expect(get.stdout).toContain('atelier-mcp.mjs');

    // `claude mcp list` health-checks every server by starting it: this proves a real host can
    // launch our bundle and complete the MCP handshake.
    const list = env.run(REAL_CLAUDE as string, ['mcp', 'list']);
    expect(`${list.stdout}${list.stderr}`, 'claude mcp list').toMatch(/atelier.*(Connected|✓)/s);

    // Idempotent against the real CLI, and uninstall removes it.
    expect(install(env, ['claude']).reports[0]?.ok).toBe(true);
    uninstall(env, ['claude']);
    expect(env.run(REAL_CLAUDE as string, ['mcp', 'get', 'atelier']).code).not.toBe(0);
    expect(doctor(env).find((c) => c.name === 'claude registration')?.status).not.toBe('ok');
  }, 240_000);
});

describe('the real server is not mistaken for the placeholder', () => {
  it('doctor and install look only at the first lines', () => {
    // The real bundle's own source contains the marker text; only a file that STARTS with it is a stand-in.
    const real = `#!/usr/bin/env node\n// atelier-mcp-version: 0.1.0\nconst a = 1;\nconst m = 'atelier-generated placeholder';\n`;
    fs.mkdirSync(path.dirname(stableFile()), { recursive: true });
    fs.writeFileSync(stableFile(), real);
    expect(doctor(makeEnv()).find((c) => c.name === 'Server file')?.status).toBe('ok');
    const dev = path.join(root, 'dev', 'atelier-mcp.mjs');
    fs.mkdirSync(path.dirname(dev), { recursive: true });
    fs.writeFileSync(dev, '// the dev bundle');
    const older = new Date(Date.now() - 60_000);
    fs.utimesSync(dev, older, older);
    install(makeEnv({ selfPath: dev }), ['cursor']);
    expect(fs.readFileSync(stableFile(), 'utf8')).toBe(real); // an older copy never replaces it
    fs.writeFileSync(stableFile(), '// atelier-generated placeholder\nprocess.exit(1);\n');
    expect(doctor(makeEnv()).find((c) => c.name === 'Server file')?.detail).toContain(
      'placeholder',
    );
  });
});
