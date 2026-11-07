/**
 * What an icon node draws, as plain data, so the live canvas (React) and the screenshot renderer
 * (plain DOM) paint exactly the same thing. A known icon is one path filled with `currentColor`; an
 * unknown name draws a labelled placeholder (never a blank coloured square, docs/04 "Icons").
 */
import { iconShape } from '@core/icons';

export interface SvgPart {
  tag: 'path' | 'rect' | 'text';
  attrs: Record<string, string>;
  /** Text content, for `text`. */
  text?: string;
}

export interface IconArt {
  viewBox: string;
  placeholder: boolean;
  parts: SvgPart[];
}

/** Placeholders show the requested name once there is room for it. */
const LABEL_MIN_PX = 44;
const LABEL_MAX_CHARS = 10;

export function iconArt(
  name: string | undefined,
  width: number | 'hug' | 'fill',
  height: number | 'hug' | 'fill',
): IconArt {
  const shape = iconShape(name);
  if (shape) {
    return {
      viewBox: `0 0 ${shape.vb[0]} ${shape.vb[1]}`,
      placeholder: false,
      parts: [
        {
          tag: 'path',
          attrs: {
            d: shape.d,
            fill: 'currentColor',
            ...(shape.rule === 'evenodd' ? { 'fill-rule': 'evenodd' } : {}),
          },
        },
      ],
    };
  }
  const room =
    typeof width === 'number' &&
    typeof height === 'number' &&
    Math.min(width, height) >= LABEL_MIN_PX;
  const label = (name ?? 'no name').trim() || 'no name';
  const shown = label.length > LABEL_MAX_CHARS ? `${label.slice(0, LABEL_MAX_CHARS - 1)}…` : label;
  const parts: SvgPart[] = [
    {
      tag: 'rect',
      attrs: {
        x: '4',
        y: '4',
        width: '56',
        height: '56',
        rx: '9',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '3',
        'stroke-dasharray': '6 4',
      },
    },
    {
      tag: 'text',
      attrs: {
        x: '32',
        y: room ? '34' : '42',
        'text-anchor': 'middle',
        'font-size': room ? '26' : '34',
        'font-weight': '700',
        'font-family': 'system-ui, sans-serif',
        fill: 'currentColor',
      },
      text: '?',
    },
  ];
  if (room) {
    parts.push({
      tag: 'text',
      attrs: {
        x: '32',
        y: '52',
        'text-anchor': 'middle',
        'font-size': '9',
        'font-weight': '600',
        'font-family': 'system-ui, sans-serif',
        fill: 'currentColor',
      },
      text: shown,
    });
  }
  return { viewBox: '0 0 64 64', placeholder: true, parts };
}
