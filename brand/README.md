# AFrame brand assets

The mark is the sliced, lit "A" (the icon files are the original artwork and are not generated).
The wordmark is that A followed by "Frame". `node scripts/gen-brand.mjs` writes the wordmark SVGs (and
`src/ui/wordmark-path.ts`, the flat wordmark the app's top bar inlines), `node scripts/render-brand.mjs`
renders the wordmark PNGs, and `node scripts/render-promo.mjs` redraws the promo cards.

| File | Use |
|---|---|
| `icon-3d.svg` | The app icon: rounded tile, lit and extruded mark. Source of `app-icon.png` and `public/brand/icon-3d.svg` |
| `icon-3d-square.svg` | Full-bleed version for stores that apply their own corner rounding |
| `icon-flat.svg` | Flat mark for tiny sizes; the favicon (`public/favicon.svg`) |
| `wordmark-flat-purple.svg` / `-cream.svg` | Flat "AFrame" lettering for light / dark surfaces |
| `wordmark-3d-on-light.svg` / `-on-dark.svg` | Lit 3D lettering; PNG renders are in `public/brand/` and `site/img/` |
| `promo/` | The 1200x630 and square promo cards (`promo.html` is their source) |

Colours: deep purple `#432B78`, UI accent `#5B3CB0` (dark theme `#8A6EE0`), frame lavender `#A57BFF`,
cream `#F3ECE2`. Typeface of the wordmark: DM Sans SemiBold (SIL OFL) after a custom A, outlined to paths,
so no font is needed to show it.

The desktop icons come from `app-icon.png` (the rendered `icon-3d.svg`): to change them run
`npx tauri icon app-icon.png` and delete the `android/` and `ios/` folders it creates under
`src-tauri/icons/` (the app is desktop only). `opentype.js` and `@fontsource/dm-sans` are only needed to
regenerate (install the latter with `npm i --no-save @fontsource/dm-sans`).

Name check before you commit to it publicly: "A-Frame" (aframe.io) is a well-known WebXR framework
with an npm package called `aframe`. The npm package here is `aframe-mcp`; check that it is free and
that the overlap in search results is acceptable.
