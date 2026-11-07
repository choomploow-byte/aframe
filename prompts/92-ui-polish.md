# UI Polish Prompt ("make it feel like the Claude app")

```
Polish pass on Atelier's own interface. Target: calm, warm, restrained, premium. Reference the design language in docs/07.

1. Screenshot every major screen/state in light and dark (empty canvas, populated canvas with selection, each panel tab, dialogs, onboarding, chat with tool activity, error states). Critique them like a design lead.
2. Fix, in this order: spacing rhythm (4/8 scale, consistent panel padding), type hierarchy (13px base, 12px dense, weights), alignment, colour usage (single accent, borders not shadows, muted text contrast >= 4.5:1), icon consistency (one set, one stroke width), control heights (28/32/36), radii (8/12), focus rings, hover/active/disabled states, motion (120-180ms ease-out, reduced-motion respected).
3. Remove visual noise: fewer borders, fewer icons, fewer simultaneous panels. If something isn't earning its pixels, hide it behind progressive disclosure.
4. Write or rewrite microcopy: friendly, short, no jargon; empty states have a next action.
5. Check keyboard flow and tooltips with shortcuts.
6. Re-screenshot; present before/after pairs and list what changed. Do not change functionality.
```
