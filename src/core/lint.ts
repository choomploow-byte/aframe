/**
 * Basic design lint (docs/05 `lint_design`). Deterministic, pure, no rendering: it reasons from the
 * document alone, so every finding is something the document says. The full rule set and the eval
 * harness arrive in Phase 9; these are the rules an agent needs to catch its own obvious mistakes.
 */
import { resolveColor } from './tokens';
import type { Doc, Node } from './types';

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  severity: Severity;
  rule: string;
  nodeId: string;
  message: string;
  /** A concrete next step the agent can apply with apply_changes. */
  fix?: string;
}

export interface LintResult {
  findings: Finding[];
  /** Findings found before the cap; `findings.length` is at most this. */
  total: number;
  counts: Record<Severity, number>;
  nodesChecked: number;
}

const MAX_FINDINGS = 100;
const MIN_TEXT_PX = 12;
const DEFAULT_NAME = /^(Frame|Rectangle|Ellipse|Image|Group)( \d+)?$/;
const ROLES_NEEDING_TARGET = new Set(['button', 'link', 'input']);

// ---- colour maths (hex and rgb() only: anything else is skipped, never guessed) -------------------

type Rgb = [number, number, number];

export function parseRgb(value: string): { rgb: Rgb; alpha: number } | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
  if (hex?.[1]) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
    return { rgb: [n(0), n(2), n(4)], alpha: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(
    value.trim(),
  );
  if (fn) {
    const a = fn[4];
    const alpha = a === undefined ? 1 : a.endsWith('%') ? parseFloat(a) / 100 : parseFloat(a);
    return { rgb: [Number(fn[1]), Number(fn[2]), Number(fn[3])], alpha };
  }
  return null;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The solid colour behind a node: the nearest ancestor fill, or null if it is a gradient/image/unknown. */
function backgroundOf(doc: Doc, node: Node): Rgb | null {
  let cur: Node | undefined = node.parentId === null ? undefined : doc.nodes[node.parentId];
  while (cur) {
    if (cur.type === 'image') return null;
    if (cur.fill !== undefined && cur.fill !== '') {
      const resolved = resolveColor(cur.fill, doc.tokens);
      const parsed = resolved === undefined ? null : parseRgb(resolved);
      if (!parsed || parsed.alpha < 1) return null; // gradient, unknown or translucent: cannot judge
      return parsed.rgb;
    }
    cur = cur.parentId === null ? undefined : doc.nodes[cur.parentId];
  }
  return [255, 255, 255]; // the page: white unless something says otherwise
}

function* walk(doc: Doc, startId: string): Generator<Node> {
  const stack = [startId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    const node = doc.nodes[id];
    if (!node) continue;
    yield node;
    for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i] as string);
  }
}

const isNumber = (v: unknown): v is number => typeof v === 'number';

