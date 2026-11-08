/**
 * Skills are markdown files an agent loads on demand (skills/README.md). Some ship with AFrame; a
 * person can add their own in `~/.aframe/skills/`, and a skill of theirs with the same name
 * replaces the shipped one. Pure: reading the folder is done by whoever has a file system.
 */
export interface Skill {
  name: string;
  description: string;
  /** The whole file, frontmatter included. */
  body: string;
  source: 'shipped' | 'user';
}

/** A skill name is also a file-friendly id (`aframe://skills/<name>`). */
export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
export const MAX_USER_SKILLS = 50;
export const MAX_SKILL_BYTES = 200_000;
/** Files in the skills folder that are not skills. */
export const NOT_A_SKILL = new Set(['README.md', 'aframe-SKILL.md']);

/**
 * Reads a skill file: `name` and `description` come from the frontmatter (the name falls back to the
 * file name). A file without a description, or with a name that is not a valid id, is not a skill.
 */
export function parseSkill(
  file: string,
  raw: string,
  source: Skill['source'] = 'shipped',
): Skill | null {
  const text = raw.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const get = (key: string): string | undefined =>
    new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(m?.[1] ?? '')?.[1]?.trim();
  const description = get('description');
  const name = get('name') ?? file.replace(/\.md$/i, '');
  if (description === undefined || description === '' || !SKILL_NAME.test(name)) return null;
  return { name, description: description.slice(0, 400), body: text, source };
}

/** Shipped skills with the person's own on top: same name means theirs wins. Sorted by name. */
export function mergeSkills(shipped: readonly Skill[], user: readonly Skill[]): Skill[] {
  const byName = new Map<string, Skill>();
  for (const s of shipped) byName.set(s.name, s);
  for (const s of user.slice(0, MAX_USER_SKILLS)) byName.set(s.name, s);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
