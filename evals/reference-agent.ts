/**
 * A scripted stand-in for a model: the "lint-fix baseline". It is not intelligent and not a
 * benchmark of any model. It answers provider requests (Anthropic format) with the same tool calls a
 * careful agent starts with: look, run the design check, apply every fix the check offers, take a
 * screenshot, report. Two uses:
 *  - it proves the harness end to end without a key or a network (selection, tools, undo, metrics);
 *  - its scores are the floor a real model has to beat: what mechanical fixing alone achieves.
 */

interface Body {
  messages?: { role: string; content: unknown }[];
}

type Block = Record<string, unknown>;

const usage = { input_tokens: 0, output_tokens: 0 };

const toolTurn = (id: string, name: string, input: unknown): unknown => ({
  content: [{ type: 'tool_use', id, name, input }],
  stop_reason: 'tool_use',
  usage,
});

/** The text of the most recent tool result in the request. */
function lastToolText(body: Body): string {
  const last = body.messages?.at(-1);
  const blocks = Array.isArray(last?.content) ? (last.content as Block[]) : [];
  for (const b of blocks) {
    if (b.type !== 'tool_result') continue;
    const inner = Array.isArray(b.content) ? (b.content as Block[]) : [];
    const text = inner.find((c) => c.type === 'text');
    if (typeof text?.text === 'string') return text.text;
  }
  return '';
}

function stepOf(body: Body): number {
  return (body.messages ?? []).filter((m) => m.role === 'assistant').length;
}

/** Selected node id, from the context line the app puts in the first message. */
function selectedId(body: Body): string | null {
  const first = body.messages?.[0];
  const blocks = Array.isArray(first?.content) ? (first.content as Block[]) : [];
  const text = blocks.map((b) => (typeof b.text === 'string' ? b.text : '')).join('\n');
  const m = /Selection: [^\n]*?\[([^\]]+)\]/.exec(text);
  return m?.[1] ?? null;
}

export function referenceAgent(body: Body, options: { edits: boolean }): unknown {
  const step = stepOf(body);
  const id = selectedId(body);
  switch (step) {
    case 0:
      return toolTurn('r1', 'get_design', {});
    case 1:
      return toolTurn('r2', 'lint_design', id === null ? {} : { nodeId: id });
    case 2: {
      if (!options.edits) return toolTurn('r3', 'screenshot', id === null ? {} : { nodeId: id });
      let ops: unknown[] = [];
      try {
        const parsed = JSON.parse(lastToolText(body)) as { findings?: { fixOps?: unknown[] }[] };
        ops = (parsed.findings ?? []).flatMap((f) => f.fixOps ?? []);
      } catch {
        /* nothing parsed: no edits */
      }
      return ops.length > 0
        ? toolTurn('r3', 'apply_changes', {
            label: 'Apply the design check fixes',
            operations: ops,
          })
        : toolTurn('r3', 'screenshot', id === null ? {} : { nodeId: id });
    }
    case 3:
      return toolTurn('r4', 'screenshot', id === null ? {} : { nodeId: id });
    default:
      return {
        content: [
          {
            type: 'text',
            text: options.edits
              ? 'I ran the design check and applied the fixes it could make safely.'
              : 'Here is what I found. I changed nothing.',
          },
        ],
        stop_reason: 'end_turn',
        usage,
      };
  }
}
