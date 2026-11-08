/**
 * Basic design lint (docs/05 `lint_design`). Deterministic, pure, no rendering: it reasons from the
 * document alone, so every finding is something the document says. The full rule set and the eval
 * harness arrive in Phase 9; these are the rules an agent needs to catch its own obvious mistakes.
 */
import { fillBase } from './fill';
import { fontInfo, supportsWeight } from './fonts';
import { getIcon, suggestIcons } from './icons';
import { resolveColor, resolveFont } from './tokens';
import { attachFixOps, groupFindings, isMobileFrame } from './lint-extra';
import { withTextStyle } from './style';
import type { Doc, Node, Op } from './types';

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  severity: Severity;
  rule: string;
  nodeId: string;
  message: string;
  /** A concrete next step the agent can apply with apply_changes. */
  fix?: string;
  /** The same fix as operations, when the right answer is unambiguous: pass them to apply_changes as they are. */
  fixOps?: Op[];
}

export interface LintResult {
  findings: Finding[];
  /** Findings found before the cap; `findings.length` is at most this. */
  total: number;
  counts: Record<Severity, number>;
  nodesChecked: number;
  /** Findings left out because the layer (or a frame above it) is marked `props["lint-ignore"]`. */
  ignored: number;
}

const MAX_FINDINGS = 100;
const MIN_TEXT_PX = 12;
const MOBILE_TEXT_PX = 14;
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
export function backgroundOf(doc: Doc, node: Node): Rgb | null {
  let cur: Node | undefined = node.parentId === null ? undefined : doc.nodes[node.parentId];
  while (cur) {
    if (cur.type === 'image') return null;
    // A pattern counts through its own background; one without a background lets the next ancestor show.
    const base = fillBase(cur.fill);
    if (base !== undefined && base !== '') {
      const resolved = resolveColor(base, doc.tokens);
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

/** The key in a layer's `props` that marks findings as intentional: "overflow, radius-variety" or "all". */
export const LINT_IGNORE_KEY = 'lint-ignore';

/** Whether this finding's layer, or a frame above it, says the rule is intentional there. */
function isIgnored(doc: Doc, f: Finding): boolean {
  for (
    let cur: Node | undefined = doc.nodes[f.nodeId];
    cur;
    cur = cur.parentId === null ? undefined : doc.nodes[cur.parentId]
  ) {
    const list = cur.props?.[LINT_IGNORE_KEY];
    if (list === undefined) continue;
    const rules = list
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (rules.includes('all') || rules.includes('*') || rules.includes(f.rule)) return true;
  }
  return false;
}

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

  for (const rawNode of walk(doc, start)) {
    const node = withTextStyle(rawNode, doc.tokens);
    if (node.id === doc.rootId) continue;
    checked += 1;

    if (node.type === 'text') {
      const size = node.fontSize ?? 16;
      const floor = isMobileFrame(doc, node) ? MOBILE_TEXT_PX : MIN_TEXT_PX;
      if (size < floor) {
        add({
          severity: 'warning',
          rule: 'text-size',
          nodeId: node.id,
          message: `Text is ${size}px; below ${floor}px is hard to read${floor === MOBILE_TEXT_PX ? ' on a phone' : ''}.`,
          fix: `update ${node.id} set fontSize to at least ${floor}`,
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

    // ---- the game-UI toolkit: layers inside an instance are judged through their master ----
    const derived = node.from !== undefined;

    if (node.type === 'text' && !derived && node.shadow !== undefined && node.shadow.length > 0) {
      add({
        severity: 'warning',
        rule: 'text-shadow',
        nodeId: node.id,
        message: `Text "${node.name}" has a shadow. Text shadows are off by default: they blur small type and fight the background. Keep one only for a deliberate outline or glow on a busy picture.`,
        fix: `update ${node.id} set shadow to null (put depth on the frame behind the text with effects instead)`,
      });
    }
    if (node.type === 'text' && !derived && node.effects !== undefined && node.effects.length > 0) {
      add({
        severity: 'warning',
        rule: 'effect-on-text',
        nodeId: node.id,
        message: `Effect presets are box recipes and are not drawn on text ("${node.name}").`,
        fix: `move the effects from ${node.id} to the frame behind the text`,
      });
    }
    if (node.type === 'icon' && !derived && getIcon(node.icon) === undefined) {
      const near = node.icon === undefined ? [] : suggestIcons(node.icon);
      add({
        severity: 'warning',
        rule: 'unknown-icon',
        nodeId: node.id,
        message:
          node.icon === undefined
            ? `Icon "${node.name}" has no icon name, so a placeholder is drawn.`
            : `There is no icon "${node.icon}", so a labelled placeholder is drawn.${near.length > 0 ? ` Closest: ${near.join(', ')}.` : ''}`,
        fix: `update ${node.id} set icon to a name from search_icons`,
      });
    }
    if (node.type === 'text' && !derived && node.fontWeight !== undefined) {
      const family = resolveFont(node.fontFamily, doc.tokens);
      if (fontInfo(family) && !supportsWeight(family, node.fontWeight)) {
        const [lo, hi] = fontInfo(family)?.weights ?? [400, 400];
        add({
          severity: 'info',
          rule: 'font-weight',
          nodeId: node.id,
          message: `${family ?? 'This font'} has ${lo === hi ? `only weight ${lo}` : `weights ${lo}-${hi}`}; ${node.fontWeight} is drawn as ${Math.min(hi, Math.max(lo, node.fontWeight))}.`,
          fix: `set fontWeight to ${Math.min(hi, Math.max(lo, node.fontWeight))} or pick a family that has it (list_fonts)`,
        });
      }
    }

    const layoutParent = node.parentId === null ? undefined : doc.nodes[node.parentId];
    if (
      !derived &&
      layoutParent?.type === 'frame' &&
      (layoutParent.layout === 'row' || layoutParent.layout === 'column') &&
      (node.x !== 0 || node.y !== 0)
    ) {
      const which = [node.x !== 0 ? `x ${node.x}` : '', node.y !== 0 ? `y ${node.y}` : '']
        .filter(Boolean)
        .join(' and ');
      add({
        severity: 'warning',
        rule: 'ignored-position',
        nodeId: node.id,
        message: `"${node.name}" has ${which}, which does nothing: its parent "${layoutParent.name}" uses auto-layout (${layoutParent.layout}). Position comes from the layout.`,
        fix: `set x and y on ${node.id} back to 0, or set layout "none" on ${layoutParent.id} to place children by hand`,
      });
    }

    const isButton = node.role === 'button' || node.component?.kind === 'button';
    if (isButton && !derived && node.instanceOf === undefined) {
      const states = node.component?.states ?? {};
      const missing = (['hover', 'pressed'] as const).filter(
        (s) => states[s] === undefined || Object.keys(states[s] ?? {}).length === 0,
      );
      if (missing.length > 0) {
        add({
          severity: 'warning',
          rule: 'button-states',
          nodeId: node.id,
          message:
            node.component === undefined
              ? `Button "${node.name}" has no hover or pressed variant, so nothing shows that it can be pressed.`
              : `Button component "${node.name}" has no ${missing.join(' or ')} state.`,
          fix:
            node.component === undefined
              ? `define_component on ${node.id} with states hover and pressed (e.g. a lighter fill on hover, effects ["bevel-pressed"] when pressed)`
              : `define_component on ${node.id} with states ${missing.join(' and ')}`,
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
            fixOps: radiusOps(doc, id, groups[0]?.[0]),
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

  findings.push(...groupFindings(doc, start));
  attachFixOps(doc, findings);
  const ignored = findings.filter((f) => isIgnored(doc, f)).length;
  if (ignored > 0)
    findings.splice(0, findings.length, ...findings.filter((f) => !isIgnored(doc, f)));

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return {
    findings: findings.slice(0, MAX_FINDINGS),
    total: findings.length,
    counts,
    nodesChecked: checked,
    ignored,
  };
}

function parseRgbOf(doc: Doc, value: string): { rgb: Rgb; alpha: number } | null {
  const resolved = resolveColor(value, doc.tokens);
  return resolved === undefined ? null : parseRgb(resolved);
}

function radiusOps(doc: Doc, id: string, json: string | undefined): Op[] | undefined {
  if (json === undefined || doc.nodes[id] === undefined) return undefined;
  try {
    return [{ op: 'update', id, set: { radius: JSON.parse(json) as unknown } } as unknown as Op];
  } catch {
    return undefined;
  }
}
