---
name: color
description: Building palettes and applying colour in UI - neutrals, one accent, semantic colours, contrast, dark mode, gradients. Load when choosing or fixing colours.
---

# Colour

## The recipe (works almost every time)
1. **Neutrals do 90% of the work.** Pick a surface, a raised surface, a border, muted text, and text colour. Tint neutrals slightly warm or cool to match the brand (not pure grey, not #000/#FFF).
2. **One accent** (primary) for the main action, links, key highlights. Use it sparingly: < 10% of pixels.
3. **Semantic colours** only when meaning requires: success (green), warning (amber), error (red), info (blue). Keep them desaturated enough to sit next to the accent.
4. Optional **secondary accent** for charts/illustrations, never for buttons competing with the primary.
60-30-10 guide: 60% background/surface, 30% secondary surfaces/text, 10% accent.

## Starter palettes (tokens)
| Mood | surface | surface-2 | border | text | muted | primary |
|---|---|---|---|---|---|---|
| Warm editorial | #FAF9F5 | #FFFFFF | #E8E6DC | #1F1E1D | #6B6A65 | #C96442 |
| Clean tech | #FFFFFF | #F6F7F9 | #E5E7EB | #111827 | #6B7280 | #4F46E5 |
| Fresh | #F8FAF7 | #FFFFFF | #E2E8E0 | #14201A | #5F6F66 | #16A34A |
| Bold dark | #0F1115 | #171A21 | #272B35 | #F3F4F6 | #9CA3AF | #7C5CFF |
| Soft consumer | #FFF8F3 | #FFFFFF | #F0E4DA | #2B2220 | #7A6A63 | #F2603C |
Set them with `set_tokens { colors: { surface, surface2, border, text, muted, primary } }` and use `$name` everywhere.

## Making a scale from the accent
Hover = 8-10% darker; pressed = 14-16% darker; subtle background = accent at 8-12% opacity on surface; focus ring = accent at 40% opacity, 3px.
Text on accent: white if accent luminance is low enough for 4.5:1, otherwise near-black. Check; don't assume.

## Contrast (accessibility is also aesthetics)
- Body text vs background ≥ **4.5:1**; large text (≥24px, or ≥18.66px bold) ≥ 3:1; UI boundaries/icons ≥ 3:1.
- Light-grey-on-white placeholders and captions are the #1 failure. Muted text should be around #6B7280 or darker on white.
- Don't put coloured text on coloured backgrounds unless contrast is verified (`lint_design`).
- Never rely on colour alone (add icon/label/underline for errors, links, status).

## Dark mode
- Not inverted: use dark greys (#0F1115-#262624), not pure black; raise surfaces by *lightness*, not shadow.
- Reduce accent saturation slightly; increase text contrast but avoid pure white (#F3F4F6).
- Borders carry more weight in dark UIs (1px, 8-12% white).

## Gradients and effects
- Use subtle, same-hue gradients (hue shift ≤ 30°) for hero backgrounds or buttons; avoid rainbow gradients.
- Gradient text and glow effects: sparingly, only for one hero element.
- Shadows: soft and low opacity (`0 1px 2px rgba(0,0,0,.06), 0 8px 24px rgba(0,0,0,.08)`); tint with the surface hue.

## Data/chart colours
Use a sequential single-hue scale for magnitude, diverging for +/-, and ≤ 6 categorical colours with sufficient lightness differences (colour-blind safe: avoid red/green pairs alone; vary lightness).

## Common mistakes
- Many saturated colours competing; the accent used on everything.
- Pure black text on pure white (harsh); pure grey neutrals (dead).
- Low-contrast ghost buttons; disabled style that looks like normal text.
- Using the error red as a brand colour (reads as danger).

## Quick fix checklist
1. Reduce to neutrals + one accent. 2. Tint neutrals. 3. Check contrast. 4. Make the primary button the only solid-accent element in its area. 5. Replace hard-coded hexes with tokens.
