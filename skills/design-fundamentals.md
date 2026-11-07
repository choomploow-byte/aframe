---
name: design-fundamentals
description: Core principles for making UI look professional - hierarchy, spacing, alignment, consistency, restraint. Load first for any design task.
---

# Design Fundamentals

Good UI is mostly **hierarchy, spacing, and restraint**. When a design looks "off", it's nearly always one of those.

## 1. Hierarchy: decide what matters, then make it obvious
- Every screen has **one primary thing** (headline, key number, main action). Make it the largest/boldest/highest-contrast element.
- Create hierarchy with *size, weight, colour/contrast, and space*. Use at most three levels in a block: primary, secondary, tertiary.
- De-emphasise instead of emphasising everything: lower contrast and size of secondary info rather than making the primary louder.
- One primary button per view. Secondary actions use outline/ghost styles.

## 2. Spacing: use a scale, group by proximity
- Scale: **4, 8, 12, 16, 24, 32, 48, 64, 96**. Never invent 13 or 37.
- **Proximity = relationship.** Space *inside* a group must be clearly smaller than space *between* groups (rule of thumb: at least 1.5-2x).
- Padding inside containers: 16-24 for cards, 12-16 for compact controls, 64-96 vertical for page sections.
- When unsure, add space. Cramped is the most common amateur tell.

## 3. Alignment: pick edges and obey them
- Align to a shared left edge for text blocks; centre only short, symmetric content (hero, empty states).
- Use auto-layout so alignment is structural, not eyeballed.
- Equal gutters in grids; consistent card heights in a row (`align: stretch`).

## 4. Consistency: fewer decisions, repeated
- Same component = same padding, radius, type size everywhere.
- Limit: 1 accent colour, 2 font families max, 3-4 radii max (e.g., 6/12/20/full), 1-2 shadow levels.
- Use tokens; if you hardcode a colour twice, make it a token.

## 5. Restraint: remove before you add
- Prefer whitespace and subtle borders (1px, low-contrast) over heavy shadows and many colours.
- Borders and backgrounds are rarely both needed. Cards: either a soft border or a subtle fill shift, plus little or no shadow.
- Remove decorative gradients/shadows that don't communicate anything.

## 6. Content-first
- Design with real copy. Short, specific headlines. Replace "Lorem ipsum" with plausible content.
- Keep line length 45-75 characters for body text.
- Left-align body text; avoid justified text.

## 7. States and polish (what makes it feel finished)
- Buttons: default / hover / pressed / disabled; inputs: focus ring and error state; links: distinguishable.
- Icons: one set, one stroke width, aligned to text baseline/center.
- Images: consistent aspect ratios and radii; never stretch.

## Quick fixes that move the needle most
1. Increase whitespace between sections (64→96) and inside cards (16→24).
2. Reduce text sizes variety to a scale; bump body to 16-18.
3. Lighten secondary text and borders; darken primary text.
4. Make the main CTA a solid accent button; make others subtle.
5. Align everything to a grid via auto-layout; equalise card sizes.
6. Replace pure black/white with near-neutrals (e.g., #1F1E1D on #FAF9F5).

## Self-check before finishing
- Squint test: can you still see the hierarchy when blurred?
- Is there one obvious primary action?
- Is spacing from the scale and grouped sensibly?
- Do colours/fonts/radii come from tokens?
- Would this survive longer copy? Shorter copy?
