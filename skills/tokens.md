---
name: tokens
description: Creating and using design tokens (colours, fonts, spacing, radii) in Atelier, extracting a design system from an existing design, and mapping tokens to exported code.
---

# Tokens

## Why
Tokens make a design coherent, editable (change `$primary` once), and exportable (CSS variables / Tailwind theme). Always establish tokens **before** restyling many nodes.

## Standard token set
```json
{ "colors": {
    "surface": "#FAF9F5", "surface2": "#FFFFFF", "border": "#E8E6DC",
    "text": "#1F1E1D", "muted": "#6B6A65",
    "primary": "#C96442", "primaryHover": "#B4573A", "onPrimary": "#FFFFFF",
    "success": "#2E7D5B", "warning": "#B7791F", "danger": "#C0392B"
  },
  "fonts": { "heading": "Fraunces", "body": "Inter", "mono": "JetBrains Mono" },
  "spacing": [4, 8, 12, 16, 24, 32, 48, 64, 96],
  "radii": { "sm": 6, "md": 10, "lg": 16, "xl": 24, "full": 999 } }
```
Reference as `$surface`, `$font.heading`, `$radius.md` in node props (`fill`, `stroke`, `color`, `fontFamily`, `radius`). Spacing values are used directly as numbers from the scale.

## Naming
Role-based, not value-based: `primary`, `surface`, `muted`, not `orange`, `grey200`. Avoid more than ~12 colour tokens in the base set.

## Extract a design system from an existing design (procedure)
1. `get_design` (full detail) and tally colours, font families/sizes, paddings/gaps, radii, shadows.
2. Cluster near-duplicates (e.g., #1F1E1D vs #201F1E → one token). Decide roles by usage: biggest area = surface; most frequent text colour = text; the colour on buttons/links = primary.
3. `set_tokens`; then `apply_changes` replacing raw values with `$tokens` (batch by node type).
4. Snap off-scale spacing to the nearest scale value when the difference ≤ 4px; flag the rest.
5. Report: tokens created, values normalised, remaining inconsistencies.

## Dark / alternate themes
Create a second token set by duplicating the frame and switching colour tokens' *values* via a themed copy (MVP: duplicate frame and update tokens per frame via explicit hex until theme modes exist in v0.2). Keep roles identical (`surface`, `text`…) so later mode support is a drop-in.

## Export mapping
| Token | CSS | Tailwind (react-tailwind) |
|---|---|---|
| colors.primary | `--color-primary` | `theme.extend.colors.primary` |
| fonts.heading | `--font-heading` | `theme.extend.fontFamily.heading` |
| radii.md | `--radius-md` | `theme.extend.borderRadius.md` |
| spacing scale | `--space-1…` | default spacing + arbitrary values |

## Lint hooks
`lint_design` reports `hardcoded-colour` (≥3 repeats not matching a token) and `off-scale-spacing`; fix by creating tokens / snapping values.
