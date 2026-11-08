// Generates the AFrame wordmarks: the original sliced "A" from the logo (the mark is unchanged), then
// "Frame" in DM Sans SemiBold, outlined to paths so no font is needed to show it. Writes
//   brand/wordmark-flat-purple.svg  wordmark-flat-cream.svg  wordmark-3d-on-light.svg  wordmark-3d-on-dark.svg
//   src/ui/wordmark-path.ts   (the flat wordmark the app's top bar inlines)
// The 3D versions are a shallow bevel: a lit face, side walls shaded by the direction each edge faces,
// a sheen and two soft shadows, like the app icon. The app icon (brand/icon-*.svg) is not generated.
// Run: node scripts/gen-brand.mjs        (needs opentype.js and @fontsource/dm-sans: see brand/README.md)
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';

// ---- the sliced A, in the icon's own geometry, y pointing down, baseline at y = 0 ----------------------------
const A_POLYS = [
  [
    [354.8, -166.6],
    [164.1, -166.6],
    [114.1, 0],
    [0, 0],
    [204.1, -680.2],
    [362.8, -561.2],
    [457.7, -244.6],
  ],
  [
    [197, -276],
    [334.2, -276],
    [265.6, -504.7],
  ],
  [
    [277.2, -663.2],
    [321.1, -700],
    [349.4, -609],
  ],
  [
    [417, 0],
    [375.7, -137.4],
    [489.9, -137.4],
    [531.1, 0],
  ],
];
const A_RIGHT = 531.1;
const CAP = 700;

// ---- "Frame" -------------------------------------------------------------------------------------------------
const buf = readFileSync('node_modules/@fontsource/dm-sans/files/dm-sans-latin-600-normal.woff');
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const SIZE = CAP / (font.tables.os2.sCapHeight / font.unitsPerEm);
const scale = SIZE / font.unitsPerEm;
const glyphs = [...'Frame'].map((c) => font.charToGlyph(c));
const F_STEM_LEFT = A_RIGHT + 78; // where the stem of the F starts: close, the A's right side is open at the top
const lsb = (glyphs[0].getBoundingBox().x1 ?? 0) * scale;
let pen = F_STEM_LEFT - lsb;

/** Curves become short straight segments, so every edge can be given its own wall. */
function flatten(commands) {
  const polys = [];
  let cur = [];
  let x = 0;
  let y = 0;
  const STEPS = 10;
  for (const c of commands) {
    if (c.type === 'M') {
      if (cur.length) polys.push(cur);
      cur = [[c.x, c.y]];
    } else if (c.type === 'L') cur.push([c.x, c.y]);
    else if (c.type === 'Q') {
      for (let i = 1; i <= STEPS; i += 1) {
        const t = i / STEPS;
        const m = 1 - t;
        cur.push([
          m * m * x + 2 * m * t * c.x1 + t * t * c.x,
          m * m * y + 2 * m * t * c.y1 + t * t * c.y,
        ]);
      }
    } else if (c.type === 'C') {
      for (let i = 1; i <= STEPS; i += 1) {
        const t = i / STEPS;
        const m = 1 - t;
        cur.push([
          m ** 3 * x + 3 * m * m * t * c.x1 + 3 * m * t * t * c.x2 + t ** 3 * c.x,
          m ** 3 * y + 3 * m * m * t * c.y1 + 3 * m * t * t * c.y2 + t ** 3 * c.y,
        ]);
      }
    } else if (c.type === 'Z') {
      if (cur.length) polys.push(cur);
      cur = [];
    }
    if (c.type !== 'Z') {
      x = c.x;
      y = c.y;
    }
  }
  if (cur.length) polys.push(cur);
  return polys.map((p) => {
    const first = p[0];
    const last = p[p.length - 1];
    return first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.01
      ? p.slice(0, -1)
      : p;
  });
}

const POLYS = [...A_POLYS.map((p) => p.map(([px, py]) => [px, py]))];
glyphs.forEach((g, i) => {
  POLYS.push(...flatten(g.getPath(pen, 0, SIZE).commands));
  const next = glyphs[i + 1];
  pen += (g.advanceWidth ?? 0) * scale + (next ? font.getKerningValue(g, next) * scale : 0);
});

const r1 = (n) => Math.round(n * 10) / 10;
const polyD = (p) => `M${p.map(([x, y]) => `${r1(x)} ${r1(y)}`).join(' L')} Z`;
const WORD_D = POLYS.map(polyD).join(' ');

// ---- the box around it -------------------------------------------------------------------------------------------
const xs = POLYS.flat().map((p) => p[0]);
const ys = POLYS.flat().map((p) => p[1]);
const minX = Math.min(...xs);
const maxX = Math.max(...xs);
const maxY = Math.max(...ys);
const vbX = Math.floor(minX - 90);
const vbY = -815;
const vbW = Math.ceil(maxX + 90 - vbX);
const vbH = Math.ceil(maxY + 176 - vbY);
const VIEWBOX = `${vbX} ${vbY} ${vbW} ${vbH}`;

const flat = (
  fill,
  title,
) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}" width="${Math.round(vbW / 2)}" height="${Math.round(vbH / 2)}">
  <title>${title}</title>
  <path d="${WORD_D}" fill="${fill}" fill-rule="evenodd"/>
