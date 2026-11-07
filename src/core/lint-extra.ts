/**
 * The rest of docs/13's lint rules, and machine-applicable fixes. Same promise as lint.ts: pure,
 * from the document alone, nothing guessed. A `fixOps` list is only attached when the right answer
 * is unambiguous (a snapped number, the other sibling's value, whichever of black or white reads
 * better); anything that needs judgement keeps just its sentence.
 */
import { fontInfo } from './fonts';
import { backgroundOf, contrastRatio, parseRgb, type Finding } from './lint';
import { resolveFont } from './tokens';
import type { Doc, Node, Op } from './types';

const isNumber = (v: unknown): v is number => typeof v === 'number';
const MOBILE_MAX_WIDTH = 480;

const update = (id: string, set: Record<string, unknown>): Op =>
  ({ op: 'update', id, set }) as unknown as Op;

/** The top-level frame (child of the page) a node sits in. */
function artboardOf(doc: Doc, node: Node): Node | undefined {
  let cur: Node | undefined = node;
  while (cur && cur.parentId !== null && cur.parentId !== doc.rootId) cur = doc.nodes[cur.parentId];
  return cur && cur.parentId === doc.rootId ? cur : undefined;
}

export const isMobileFrame = (doc: Doc, node: Node): boolean => {
  const board = artboardOf(doc, node);
  return board !== undefined && isNumber(board.w) && board.w <= MOBILE_MAX_WIDTH;
};

function* subtree(doc: Doc, id: string): Generator<Node> {
  const stack = [id];
  while (stack.length > 0) {
    const n = doc.nodes[stack.pop() as string];
    if (!n) continue;
    yield n;
    for (let i = n.children.length - 1; i >= 0; i -= 1) stack.push(n.children[i] as string);
  }
}

const hasText = (doc: Doc, node: Node): boolean =>
  node.type === 'text' || node.children.some((id) => doc.nodes[id] && hasText(doc, doc.nodes[id]));

/** The nearest value on the spacing scale (the tokens, or any multiple of 4). */
export function snapSpacing(value: number, scale: readonly number[]): number {
  let best = Math.max(0, Math.round(value / 4) * 4);
  for (const s of scale) if (Math.abs(s - value) < Math.abs(best - value)) best = s;
  return best;
}

/** Rules that look at groups of nodes. */
export function groupFindings(doc: Doc, start: string): Finding[] {
  const out: Finding[] = [];
  const boards = new Set<string>();
  for (const node of subtree(doc, start)) {
    if (node.id === doc.rootId) continue;
    const board = artboardOf(doc, node);
    if (board) boards.add(board.id);
  }

  // too-many-fonts: more than two families or five sizes in one artboard.
  for (const id of boards) {
    const families = new Set<string>();
    const sizes = new Set<number>();
    for (const n of subtree(doc, id)) {
      if (n.type !== 'text') continue;
      const family = resolveFont(n.fontFamily, doc.tokens);
      if (family) families.add(family);
      sizes.add(n.fontSize ?? 16);
    }
    const board = doc.nodes[id];
    if (!board) continue;
    // A board that holds the reusable masters is a library, not a screen.
    if (board.children.some((c) => doc.nodes[c]?.component !== undefined)) continue;
    if (families.size > 2 || sizes.size > 5) {
      out.push({
        severity: 'warning',
        rule: 'too-many-fonts',
        nodeId: id,
        message: `"${board.name}" uses ${families.size} font families and ${sizes.size} text sizes; two families and a handful of sizes (a type scale) read as one design.`,
        fix: 'pick one heading family and one body family, and snap the sizes to a scale such as 14, 16, 20, 28, 40',
      });
    }
  }

  for (const node of subtree(doc, start)) {
    if (node.id === doc.rootId) continue;

    // line-length: a long paragraph in a very wide box.
    if (node.type === 'text' && isNumber(node.w) && (node.text ?? '').length > 80) {
      const size = node.fontSize ?? 16;
      const perLine = node.w / (size * 0.5);
      if (perLine > 80) {
        out.push({
          severity: 'info',
          rule: 'line-length',
          nodeId: node.id,
          message: `About ${Math.round(perLine)} characters fit on a line of "${node.name}"; 45-75 is easier to read.`,
          fix: `limit the width of ${node.id} to about ${Math.round(size * 0.5 * 65)}px`,
          fixOps: [update(node.id, { w: Math.round(size * 0.5 * 65) })],
        });
      }
    }

    if (node.type !== 'frame' && node.type !== 'page') continue;
    const kids = node.children
      .map((id) => doc.nodes[id])
      .filter((n): n is Node => n !== undefined && n.visible);

    // unaligned: free-placed siblings whose edges miss each other by 1-3px.
    if (node.layout === 'none') {
      for (const axis of ['x', 'y'] as const) {
        const sorted = [...kids].sort((a, b) => a[axis] - b[axis]);
        for (let i = 1; i < sorted.length; i += 1) {
          const a = sorted[i - 1] as Node;
          const b = sorted[i] as Node;
          const d = b[axis] - a[axis];
          // Only look-alikes: a label sitting 2px off a bar is placement, two cards 2px apart is a slip.
          if (d > 0 && d <= 3 && a.type === b.type) {
            out.push({
              severity: 'info',
              rule: 'unaligned',
              nodeId: b.id,
              message: `"${b.name}" is ${d}px off the ${axis === 'x' ? 'left' : 'top'} edge of "${a.name}": close enough to look like a mistake.`,
              fix: `set ${axis} on ${b.id} to ${a[axis]}`,
              fixOps: [update(b.id, { [axis]: a[axis] })],
            });
          }
        }
      }
    }

    // touching: text-bearing neighbours in a stack with nothing between them.
    if (
      (node.layout === 'row' || node.layout === 'column') &&
      (node.gap ?? 0) === 0 &&
      node.justify !== 'between' &&
      kids.length >= 2
    ) {
      const bare = (n: Node): boolean =>
        n.type === 'text' ||
        (n.type === 'frame' &&
          hasText(doc, n) &&
          n.fill === undefined &&
          (n.padding === undefined || n.padding.every((p) => p === 0)));
      for (let i = 1; i < kids.length; i += 1) {
        const a = kids[i - 1] as Node;
        const b = kids[i] as Node;
        if (bare(a) && bare(b)) {
          out.push({
            severity: 'warning',
            rule: 'touching',
            nodeId: node.id,
            message: `"${a.name}" and "${b.name}" sit directly against each other in "${node.name}" (gap 0).`,
            fix: `set gap on ${node.id} to 8 or 12`,
            fixOps: [update(node.id, { gap: 8 })],
          });
          break;
        }
      }
    }
  }
  return out;
}

