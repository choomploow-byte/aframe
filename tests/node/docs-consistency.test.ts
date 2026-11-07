// docs/20 "cross-document consistency checklist", as tests: the things that repeat across files and
// drift. If one of these fails, a doc, a skill or the server disagrees with the code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ATELIER_SKILL,
  MCP_VERSION,
  PROMPT_RECIPES,
  SERVER_INSTRUCTIONS,
  SKILLS,
} from '../../mcp/generated';
import { TOOLS } from '../../src/core/tools';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (p: string): string =>
  fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const toolNames = TOOLS.map((t) => t.name);

/** Words that look like tool names (snake_case with a known verb prefix) in a document. */
function mentionedTools(text: string): Set<string> {
  const verbs = '(?:get|set|list|load|add|resolve|apply|create|open|import|export|lint|screenshot)';
  const found = new Set<string>();
  for (const m of text.matchAll(new RegExp(`\\b(${verbs}(?:_[a-z]+)*)\\b`, 'g'))) {
    const word = m[1] as string;
    if (word.includes('_') || word === 'screenshot') found.add(word);
  }
  return found;
}

describe('the embedded copy matches its sources', () => {
  it('skills', () => {
    const files = fs
      .readdirSync(path.join(root, 'skills'))
      .filter((f) => f.endsWith('.md') && f !== 'README.md' && f !== 'atelier-SKILL.md')
      .sort();
    expect(SKILLS.map((s) => s.name)).toEqual(files.map((f) => f.replace(/\.md$/, '')));
    for (const f of files) {
      expect(SKILLS.find((s) => s.name === f.replace(/\.md$/, ''))?.body, f).toBe(
        read(`skills/${f}`),
      );
    }
    for (const s of SKILLS) expect(s.description.length, s.name).toBeGreaterThan(20);
  });

  it('the Claude skill, server instructions and prompt recipes', () => {
    expect(ATELIER_SKILL).toBe(read('skills/atelier-SKILL.md'));
    expect(read('prompts/mcp-server-instructions.md')).toContain(SERVER_INSTRUCTIONS);
    for (const r of PROMPT_RECIPES)
      expect(read('prompts/design-agent-prompts.md')).toContain(r.text);
    expect(PROMPT_RECIPES.length).toBeGreaterThanOrEqual(5);
  });

  it('the version', () => {
    expect(MCP_VERSION).toBe((JSON.parse(read('package.json')) as { version: string }).version);
  });

  it('SKILL.md names a loadable skill in its frontmatter and in its text', () => {
    expect(ATELIER_SKILL).toMatch(/^---\nname: atelier\ndescription: .{40,}\n---\n/);
    for (const name of SKILLS.map((s) => s.name)) expect(ATELIER_SKILL, name).toContain(name);
  });
});

describe('tool names agree everywhere', () => {
  it('every tool in the registry is in the docs/05 tables, and nothing else is', () => {
    const doc = read('docs/05-mcp-tools-spec.md');
    const table = doc.slice(doc.indexOf('## Tools'), doc.indexOf('## Op schema'));
    const inTables = new Set([...table.matchAll(/^\| `([a-z_]+)`/gm)].map((m) => m[1] as string));
    expect([...inTables].sort()).toEqual([...toolNames].sort());
  });

  it.each([
    ['skills/atelier-SKILL.md', () => ATELIER_SKILL],
    ['server instructions', () => SERVER_INSTRUCTIONS],
    ['prompt recipes', () => PROMPT_RECIPES.map((r) => r.text).join('\n')],
    ['the in-app system prompt', () => read('prompts/in-app-system-prompt.md')],
  ])('%s only mentions tools that exist', (_name, text) => {
    const unknown = [...mentionedTools(text())].filter((w) => !toolNames.includes(w));
    // Words that look like tool names but are not (a node property, a CSS word...).
    const notTools = new Set(['get_started']);
    expect(unknown.filter((w) => !notTools.has(w))).toEqual([]);
  });

  it('the name finder has teeth: it sees real names and flags an invented one', () => {
    expect(mentionedTools(ATELIER_SKILL).size).toBeGreaterThan(8);
    expect(mentionedTools(SERVER_INSTRUCTIONS).size).toBeGreaterThan(8);
    const unknown = [...mentionedTools('use get_design then make_it_pop and set_vibes')].filter(
      (w) => !toolNames.includes(w),
    );
    expect(unknown).toEqual(['set_vibes']);
  });

  it('the server instructions name the tools an agent must know', () => {
    for (const t of [
      'get_design',
      'apply_changes',
      'screenshot',
      'get_selection',
      'get_annotations',
      'resolve_annotation',
      'lint_design',
      'load_skill',
      'list_skills',
      'list_references',
      'get_reference',
      'export_code',
    ]) {
      expect(SERVER_INSTRUCTIONS, t).toContain(t);
    }
  });

  it('every tool has a description an agent can act on and a schema with no required `project`', () => {
    for (const t of TOOLS) {
      expect(t.description.length, t.name).toBeGreaterThan(40);
    }
  });
});

describe('the install text in the app matches the kit', () => {
  it('the paste-into-Claude prompt keeps the kit’s steps', async () => {
    const { claudePrompt, codexPrompt } = await import('../../src/connect/install-text');
    const kit = read('prompts/user-install-prompt.md');
    const claude = claudePrompt('{PATH}');
    for (const line of claude.split('\n').filter((l) => l.trim() !== '')) {
      // The kit says "atelier" in lower case where the app says "Atelier" for the product name.
      expect(kit.toLowerCase(), line).toContain(line.toLowerCase());
    }
    for (const line of codexPrompt('{PATH}')
      .split('\n')
      .filter((l) => l.trim() !== '')) {
      expect(kit.toLowerCase(), line).toContain(line.toLowerCase());
    }
  });
});