</svg>
`;

// ---- the bevel ------------------------------------------------------------------------------------------------------
const OFF = [14, 22]; // how far the back of the letter sits behind the face: a short extrusion, down and a touch right
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));

function walls(shade, pre) {
  const out = [];
  const defs = [];
  let n = 0;
  for (const poly of POLYS) {
    let area = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      area += x0 * y1 - x1 * y0;
    }
    const sign = area > 0 ? 1 : -1;
    for (let i = 0; i < poly.length; i += 1) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      // Outward normal, then how much it faces the light (above and left).
      const nx = (sign * dy) / len;
      const ny = (-sign * dx) / len;
      const lit = Math.max(0, Math.min(1, 0.5 + 0.5 * (nx * -0.45 + ny * -0.9)));
      const [top, bottom] = shade(lit);
      const id = `${pre}w${n++}`;
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      defs.push(
        `    <linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${r1(mx)}" y1="${r1(my)}" x2="${r1(mx + OFF[0])}" y2="${r1(my + OFF[1])}"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`,
      );
      out.push(
        `    <path d="M${r1(x0)} ${r1(y0)} L${r1(x1)} ${r1(y1)} L${r1(x1 + OFF[0])} ${r1(y1 + OFF[1])} L${r1(x0 + OFF[0])} ${r1(y0 + OFF[1])} Z" fill="url(#${id})" stroke="url(#${id})" stroke-width="1.6" stroke-linejoin="round"/>`,
      );
    }
  }
  return { defs: defs.join('\n'), body: out.join('\n') };
}

function word3d(title, c, pre) {
  const w = walls(c.wall, pre);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}" width="${Math.round(vbW / 2)}" height="${Math.round(vbH / 2)}">
  <title>${title}</title>
  <defs>
    <linearGradient id="${pre}face" gradientUnits="userSpaceOnUse" x1="0" y1="-725" x2="0" y2="12">
      <stop offset="0" stop-color="${c.faceTop}"/><stop offset="0.55" stop-color="${c.faceMid}"/><stop offset="1" stop-color="${c.faceBottom}"/>
    </linearGradient>
    <linearGradient id="${pre}sheen" gradientUnits="userSpaceOnUse" x1="0" y1="-725" x2="0" y2="-356.5">
      <stop offset="0" stop-color="#fff" stop-opacity="${c.sheen}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="${pre}faceClip"><path fill-rule="evenodd" d="${WORD_D}"/></clipPath>
    <filter id="${pre}blur1" x="-10%" y="-40%" width="120%" height="190%"><feGaussianBlur stdDeviation="7"/></filter>
    <filter id="${pre}blur2" x="-10%" y="-60%" width="120%" height="240%"><feGaussianBlur stdDeviation="22"/></filter>
${w.defs}
  </defs>
  <g transform="translate(16 32)" opacity="${c.shadow2}" filter="url(#${pre}blur2)"><path fill="${c.shadowColor}" fill-rule="evenodd" d="${WORD_D}"/></g>
  <g transform="translate(5 11)" opacity="${c.shadow1}" filter="url(#${pre}blur1)"><path fill="${c.shadowColor}" fill-rule="evenodd" d="${WORD_D}"/></g>
  <g>
${w.body}
    <path d="${WORD_D}" fill="url(#${pre}face)" fill-rule="evenodd"/>
    <g clip-path="url(#${pre}faceClip)"><rect x="${vbX}" y="-745" width="${vbW}" height="777" fill="url(#${pre}sheen)"/></g>
  </g>
</svg>
`;
}

// On dark surfaces: a white face with lilac walls. On light surfaces: a purple face with deep-purple walls.
const ON_DARK = {
  faceTop: '#FFFFFF',
  faceMid: '#F1E9F8',
  faceBottom: '#D6C6EE',
  sheen: 0.5,
  shadowColor: '#0E0626',
  shadow2: 0.35,
  shadow1: 0.55,
  wall: (t) => [mix('#6a50c8', '#c4b4f0', t * t), mix('#3d2988', '#8a74d8', t * t)],
};
const ON_LIGHT = {
  faceTop: '#7A58CC',
  faceMid: '#5A3CA8',
  faceBottom: '#3B2475',
  sheen: 0.35,
  shadowColor: '#2A1757',
  shadow2: 0.22,
  shadow1: 0.32,
  wall: (t) => [mix('#3a2576', '#6f55b8', t * t), mix('#21124c', '#3b2878', t * t)],
};

const files = {
  'brand/wordmark-flat-purple.svg': flat('#432B78', 'AFrame wordmark - purple'),
  'brand/wordmark-flat-cream.svg': flat('#F3ECE2', 'AFrame wordmark - cream'),
  'brand/wordmark-3d-on-light.svg': word3d('AFrame wordmark - 3D (light)', ON_LIGHT, 'l_'),
  'brand/wordmark-3d-on-dark.svg': word3d('AFrame wordmark - 3D (dark)', ON_DARK, 'd_'),
};
for (const [path, text] of Object.entries(files)) writeFileSync(path, text);

writeFileSync(
  'src/ui/wordmark-path.ts',
  `// Generated by scripts/gen-brand.mjs: the flat AFrame wordmark (the logo's sliced A, then DM Sans SemiBold "Frame").
export const WORDMARK_VIEWBOX = '${VIEWBOX}';
export const WORDMARK_RATIO = ${(vbH / vbW).toFixed(5)};
export const WORDMARK_PATH =
  '${WORD_D}';
`,
);
console.log(
  `wrote ${Object.keys(files).length} SVGs and src/ui/wordmark-path.ts (viewBox ${VIEWBOX})`,
);
