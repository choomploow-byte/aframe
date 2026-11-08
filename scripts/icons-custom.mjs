// Icons AFrame draws itself, for things Font Awesome Free does not have (a sword, a potion, a chest).
// Original artwork, released under the project's MIT licence. Same 512 x 512 grid and solid style as
// the Font Awesome set so the two read as one family. Shapes are built from simple geometry; see EVENODD
// below for which ones are drawn with holes.

const r1 = (n) => Math.round(n * 10) / 10;

function rotate([x, y], deg, [cx, cy]) {
  const a = (deg * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
}

const poly = (points) => `M${points.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}Z`;

const rectPts = (x, y, w, h) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

const circle = (cx, cy, r) =>
  `M${r1(cx - r)} ${r1(cy)}a${r} ${r} 0 1 1 ${r * 2} 0a${r} ${r} 0 1 1 ${-r * 2} 0Z`;

/** An upright sword, tip up, about the centre of the 512 grid, as a list of path strings. */
function swordParts({ scale = 1, deg = 0, at = [256, 256] }) {
  const place = (p) => {
    const s = [256 + (p[0] - 256) * scale, 256 + (p[1] - 256) * scale];
    const t = rotate(s, deg, [256, 256]);
    return [t[0] + (at[0] - 256), t[1] + (at[1] - 256)];
  };
  const shape = (pts) => poly(pts.map(place));
  const ball = (cx, cy, r) => {
    const [x, y] = place([cx, cy]);
    return circle(x, y, r * scale);
  };
  const parts = [
    shape([
      [256, 10],
      [292, 62],
      [292, 312],
      [220, 312],
      [220, 62],
    ]),
    shape(rectPts(136, 324, 240, 32)),
    shape(rectPts(238, 368, 36, 68)),
    ball(256, 462, 26),
  ];
  return parts;
}

function star4(cx, cy, R, inner = 0.26) {
  const r = R * inner;
  return poly([
    [cx, cy - R],
    [cx + r, cy - r],
    [cx + R, cy],
    [cx + r, cy + r],
    [cx, cy + R],
    [cx - r, cy + r],
    [cx - R, cy],
    [cx - r, cy - r],
  ]);
}

export const CUSTOM_ICONS = {
  sword: {
    category: 'game',
    tags: 'weapon blade attack fight melee',
    d: swordParts({ deg: 45, scale: 1.28 }).join(''),
  },
  swords: {
    category: 'game',
    tags: 'crossed weapons battle fight pvp versus arena',
    d: [...swordParts({ deg: 45, scale: 1.12 }), ...swordParts({ deg: -45, scale: 1.12 })].join(''),
  },
  potion: {
    category: 'game',
    tags: 'flask bottle elixir health mana heal drink',
    d: [
      // cork, lip, then neck and round body as one outline
      poly(rectPts(228, 28, 56, 48)),
      poly(rectPts(204, 84, 104, 28)),
      'M226 122H286V199.3A138 138 0 1 1 226 199.3Z',
      // the liquid line and two bubbles are holes
      poly(rectPts(140, 306, 232, 16)),
      circle(212, 376, 15),
      circle(304, 398, 10),
    ].join(''),
  },
  chest: {
    category: 'game',
    tags: 'treasure loot box reward crate storage',
    d: [
      'M56 430V196A200 100 0 0 1 456 196V430Z',
      poly(rectPts(56, 226, 400, 14)), // the seam between lid and base
      poly(rectPts(116, 128, 14, 302)), // straps
      poly(rectPts(382, 128, 14, 302)),
      circle(256, 290, 22), // keyhole
      poly(rectPts(247, 300, 18, 64)),
    ].join(''),
  },
  sparkles: {
    category: 'game',
    tags: 'magic shine glitter new special effect stars',
    d: [star4(212, 276, 190), star4(404, 118, 78), star4(412, 392, 62)].join(''),
  },
};

/**
 * Icons drawn with holes (shapes inside shapes) use the even-odd rule. The swords overlap on purpose
 * and are wound the same way so they merge (non-zero rule).
 */
export const EVENODD = new Set(['potion', 'chest', 'sparkles']);
