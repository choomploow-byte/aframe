/**
 * The design skills (skills/*.md) as the in-app assistant sees them: the same files the MCP server
 * ships, bundled into the app at build time and loaded on demand through `load_skill`.
 */
const files = import.meta.glob<string>('../../skills/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export interface ChatSkill {
  name: string;
  description: string;
  body: string;
}

const NOT_LOADABLE = new Set(['README.md', 'atelier-SKILL.md']);

export function parseSkill(file: string, raw: string): ChatSkill | null {
  const text = raw.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const get = (key: string): string | undefined =>
    new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(m?.[1] ?? '')?.[1]?.trim();
  const description = get('description');
  if (description === undefined) return null;
  return { name: get('name') ?? file.replace(/\.md$/, ''), description, body: text };
}

let cached: ChatSkill[] | null = null;

export function chatSkills(): ChatSkill[] {
  cached ??= Object.entries(files)
    .map(([path, raw]) => ({ file: path.split('/').pop() ?? path, raw }))
    .filter((f) => !NOT_LOADABLE.has(f.file))
    .map((f) => parseSkill(f.file, f.raw))
    .filter((s): s is ChatSkill => s !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  return cached;
}
