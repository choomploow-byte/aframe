import type { NodePropKey, NodeType } from './types';

/**
 * Which properties apply to which node types (docs/04 Phase 1 decision 9). Single source for
 * validation, normalisation and the tool schemas; adding a node property means touching this
 * list (see the "If you change X, also change Y" table in docs/20).
 */
export const COMMON_PROPS = [
  'name',
  'x',
  'y',
  'w',
  'h',
  'rotation',
  'flipX',
  'flipY',
  'visible',
  'locked',
  'opacity',
  'fill',
  'stroke',
  'strokeWidth',
  'strokeAlign',
  'radius',
  'shadow',
  'blur',
  'backdropBlur',
  'hue',
  'saturation',
  'brightness',
  'contrast',
  'blendMode',
  'effects',
  'role',
  'href',
  'props',
] as const satisfies readonly NodePropKey[];

export const FRAME_PROPS = [
  'layout',
  'gap',
  'padding',
  'align',
  'justify',
  'wrap',
  'clip',
] as const satisfies readonly NodePropKey[];

export const TEXT_PROPS = [
  'text',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'color',
  'textTransform',
  'textStroke',
  'textStrokeWidth',
] as const satisfies readonly NodePropKey[];

export const IMAGE_PROPS = ['assetId', 'fit', 'tileSize'] as const satisfies readonly NodePropKey[];

/** `color` is the icon's ink, like text colour. */
export const ICON_PROPS = ['icon', 'color'] as const satisfies readonly NodePropKey[];

/** A master has `component`; an instance has `instanceOf` (and its `state` and `overrides`). Frames only. */
export const COMPONENT_PROPS = [
  'component',
  'instanceOf',
  'state',
  'overrides',
] as const satisfies readonly NodePropKey[];

/** Properties that must always have a value, so `null` ("remove") is rejected for them. */
export const REQUIRED_PROPS: ReadonlySet<string> = new Set([
  'name',
  'x',
  'y',
  'w',
  'h',
  'visible',
  'locked',
  'opacity',
  'text',
]);

export function propsFor(type: NodeType): readonly string[] {
  switch (type) {
    case 'page':
      // The page is only a container; it keeps the base geometry/visibility keys the schema stores.
      return ['name', 'x', 'y', 'w', 'h', 'visible', 'locked', 'opacity'];
    case 'frame':
      return [...COMMON_PROPS, ...FRAME_PROPS, ...COMPONENT_PROPS];
    case 'text':
      return [...COMMON_PROPS, ...TEXT_PROPS];
    case 'image':
      return [...COMMON_PROPS, ...IMAGE_PROPS];
    case 'icon':
      return [...COMMON_PROPS, ...ICON_PROPS];
    case 'rect':
    case 'ellipse':
    case 'line':
      return COMMON_PROPS;
  }
}

/** Which node types a property belongs to, for hints ("`fontSize` only applies to text nodes"). */
export function ownersOf(prop: string): string | null {
  if ((FRAME_PROPS as readonly string[]).includes(prop)) return 'frame';
  if ((COMPONENT_PROPS as readonly string[]).includes(prop)) return 'frame';
  if (prop === 'color') return 'text and icon';
  if ((ICON_PROPS as readonly string[]).includes(prop)) return 'icon';
  if ((TEXT_PROPS as readonly string[]).includes(prop)) return 'text';
  if ((IMAGE_PROPS as readonly string[]).includes(prop)) return 'image';
  return null;
}

export const NODE_TYPES: readonly NodeType[] = [
  'page',
  'frame',
  'rect',
  'ellipse',
  'line',
  'text',
  'image',
  'icon',
];
export const CREATABLE_TYPES: readonly NodeType[] = [
  'frame',
  'rect',
  'ellipse',
  'line',
  'text',
  'image',
  'icon',
];
export const CONTAINER_TYPES: readonly NodeType[] = ['page', 'frame'];
