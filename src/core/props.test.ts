import { describe, expect, it } from 'vitest';
import {
  COMMON_PROPS,
  COMPONENT_PROPS,
  FRAME_PROPS,
  ICON_PROPS,
  IMAGE_PROPS,
  NODE_TYPES,
  ownersOf,
  propsFor,
  TEXT_PROPS,
} from './props';
import type { NodePropKey } from './types';
import { propIssues } from './validate';

// Compile-time exhaustiveness: adding or removing a key on `Node` breaks this literal until the
// property tables (props.ts), validators (validate.ts), tool schemas (tools.ts) and `nodeToCss`
// are reviewed together (docs/20: "If you change X, also change Y").
const ALL_PROPS: Record<NodePropKey, true> = {
  name: true,
  x: true,
  y: true,
  w: true,
  h: true,
  rotation: true,
  flipX: true,
  flipY: true,
  visible: true,
  locked: true,
  opacity: true,
  fill: true,
  stroke: true,
  strokeWidth: true,
  strokeAlign: true,
  radius: true,
  shadow: true,
  blur: true,
  backdropBlur: true,
  hue: true,
  saturation: true,
  brightness: true,
  contrast: true,
  blendMode: true,
  effects: true,
  layout: true,
  gap: true,
  padding: true,
  align: true,
  justify: true,
  wrap: true,
  clip: true,
  text: true,
  fontFamily: true,
  fontSize: true,
  fontWeight: true,
  lineHeight: true,
  letterSpacing: true,
  textAlign: true,
  color: true,
  textTransform: true,
  textStroke: true,
  textStrokeWidth: true,
  textStyle: true,
  assetId: true,
  fit: true,
  tileSize: true,
  icon: true,
  component: true,
  instanceOf: true,
  state: true,
  overrides: true,
  role: true,
  href: true,
  props: true,
};

describe('property tables', () => {
  it('cover every node property exactly once', () => {
    // `color` is shared by text and icons, so it is listed once (with the text properties).
    const listed = [
      ...COMMON_PROPS,
      ...FRAME_PROPS,
      ...COMPONENT_PROPS,
      ...TEXT_PROPS,
      ...IMAGE_PROPS,
      ...ICON_PROPS.filter((p) => p !== 'color'),
    ];
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(Object.keys(ALL_PROPS).sort());
  });

  it('give every property a validator (no "Unknown property" for any listed key)', () => {
    for (const type of NODE_TYPES) {
      for (const key of propsFor(type)) {
        const issues = propIssues({ [key]: { notAValue: true } }, type);
        expect(issues.map((i) => i.message).join(), `${type}.${key}`).not.toMatch(
          /Unknown property/,
        );
      }
    }
  });

  it('knows which node type owns type-specific properties', () => {
    expect(ownersOf('layout')).toBe('frame');
    expect(ownersOf('fontSize')).toBe('text');
    expect(ownersOf('fit')).toBe('image');
    expect(ownersOf('fill')).toBeNull();
  });

  it('applies the right set per node type', () => {
    expect(propsFor('rect')).toEqual(COMMON_PROPS);
    expect(propsFor('frame')).toContain('layout');
    expect(propsFor('frame')).not.toContain('text');
    expect(propsFor('text')).toContain('fontSize');
    expect(propsFor('text')).not.toContain('layout');
    expect(propsFor('image')).toContain('assetId');
    expect(propsFor('page')).toEqual(['name', 'x', 'y', 'w', 'h', 'visible', 'locked', 'opacity']);
  });
});
