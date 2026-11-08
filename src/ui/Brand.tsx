import type { CSSProperties } from 'react';
import { WORDMARK_PATH, WORDMARK_RATIO, WORDMARK_VIEWBOX } from './wordmark-path';

/**
 * The AFrame brand marks. Masters live in /brand; web copies in /public/brand.
 * - LogoMark: the 3D app icon (flat enough to read at 20px).
 * - Wordmark: flat "AFrame" lettering (a custom A, then DM Sans SemiBold); takes its colour from --wordmark.
 * - Wordmark3D: the lit 3D wordmark, one image per theme (swapped by brand.css).
 */

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <img
      className="logo-mark"
      src="/brand/icon-3d.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

export function Wordmark({ height = 15, label = 'AFrame' }: { height?: number; label?: string }) {
  const style: CSSProperties = { height, width: 'auto' };
  return (
    <svg
      className="wordmark"
      viewBox={WORDMARK_VIEWBOX}
      style={style}
      role="img"
      aria-label={label}
    >
      <path d={WORDMARK_PATH} fillRule="evenodd" />
    </svg>
  );
}

export function Wordmark3D({ width = 200 }: { width?: number }) {
  const h = Math.round(width * WORDMARK_RATIO);
  return (
    <span className="wordmark3d" role="img" aria-label="AFrame" style={{ width, height: h }}>
      <img
        className="wordmark3d__img wordmark3d__img--on-light"
        src="/brand/wordmark-3d-on-light.png"
        width={width}
        height={h}
        alt=""
        draggable={false}
      />
      <img
        className="wordmark3d__img wordmark3d__img--on-dark"
        src="/brand/wordmark-3d-on-dark.png"
        width={width}
        height={h}
        alt=""
        draggable={false}
      />
    </span>
  );
}
