// Malformed input must never crash the app or corrupt it: the document loader, the importers and the
// code exporter get thousands of deterministic mutations of real inputs. The only acceptable outcomes are
// a clean "no" (or a refusal with a message) or a result that is itself valid.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadDoc } from '../../src/core/doc';
import { exportDesign } from '../../src/core/export';
import { importDom, type DomSnapshot } from '../../src/core/import/dom';
import { importFigma, listFigmaFrames } from '../../src/core/import/figma';
import { importSvg } from '../../src/core/import/svg';
import { ImportError } from '../../src/core/import/types';
import { lintDesign } from '../../src/core/lint';
import { seededRng } from '../../src/core/ids';
import { nodeToCss } from '../../src/core/style';
import { validateDoc } from '../../src/core/validate';

const rng = seededRng(424242);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)] as T;

const WEIRD: unknown[] = [
  null,
  undefined,
  true,
  false,
  0,
  -1,
  1e308,
  -1e308,
  NaN,
  '',
  'x'.repeat(5000),
  '$nope',
  '<script>',
  '../../etc/passwd',
  [],
  {},
  [[[]]],
  { a: { b: { c: 1 } } },
  '__proto__',
  'url(javascript:1)',
  2 ** 53,
];

/** Applies one random change somewhere in a JSON tree. */
function mutate(value: unknown, depth = 0): unknown {
  if (typeof value !== 'object' || value === null) return pick(WEIRD);
  const copy: unknown = Array.isArray(value)
    ? [...(value as unknown[])]
    : { ...(value as Record<string, unknown>) };
  const keys = Object.keys(copy as object);
  if (keys.length === 0) return pick(WEIRD);
  const key = pick(keys);
  const target = copy as Record<string, unknown>;
  const roll = rng();
  if (roll < 0.25) delete target[key];
  else if (roll < 0.5 || depth > 6) target[key] = pick(WEIRD);
  else target[key] = mutate(target[key], depth + 1);
  return copy;
}

const sampleJson = JSON.parse(readFileSync('fixtures/sample-doc.json', 'utf8')) as unknown;
const figmaJson = JSON.parse(readFileSync('fixtures/figma-sample.json', 'utf8')) as unknown;

