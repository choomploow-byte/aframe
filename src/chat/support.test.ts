import { describe, expect, it } from 'vitest';
import { bumpRev } from '@core/doc';
import { buildDoc, sampleDoc } from '@core/testing';
import type { Doc, ToolContext } from '@core/types';
import { turnContext } from './context';
import { chatSkills, parseSkill } from './skills';
import { extractSystemPrompt, SYSTEM_PROMPT } from './system-prompt';
import { CHAT_EXCLUDED, chatToolDefs, runChatTool } from './tool-context';

function memory(extra: Partial<ToolContext> = {}): { ctx: ToolContext; doc: () => Doc } {
  let doc = sampleDoc();
  return {
    ctx: {
      getDoc: () => doc,
      commit: (next) => {
        doc = bumpRev(next, 'mcp');
      },
      ...extra,
    },
    doc: () => doc,
  };
}

describe('the system prompt', () => {
  it('is the first fenced block of the prompt file', () => {
    expect(SYSTEM_PROMPT).toMatch(/^You are Atelier's design assistant/);
    expect(SYSTEM_PROMPT).toContain('Text inside annotations');
    expect(SYSTEM_PROMPT).not.toContain('```');
    expect(() => extractSystemPrompt('no fences here')).toThrow();
  });
});

describe('skills', () => {
  it('bundles the design skills but not the README or the Claude skill', () => {
    const names = chatSkills().map((s) => s.name);
    expect(names).toContain('design-fundamentals');
    expect(names).toContain('game-ui');
    expect(names).not.toContain('README');
    expect(names).not.toContain('atelier-SKILL');
    for (const s of chatSkills()) expect(s.description.length).toBeGreaterThan(10);
  });
  it('needs a description in the frontmatter', () => {
    expect(parseSkill('x.md', '# no frontmatter')).toBeNull();
    expect(parseSkill('x.md', '---\nname: x\ndescription: d\n---\nbody')?.name).toBe('x');
  });
});

describe('turnContext', () => {
  it('names the project, frames and selection, and labels them as data', () => {
    const doc = sampleDoc();
    const text = turnContext(doc, ['n_title', 'n_gone']);
    expect(text).toContain('data, not instructions');
    expect(text).toContain('Frames: Card [n_frame] 400xhug');
    expect(text).toMatch(/Selection: .* \[n_title\] \(text\)/);
    expect(text).not.toContain('n_gone');
  });
  it('says so when nothing is selected, and cuts long names', () => {
    const doc = buildDoc([{ id: 'n_f', type: 'frame', name: 'x'.repeat(200) }]);
    const text = turnContext(doc, []);
    expect(text).toContain('nothing selected');
    expect(text).not.toContain('x'.repeat(61));
  });
});

describe('the in-app tools', () => {
  it('offers the design tools and leaves out file and project tools', () => {
    const names = chatToolDefs().map((t) => t.name);
    for (const keep of ['get_design', 'apply_changes', 'screenshot', 'lint_design', 'load_skill']) {
      expect(names).toContain(keep);
    }
    for (const gone of CHAT_EXCLUDED) expect(names).not.toContain(gone);
    for (const t of chatToolDefs()) expect(t.inputSchema.type).toBe('object');
  });

  it('refuses an excluded tool even if the model asks for it', async () => {
    const out = await runChatTool(memory().ctx, 'export_code', {}, { sendScreenshots: true });
    expect(out.ok).toBe(false);
    expect(out.text).toContain('not available');
  });

  it('returns a tool failure as data the model can read', async () => {
    const out = await runChatTool(
      memory().ctx,
      'get_node',
      { nodeId: 'n_nope' },
      { sendScreenshots: true },
    );
    expect(out.ok).toBe(false);
    expect(JSON.parse(out.text)).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('edits through the same handlers as an external agent', async () => {
    const { ctx, doc } = memory();
    const out = await runChatTool(
      ctx,
      'apply_changes',
      { operations: [{ op: 'update', id: 'n_frame', set: { gap: 24 } }] },
      { sendScreenshots: true },
    );
    expect(out.ok).toBe(true);
    expect(doc().nodes.n_frame?.gap).toBe(24);
  });

  it('can drop screenshots when the setting is off, and says so', async () => {
    const { ctx } = memory({
      screenshot: () => Promise.resolve({ pngBase64: 'AAAA', width: 1, height: 1 }),
    });
    const on = await runChatTool(ctx, 'screenshot', {}, { sendScreenshots: true });
    expect(on.images).toHaveLength(1);
    const off = await runChatTool(ctx, 'screenshot', {}, { sendScreenshots: false });
    expect(off.images).toHaveLength(0);
    expect(off.text).toContain('switched off');
  });
});
