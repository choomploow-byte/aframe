// People who ran the product under its old name (Atelier): their data moves to the new folder, and the
// old registrations in their AI tools are removed so nothing is left pointing at a missing file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { install, type InstallEnv, type RunResult } from '../../mcp/install';
import { chooseHome, removeLegacyEntries } from '../../mcp/legacy';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('chooseHome', () => {
  it('moves the old data folder with everything in it', () => {
    fs.mkdirSync(path.join(root, '.atelier', 'projects', 'p_1'), { recursive: true });
    fs.writeFileSync(path.join(root, '.atelier', 'projects', 'p_1', 'project.json'), '{"a":1}');
    expect(chooseHome(root, '.aframe')).toBe(path.join(root, '.aframe'));
    expect(
      fs.readFileSync(path.join(root, '.aframe', 'projects', 'p_1', 'project.json'), 'utf8'),
    ).toBe('{"a":1}');
    expect(fs.existsSync(path.join(root, '.atelier'))).toBe(false);
  });

  it('does nothing when the new folder already exists, or there is no old one', () => {
    fs.mkdirSync(path.join(root, '.atelier'));
    fs.mkdirSync(path.join(root, '.aframe'));
    expect(chooseHome(root, '.aframe')).toBe(path.join(root, '.aframe'));
    expect(fs.existsSync(path.join(root, '.atelier'))).toBe(true);
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-fresh-'));
    expect(chooseHome(fresh, '.aframe')).toBe(path.join(fresh, '.aframe'));
    expect(fs.existsSync(path.join(fresh, '.aframe'))).toBe(false);
    fs.rmSync(fresh, { recursive: true, force: true });
  });
});

describe('removeLegacyEntries', () => {
  const calls: string[][] = [];
  const servers = new Map<string, string>();
  const env = (): InstallEnv => ({
    userHome: root,
    aframeHome: path.join(root, '.aframe'),
    selfPath: path.join(root, 'aframe-mcp.mjs'),
    which: (cmd) => (cmd === 'claude' ? 'claude' : null),
    run: (_cmd, args): RunResult => {
      calls.push(args);
      const [, verb, name] = args;
      if (verb === 'get') {
        const v = servers.get(name ?? '');
        return v === undefined
          ? { code: 1, stdout: '', stderr: 'none' }
          : { code: 0, stdout: v, stderr: '' };
      }
      if (verb === 'remove') {
        servers.delete(name ?? '');
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    },
    platform: 'win32',
    nodeVersion: process.version,
    now: () => 0,
  });
  beforeEach(() => {
    calls.length = 0;
    servers.clear();
  });

  it('removes the old Cursor, Codex and Claude registrations and leaves everything else', () => {
    fs.mkdirSync(path.join(root, '.cursor'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.cursor', 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          atelier: { command: 'node', args: ['C:/x/.atelier/mcp/atelier-mcp.mjs'] },
          other: { command: 'x' },
        },
      }),
    );
    fs.mkdirSync(path.join(root, '.codex'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.codex', 'config.toml'),
      `model = "x"\n\n# >>> atelier (managed by \`atelier-mcp install\`; remove with \`atelier-mcp uninstall\`) >>>\n[mcp_servers.atelier]\ncommand = "node"\n# <<< atelier <<<\n\n[other]\na = 1\n`,
    );
    fs.writeFileSync(
      path.join(root, '.claude.json'),
      JSON.stringify({
        mcpServers: { atelier: { args: ['/x/atelier-mcp.mjs'] }, keep: { command: 'y' } },
      }),
    );
    servers.set('atelier', 'command: node C:/x/atelier-mcp.mjs');

    const steps = removeLegacyEntries(env(), ['claude', 'codex', 'cursor']);
    expect(steps.map((s) => s.text).join('\n')).toMatch(/Cursor/);
    const cursor = JSON.parse(fs.readFileSync(path.join(root, '.cursor', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(cursor.mcpServers)).toEqual(['other']);
    const toml = fs.readFileSync(path.join(root, '.codex', 'config.toml'), 'utf8');
    expect(toml).not.toContain('atelier');
    expect(toml).toContain('model = "x"');
    expect(toml).toContain('[other]');
    const claudeJson = JSON.parse(fs.readFileSync(path.join(root, '.claude.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(claudeJson.mcpServers)).toEqual(['keep']);
    expect(servers.has('atelier')).toBe(false);
  });

  it('leaves an "atelier" server that is not ours alone', () => {
    fs.mkdirSync(path.join(root, '.cursor'), { recursive: true });
    const text = JSON.stringify({ mcpServers: { atelier: { command: 'someone-elses-tool' } } });
    fs.writeFileSync(path.join(root, '.cursor', 'mcp.json'), text);
    servers.set('atelier', 'command: something-else');
    expect(removeLegacyEntries(env(), ['claude', 'cursor'])).toEqual([]);
    expect(fs.readFileSync(path.join(root, '.cursor', 'mcp.json'), 'utf8')).toBe(text);
    expect(servers.has('atelier')).toBe(true);
  });

  it('is part of install: a fresh install tidies the old entry and registers the new one', () => {
    fs.mkdirSync(path.join(root, '.cursor'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.cursor', 'mcp.json'),
      JSON.stringify({
        mcpServers: { atelier: { command: 'node', args: ['/x/.atelier/mcp/atelier-mcp.mjs'] } },
      }),
    );
    fs.writeFileSync(path.join(root, 'aframe-mcp.mjs'), '// bundle');
    install(env(), ['cursor']);
    const after = JSON.parse(fs.readFileSync(path.join(root, '.cursor', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(after.mcpServers)).toEqual(['aframe']);
  });
});
