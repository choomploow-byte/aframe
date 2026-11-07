import type { CSSProperties } from 'react';

/**
 * The Atelier brand marks. Masters live in /brand; web copies in /public/brand.
 * - LogoMark: the 3D app icon (flat enough to read at 20px).
 * - Wordmark: flat "Atelier" lettering with the sliced A; takes its colour from --wordmark.
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

const WORDMARK_VIEWBOX = '-80 -880 3186 980';
const WORDMARK_PATH =
  'M354.8 166.6 L457.7 244.6 L362.8 561.2 L204.1 680.2 L0 0 L114.1 0 L164.1 166.6 Z M197 276 L265.6 504.7 L334.2 276 Z M277.2 663.2 L321.1 700 L349.4 609 Z M417 0 L531.1 0 L489.9 137.4 L375.7 137.4 Z M842.1 0Q791.1 0 753.6 16Q716.1 32 695.1 69Q674.1 106 674.1 169V403H588.1V504H674.1L688.1 637H794.1V504H931.1V403H794.1V169Q794.1 131 810.6 116.5Q827.1 102 866.1 102H928.1V0Z M1270.1 -12Q1195.1 -12 1138.1 20.5Q1081.1 53 1049.1 112Q1017.1 171 1017.1 248Q1017.1 328 1048.6 388Q1080.1 448 1137.6 482Q1195.1 516 1271.1 516Q1345.1 516 1400.1 483Q1455.1 450 1485.1 394.5Q1515.1 339 1515.1 270V248Q1515.1 236 1513.1 223H1135.1Q1138.1 185 1153.1 156Q1170.1 122 1200.6 104.5Q1231.1 87 1269.1 87Q1311.1 87 1338.6 105Q1366.1 123 1379.1 153H1501.1Q1487.1 106 1455.1 68.5Q1423.1 31 1376.1 9.5Q1329.1 -12 1270.1 -12ZM1137.1 300H1394.1Q1392.1 355 1357.1 386.5Q1322.1 418 1270.1 418Q1233.1 418 1202.1 401Q1171.1 384 1153.1 351Q1141.1 329 1137.1 300Z M1616.1 0V720H1736.1V0Z M1865.1 0V504H1985.1V0ZM1925.1 584Q1892.1 584 1870.6 604.5Q1849.1 625 1849.1 655Q1849.1 686 1870.6 705.5Q1892.1 725 1925.1 725Q1958.1 725 1979.6 705.5Q2001.1 686 2001.1 655Q2001.1 625 1979.6 604.5Q1958.1 584 1925.1 584Z M2350.1 -12Q2275.1 -12 2218.1 20.5Q2161.1 53 2129.1 112Q2097.1 171 2097.1 248Q2097.1 328 2128.6 388Q2160.1 448 2217.6 482Q2275.1 516 2351.1 516Q2425.1 516 2480.1 483Q2535.1 450 2565.1 394.5Q2595.1 339 2595.1 270V248Q2595.1 236 2593.1 223H2215.1Q2218.1 185 2233.1 156Q2250.1 122 2280.6 104.5Q2311.1 87 2349.1 87Q2391.1 87 2418.6 105Q2446.1 123 2459.1 153H2581.1Q2567.1 106 2535.1 68.5Q2503.1 31 2456.1 9.5Q2409.1 -12 2350.1 -12ZM2217.1 300H2474.1Q2472.1 355 2437.1 386.5Q2402.1 418 2350.1 418Q2313.1 418 2282.1 401Q2251.1 384 2233.1 351Q2221.1 329 2217.1 300Z M2696.1 0V504H2803.1L2814.1 410Q2832.1 443 2859.1 466.5Q2886.1 490 2922.6 503Q2959.1 516 3003.1 516V389H2961.1Q2931.1 389 2904.1 381.5Q2877.1 374 2857.6 357.5Q2838.1 341 2827.1 312.5Q2816.1 284 2816.1 241V0Z';

export function Wordmark({ height = 15, label = 'Atelier' }: { height?: number; label?: string }) {
  const style: CSSProperties = { height, width: 'auto' };
  return (
    <svg
      className="wordmark"
      viewBox={WORDMARK_VIEWBOX}
      style={style}
      role="img"
      aria-label={label}
    >
      <g transform="scale(1 -1)" fillRule="evenodd">
        <path d={WORDMARK_PATH} />
      </g>
    </svg>
  );
}

export function Wordmark3D({ width = 200 }: { width?: number }) {
  const h = Math.round((width * 739) / 2400);
  return (
    <span className="wordmark3d" role="img" aria-label="Atelier" style={{ width, height: h }}>
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
