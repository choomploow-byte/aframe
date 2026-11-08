/**
 * The product used to be called Atelier. People who installed that version have an "atelier" server
 * registered in their AI tools, pointing at a file that no longer exists once the data folder moves
 * to ~/.aframe. `install` removes exactly those leftovers (and only those that are ours: they mention
 * `atelier-mcp`), so nothing is left broken. These strings are literal on purpose: a future rename
 * must not rewrite them (scripts/rename.mjs skips this file).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Host, InstallEnv, Step } from './install';

const LEGACY_NAME = 'atelier';
const LEGACY_MARK = 'atelier-mcp';
const BLOCK_START =
  '# >>> atelier (managed by `atelier-mcp install`; remove with `atelier-mcp uninstall`) >>>';
const BLOCK_END = '# <<< atelier <<<';
const MD_START = '<!-- >>> atelier (managed by `atelier-mcp install`) >>> -->';
const MD_END = '<!-- <<< atelier <<< -->';

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const block = (a: string, b: string): RegExp =>
  new RegExp(`${escapeRe(a)}[\\s\\S]*?${escapeRe(b)}\\r?\\n?`);

function read(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function write(file: string, text: string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** Removes a legacy key from an `mcpServers` JSON file if it is ours. Returns whether it did. */
function dropJsonEntry(file: string): boolean {
  const text = read(file);
  if (text === null) return false;
  try {
    const json = JSON.parse(text) as { mcpServers?: Record<string, unknown> };
    const entry = json.mcpServers?.[LEGACY_NAME];
    if (entry === undefined || !JSON.stringify(entry).includes(LEGACY_MARK) || !json.mcpServers) {
      return false;
    }
    fs.copyFileSync(file, `${file}.aframe-legacy.bak`);
    delete json.mcpServers[LEGACY_NAME];
    write(file, `${JSON.stringify(json, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

/** Removes what the old "atelier" installs left in the given hosts. Never touches anything else. */
export function removeLegacyEntries(env: InstallEnv, hosts: readonly Host[]): Step[] {
  const steps: Step[] = [];
  const done = (what: string): void =>
    void steps.push({ level: 'info', text: `Removed the old Atelier ${what}` });

  if (hosts.includes('claude')) {
    const claude = env.which('claude');
    if (claude) {
      const r = env.run(claude, ['mcp', 'get', LEGACY_NAME]);
      if (r.code === 0 && `${r.stdout}\n${r.stderr}`.includes(LEGACY_MARK)) {
        const rm = env.run(claude, ['mcp', 'remove', LEGACY_NAME, '--scope', 'user']);
        if (rm.code === 0) done('entry from Claude Code');
      }
    }
    if (dropJsonEntry(path.join(env.userHome, '.claude.json'))) done('entry from ~/.claude.json');
    const skillDir = path.join(env.userHome, '.claude', 'skills', LEGACY_NAME);
    const skill = path.join(skillDir, 'SKILL.md');
    if (read(skill)?.includes(LEGACY_NAME) === true) {
      try {
        fs.rmSync(skill);
        fs.rmdirSync(skillDir);
        done('skill from Claude Code');
      } catch {
        /* the folder holds something else: leave it */
      }
    }
  }

  if (hosts.includes('codex')) {
    const dir = path.join(env.userHome, '.codex');
    for (const [file, re, what] of [
      [path.join(dir, 'config.toml'), block(BLOCK_START, BLOCK_END), 'entry from Codex'],
      [path.join(dir, 'AGENTS.md'), block(MD_START, MD_END), 'note from Codex'],
    ] as const) {
      const text = read(file);
      if (text !== null && re.test(text)) {
        fs.copyFileSync(file, `${file}.aframe-legacy.bak`);
        const next = text.replace(re, '').replace(/\n{3,}/g, '\n\n');
        write(file, next.trim() === '' ? '' : next);
        done(what);
      }
    }
  }

  if (hosts.includes('cursor') && dropJsonEntry(path.join(env.userHome, '.cursor', 'mcp.json'))) {
    done('entry from Cursor');
  }
  return steps;
}

const LEGACY_HOME = '.atelier';

/**
 * The data folder. Before the rename it was ~/.atelier: if only that exists, it is moved to the new
 * name (one atomic rename on the same disk), so projects, notes and the asset library carry over. If
 * the move is refused (the old app is still running and holds a file), the old folder keeps being used.
 */
export function chooseHome(userHome: string, newName: string): string {
  const next = path.join(userHome, newName);
  const old = path.join(userHome, LEGACY_HOME);
  if (fs.existsSync(next) || !fs.existsSync(old)) return next;
  try {
    fs.renameSync(old, next);
    return next;
  } catch {
    return old;
  }
}