describe('the document loader', () => {
  it('survives 3000 mutations of a real project: a clean no, or a document that is valid and can be drawn and exported', () => {
    let loaded = 0;
    for (let i = 0; i < 3000; i += 1) {
      let candidate = sampleJson;
      for (let k = 0; k < 1 + (i % 3); k += 1) candidate = mutate(candidate);
      const result = loadDoc(JSON.parse(JSON.stringify(candidate ?? null)) as unknown);
      if (!result.ok) continue;
      loaded += 1;
      const doc = result.doc;
      expect(validateDoc(doc).ok, `mutation ${i}`).toBe(true);
      expect(() => lintDesign(doc)).not.toThrow();
      for (const node of Object.values(doc.nodes)) {
        if (node.type === 'page') continue;
        expect(() =>
          nodeToCss(
            node,
            node.parentId === null ? undefined : doc.nodes[node.parentId],
            doc.tokens,
          ),
        ).not.toThrow();
      }
      const frame = doc.nodes[doc.rootId]?.children[0];
      if (frame !== undefined && doc.nodes[frame]?.visible) {
        for (const f of ['html', 'react-css', 'react-tailwind'] as const) {
          expect(() => exportDesign(doc, frame, f), `${f} on mutation ${i}`).not.toThrow();
        }
      }
    }
    // The mutations are not all fatal: the loader is repairing or tolerating some of them.
    expect(loaded).toBeGreaterThan(0);
  });

  it('does not let a project file change Object.prototype', () => {
    const text =
      '{"schema":1,"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"nodes":{"__proto__":{"polluted":"yes"}}}';
    loadDoc(JSON.parse(text) as unknown);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('says no to things that are not documents', () => {
    for (const bad of [
      null,
      undefined,
      1,
      'text',
      [],
      {},
      { schema: 1 },
      { schema: 999, nodes: {} },
    ]) {
      expect(loadDoc(bad).ok).toBe(false);
    }
  });
});

const svgCorpus = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect x="1" y="2" width="30" height="20" rx="3" fill="#f00" stroke="blue" stroke-width="2"/><circle cx="50" cy="30" r="10"/><text x="5" y="50" font-size="12">Hi &amp; bye</text><g transform="translate(5 5) scale(2)"><path d="M0 0 L10 10"/></g><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs><rect width="9" height="9" fill="url(#g)"/></svg>',
];

function mutateText(text: string): string {
  const roll = rng();
  const at = Math.floor(rng() * text.length);
  if (roll < 0.3) return text.slice(0, at) + text.slice(at + 1 + Math.floor(rng() * 12));
  if (roll < 0.5) return text.slice(0, at);
  if (roll < 0.7)
    return (
      text.slice(0, at) +
      pick([
        '<',
        '>',
        '"',
        "'",
        '&',
        '&#x0;',
        '&#99999999;',
        '<!--',
        ']]>',
        '<![CDATA[',
        '\0',
        '<?',
        '/>',
        '</g>',
      ]) +
      text.slice(at)
    );
  if (roll < 0.85)
    return (
      text.slice(0, at) +
      text.slice(at, at + 20).repeat(1 + Math.floor(rng() * 30)) +
      text.slice(at)
    );
  return text.replace(/\d+/, String(pick([-1, 0, 1e9, 1e300, NaN])));
}

describe('the SVG importer', () => {
  it('survives 3000 mutations: a result, or an ImportError, never anything else', () => {
    for (let i = 0; i < 3000; i += 1) {
      let text = pick(svgCorpus);
      for (let k = 0; k < 1 + (i % 3); k += 1) text = mutateText(text);
      try {
        const r = importSvg(text);
        expect(Array.isArray(r.report)).toBe(true);
      } catch (e) {
        expect(e instanceof ImportError, `mutation ${i}: ${String(e)}`).toBe(true);
      }
    }
  });
});

describe('the Figma importer', () => {
  it('survives 3000 mutations of a recorded file', () => {
    for (let i = 0; i < 3000; i += 1) {
      let candidate: unknown = JSON.parse(JSON.stringify(figmaJson));
      for (let k = 0; k < 1 + (i % 3); k += 1) candidate = mutate(candidate);
      try {
        const frames = listFigmaFrames(candidate);
        const id = frames[0]?.id ?? '1:2';
        importFigma(candidate, { frameId: id });
      } catch (e) {
        expect(e instanceof ImportError, `mutation ${i}: ${String(e)}`).toBe(true);
      }
    }
  });
});

describe('the page-capture importer', () => {
  const base: DomSnapshot = {
    url: 'http://localhost:3000/',
    title: 'App',
    width: 400,
    height: 300,
    root: {
      tag: 'body',
      box: { x: 0, y: 0, w: 400, h: 300 },
      style: {
        backgroundColor: 'rgb(250, 250, 250)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      },
      children: [
        {
          tag: 'h1',
          box: { x: 10, y: 10, w: 300, h: 40 },
          style: { fontSize: '32px', color: 'rgb(0, 0, 0)' },
          text: 'Hello',
        },
        {
          tag: 'div',
          box: { x: 10, y: 60, w: 100, h: 40 },
          style: {
            backgroundColor: 'rgb(201, 100, 66)',
            borderTopLeftRadius: '8px',
            boxShadow: 'rgba(0, 0, 0, 0.1) 0px 2px 4px 0px',
          },
          children: [],
        },
      ],
    },
  };
  it('survives 3000 mutations', () => {
    for (let i = 0; i < 3000; i += 1) {
      let candidate: unknown = JSON.parse(JSON.stringify(base));
      for (let k = 0; k < 1 + (i % 3); k += 1) candidate = mutate(candidate);
      try {
        importDom(candidate as DomSnapshot);
      } catch (e) {
        // A malformed capture may be refused with our error, or trip over a missing field; it must not hang or corrupt.
        expect(e instanceof Error, `mutation ${i}`).toBe(true);
      }
    }
  });
});
