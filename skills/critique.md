---
name: critique
description: Structured design critique and polish checklist - how to review a screenshot like a design lead and produce prioritized, actionable feedback or fixes.
---

# Critique

## Procedure
1. `screenshot` the frame (and `lint_design`). Look at the whole first, then regions.
2. **Squint test**: blur your eyes: what stands out first? Is it the right thing?
3. Walk the checklist; collect issues; rank by impact on the user's goal.
4. Report 3-7 items (not 30). Start with what works. Each item: *what / why it matters / fix*.
5. If asked to fix: apply the top issues in structure → type → colour → detail order, then re-screenshot.

## Checklist (ordered by typical impact)
**Hierarchy**: one clear focal point? Is the primary action obvious? Do headings clearly outrank body? Is secondary info subdued?
**Spacing**: consistent scale? Related items grouped? Enough breathing room around sections and inside cards? Any collisions or near-touches?
**Alignment**: shared edges? Equal card heights? Icons/text vertically centred? Grid columns consistent?
**Typography**: ≤ 2 families, ≤ 5 sizes; body ≥ 16; line height 1.4-1.6; sensible line length; heading/body weight contrast; no orphan words.
**Colour**: neutrals + one accent; accent reserved for actions/highlights; contrast ≥ 4.5:1; no pure black/white harshness; consistent use of semantic colours.
**Consistency**: same components styled the same (buttons, cards, inputs); radii/shadows/borders consistent; icon set uniform.
**Content**: real, specific copy; scannable headings; CTA text is a verb phrase; no filler.
**Imagery**: consistent aspect ratios and treatment; no stretched/low-res images; text over images has a scrim.
**Accessibility**: tap targets, focus states, alt text, colour independence.
**Responsiveness**: does it hold up with longer text and on mobile width? Any fixed widths that will break?
**Polish**: hover/focus/disabled states, empty states, hairline borders, optical alignment of icons, consistent shadows.

## Severity guide
- **Blocker**: unreadable, broken layout, failing contrast on key text, hidden primary action.
- **Major**: weak hierarchy, inconsistent spacing system, cluttered, off-brand colour usage.
- **Minor**: small misalignments, slightly inconsistent radii, copy tweaks.
- **Nit**: personal taste.

## Output template
```
What's working: …
Top issues:
1. [Major] Hierarchy - The pricing cards all have equal weight, so nothing guides the eye. → Highlight the middle plan (accent border, badge, +8px padding) and soften the others.
2. …
Quick wins I can apply now: …
```

## Heuristics to quote when helpful
Proximity (group by space), contrast (emphasis by difference), repetition (consistent patterns), alignment (shared edges), whitespace (restraint), Fitts's law (bigger/closer targets), Hick's law (fewer choices).
