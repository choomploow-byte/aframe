# Atelier brand assets

Masters (SVG, 800x800 icons; wordmarks are outlined paths, no font needed):

| File | Use |
|---|---|
| `icon-3d.svg` | The app icon: rounded tile, 3D lit "A". Source of `app-icon.png` and `public/brand/icon-3d.svg` |
| `icon-3d-square.svg` | Full-bleed version for stores that apply their own corner rounding |
| `icon-flat.svg` | Flat mark for tiny sizes; the favicon (`public/favicon.svg`) |
| `wordmark-flat-purple.svg` / `-cream.svg` | Flat "Atelier" lettering for light / dark surfaces (inlined in `src/ui/Brand.tsx`) |
| `wordmark-3d-on-light.svg` / `-on-dark.svg` | Lit 3D lettering; PNG renders are in `public/brand/` |

Colours: deep purple `#432B78`, UI accent `#5B3CB0` (dark theme `#8A6EE0`), cream `#F3ECE2`.
Typeface of the wordmark: DM Sans SemiBold (SIL OFL) with a custom sliced "A".

Regenerate the desktop icons after changing `icon-3d.svg`: render it to a 1024x1024 transparent PNG
at `app-icon.png`, then run `npx tauri icon app-icon.png` and delete the `android/` and `ios/` folders
it creates under `src-tauri/icons/` (the app is desktop only).
