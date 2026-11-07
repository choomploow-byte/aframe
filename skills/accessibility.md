---
name: accessibility
description: Designing accessible UI - contrast, text size, tap targets, focus, semantics, colour independence - and how to set node properties so exported code is accessible. Load for any production-bound design.
---

# Accessibility (design + export)

## Non-negotiables
| Rule | Target |
|---|---|
| Text contrast | ≥ 4.5:1 normal, ≥ 3:1 large (≥24px, or ≥18.66px bold) |
| UI component / icon contrast vs adjacent colour | ≥ 3:1 |
| Body text size | ≥ 16px desktop, ≥ 16px mobile (never < 14 for essential info; 12 only for captions) |
| Touch targets | ≥ 44×44 (mobile), ≥ 32px height desktop; ≥ 8px gap between targets |
| Line height | ≥ 1.5 for body |
| Focus | Visible focus indicator for every interactive element (≥ 3:1, ≥ 2px) |
| Colour | Never the only carrier of meaning (add icon, text, pattern) |
| Motion | Respect reduced motion (note in handoff) |

## Design practices
- Show **states** for interactive things: hover, focus, pressed, disabled, error, success.
- Disabled isn't invisible: lower emphasis but keep ≥ 3:1 for icons; explain why when possible.
- Form fields have visible labels (not placeholder-only), help text, and error text next to the field.
- Links inside text are underlined or otherwise clearly distinct from body text.
- Don't place text over busy images without a scrim (rgba(0,0,0,.4+)) or a solid container.
- Keep reading order = visual order (top-to-bottom, left-to-right); avoid layouts that rely on absolute positioning order.
- Headings go in order (one H1, then H2…); don't pick heading sizes only for looks. Set `props.level` on heading text nodes when size alone is ambiguous.

## How to encode it in Atelier so the exporter outputs good HTML
| Need | Set |
|---|---|
| Button | frame `role: "button"` (exports `<button>`) |
| Link | frame/text `role: "link"`, `href` |
| Navigation | frame `role: "nav"` |
| Image meaning | image node `props.alt: "…"` (empty string `""` for decorative) |
| Icon-only control | `props["aria-label"]: "Close"` on the button frame |
| Heading | text `role: "heading"`, `props.level: "2"` |
| Input | frame `role: "input"`, `props.label: "Email"`, `props.type: "email"` |
| Sections | frame `role: "section"` + a heading inside |

## Checking
- Run `lint_design`: it flags contrast, tiny text, small tap targets, missing alt.
- Visually check greys and brand colours against backgrounds; don't trust your eyes on light-on-light.
- Test with long text and larger text size mentally: does the layout reflow (auto-layout `wrap`, `hug` heights) instead of clipping?

## Colour-blind safety
Avoid red/green as the only differentiator; vary lightness, add icons/labels. Blue + orange is a robust pair. Charts: use direct labels or patterns.

## Cognitive accessibility
Plain language, consistent patterns, one primary action, clear error recovery, avoid timeouts and surprise motion, limit simultaneous choices (≤ 7 in a menu).

## When asked to "make it accessible"
1. `lint_design`; fix errors. 2. Bump muted text/borders to pass. 3. Enlarge small targets. 4. Add focus-ring style to buttons/inputs (annotation or note in handoff). 5. Add alt/aria props. 6. Check heading structure. 7. Report remaining manual checks (keyboard order, screen reader) for the dev.