export function lintDesign(doc: Doc, nodeId?: string): LintResult {
  const start = nodeId ?? doc.rootId;
  const findings: Finding[] = [];
  const add = (f: Finding): void => void findings.push(f);
  const spacing = new Set(doc.tokens.spacing);
  const tokenColors = new Map<string, string>();
  for (const [name, value] of Object.entries(doc.tokens.colors)) {
    const parsed = parseRgb(value);
    if (parsed) tokenColors.set(value.toLowerCase(), name);
  }
  const radiiByRole = new Map<string, Map<string, string[]>>();
  const distinctRadii = new Set<string>();
  let checked = 0;

  for (const node of walk(doc, start)) {
    if (node.id === doc.rootId) continue;
    checked += 1;

    if (node.type === 'text') {
      const size = node.fontSize ?? 16;
      if (size < MIN_TEXT_PX) {
        add({
          severity: 'warning',
          rule: 'text-size',
          nodeId: node.id,
          message: `Text is ${size}px; below ${MIN_TEXT_PX}px is hard to read.`,
          fix: `update ${node.id} set fontSize to at least ${MIN_TEXT_PX}`,
        });
      }
      const fg = parseRgbOf(doc, node.color ?? '$text');
      const bg = backgroundOf(doc, node);
      if (fg && bg && fg.alpha === 1) {
        const ratio = contrastRatio(fg.rgb, bg);
        const large = size >= 24 || (size >= 18.66 && (node.fontWeight ?? 400) >= 700);
        const need = large ? 3 : 4.5;
        if (ratio < need) {
          add({
            severity: ratio < 3 ? 'error' : 'warning',
            rule: 'contrast',
            nodeId: node.id,
            message: `Contrast ${ratio.toFixed(1)}:1 is below ${need}:1 for ${large ? 'large' : 'body'} text.`,
            fix: `use a darker or lighter text colour on this background (e.g. $text) in ${node.id}`,
          });
        }
      }
    }

    if (node.role !== undefined && ROLES_NEEDING_TARGET.has(node.role)) {
      const small = [node.w, node.h].some((v) => isNumber(v) && v < 32);
      if (small) {
        add({
          severity: 'warning',
          rule: 'tap-target',
          nodeId: node.id,
          message: `A ${node.role} that is ${isNumber(node.w) ? node.w : 'auto'} x ${isNumber(node.h) ? node.h : 'auto'}px is hard to hit; aim for at least 32px (44px on touch screens).`,
          fix: `give ${node.id} a minimum height of 40 (padding is the usual way)`,
        });
      }
    }

    for (const key of ['gap'] as const) {
      const v = node[key];
      if (isNumber(v) && v > 0 && !spacing.has(v) && v % 4 !== 0) {
        add({
          severity: 'info',
          rule: 'spacing-scale',
          nodeId: node.id,
          message: `${key} ${v}px is not on the spacing scale (${doc.tokens.spacing.join(', ')}).`,
          fix: `use the nearest scale value for ${key} on ${node.id}`,
        });
      }
    }
    if (node.padding !== undefined) {
      const off = node.padding.filter((v) => v > 0 && !spacing.has(v) && v % 4 !== 0);
      if (off.length > 0) {
        add({
          severity: 'info',
          rule: 'spacing-scale',
          nodeId: node.id,
          message: `padding ${off.join(', ')}px is not on the spacing scale (${doc.tokens.spacing.join(', ')}).`,
          fix: `snap the padding of ${node.id} to the scale`,
        });
      }
    }

    if (node.radius !== undefined && node.type !== 'text') {
      const key = JSON.stringify(node.radius);
      distinctRadii.add(key);
      if (node.role !== undefined) {
        const byValue = radiiByRole.get(node.role) ?? new Map<string, string[]>();
        byValue.set(key, [...(byValue.get(key) ?? []), node.id]);
        radiiByRole.set(node.role, byValue);
      }
    }

    if (
      (node.type === 'frame' ||
        node.type === 'rect' ||
        node.type === 'ellipse' ||
        node.type === 'image') &&
      DEFAULT_NAME.test(node.name) &&
      node.parentId !== doc.rootId
    ) {
      add({
        severity: 'info',
        rule: 'layer-name',
        nodeId: node.id,
        message: `"${node.name}" is a default layer name; meaningful names make the design and the exported code readable.`,
        fix: `update ${node.id} set name to what it is, e.g. "Hero" or "Primary Button"`,
      });
    }

    if (node.type === 'image' && !(node.props?.alt || node.props?.['aria-label'])) {
      add({
        severity: 'info',
        rule: 'image-alt',
        nodeId: node.id,
        message: 'Image has no alt text.',
        fix: `update ${node.id} set props to { "alt": "what the image shows" }`,
      });
    }

    if (
      isNumber(node.fill) === false &&
      typeof node.fill === 'string' &&
      !node.fill.startsWith('$')
    ) {
      const token = tokenColors.get(node.fill.toLowerCase());
      if (token !== undefined) {
        add({
          severity: 'info',
          rule: 'use-token',
          nodeId: node.id,
          message: `Fill ${node.fill} is the colour token $${token}; reference the token so theme changes reach it.`,
          fix: `update ${node.id} set fill to "$${token}"`,
        });
      }
    }

    const parent = node.parentId === null ? undefined : doc.nodes[node.parentId];
    if (
      parent !== undefined &&
      parent.type === 'frame' &&
      parent.layout === 'none' &&
      isNumber(parent.w) &&
      isNumber(parent.h) &&
      isNumber(node.w) &&
      isNumber(node.h)
    ) {
      const overflowX = node.x + node.w - parent.w;
      const overflowY = node.y + node.h - parent.h;
      if (node.x < 0 || node.y < 0 || overflowX > 0 || overflowY > 0) {
        add({
          severity: 'warning',
          rule: 'overflow',
          nodeId: node.id,
          message: `Extends outside its parent "${parent.name}" (${parent.w} x ${parent.h}).`,
          fix: `move or resize ${node.id} to fit inside ${parent.id}, or resize the parent`,
        });
      }
    }
  }

  for (const [role, byValue] of radiiByRole) {
    if (byValue.size > 1) {
      const groups = [...byValue.entries()];
      for (const [value, ids] of groups.slice(1)) {
        for (const id of ids) {
          add({
            severity: 'warning',
            rule: 'radius-consistency',
            nodeId: id,
            message: `Corner radius ${value} differs from other ${role}s (${groups[0]?.[0]}).`,
            fix: `use the same radius token for every ${role}`,
          });
        }
      }
    }
  }
  if (distinctRadii.size > 4) {
    add({
      severity: 'info',
      rule: 'radius-variety',
      nodeId: start,
      message: `${distinctRadii.size} different corner radii are in use; two or three read as a system.`,
    });
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return {
    findings: findings.slice(0, MAX_FINDINGS),
    total: findings.length,
    counts,
    nodesChecked: checked,
  };
}

function parseRgbOf(doc: Doc, value: string): { rgb: Rgb; alpha: number } | null {
  const resolved = resolveColor(value, doc.tokens);
  return resolved === undefined ? null : parseRgb(resolved);
}
