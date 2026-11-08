// The npm package for the MCP server: pack it, install the tarball somewhere clean, and run it from
// there the way `npx -y aframe-mcp` would. No network and no publishing.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve('.');
let work: string;
let installed: string;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32' && cmd.endsWith('.cmd'),
  });

beforeAll(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'aframe-npm-'));
  const pkgDir = path.join(work, 'pkg');
  run(process.execPath, [path.join(root, 'scripts', 'pack-mcp.mjs'), pkgDir], root);
  const packed = run(npm, ['pack', '--silent'], pkgDir).trim().split('\n').pop() as string;
  const project = path.join(work, 'clean-project');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'package.json'), '{"name":"clean","private":true}');
  run(npm, ['install', path.join(pkgDir, packed), '--no-audit', '--no-fund', '--silent'], project);
  installed = path.join(project, 'node_modules', 'aframe-mcp');
}, 180_000);
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

describe('the packed aframe-mcp', () => {
  it('has the right metadata and only the files it should ship', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(pkg).toMatchObject({
      name: 'aframe-mcp',
      version: rootPkg.version,
      license: 'MIT',
      bin: { 'aframe-mcp': 'aframe-mcp.mjs' },
      engines: { node: '>=20' },
    });
    expect(fs.readdirSync(installed).sort()).toEqual([
      'LICENSE',
      'README.md',
      'THIRD-PARTY-NOTICES.md',
      'aframe-mcp.mjs',
      'package.json',
    ]);
    expect(
      fs
        .readFileSync(path.join(installed, 'aframe-mcp.mjs'), 'utf8')
        .startsWith('#!/usr/bin/env node\n'),
    ).toBe(true);
  });

  it('runs from a clean install: version, help and the config snippet', () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      version: string;
    };
    const bin = path.join(installed, 'aframe-mcp.mjs');
    expect(run(process.execPath, [bin, '--version'], work).trim()).toContain(rootPkg.version);
    expect(run(process.execPath, [bin, '--help'], work)).toContain('install [hosts]');
    const config = JSON.parse(
      run(process.execPath, [bin, 'print-config'], work).replace(/^[^{]*/, ''),
    ) as { mcpServers: { aframe: { command: string } } };
    expect(config.mcpServers.aframe.command).toBe('node');
  });

  it('installs into a throwaway home without touching a real one, and removes exactly what it added', () => {
    const home = path.join(work, 'fake-home');
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    const bin = path.join(installed, 'aframe-mcp.mjs');
    const env = { HOME: home, USERPROFILE: home, AFRAME_HOME: path.join(home, '.aframe') };
    run(process.execPath, [bin, 'install', '--cursor'], work, env);
    const cursor = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(cursor.mcpServers)).toContain('aframe');
    run(process.execPath, [bin, 'uninstall', '--cursor'], work, env);
    const after = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf8')) as {
      mcpServers?: Record<string, unknown>;
    };
    expect(Object.keys(after.mcpServers ?? {})).not.toContain('aframe');
  });
});
