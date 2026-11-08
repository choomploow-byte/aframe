import { beforeAll, describe, expect, it } from 'vitest';
import { applyChanges } from '../../src/core/apply';
import { lintDesign } from '../../src/core/lint';
import { buildDoc } from '../../src/core/testing';
import { validateDoc } from '../../src/core/validate';
import { changedNodes, measure, TARGETS, verdict } from '../../evals/metrics';
import { referenceAgent } from '../../evals/reference-agent';
import { prepare, TASKS } from '../../evals/tasks';
import type { Op } from '../../src/core/types';

beforeAll(async () => {
  await prepare();
});

describe('the task set', () => {
  it('has ten distinct tasks', () => {
    expect(TASKS).toHaveLength(10);
    expect(new Set(TASKS.map((t) => t.id)).size).toBe(10);
  });

  it.each(TASKS.map((t) => [t.id, t] as const))(
    '%s builds a valid document and its selection exists',
    (_id, task) => {
      const doc = task.build();
      expect(validateDoc(doc).ok).toBe(true);
      if (task.select !== undefined) {
        expect(Object.values(doc.nodes).some((n) => n.name === task.select)).toBe(true);
      }
      expect(task.prompt.length).toBeGreaterThan(10);
      expect(task.humanFocus.length).toBeGreaterThan(10);
    },
  );

  it('every task starts the same way each time', () => {
    for (const t of TASKS) expect(JSON.stringify(t.build())).toBe(JSON.stringify(t.build()));
  });

  it('the address-notes task really has open notes', () => {
    const doc = TASKS.find((t) => t.id === 'address-notes')?.build();
    expect(doc?.annotations.filter((a) => a.status === 'open')).toHaveLength(3);
  });
});

describe('measure', () => {
  const board = (extra: object, children: object[]) =>
    buildDoc([
      {
        id: 'n_f',
        type: 'frame',
        name: 'Board',
        w: 400,
        fill: '#ffffff',
        ...extra,
        children: children as never[],
      },
    ]);

  it('counts auto-layout frames, token colours and on-scale spacing', () => {
    const doc = board({ layout: 'column', gap: 8, padding: [16, 16, 16, 16] }, [
      {
        id: 'n_a',
        type: 'frame',
        name: 'Free',
        fill: '$primary',
        children: [{ id: 'n_t', type: 'text', name: 'T', text: 'x', color: '#111111' }],
      },
    ]);
    const m = measure(doc);
    expect(m.autoLayoutPct).toBe(50); // Board yes, Free no
    expect(m.tokenPct).toBeCloseTo(33.3, 0); // $primary of #fff, $primary, #111
    expect(m.spacingOnScalePct).toBe(100);
    expect(m.minTextPx).toBe(16);
  });

  it('reports off-scale spacing and tiny text', () => {
    const m = measure(
      board({ layout: 'column', gap: 13 }, [
        { id: 'n_t', type: 'text', name: 'T', text: 'x', fontSize: 9, color: '#eeeeee' },
      ]),
    );
    expect(m.spacingOnScalePct).toBe(0);
    expect(m.minTextPx).toBe(9);
    expect(m.contrastErrors).toBe(1);
  });

  it('can measure one frame only', () => {
    const doc = buildDoc([
      {
        id: 'n_a',
        type: 'frame',
        name: 'A',
        gap: 13,
        layout: 'row',
        children: [{ id: 'n_x', type: 'rect', name: 'X' }],
      },
      {
        id: 'n_b',
        type: 'frame',
        name: 'B',
        gap: 8,
        layout: 'row',
        children: [{ id: 'n_y', type: 'rect', name: 'Y' }],
      },
    ]);
    expect(measure(doc, 'n_b').spacingOnScalePct).toBe(100);
    expect(measure(doc, 'n_a').spacingOnScalePct).toBe(0);
  });

  it('judges against the stated bars, with per-task exceptions', () => {
    const good = {
      ...measure(
        buildDoc([
          {
            id: 'n_f',
            type: 'frame',
            name: 'F',
            layout: 'row',
            children: [{ id: 'n_r', type: 'rect', name: 'R' }],
          },
        ]),
      ),
    };
    expect(verdict(good).pass).toBe(true);
    const free = { ...good, autoLayoutPct: 50 };
    expect(verdict(free).autoLayout).toBe(false);
    expect(verdict(free, { skipAutoLayout: true }).pass).toBe(true);
    expect(verdict({ ...good, tokenPct: 10 }, { minTokenPct: 80 }).pass).toBe(false);
    expect(TARGETS).toEqual({ autoLayoutPct: 80, spacingOnScalePct: 90, contrastErrors: 0 });
  });

  it('counts changed nodes by value', () => {
    const a = board({}, [{ id: 'n_c', type: 'rect', name: 'C' }]);
    const b = JSON.parse(JSON.stringify(a)) as typeof a;
    expect(changedNodes(a, b)).toBe(0);
    (b.nodes.n_c as { name: string }).name = 'Renamed';
    expect(changedNodes(a, b)).toBe(1);
  });
});

describe('the scripted baseline agent', () => {
  it('looks, checks, applies the offered fixes and photographs, in that order', () => {
    const seen: string[] = [];
    const messages: { role: string; content: unknown }[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Selection: Signup [n_card] (frame)\n\nfix it' }],
      },
    ];
    const doc = TASKS.find((t) => t.id === 'fix-contrast-and-sizes')?.build();
    if (!doc) throw new Error('no task');
    let current = doc;
    for (let i = 0; i < 6; i += 1) {
      const reply = referenceAgent({ messages }, { edits: true }) as {
        content: { type: string; name?: string; input?: unknown; id?: string }[];
        stop_reason: string;
      };
      messages.push({ role: 'assistant', content: reply.content });
      const call = reply.content.find((c) => c.type === 'tool_use');
      if (!call) break;
      seen.push(call.name ?? '');
      let text = '{}';
      if (call.name === 'lint_design') text = JSON.stringify(lintDesign(current, 'n_card'));
      if (call.name === 'apply_changes') {
        const ops = (call.input as { operations: Op[] }).operations;
        const r = applyChanges(current, ops);
        expect(r.ok).toBe(true);
        if (r.ok) current = r.doc;
      }
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: call.id, content: [{ type: 'text', text }] }],
      });
    }
    expect(seen).toEqual(['get_design', 'lint_design', 'apply_changes', 'screenshot']);
    expect(measure(current, 'n_card').spacingOnScalePct).toBe(100);
    expect(measure(current, 'n_card').contrastErrors).toBe(0);
  });

  it('changes nothing when told it may not edit', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'Selection: none' }] },
      { role: 'assistant', content: [] },
      { role: 'assistant', content: [] },
    ];
    const reply = referenceAgent({ messages }, { edits: false }) as {
      content: { name?: string }[];
    };
    expect(reply.content[0]?.name).toBe('screenshot');
  });
});