/** Adds `fixOps` where the right fix is a number or a name the document already contains. */
export function attachFixOps(doc: Doc, findings: Finding[]): void {
  const scale = doc.tokens.spacing;
  for (const f of findings) {
    if (f.fixOps !== undefined) continue;
    const node = doc.nodes[f.nodeId];
    if (!node) continue;
    switch (f.rule) {
      case 'text-size':
        f.fixOps = [update(node.id, { fontSize: isMobileFrame(doc, node) ? 14 : 12 })];
        break;
      case 'spacing-scale': {
        if (f.message.startsWith('gap') && isNumber(node.gap)) {
          f.fixOps = [update(node.id, { gap: snapSpacing(node.gap, scale) })];
        } else if (node.padding !== undefined) {
          const snapped = node.padding.map((p) =>
            p > 0 && !scale.includes(p) && p % 4 !== 0 ? snapSpacing(p, scale) : p,
          );
          f.fixOps = [update(node.id, { padding: snapped })];
        }
        break;
      }
      case 'tap-target': {
        const set: Record<string, number> = {};
        if (isNumber(node.h) && node.h < 32) set.h = 40;
        if (isNumber(node.w) && node.w < 32) set.w = 40;
        if (Object.keys(set).length > 0) f.fixOps = [update(node.id, set)];
        break;
      }
      case 'contrast': {
        const bg = backgroundOf(doc, node);
        if (bg) {
          const dark = parseRgb('#111111');
          const light = parseRgb('#ffffff');
          if (dark && light) {
            const better = contrastRatio(dark.rgb, bg) >= contrastRatio(light.rgb, bg);
            f.fixOps = [update(node.id, { color: better ? '#111111' : '#ffffff' })];
          }
        }
        break;
      }
      case 'use-token': {
        const m = /colour token (\$[\w-]+)/.exec(f.message);
        if (m?.[1] && typeof node.fill === 'string') f.fixOps = [update(node.id, { fill: m[1] })];
        break;
      }
      case 'ignored-position':
        f.fixOps = [update(node.id, { x: 0, y: 0 })];
        break;
      case 'font-weight': {
        const family = resolveFont(node.fontFamily, doc.tokens);
        const [lo, hi] = fontInfo(family)?.weights ?? [400, 400];
        if (node.fontWeight !== undefined) {
          f.fixOps = [update(node.id, { fontWeight: Math.min(hi, Math.max(lo, node.fontWeight)) })];
        }
        break;
      }
      case 'text-shadow':
        f.fixOps = [update(node.id, { shadow: null })];
        break;
      default:
        break;
    }
  }
}
