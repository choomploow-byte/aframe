---
name: patterns
description: Proven layouts and component recipes - landing page sections, pricing, cards, nav, forms, dashboards, mobile app screens, empty states. Load when designing a screen type from scratch.
---

# UI Patterns

All values assume desktop 1440 and tokens `$surface $surface2 $border $text $muted $primary`. Adapt to the brief.

## Navigation bar
Row, w fill, padding 16-20/64, justify between, align center, bottom border 1px `$border`.
Left: logo (text 20 weight 700) · centre/left: 3-5 links (15 weight 500 `$muted`, gap 32) · right: ghost "Log in" + solid "Get started" button.
Sticky feel: slight `$surface` fill, no heavy shadow. Mobile: logo + menu icon.

## Hero (conversion-focused)
Column, padding 96-128/64, gap 24, align center.
1. Overline/badge (optional, 13px pill, `primary` at 10% bg).
2. Headline 56-72/1.05, ≤ 10 words, `w ≈ 800`.
3. Subhead 20/1.5 `$muted`, `w ≈ 600`.
4. CTA row: primary (solid) + secondary (outline/ghost), gap 12.
5. Trust line (small, `$muted`) or logo row.
6. Product image/mockup below, radius 16-20, soft shadow, border.
Split hero variant: row, text column `fill` left-aligned, image column `fill`; gap 64.

## Feature grid
Section title block (overline + H2 + sub, centred, gap 12) then row of 3 cards, gap 24.
Card: column, padding 24-28, gap 12-16, radius 16, border 1px `$border`, fill `$surface2`. Icon in a 40-44px rounded square tinted with `primary` 10%, title 18-20/600, body 15-16 `$muted`.
Alternate with image+text rows (zig-zag) for 2-3 deeper features.

## Social proof
Logo strip (grayscale, 5-6 logos, gap 48, opacity .7) or 3 testimonial cards: quote 18, name 15/600, role 14 `$muted`, avatar 40.

## Pricing
3 tier cards in a row, gap 24; middle highlighted (border `primary`, "Popular" badge, slightly larger padding).
Card: plan name (18/600), price (48/700 + "/mo" 16 `$muted`), one-line description, divider, 5-7 feature rows (check icon + text 15), full-width CTA at the bottom (primary for the featured, outline for others).
Toggle monthly/yearly above. Keep feature lists parallel and short.

## Cards (generic)
Column, padding 20-24, gap 12, radius 12-16, either border 1px `$border` OR fill shift (not heavy shadow). Hover: border darkens / slight lift. Image on top: full-bleed, same aspect ratio, top radius matches card.

## Forms
Label (14/500) above input, gap 6; input h 44, padding 12/14, radius 10, border 1px `$border`, fill `$surface2`; focus: border `primary` + 3px ring at 30%. Help text 13 `$muted`; error text 13 red with icon. Field gap 16-20. One primary submit button, full width on mobile. Group related fields; avoid placeholder-only labels.

## Buttons
Primary: fill `$primary`, text white 15-16/600, padding 12-14/20-24, radius 10. Secondary: border 1px `$border` / text `$text`. Ghost: text only `$muted`→`$text`. Destructive: red fill/outline. Min height 40-48. Icon + text gap 8.

## Dashboard
Layout: sidebar (w 240-260, `$surface2`, border-right) + main (column, padding 24-32, gap 24).
Header row: title H2 + actions. KPI row: 3-4 stat cards (label 13 `$muted`, value 32/700, delta chip). Main: chart card (w fill) + side list card. Tables: row height 44-52, 1px dividers, right-aligned numbers, status chips, sticky header.
Density: tighter than marketing (body 14), but keep 16+ gaps between cards.

## Settings / list pages
Left sub-nav or tabs; content column max-width 720; sections with H3 + description left and controls right (row, justify between); dividers instead of cards.

## Mobile app screen (390x844)
Status area 44-54 top inset; screen padding 20; large title 28-34/700; content cards radius 16; bottom tab bar h 64-84 with 4-5 icons (active = `primary`); primary action floating or bottom-anchored full-width button (h 52, radius 14). Thumb-zone: key actions in the bottom half.

## Empty state
Centred column, gap 12: soft illustration/icon (64-96, tinted), title 20/600, one-sentence help `$muted`, primary CTA.

## Footer
Dark or `$surface2`; 4 columns of links (14 `$muted`), brand + blurb left, legal row at bottom with divider.

## Modals / dialogs
Overlay rgba(0,0,0,.4); dialog w 440-560, radius 16, padding 24, title 20/600, body 15, actions right-aligned (secondary + primary), gap 12.

## Charts (as design elements)
Minimal gridlines (`$border`), no chart junk, direct labels over legends where possible, one highlight colour + muted greys for context.

## Anti-patterns to avoid
Centre-aligned paragraphs; five competing colours; tiny grey text; stock-gradient blobs as the only visual; equal visual weight on every card; buttons with different heights in one row; inconsistent icon styles.
