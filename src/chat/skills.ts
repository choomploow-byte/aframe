/**
 * The design skills as the in-app assistant sees them: the files in skills/ (bundled into the app at
 * build time, the same ones the MCP server ships) plus the person's own in `~/.aframe/skills/`,
 * which win on a name clash. Skills are loaded on demand through `load_skill`.
 */
import {
  MAX_SKILL_BYTES,
  MAX_USER_SKILLS,
  NOT_A_SKILL,
  mergeSkills,
  parseSkill,
  type Skill,
} from '@core/skills';
import { getFs } from '../platform/fs';

const files = import.meta.glob<string>('../../skills/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export type ChatSkill = Skill;
export { parseSkill };

let shipped: Skill[] | null = null;
let user: Skill[] = [];

function shippedSkills(): Skill[] {
  shipped ??= Object.entries(files)
    .map(([path, raw]) => ({ file: path.split('/').pop() ?? path, raw }))
    .filter((f) => !NOT_A_SKILL.has(f.file))
    .map((f) => parseSkill(f.file, f.raw, 'shipped'))
    .filter((s): s is Skill => s !== null);
  return shipped;
}

/** The skills the assistant can load right now (shipped, then the person's own on top). */
export function chatSkills(): Skill[] {
  return mergeSkills(shippedSkills(), user);
}

/** Reads `~/.aframe/skills/` through the app's confined file API. Never throws: no folder means none. */
export async function refreshUserSkills(): Promise<void> {
  try {
    const fs = await getFs();
    const entries = (await fs.list('skills')).filter(
      (e) =>
        !e.isDir &&
        e.name.toLowerCase().endsWith('.md') &&
        !NOT_A_SKILL.has(e.name) &&
        e.size <= MAX_SKILL_BYTES,
    );
    const found: Skill[] = [];
    for (const e of entries.slice(0, MAX_USER_SKILLS)) {
      const text = await fs.readText(`skills/${e.name}`);
      const skill = text === null ? null : parseSkill(e.name, text, 'user');
      if (skill) found.push(skill);
    }
    user = found;
  } catch {
    user = [];
  }
}
