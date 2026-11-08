---
name: typography
description: Type scales, font pairing from AFrame's bundled fonts, line height, weights, and text patterns for UI. Load when choosing or fixing fonts and text sizes.
---

# Typography

## Bundled font families (use these exact names in `fontFamily` or tokens)
| Family | Character | Best for |
|---|---|---|
| **Inter** | Neutral, highly legible UI sans | Body, UI, dashboards (safe default) |
| **DM Sans** | Friendly geometric sans | Consumer apps, softer brands |
| **Space Grotesk** | Techy, quirky grotesk | Dev tools, crypto, bold headings |
| **Fraunces** | Warm, soft serif with personality | Editorial, premium-human brands, headings |
| **Playfair Display** | High-contrast classic serif | Luxury, magazines, large headings only |
| **JetBrains Mono** | Monospace | Code, numbers, technical labels |

## Pairings that work
- Fraunces (headings) + Inter (body): warm and credible.
- Space Grotesk (headings) + Inter (body): modern product/dev.
- DM Sans for both (weight contrast): friendly and cohesive.
- Playfair Display (large headings) + DM Sans/Inter: editorial/luxury.
Rules: max 2 families; one expressive, one neutral. Never pair two similar sans or two display faces.

## Type scale (pick one ratio and stick to it)
Base 16px. Ratio 1.25 (major third) for apps/dashboards, 1.333 for marketing, 1.5 for dramatic heroes.
- 1.25 scale: 12, 14, 16, 20, 25, 31, 39, 49, 61
- Practical UI set: **12 / 14 / 16 / 20 / 24 / 32 / 40 / 56 / 72**
Use 3-5 sizes per screen.

## Roles and defaults (desktop)
| Role | Size | Weight | Line height | Notes |
|---|---|---|---|---|
| Display / hero | 56-72 | 600-700 | 1.05-1.1 | letterSpacing -0.02em |
| H1 | 40-48 | 600-700 | 1.15 | one per page |
| H2 | 28-32 | 600 | 1.2 | section titles |
| H3 | 20-24 | 600 | 1.3 | card titles |
| Body | 16-18 | 400 | 1.5-1.6 | `$text` colour |
| Small / caption | 12-14 | 400-500 | 1.4 | `$muted` colour |
| Button / label | 14-16 | 500-600 | 1 | no wrap |
| Overline | 12 | 600 | 1.2 | uppercase, letterSpacing +0.08em |
Mobile: body ≥ 16, hero 36-44, H1 28-32.

## Rules
- **Line height shrinks as size grows**: 1.6 body → 1.2 large headings → 1.05 display.
- **Letter spacing**: tighten large headings (-0.01 to -0.03em), loosen small uppercase (+0.05 to +0.1em), leave body at 0.
- **Weights**: use 2-3 weights (400, 500/600, 700). Avoid 300 on small text.
- **Line length**: constrain text width (w ≈ 560-680px for body); wide lines hurt reading.
- **Alignment**: left for paragraphs; centre only for short headlines/CTAs.
- **Contrast**: body text `$text`; secondary `$muted` must still reach 4.5:1.
- **Numbers** in tables/dashboards: tabular figures if available; right-align numerics; consider JetBrains Mono for code-like data.
- **Don't** use more than one italic style, underline for non-links, or all-caps for long text.
- Avoid orphans: keep a short last word off its own line by narrowing the box width a bit.

## Example token setup
```json
set_tokens { "fonts": { "heading": "Fraunces", "body": "Inter", "mono": "JetBrains Mono" } }
```
Then nodes use `fontFamily: "$font.heading"`.

## Fixing "this text looks bad" quickly
1. Is body ≥ 16 and line height ≥ 1.5?
2. Is there clear size/weight contrast between heading and body (ratio ≥ 1.5)?
3. Is the line too long or too short?
4. Too many sizes/weights? Snap to the scale.
5. Is secondary text too light or too dark relative to primary?
