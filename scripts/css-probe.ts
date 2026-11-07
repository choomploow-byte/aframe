// Proves the layout contract of nodeToCss in a real browser (docs/04 "Layout semantics"):
// renders small documents with the exact CSS the core produces and measures the result.
// Run: npx tsx scripts/css-probe.ts   (needs system Chrome; set CHROME_PATH if not found)
// Optional: SHOT_DIR=<dir> saves screenshots of the stroke scenarios.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';
import { PNG } from 'pngjs';
import { cssToString, GLOBAL_RESET_CSS, nodeToCss, type CssRecord } from '../src/core/style';
import { buildDoc, PAGE_ID, type TestSpec } from '../src/core/testing';
import { DEFAULT_TOKENS } from '../src/core/tokens';
import type { Doc, Node } from '../src/core/types';

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p): p is string => typeof p === 'string' && existsSync(p));
if (!CHROME) {
  console.error('No Chrome found. Set CHROME_PATH.');
  process.exit(2);
}

type Override = (id: string, css: CssRecord) => CssRecord;
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function render(doc: Doc, override?: Override): string {
  const walk = (node: Node, parent: Node | undefined): string => {
    let css = nodeToCss(node, parent, doc.tokens);
    if (override) css = override(node.id, css);
    const inner =
      node.type === 'text'
        ? esc(node.text ?? '')
        : node.children
            .map((c) => doc.nodes[c])
            .filter((c): c is Node => !!c)
            .map((c) => walk(c, node))
            .join('');
    return `<div data-id="${node.id}" style="${esc(cssToString(css))}">${inner}</div>`;
  };
  const root = doc.nodes[doc.rootId] as Node;
  return `<!doctype html><meta charset="utf-8"><style>${GLOBAL_RESET_CSS}body{margin:0;font:16px system-ui}</style>${walk(root, undefined)}`;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function measure(page: Page, html: string): Promise<Record<string, Rect>> {
  await page.setViewport({ width: 1200, height: 900 });
  await page.setContent(html);
  return page.evaluate(() => {
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const el of document.querySelectorAll<HTMLElement>('[data-id]')) {
      const r = el.getBoundingClientRect();
      out[el.dataset.id as string] = { x: r.x, y: r.y, w: r.width, h: r.height };
    }
    return out;
  });
}

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  -> ${detail}`}`);
  if (!ok) failures += 1;
}
const near = (a: number | undefined, b: number, tol = 0.6): boolean =>
  a !== undefined && Math.abs(a - b) <= tol;
const info = (name: string, value: unknown): void =>
  console.log(`INFO  ${name}: ${JSON.stringify(value)}`);

const LOREM =
  'Plan work your team will actually follow and review it together every single week without meetings';

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();

