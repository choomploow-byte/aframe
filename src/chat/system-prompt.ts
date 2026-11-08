import promptDoc from '../../prompts/in-app-system-prompt.md?raw';

/** The first fenced block of prompts/in-app-system-prompt.md is the system prompt. */
export function extractSystemPrompt(doc: string): string {
  const m = /```\r?\n([\s\S]*?)\r?\n```/.exec(doc);
  if (!m?.[1]) throw new Error('prompts/in-app-system-prompt.md has no fenced system prompt.');
  return m[1].replace(/\r\n/g, '\n');
}

export const SYSTEM_PROMPT: string = extractSystemPrompt(promptDoc);

export const SUGGESTED_PROMPTS: readonly string[] = [
  'Improve the selected frame',
  'Make this look more professional',
  'Critique my design (no edits)',
  'Check my spacing and contrast, then fix what you find',
  'Make a mobile version of this screen',
  'Address my open notes',
];
