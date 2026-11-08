import { describe, expect, it } from 'vitest';
import { createEmptyDoc } from '../doc';
import { buildDoc } from '../testing';
import { validateDoc } from '../validate';
import { applyImport } from './apply';
import { importSvg } from './svg';
import { summarise, type ReportEntry } from './types';
import { parseXml } from './xml';
import type { NodeSpec } from '../types';

const svg = (inner: string, attrs = 'width="200" height="100" viewBox="0 0 200 100"'): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;

const kids = (r: { spec: NodeSpec | null }): NodeSpec[] => r.spec?.children ?? [];
const kinds = (report: ReportEntry[], kind: ReportEntry['kind']): string[] =>
  report.filter((e) => e.kind === kind).map((e) => e.what);

describe('shapes', () => {
  it('makes a frame the size of the viewBox with rect, circle and ellipse as layers', () => {
    const r = importSvg(
      svg(
        '<rect x="10" y="20" width="50" height="30" rx="4" fill="#ff0000" stroke="#000" stroke-width="2"/>' +
          '<circle cx="100" cy="50" r="20" fill="blue"/>' +
          '<ellipse cx="150" cy="50" rx="10" ry="20" fill="rgb(0,128,0)" opacity="0.5"/>',
      ),
      'logo.svg',
    );
    expect(r.spec).toMatchObject({ type: 'frame', name: 'logo', w: 200, h: 100, clip: true });
    const [rect, circle, ellipse] = kids(r);
    expect(rect).toMatchObject({
      type: 'rect',
      x: 10,
      y: 20,
      w: 50,
      h: 30,
      radius: 4,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 2,
    });
    expect(circle).toMatchObject({ type: 'ellipse', x: 80, y: 30, w: 40, h: 40, fill: '#0000ff' });
    expect(ellipse).toMatchObject({
      type: 'ellipse',
      x: 140,
      y: 30,
      w: 20,
      h: 40,
      fill: '#008000',
      opacity: 0.5,
    });
    expect(kinds(r.report, 'converted')).toHaveLength(3);
  });

  it('uses the viewBox origin and honours fill and style inheritance from a group', () => {
    const r = importSvg(
      svg(
        '<g fill="#112233" style="stroke:#445566;stroke-width:3"><rect x="5" y="5" width="10" height="10"/></g>',
        'viewBox="-5 -5 100 50"',
      ),
    );
    const group = kids(r)[0];
    expect(group?.type).toBe('frame');
    const rect = group?.children?.[0];
    expect(rect).toMatchObject({ fill: '#112233', stroke: '#445566', strokeWidth: 3 });
    // The rect is at 5,5 in a viewBox that starts at -5,-5: 10px in.
    expect((group?.x ?? 0) + (rect?.x ?? 0)).toBe(10);
  });

  it('applies translate and scale, and says rotation is approximate', () => {
    const r = importSvg(
      svg(
        '<g transform="translate(10 20) scale(2)"><rect x="5" y="5" width="10" height="10" transform="rotate(45)"/></g>',
      ),
    );
    const group = kids(r)[0];
    const rect = group?.children?.[0];
    expect(group?.x).toBe(20);
    expect(group?.y).toBe(30);
    expect(rect).toMatchObject({ w: 20, h: 20, rotation: 45 });
    expect(kinds(r.report, 'approximated').some((w) => w.includes('transform'))).toBe(true);
  });

  it('turns a horizontal line into a thin rectangle and keeps a diagonal as a drawing', () => {
    const r = importSvg(
      svg(
        '<line x1="10" y1="50" x2="110" y2="50" stroke="#333" stroke-width="4"/><line x1="0" y1="0" x2="50" y2="50" stroke="#333"/>',
      ),
    );
    const [flat, diagonal] = kids(r);
    expect(flat).toMatchObject({ type: 'rect', w: 100, h: 4, fill: '#333333', y: 48 });
    expect(diagonal?.type).toBe('image');
    expect(r.assets).toHaveLength(1);
  });

  it('reads text, anchors and font settings', () => {
    const r = importSvg(
      svg(
        '<text x="100" y="60" font-family="Inter, sans-serif" font-size="20" font-weight="bold" text-anchor="middle" fill="#111">Hello &amp; welcome</text>',
      ),
    );
    const t = kids(r)[0];
    expect(t).toMatchObject({
      type: 'text',
      text: 'Hello & welcome',
      fontSize: 20,
      fontFamily: 'Inter',
      fontWeight: 700,
      textAlign: 'center',
      color: '#111111',
    });
    expect(t?.y).toBe(44); // baseline 60 minus 0.8 of the font size
  });

  it('joins tspans on new lines', () => {
    const r = importSvg(
      svg(
        '<text x="0" y="20" font-size="10"><tspan x="0" dy="0">One</tspan><tspan x="0" dy="12">Two</tspan></text>',
      ),
    );
    expect(kids(r)[0]?.text).toBe('One\nTwo');
  });
});

