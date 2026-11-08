import { describe, expect, it } from 'vitest';
import { mergeSkills, parseSkill, type Skill } from './skills';

const file = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\nBody.`;

describe('parseSkill', () => {
  it('reads the frontmatter and keeps the whole file as the body', () => {
    const s = parseSkill('x.md', file('my-style', 'How I like buttons'), 'user');
    expect(s).toMatchObject({
      name: 'my-style',
      description: 'How I like buttons',
      source: 'user',
    });
    expect(s?.body).toContain('# my-style');
  });

  it('falls back to the file name, and understands Windows line endings', () => {
    const raw = '---\r\ndescription: From a Windows editor\r\n---\r\nBody';
    expect(parseSkill('brand-voice.md', raw)?.name).toBe('brand-voice');
  });

  it('is not a skill without a description or with a name that is not an id', () => {
    expect(parseSkill('x.md', '# just notes')).toBeNull();
    expect(parseSkill('x.md', '---\nname: x\n---\nbody')).toBeNull();
    expect(parseSkill('x.md', file('Bad Name!', 'd'))).toBeNull();
    expect(parseSkill('../evil.md', file('../evil', 'd'))).toBeNull();
    expect(parseSkill('x.md', file('a'.repeat(60), 'd'))).toBeNull();
  });

  it('cuts a very long description', () => {
    expect(parseSkill('x.md', file('ok', 'd'.repeat(1000)))?.description).toHaveLength(400);
  });
});

describe('mergeSkills', () => {
  const skill = (name: string, source: Skill['source'], description = name): Skill => ({
    name,
    description,
    body: `${source} ${name}`,
    source,
  });

  it("puts the person's own skills in, sorted, and lets them replace a shipped one", () => {
    const merged = mergeSkills(
      [skill('typography', 'shipped'), skill('color', 'shipped')],
      [skill('typography', 'user'), skill('brand', 'user')],
    );
    expect(merged.map((s) => s.name)).toEqual(['brand', 'color', 'typography']);
    expect(merged.find((s) => s.name === 'typography')?.source).toBe('user');
    expect(merged.find((s) => s.name === 'color')?.source).toBe('shipped');
  });

  it("takes no more than 50 of the person's skills", () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      skill(`s${String(i).padStart(2, '0')}`, 'user'),
    );
    expect(mergeSkills([], many)).toHaveLength(50);
  });
});
