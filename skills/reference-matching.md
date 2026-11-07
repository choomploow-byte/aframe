---
name: reference-matching
description: How to analyse a reference image or screenshot and apply its style or layout to the user's design - style brief, measurement, tokens, comparison loop. Load when the user provides or mentions a reference/inspiration/example.
---

# Reference Matching

Goal: transfer the **style system** of the reference onto the user's own content. Not a pixel copy; never reproduce someone's logo, illustrations, or proprietary assets.

## Respect scope
Each reference may have a note and scope (`style`, `layout`, `everything`). Obey it: "style" = palette/type/spacing/shape/density but keep the user's structure; "layout" = arrangement and proportions but keep the user's colours/type; "everything" = both.

## Step 1: Write a style brief (show it to the user, 8-12 lines)
1. **Palette**: background, surface, text, muted, accent, border; estimate hex values; note contrast level and temperature (warm/cool).
2. **Typography**: category (geometric sans / humanist / serif / mono), weight contrast, heading-to-body size ratio, letter-spacing (tight/loose), case. Map to the **closest bundled family** (Inter, DM Sans, Space Grotesk, Fraunces, Playfair Display, JetBrains Mono); say what you substituted.
3. **Spacing rhythm**: base unit (4/8), section padding vs card padding, density (airy/standard/dense).
4. **Shape language**: corner radius (sharp 0-4 / soft 8-12 / round 16-24 / pill), border usage, shadow style (none/soft/hard), dividers.
5. **Layout pattern**: grid (cols), container width, alignment (left/centre), hero type (split/centred), card patterns.
6. **Imagery & decoration**: photo/illustration/3D/gradients/noise/none; icon style (line/solid, weight).
7. **Tone**: 3 adjectives (e.g., calm, premium, playful).

## Step 2: Measure rather than guess
- Estimate sizes relative to the viewport: cap height → font size; gaps between elements → nearest scale values (4/8/12/16/24/32/48/64/96).
- Compare ratios: headline:body (e.g., 3.5:1), section gap: card gap (e.g., 4:1).
- Count distinct colours; the reference usually has fewer than it seems.
- Radii: compare to button height (radius ≈ height/2 = pill).

## Step 3: Encode as tokens first
`set_tokens` with palette, fonts, spacing scale, radii. Only then restyle nodes by token. This keeps the result coherent and editable.

## Step 4: Apply in this order
Structure/layout (if scope allows) → typography → colour → spacing → shape (radius/border/shadow) → imagery/decoration.

## Step 5: Compare and iterate
`screenshot` the result and `get_reference`. Compare side-by-side mentally using the brief categories; list the 3 largest differences; fix; repeat (≤ 3 loops). Common big misses: spacing too tight, heading weight/size ratio, over-saturated accent, shadows heavier than reference, line height.

## Report
Tell the user: what you matched, what you intentionally did not (assets, logos, exact fonts), and substitutions. Offer to tweak "more/less like the reference" along specific axes (e.g., airier, rounder, bolder type).

## Multiple references
Tag each reference with the aspect it contributes (e.g., ref 1 = typography, ref 2 = layout). If they conflict, prefer the one whose scope is `everything`, otherwise ask or choose and explain.

## Ethics
Inspiration, not imitation: avoid reproducing distinctive trade dress, brand marks or copyrighted illustrations. If the user wants an exact copy of someone else's design, steer toward capturing the principles and using original assets.
