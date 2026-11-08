/**
 * The person's own skills: `*.md` files in `~/.atelier/skills/` (docs/08). Read fresh on every call, so
 * adding a file needs no restart. Only ordinary markdown files of a sensible size are read; links,
 * directories and anything that is not a valid skill are ignored, never an error.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_SKILL_BYTES,
  MAX_USER_SKILLS,
  NOT_A_SKILL,
  mergeSkills,
  parseSkill,
  type Skill,
} from '../src/core/skills';

export function readUserSkills(atelierHome: string): Skill[] {
  const dir = path.join(atelierHome, 'skills');
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: Skill[] = [];
  for (const name of names.sort()) {
    if (out.length >= MAX_USER_SKILLS) break;
    if (!name.toLowerCase().endsWith('.md') || NOT_A_SKILL.has(name)) continue;
    const file = path.join(dir, name);
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile() || st.size > MAX_SKILL_BYTES) continue;
      const skill = parseSkill(name, fs.readFileSync(file, 'utf8'), 'user');
      if (skill) out.push(skill);
    } catch {
      /* unreadable: skip */
    }
  }
  return out;
}

/** Shipped skills plus the person's own (theirs win on a name clash). */
export function allSkills(atelierHome: string, shipped: readonly Skill[]): Skill[] {
  return mergeSkills(shipped, readUserSkills(atelierHome));
}
