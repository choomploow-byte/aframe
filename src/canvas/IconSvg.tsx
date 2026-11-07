import { createElement, memo } from 'react';
import { iconArt } from './icon-art';

/** The SVG inside an icon node. Draws with `currentColor`, which the node's CSS sets from its colour. */
export const IconSvg = memo(function IconSvg({
  name,
  w,
  h,
}: {
  name: string | undefined;
  w: number | 'hug' | 'fill';
  h: number | 'hug' | 'fill';
}) {
  const art = iconArt(name, w, h);
  return (
    <svg
      viewBox={art.viewBox}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
      data-icon={art.placeholder ? undefined : name}
      data-placeholder={art.placeholder ? 'true' : undefined}
      style={{ display: 'block', width: '100%', height: '100%', overflow: 'visible' }}
    >
      {art.parts.map((p, i) =>
        createElement(
          p.tag,
          { key: i, ...Object.fromEntries(Object.entries(p.attrs).map(([k, v]) => [camel(k), v])) },
          p.text,
        ),
      )}
    </svg>
  );
});

/** SVG attributes React wants in camelCase (`stroke-width` -> `strokeWidth`). */
const camel = (attr: string): string =>
  attr.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
