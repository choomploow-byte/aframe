import { sampleDoc } from '@core/testing';
import { describe, expect, it } from 'vitest';
import {
  bottom,
  centerX,
  centerY,
  containsPoint,
  equalRects,
  intersects,
  rectFromPoints,
  right,
  round2,
  translate,
  unionRects,
} from './geometry';
import { chainTo, depthOf, enterTarget, pickTarget } from './pick';
import { snapMove } from './snapping';
import {
  clampZoom,
  fitRect,
  MAX_ZOOM,
  MIN_ZOOM,
  nextZoomStep,
  panBy,
  screenToWorld,
  wheelZoomFactor,
  worldToScreen,
  zoomAt,
} from './viewport';

describe('geometry', () => {
  it('basic accessors and construction', () => {
    const r = { x: 10, y: 20, w: 100, h: 50 };
    expect([right(r), bottom(r), centerX(r), centerY(r)]).toEqual([110, 70, 60, 45]);
    expect(rectFromPoints({ x: 50, y: 40 }, { x: 10, y: 80 })).toEqual({
      x: 10,
      y: 40,
      w: 40,
      h: 40,
    });
    expect(translate(r, 5, -5)).toEqual({ x: 15, y: 15, w: 100, h: 50 });
  });

  it('union, intersection and containment', () => {
    expect(unionRects([])).toBeNull();
    expect(
      unionRects([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 20, y: 5, w: 10, h: 30 },
      ]),
    ).toEqual({ x: 0, y: 0, w: 30, h: 35 });
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(intersects(a, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(intersects(a, { x: 10, y: 0, w: 5, h: 5 })).toBe(true); // touching counts
    expect(intersects(a, { x: 11, y: 0, w: 5, h: 5 })).toBe(false);
    expect(containsPoint(a, { x: 10, y: 10 })).toBe(true);
    expect(containsPoint(a, { x: 10.1, y: 5 })).toBe(false);
  });

  it('compares rects with a tolerance and rounds coordinates', () => {
    expect(equalRects({ x: 0, y: 0, w: 1, h: 1 }, { x: 0.005, y: 0, w: 1, h: 1 })).toBe(true);
    expect(equalRects({ x: 0, y: 0, w: 1, h: 1 }, { x: 0.5, y: 0, w: 1, h: 1 })).toBe(false);
    expect(equalRects(undefined, undefined)).toBe(true);
    expect(equalRects({ x: 0, y: 0, w: 1, h: 1 }, undefined)).toBe(false);
    expect(round2(1.23456)).toBe(1.23);
  });
});

describe('viewport', () => {
  const vp = { x: 100, y: 50, zoom: 2 };

  it('converts between screen and world and back', () => {
    expect(screenToWorld(vp, { x: 300, y: 150 })).toEqual({ x: 100, y: 50 });
    const p = { x: 123.4, y: -56.7 };
    const back = screenToWorld(vp, worldToScreen(vp, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it('zooms around a point that stays put under the cursor', () => {
    const anchor = { x: 400, y: 300 };
    const before = screenToWorld(vp, anchor);
    for (const z of [0.5, 1, 3.7, 20]) {
      const next = zoomAt(vp, z, anchor);
      const after = screenToWorld(next, anchor);
      expect(after.x).toBeCloseTo(before.x, 9);
      expect(after.y).toBeCloseTo(before.y, 9);
      expect(next.zoom).toBe(z);
    }
  });

  it('clamps zoom and pans', () => {
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(zoomAt(vp, 1e9, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
    expect(panBy(vp, -10, 5)).toEqual({ x: 90, y: 55, zoom: 2 });
  });

  it('wheel zoom is symmetric and bounded', () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(40) * wheelZoomFactor(-40)).toBeCloseTo(1, 9);
    expect(wheelZoomFactor(1e6)).toBe(wheelZoomFactor(300));
  });

  it('steps through zoom stops', () => {
    expect(nextZoomStep(1, 1)).toBe(1.5);
    expect(nextZoomStep(1, -1)).toBe(0.75);
    expect(nextZoomStep(1.2, 1)).toBe(1.5);
    expect(nextZoomStep(1.2, -1)).toBe(1);
    expect(nextZoomStep(64, 1)).toBe(64);
    expect(nextZoomStep(0.05, -1)).toBe(MIN_ZOOM);
  });

  it('fits a rect into the view, centred, never over maxZoom', () => {
    const view = { w: 1000, h: 800 };
    const vpFit = fitRect({ x: 0, y: 0, w: 2000, h: 1000 }, view, { padding: 0 });
    expect(vpFit.zoom).toBeCloseTo(0.5, 9);
    // The centre of the rect lands in the centre of the view.
    const c = worldToScreen(vpFit, { x: 1000, y: 500 });
    expect(c.x).toBeCloseTo(500, 9);
    expect(c.y).toBeCloseTo(400, 9);
    expect(fitRect({ x: 0, y: 0, w: 10, h: 10 }, view).zoom).toBe(2);
    expect(
      fitRect({ x: 0, y: 0, w: 0, h: 0 }, { w: 10, h: 10 }, { padding: 100 }).zoom,
    ).toBeGreaterThan(0);
  });
});

describe('snapMove', () => {
  const targets = [{ x: 100, y: 100, w: 200, h: 100 }];

  it('snaps edges and centres within the threshold, and reports guides', () => {
    // Moving box's left edge is 3 away from the target's left edge (100).
    const moving = { x: 97, y: 400, w: 50, h: 50 };
    const res = snapMove(moving, targets, 6);
    expect(res.dx).toBe(3);
    expect(res.dy).toBe(0);
    expect(res.guides.map((g) => g.axis)).toEqual(['x']);
    expect(res.guides[0]).toMatchObject({ axis: 'x', at: 100, from: 100, to: 450 });
  });

  it('snaps centres to centres', () => {
    const moving = { x: 175, y: 300, w: 50, h: 40 }; // centre x = 200, target centre x = 200
    const res = snapMove(moving, targets, 6);
    expect(res.dx).toBe(0);
    expect(res.guides.some((g) => g.axis === 'x' && g.at === 200)).toBe(true);
  });

  it('picks the closest of several candidates, independently per axis', () => {
    const moving = { x: 301, y: 94, w: 20, h: 20 }; // left near target right (300); top near target top (100)
    const res = snapMove(moving, targets, 6);
    expect(res.dx).toBe(-1);
    expect(res.dy).toBe(-4); // the box centre (104) is closer to the target top (100) than its own top (94)
    expect(res.guides.map((g) => g.axis).sort()).toEqual(['x', 'y']);
  });

  it('does nothing outside the threshold or without targets', () => {
    expect(snapMove({ x: 0, y: 0, w: 10, h: 10 }, targets, 6)).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
    });
    expect(snapMove({ x: 0, y: 0, w: 10, h: 10 }, [], 6)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('shows a guide when already aligned (no correction needed)', () => {
    const res = snapMove({ x: 100, y: 400, w: 30, h: 30 }, targets, 6);
    expect(res.dx).toBe(0);
    expect(res.guides.some((g) => g.axis === 'x' && g.at === 100)).toBe(true);
  });

  it('draws each guide once even when several targets line up', () => {
    const two = [
      { x: 100, y: 0, w: 50, h: 50 },
      { x: 100, y: 300, w: 80, h: 50 },
    ];
    const res = snapMove({ x: 98, y: 150, w: 40, h: 40 }, two, 6);
    const lefts = res.guides.filter((g) => g.axis === 'x' && g.at === 100);
    expect(lefts).toHaveLength(1);
    expect(lefts[0]).toMatchObject({ from: 0, to: 350 });
  });
});

describe('picking', () => {
  const nodes = sampleDoc().nodes;

  it('computes depth below the page and the chain from the artboard', () => {
    expect(depthOf(nodes, 'n_frame')).toBe(0);
    expect(depthOf(nodes, 'n_row1')).toBe(1);
    expect(depthOf(nodes, 'n_recta')).toBe(2);
    expect(chainTo(nodes, 'n_recta')).toEqual(['n_frame', 'n_row1', 'n_recta']);
    expect(chainTo(nodes, 'n_page1')).toEqual([]);
    expect(chainTo(nodes, 'n_gone1')).toEqual([]);
  });

  const chain = ['n_frame', 'n_row1', 'n_recta'];

  it('with nothing selected, picks the artboard child; a lone artboard picks itself', () => {
    expect(pickTarget({ chain, selected: [], nodes })).toBe('n_row1');
    expect(pickTarget({ chain: ['n_other'], selected: [], nodes })).toBe('n_other');
    expect(pickTarget({ chain: [], selected: [], nodes })).toBeNull();
  });

  it('keeps clicking at the depth of the current selection', () => {
    expect(pickTarget({ chain, selected: ['n_title'], nodes })).toBe('n_row1');
    expect(pickTarget({ chain, selected: ['n_recta'], nodes })).toBe('n_recta');
    // A selected artboard behaves like depth 1, so its children stay clickable.
    expect(pickTarget({ chain, selected: ['n_frame'], nodes })).toBe('n_row1');
  });

  it('ctrl/cmd-click goes straight to the deepest node', () => {
    expect(pickTarget({ chain, selected: [], nodes, deep: true })).toBe('n_recta');
  });

  it('double-click enters one level at a time', () => {
    expect(enterTarget({ chain, selected: ['n_frame'] })).toBe('n_row1');
    expect(enterTarget({ chain, selected: ['n_row1'] })).toBe('n_recta');
    expect(enterTarget({ chain, selected: ['n_recta'] })).toBe('n_recta');
    expect(enterTarget({ chain, selected: [] })).toBe('n_row1');
    expect(enterTarget({ chain, selected: ['n_other'] })).toBe('n_row1');
    expect(enterTarget({ chain: [], selected: [] })).toBeNull();
  });
});
