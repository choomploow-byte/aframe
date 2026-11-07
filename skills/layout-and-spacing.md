---
name: layout-and-spacing
description: Auto-layout structure, grids, containers, spacing recipes, responsive behaviour and sizing modes in Atelier. Load when structuring or restructuring a screen.
---

# Layout and Spacing in Atelier

## Mental model
Everything is **frames with auto-layout**. A page = column of sections; a section = frame (padding) containing a centred container; a container = row or column of items. Avoid `layout: "none"` except for decorative layering and top-level canvas placement.

## Sizing modes
| Mode | Meaning | Use for |
|---|---|---|
| number | Fixed px | Icons, avatars, images with set aspect, max-width containers |
| `'hug'` | Shrink to content | Buttons, tags, text blocks, cards in a flow |
| `'fill'` | Take available space | Page sections (width), columns of equal weight, inputs |
Pattern for centred max-width content: outer section `w: fill`, `align: center`; inner container `w: 1120` (or `fill` with side padding) `layout: column`.

## Standard page skeleton (desktop 1440)
```
Page frame (column, w 1440, h hug, fill $surface)
├─ Nav (row, w fill, padding 20/64, justify between, align center)
├─ Hero (column, w fill, padding 96/64, align center, gap 24)
├─ Features (column, padding 96/64, gap 48) → grid rows
├─ Social proof / Testimonials
├─ Pricing / CTA
└─ Footer (row/column, padding 48/64, border-top)
```
Container width: 1120-1200. Side padding: 64 desktop, 32 tablet, 20-24 mobile.

## Grids with auto-layout
- N equal columns: a `row` frame with `gap: 24`, each child `w: 'fill'`. Cards equal height: `align: 'stretch'`.
- Responsive wrap: `wrap: true` + children with fixed `w` (e.g., 340) and `gap`.
- Sidebar + content: row; sidebar `w: 260` fixed, content `w: 'fill'`.
- Avoid nesting more than 5-6 levels; flatten by removing frames that have only one child and no styling.

## Spacing recipes
| Context | Value |
|---|---|
| Icon ↔ label | 8 |
| Label ↔ input | 6-8 |
| Form field ↔ field | 16-20 |
| Inside buttons (V/H) | 12-14 / 20-24 |
| Inside cards | 20-32 |
| Card ↔ card | 16-24 |
| Heading ↔ paragraph | 12-16 |
| Paragraph ↔ CTA | 24-32 |
| Section title block ↔ content | 48 |
| Section ↔ section | 80-120 |
| Page side margin | 64 (desktop), 20-24 (mobile) |
Rule: inner gap < outer gap. If two groups touch, increase the outer gap first.

## Alignment and balance
- Text blocks left-aligned in columns; centre hero content only when everything in it is centred (headline, sub, buttons).
- Vertically centre icon+text rows (`align: center`). Baseline-align mixed text sizes if needed.
- Make sibling cards share height (`align: stretch`) and pin their buttons to the bottom (column card + spacer frame `h: fill`).

## Responsive approach in Atelier
Create separate frames per breakpoint (Desktop 1440, Tablet 820, Mobile 390) from the same tokens.
Mobile conversions: rows → columns; 3-col grids → 1 column; side padding 20-24; nav → logo + menu icon; hero type 56 → 36-40; tap targets ≥ 44px; remove decorative elements; keep one primary CTA above the fold.

## Common layout bugs and fixes
| Symptom | Fix |
|---|---|
| Text overflows its box | Set text `w` to `fill` or a fixed width so it wraps; make parent `h: hug` |
| Cards uneven | Parent row `align: stretch`; cards `h: fill`/stretch |
| Content hugs the screen edge | Add side padding on the section, not on every child |
| Stuff floats randomly | Convert absolute (`layout: none`) frames into row/column auto-layout |
| Button too small | Padding 12-14 / 20-24, min height 40-48 |
| Big empty gaps | A `fill` child in a column with no height constraint, or excessive section padding; reduce to scale values |

## Using the tools
- Build sections with nested `create` ops; set `name` on every frame.
- Use `move` to reorder; `duplicate` to repeat cards then `update` the copy.
- After layout changes, `screenshot` and check: alignment, overflow, equal heights, rhythm.