try {
  // 1. Fixed-size items never shrink inside a row that is too small.
  {
    const doc = buildDoc([
      {
        id: 'n_row',
        type: 'frame',
        layout: 'row',
        w: 300,
        h: 80,
        children: [
          { id: 'n_a', type: 'rect', w: 150, h: 50 },
          { id: 'n_b', type: 'rect', w: 150, h: 50 },
          { id: 'n_c', type: 'rect', w: 150, h: 50 },
        ],
      },
    ]);
    const r = await measure(page, render(doc));
    check(
      'fixed items keep their width in an undersized row',
      near(r.n_a?.w, 150) && near(r.n_c?.w, 150),
      JSON.stringify(r),
    );
  }

  // 2. fill takes the remaining main-axis space; hug is content-sized.
  {
    const doc = buildDoc([
      {
        id: 'n_row',
        type: 'frame',
        layout: 'row',
        w: 600,
        h: 60,
        children: [
          { id: 'n_fix', type: 'rect', w: 100, h: 40 },
          { id: 'n_fill', type: 'rect', w: 'fill', h: 40 },
          { id: 'n_hug', type: 'text', text: 'Hug me' },
        ],
      },
    ]);
    const r = await measure(page, render(doc));
    check(
      'row: fill = parent - fixed - hug',
      near(r.n_fill?.w, 600 - 100 - (r.n_hug?.w ?? 0)),
      JSON.stringify(r),
    );
    check(
      'row: hug text is single line (height = one line)',
      (r.n_hug?.h ?? 99) < 30,
      JSON.stringify(r.n_hug),
    );
  }

  // 3. Two fills share equally regardless of content.
  {
    const doc = buildDoc([
      {
        id: 'n_row',
        type: 'frame',
        layout: 'row',
        w: 400,
        h: 100,
        children: [
          {
            id: 'n_f1',
            type: 'frame',
            w: 'fill',
            h: 'fill',
            layout: 'column',
            children: [{ id: 'n_t1', type: 'text', text: 'short' }],
          },
          {
            id: 'n_f2',
            type: 'frame',
            w: 'fill',
            h: 'fill',
            layout: 'column',
            children: [{ id: 'n_t2', type: 'text', text: LOREM, w: 'fill' }],
          },
        ],
      },
    ]);
    const r = await measure(page, render(doc));
    check(
      'two fills split 50/50 even with unequal content',
      near(r.n_f1?.w, 200) && near(r.n_f2?.w, 200),
      JSON.stringify(r),
    );
    check('fill text wraps (taller than one line)', (r.n_t2?.h ?? 0) > 40, JSON.stringify(r.n_t2));
  }

  // 4. Column with fixed height: fill takes the rest.
  {
    const doc = buildDoc([
      {
        id: 'n_col',
        type: 'frame',
        layout: 'column',
        w: 200,
        h: 300,
        children: [
          { id: 'n_head', type: 'rect', w: 'fill', h: 50 },
          { id: 'n_body', type: 'rect', w: 'fill', h: 'fill' },
        ],
      },
    ]);
    const r = await measure(page, render(doc));
    check(
      'column: fill height = parent - fixed',
      near(r.n_body?.h, 250) && near(r.n_body?.w, 200),
      JSON.stringify(r),
    );
  }

  // 5. A frame with h:'fill' inside a column whose height is 'hug': does its content survive?
  {
    const doc = buildDoc([
      {
        id: 'n_col',
        type: 'frame',
        layout: 'column',
        w: 300,
        children: [
          { id: 'n_top', type: 'text', text: 'Top' },
          {
            id: 'n_fillframe',
            type: 'frame',
            layout: 'column',
            w: 'fill',
            h: 'fill',
            children: [
              { id: 'n_l1', type: 'text', text: 'Line one' },
              { id: 'n_l2', type: 'text', text: 'Line two' },
            ],
          },
        ],
      },
    ]);
    const asEmitted = await measure(page, render(doc));
    const withoutMin: Override = (id, css) => {
      if (id !== 'n_fillframe') return css;
      const copy = { ...css };
      delete copy.minHeight;
      return copy;
    };
    const variant = await measure(page, render(doc, withoutMin));
    const contentH = (asEmitted.n_l1?.h ?? 0) + (asEmitted.n_l2?.h ?? 0);
    info('fill-in-hug column: frame height as emitted vs without min-height:0', [
      asEmitted.n_fillframe?.h,
      variant.n_fillframe?.h,
    ]);
    info('content height', contentH);
    check(
      'column fill inside a hug parent does not collapse below its content',
      (asEmitted.n_fillframe?.h ?? 0) >= contentH - 0.6,
      `frame ${asEmitted.n_fillframe?.h} < content ${contentH}`,
    );
  }

  // 5b. The same question on the width axis: fill inside a hug row keeps its content width.
  {
    const doc = buildDoc([
      {
        id: 'n_hugrow2',
        type: 'frame',
        layout: 'row',
        children: [
          { id: 'n_lead', type: 'text', text: 'Lead' },
          {
            id: 'n_fillw',
            type: 'frame',
            layout: 'row',
            w: 'fill',
            children: [{ id: 'n_fw_t', type: 'text', text: 'Content that needs room' }],
          },
        ],
      },
    ]);
    const r = await measure(page, render(doc));
    check(
      'row fill inside a hug row does not collapse below its content width',
      (r.n_fillw?.w ?? 0) >= (r.n_fw_t?.w ?? 1) - 0.6,
      JSON.stringify([r.n_fillw, r.n_fw_t]),
    );
  }

  // 6. Text: hug never wraps, fixed/fill width wraps.
  {
    const doc = buildDoc([
      {
        id: 'n_f',
        type: 'frame',
        layout: 'none',
        w: 240,
        h: 200,
        children: [
          { id: 'n_hug', type: 'text', text: LOREM, x: 0, y: 0 },
          { id: 'n_wrap', type: 'text', text: LOREM, x: 0, y: 40, w: 200 },
        ],
      },
    ]);
    const r = await measure(page, render(doc));
    check(
      'abs text with w:hug stays on one line (wider than parent)',
      (r.n_hug?.h ?? 99) < 30 && (r.n_hug?.w ?? 0) > 240,
      JSON.stringify(r.n_hug),
    );
    check(
      'abs text with numeric w wraps at that width',
      near(r.n_wrap?.w, 200) && (r.n_wrap?.h ?? 0) > 40,
      JSON.stringify(r.n_wrap),
    );
  }

  // 7. Cross axis: stretch equalises hug heights; start does not; fill/fixed behave.
  {
    const mk = (align: 'stretch' | 'start'): TestSpec => ({
      id: 'n_row',
      type: 'frame',
      layout: 'row',
      align,
      w: 500,
      gap: 10,
      children: [
        {
          id: 'n_c1',
          type: 'frame',
          layout: 'column',
          w: 'fill',
          children: [{ id: 'n_x1', type: 'text', text: 'One line' }],
        },
        {
          id: 'n_c2',
          type: 'frame',
          layout: 'column',
          w: 'fill',
          children: [{ id: 'n_x2', type: 'text', text: LOREM, w: 'fill' }],
        },
        { id: 'n_c3', type: 'rect', w: 40, h: 40 },
        { id: 'n_c4', type: 'rect', w: 40, h: 'fill' },
      ],
    });
    const stretch = await measure(page, render(buildDoc([mk('stretch')])));
    const start = await measure(page, render(buildDoc([mk('start')])));
    check(
      'align:stretch makes hug-height cards equal height (docs/04 decision 5)',
      near(stretch.n_c1?.h, stretch.n_c2?.h ?? -1),
      JSON.stringify([stretch.n_c1, stretch.n_c2]),
    );
    check(
      'align:stretch leaves a fixed cross size alone',
      near(stretch.n_c3?.h, 40),
      JSON.stringify(stretch.n_c3),
    );
    check(
      'align:start keeps hug heights different',
      !near(start.n_c1?.h, start.n_c2?.h ?? -1),
      JSON.stringify([start.n_c1, start.n_c2]),
    );
    check(
      'cross-axis fill stretches even when align is start',
      near(start.n_c4?.h, start.n_c2?.h ?? -1),
      JSON.stringify([start.n_c4, start.n_c2]),
    );
  }

  // 8. Absolute positioning and containing blocks.
  {
    const doc = buildDoc([
      {
        id: 'n_page_frame',
        type: 'frame',
        layout: 'none',
        x: 100,
        y: 50,
        w: 300,
        h: 200,
        children: [
          { id: 'n_child', type: 'rect', x: 20, y: 30, w: 100, h: 50 },
          { id: 'n_full', type: 'rect', x: 0, y: 0, w: 'fill', h: 'fill' },
        ],
      },
      {
        id: 'n_flexparent',
        type: 'frame',
        layout: 'column',
        x: 600,
        y: 400,
        w: 300,
        children: [
          { id: 'n_spacer', type: 'rect', w: 10, h: 70 },
          {
            id: 'n_nonflex',
            type: 'frame',
            layout: 'none',
            w: 200,
            h: 100,
            children: [{ id: 'n_inner', type: 'rect', x: 15, y: 25, w: 20, h: 20 }],
          },
        ],
      },
    ]);
    const r = await measure(page, render(doc));
    check(
      'artboard is placed at x,y on the page',
      near(r.n_page_frame?.x, 100) && near(r.n_page_frame?.y, 50),
      JSON.stringify(r.n_page_frame),
    );
    check(
      'abs child offset is relative to its frame',
      near((r.n_child?.x ?? 0) - 100, 20) && near((r.n_child?.y ?? 0) - 50, 30),
      JSON.stringify(r.n_child),
    );
    check(
      'abs child w/h fill = 100% of the frame',
      near(r.n_full?.w, 300) && near(r.n_full?.h, 200),
      JSON.stringify(r.n_full),
    );
    check(
      'layout:none frame inside a flex parent anchors its own abs children',
      near((r.n_inner?.x ?? 0) - (r.n_nonflex?.x ?? 0), 15) &&
        near((r.n_inner?.y ?? 0) - (r.n_nonflex?.y ?? 0), 25),
      JSON.stringify([r.n_nonflex, r.n_inner]),
    );
  }

  // 9. hug frames, wrap, and the documented collapse of hug on layout:none.
  {
    const doc = buildDoc([
      {
        id: 'n_wrapper',
        type: 'frame',
        layout: 'row',
        wrap: true,
        w: 200,
        gap: 10,
        children: [
          { id: 'n_w1', type: 'rect', w: 90, h: 30 },
          { id: 'n_w2', type: 'rect', w: 90, h: 30 },
          { id: 'n_w3', type: 'rect', w: 90, h: 30 },
        ],
      },
      {
        id: 'n_hugrow',
        type: 'frame',
        layout: 'row',
        x: 400,
        padding: [4, 8, 4, 8],
        gap: 6,
        children: [
          { id: 'n_k1', type: 'rect', w: 20, h: 20 },
          { id: 'n_k2', type: 'rect', w: 30, h: 20 },
        ],
      },
      {
        id: 'n_hugnone',
        type: 'frame',
        layout: 'none',
        x: 700,
        w: 'hug',
        h: 'hug',
        children: [{ id: 'n_k3', type: 'rect', x: 0, y: 0, w: 50, h: 50 }],
      },
    ]);
    const r = await measure(page, render(doc));
    check(
      'wrap: third item goes to a second row',
      (r.n_w3?.y ?? 0) > (r.n_w1?.y ?? 0) + 20,
      JSON.stringify([r.n_w1, r.n_w3]),
    );
    check(
      'hug frame = children + gap + padding',
      near(r.n_hugrow?.w, 20 + 30 + 6 + 16) && near(r.n_hugrow?.h, 28),
      JSON.stringify(r.n_hugrow),
    );
    check(
      'hug on layout:none collapses to 0 (documented)',
      near(r.n_hugnone?.w, 0) && near(r.n_hugnone?.h, 0),
      JSON.stringify(r.n_hugnone),
    );
  }

  // 10. Strokes via outline: no layout impact, painted above children, correct alignment.
  {
    const RED = '#ff0000';
    const BLUE = '#0000ff';
    const GREEN = '#00ff00';
    const mkStroke = (align: 'inside' | 'center' | 'outside'): Doc =>
      buildDoc([
        {
          id: 'n_box',
          type: 'frame',
          layout: 'column',
          x: 40,
          y: 40,
          w: 100,
          h: 100,
          fill: GREEN,
          stroke: RED,
          strokeWidth: 8,
          strokeAlign: align,
          children: [{ id: 'n_cover', type: 'rect', w: 'fill', h: 'fill', fill: BLUE }],
        },
      ]);

    const pixel = (png: PNG, x: number, y: number): string => {
      const i = (png.width * y + x) * 4;
      return [png.data[i], png.data[i + 1], png.data[i + 2]].join(',');
    };
    const shot = async (
      doc: Doc,
      override?: Override,
      name?: string,
    ): Promise<{ png: PNG; rects: Record<string, Rect> }> => {
      const rects = await measure(page, render(doc, override));
      const buf = await page.screenshot({ type: 'png' });
      if (process.env.SHOT_DIR && name) {
        mkdirSync(process.env.SHOT_DIR, { recursive: true });
        writeFileSync(join(process.env.SHOT_DIR, `stroke-${name}.png`), buf);
      }
      return { png: PNG.sync.read(Buffer.from(buf)), rects };
    };

    const inside = await shot(mkStroke('inside'), undefined, 'inside');
    const redP = '255,0,0';
    const blueP = '0,0,255';
    check(
      'stroke inside: ring is above a child that fills the frame',
      pixel(inside.png, 43, 90) === redP && pixel(inside.png, 60, 90) === blueP,
      `${pixel(inside.png, 43, 90)} / ${pixel(inside.png, 60, 90)}`,
    );
    check(
      'stroke does not change layout (child still 100x100)',
      near(inside.rects.n_cover?.w, 100) && near(inside.rects.n_cover?.h, 100),
      JSON.stringify(inside.rects.n_cover),
    );
    check(
      'stroke inside stays within the frame bounds',
      pixel(inside.png, 38, 90) !== redP,
      pixel(inside.png, 38, 90),
    );

    const outside = await shot(mkStroke('outside'), undefined, 'outside');
    check(
      'stroke outside: ring is outside, frame content intact',
      pixel(outside.png, 36, 90) === redP && pixel(outside.png, 43, 90) === blueP,
      `${pixel(outside.png, 36, 90)} / ${pixel(outside.png, 43, 90)}`,
    );

    const center = await shot(mkStroke('center'), undefined, 'center');
    check(
      'stroke center: half in, half out',
      pixel(center.png, 38, 90) === redP &&
        pixel(center.png, 42, 90) === redP &&
        pixel(center.png, 47, 90) === blueP,
      `${pixel(center.png, 38, 90)} ${pixel(center.png, 42, 90)} ${pixel(center.png, 47, 90)}`,
    );

    // Why not an inset box-shadow: the same stroke would be hidden by the child fill.
    const insetShadow: Override = (id, css) => {
      if (id !== 'n_box') return css;
      const copy = { ...css };
      delete copy.outline;
      delete copy.outlineOffset;
      copy.boxShadow = `inset 0 0 0 8px ${RED}`;
      return copy;
    };
    const alt = await shot(mkStroke('inside'), insetShadow);
    check(
      '(comparison) inset box-shadow stroke is hidden by a full-size child',
      pixel(alt.png, 43, 90) === blueP,
      pixel(alt.png, 43, 90),
    );
  }

  // 11. Rounded + ellipse + visibility sanity.
  {
    const doc = buildDoc([
      { id: 'n_el', type: 'ellipse', x: 0, y: 0, w: 80, h: 80, fill: '#000' },
      { id: 'n_hidden', type: 'rect', x: 100, y: 0, w: 50, h: 50, visible: false },
      { id: 'n_line', type: 'line', x: 0, y: 120, w: 200, h: 3, stroke: '#123456' },
    ]);
    const html = render(doc);
    const r = await measure(page, html);
    check(
      'hidden node takes no space',
      near(r.n_hidden?.w, 0) && near(r.n_hidden?.h, 0),
      JSON.stringify(r.n_hidden),
    );
    check(
      'line is a w x h bar',
      near(r.n_line?.w, 200) && near(r.n_line?.h, 3),
      JSON.stringify(r.n_line),
    );
    const radius = await page.evaluate(
      () => getComputedStyle(document.querySelector('[data-id=n_el]') as Element).borderRadius,
    );
    check('ellipse renders with 50% radius', radius === '50%', radius);
  }
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll layout probes passed.' : `\n${failures} probe(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

void DEFAULT_TOKENS;
void PAGE_ID;