describe('gradients and fallbacks', () => {
  it('turns a linear gradient into a gradient fill', () => {
    const r = importSvg(
      svg(
        '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff0000"/><stop offset="100%" stop-color="#0000ff"/></linearGradient></defs>' +
          '<rect width="100" height="50" fill="url(#g)"/>',
      ),
    );
    expect(kids(r)[0]?.fill).toBe('linear-gradient(180deg, #ff0000 0%, #0000ff 100%)');
  });

  it('says so when a gradient is missing or radial', () => {
    const missing = importSvg(svg('<rect width="10" height="10" fill="url(#nope)"/>'));
    expect(kinds(missing.report, 'skipped').some((w) => w.includes('fill'))).toBe(true);
    const radial = importSvg(
      svg(
        '<defs><radialGradient id="r"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient></defs><circle cx="50" cy="50" r="40" fill="url(#r)"/>',
      ),
    );
    expect(kids(radial)[0]?.fill).toMatch(/^radial-gradient/);
    expect(kinds(radial.report, 'approximated').length).toBeGreaterThan(0);
  });

  it('keeps a path as an image of exactly that drawing, with its gradients', () => {
    const r = importSvg(
      svg(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><path d="M10 10 L90 10 L50 80 Z" fill="url(#g)"/>',
      ),
    );
    const image = kids(r)[0];
    expect(image).toMatchObject({ type: 'image', x: 0, y: 0, w: 200, h: 100 });
    expect(image?.assetId).toMatch(/^ref:/);
    const text = new TextDecoder().decode(r.assets[0]?.bytes);
    expect(text).toContain('<path');
    expect(text).toContain('linearGradient');
    expect(text.startsWith('<svg')).toBe(true);
    expect(kinds(r.report, 'fallback')).toHaveLength(1);
  });

  it('reads a picture stored in the file and refuses one that is not', () => {
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const r = importSvg(
      svg(
        `<image x="0" y="0" width="40" height="40" href="data:image/png;base64,${png}"/><image width="40" height="40" href="https://example.com/x.png"/>`,
      ),
    );
    expect(kids(r)).toHaveLength(1);
    expect(kids(r)[0]?.type).toBe('image');
    expect(kinds(r.report, 'skipped').some((w) => w.includes('image'))).toBe(true);
  });
});

describe('what is left out, and why', () => {
  it('reports use, style, script and foreignObject instead of following them', () => {
    const r = importSvg(
      svg(
        '<style>.a{fill:red}</style><script>alert(1)</script><foreignObject><div>hi</div></foreignObject><use href="#x"/><rect width="10" height="10"/>',
      ),
    );
    expect(kids(r)).toHaveLength(1);
    const text = r.report.map((e) => `${e.kind}:${e.what}`).join('|');
    expect(text).toContain('skipped:script');
    expect(text).toContain('skipped:foreignObject');
    expect(text).toContain('skipped:use');
    expect(text).toContain('approximated:a <style> block');
  });

  it('summarises how much came across editable', () => {
    const r = importSvg(
      svg('<rect width="10" height="10"/><circle r="5" cx="5" cy="5"/><path d="M0 0L9 9"/>'),
    );
    const s = summarise(r.report);
    expect(s).toMatchObject({ converted: 2, fallback: 1, skipped: 0, editablePct: 67 });
  });

  it('counts repeated colours as token suggestions', () => {
    const r = importSvg(
      svg(
        '<rect width="1" height="1" fill="#aabbcc"/><rect width="1" height="1" fill="#aabbcc"/><rect width="1" height="1" fill="#123456"/>',
      ),
    );
    expect(r.colors).toEqual({ '#aabbcc': 2 });
  });

  it('has nothing to import from an empty drawing', () => {
    const r = importSvg(svg(''));
    expect(r.spec).toBeNull();
    expect(r.report[0]?.kind).toBe('skipped');
  });
});

