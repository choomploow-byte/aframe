# Design Agent Prompt Recipes

User-facing phrases and the longer prompts behind them. Ship these as MCP `prompts` (slash commands where supported), as suggested chips in the chat panel, and in the docs.

## 1. Improve my design
**Say:** "in atelier, improve my design" / "improve the selected frame"
```
Improve the design in Atelier. Start with get_design (and get_selection if something is selected), then take a screenshot. Load design-fundamentals. Identify the 3 most impactful problems (hierarchy, spacing, typography, colour, alignment, contrast). Fix structure first, then type and colour. Keep my copy. Verify with a screenshot and lint_design. Tell me what you changed in plain language.
```

## 2. Match a reference
**Say:** "in atelier, make this look like my reference" / "follow reference 2"
```
Use the reference image(s) in Atelier. First write a short style brief: palette (hex), type (families/weights/size ratios), spacing rhythm, corner radius/borders/shadows, layout pattern, density, tone. Show me the brief, then apply it to my design with tokens (respect each reference's note and scope). Do not copy specific logos or exact proprietary layouts; match the style. Screenshot, compare against the reference, fix the biggest differences. Report what matched and what didn't.
```

## 3. Rebuild from a screenshot
**Say:** "in atelier, rebuild this screenshot as an editable design" (image attached)
```
Rebuild the attached screenshot in Atelier as an editable design. Steps: (1) list regions and estimate the canvas size, (2) extract tokens (colours, fonts from the available families, radius, spacing unit), (3) build with nested auto-layout frames via apply_changes, bottom-up, with semantic layer names and roles, (4) screenshot your result and compare it to the original, then fix the biggest deltas (size, alignment, weight, colour), (5) keep placeholder images as image nodes or neutral rectangles. Offer to place the original as a reference for comparison.
```

## 4. Address my annotations
**Say:** "in atelier, address my annotations"
```
Call get_annotations (open only). For each: look at the node under the pin and its parent, take a screenshot with annotations visible, make the change, then resolve_annotation with a one-line reply on what you did. If a note is ambiguous, make the most reasonable change and say what you assumed. Re-screenshot at the end.
```

## 5. Critique (no edits)
**Say:** "in atelier, critique my design"
```
Review the design in Atelier without changing it. Screenshot, run lint_design, and judge hierarchy, spacing, typography, colour/contrast, consistency, alignment and accessibility. Give a prioritised list of 3-7 issues, each with: what's wrong, why it matters for users, and the concrete fix. Start with what's already good. Offer to apply the fixes.
```

## 6. Make it responsive / mobile version
**Say:** "in atelier, make a mobile version of this frame"
```
Duplicate the selected frame as a 390px-wide mobile version next to it. Reflow with auto-layout: stack columns, scale type (keep body >= 16px), enlarge tap targets (>= 44px), turn nav into a compact bar or menu icon, keep one primary action visible. Reuse the same tokens. Screenshot and fix overflow or cramped areas.
```

## 7. Design from scratch
**Say:** "in atelier, design a landing page for {product}: {audience}, {tone}"
```
Create a new frame (1440x900 desktop) in Atelier for: {product}. First propose in 5 lines: audience, tone, palette, type pairing, and page sections. Set tokens. Build sections with auto-layout (nav, hero with one primary CTA, social proof, 3 features, pricing/CTA, footer). Use realistic copy, not lorem ipsum. Screenshot, critique, refine up to 3 times. Then offer a mobile version and code export.
```

## 8. Polish pass
**Say:** "in atelier, give it a polish pass"
```
Do a polish-only pass: align edges, normalise spacing to the scale, unify radii/shadows, fix orphan/widow text wrapping, tighten line lengths, ensure contrast and tap targets, name layers. Don't change content or structure. Screenshot before/after and list the details you fixed.
```

## 9. Design system from my design
**Say:** "in atelier, extract a design system"
```
Analyse the design and create tokens: colour roles (primary, surface, text, muted, border, success/warn/error), font roles, spacing scale, radii. Replace repeated raw values with $tokens across all nodes. Report the system and any inconsistencies you normalised.
```

## 10. Export to my code
**Say:** "in atelier, export the pricing frame as React into ./src/components"
```
Confirm the target folder with me if unclear. Run lint_design first and fix errors. Then export_code (framework react-css or react-tailwind to match my project: check package.json for Tailwind). Summarise the generated files and any manual follow-ups (fonts, images, tokens).
```

## 11. Build a game UI
**Say:** "in atelier, design a game HUD" / "build a shop screen for my game"
```
Build the game interface in Atelier. Load game-ui and design-fundamentals. Start from a game template with create_project if one fits (game-hud, game-shop, game-inventory), otherwise set tokens first: a dark ground, a lighter panel, one hot action colour, and the display font. Use search_icons for icons and list_fonts for type. Make every repeated control a component with hover, pressed and disabled states (slots and tabs also selected). Add depth with a faint pattern fill and effect presets, never a shadow on text. Check each button with screenshot and state all, lint_design, and tell me what you built.
```