describe('hostile and broken files', () => {
  it('does not expand entities or follow a DOCTYPE', () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "AAAAAAAAAA"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text x="0" y="8">&b;</text></svg>`;
    const r = importSvg(bomb);
    // The unknown entity stays as written; nothing is expanded.
    expect(kids(r)[0]?.text).toBe('&b;');
  });

  it('rejects things that are not SVG, mismatched tags and files cut short', () => {
    expect(() => importSvg('hello')).toThrow();
    expect(() => importSvg('<html><body/></html>')).toThrow(/not an SVG/);
    expect(() => importSvg('<svg><g></svg>')).toThrow();
    expect(() => importSvg('<svg><rect')).toThrow();
  });

  it('refuses a drawing that is nested absurdly deep', () => {
    const deep = `${'<g>'.repeat(40)}<rect width="1" height="1"/>${'</g>'.repeat(40)}`;
    expect(() => importSvg(svg(deep))).toThrow(/deeply/);
  });

  it('refuses a drawing with far too many elements', () => {
    const many = '<rect width="1" height="1"/>'.repeat(2500);
    expect(() => importSvg(svg(many))).toThrow(/more than/);
  });

  it('refuses a drawing that claims to be enormous', () => {
    expect(() =>
      importSvg(svg('<rect width="1" height="1"/>', 'width="99999" height="99999"')),
    ).toThrow(/larger/);
  });

  it('keeps script out of a drawing it keeps as an image', () => {
    const r = importSvg(
      svg('<defs><script>alert(1)</script></defs><path d="M0 0L9 9" onclick="alert(2)"/>'),
    );
    const text = new TextDecoder().decode(r.assets[0]?.bytes);
    expect(text).not.toContain('<script');
    expect(text).not.toContain('onclick');
  });

  it('treats an odd colour as black and says so', () => {
    const r = importSvg(svg('<rect width="5" height="5" fill="notacolour"/>'));
    expect(kids(r)[0]?.fill).toBe('#000000');
    expect(kinds(r.report, 'approximated').some((w) => w.includes('notacolour'))).toBe(true);
  });
});

describe('parseXml', () => {
  it('reads attributes in either quote style, entities and CDATA', () => {
    const el = parseXml(`<svg a='1' b="x &amp; y"><text><![CDATA[<raw>]]></text></svg>`);
    expect(el.attrs).toMatchObject({ a: '1', b: 'x & y' });
    expect(el.children[0]?.text).toBe('<raw>');
  });
  it('drops a namespace prefix', () => {
    const el = parseXml('<svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:rect/></svg:svg>');
    expect(el.name).toBe('svg');
    expect(el.children[0]?.name).toBe('rect');
  });
});

describe('applyImport', () => {
  it('adds the frame, its pictures and keeps the document valid, as one batch', () => {
    const doc = createEmptyDoc();
    const r = importSvg(
      svg('<rect width="50" height="50" fill="#f00"/><path d="M0 0L9 9" stroke="#000"/>'),
      'art.svg',
    );
    const out = applyImport(doc, r, { x: 100, y: 200 });
    const frame = out.doc.nodes[out.nodeId];
    expect(frame).toMatchObject({ name: 'art', x: 100, y: 200, w: 200, h: 100 });
    expect(frame?.children).toHaveLength(2);
    const image = out.doc.nodes[frame?.children[1] ?? ''];
    expect(image?.type).toBe('image');
    expect(out.doc.assets[image?.assetId ?? '']).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(validateDoc(out.doc).ok).toBe(true);
  });

  it('can place into an existing frame, and refuses an empty import', () => {
    const doc = buildDoc([
      { id: 'n_host', type: 'frame', name: 'Host', w: 400, h: 400, layout: 'none' },
    ]);
    const out = applyImport(doc, importSvg(svg('<rect width="5" height="5"/>')), {
      parentId: 'n_host',
    });
    expect(out.doc.nodes[out.nodeId]?.parentId).toBe('n_host');
    expect(() => applyImport(doc, importSvg(svg('')))).toThrow(/Nothing/);
  });
});
