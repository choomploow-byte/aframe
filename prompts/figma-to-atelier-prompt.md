# Figma to Atelier (agent workflow using two MCP servers)

> Verify what Figma's current developer tooling offers (Dev Mode / MCP server availability, plans, limits). If unavailable, use the REST API importer (Phase 10) or export the frame as PNG/SVG and use "rebuild from screenshot".

## Prompt (user pastes into Claude Code with both MCP servers connected)
```
I have a Figma frame at {FIGMA_URL}. Recreate it in Atelier as an editable design.

1. Use the Figma tools to read the frame: structure, auto-layout settings, text styles, colours, radii, shadows, and export any images/icons you need.
2. Create tokens in Atelier first (colours, fonts, spacing, radii) from the Figma styles/variables.
3. Build the frame in Atelier with apply_changes using nested auto-layout frames. Map: Figma auto-layout -> layout row/column; itemSpacing -> gap; padding -> padding; primary-axis alignment -> justify; counter-axis alignment -> align; hug/fill/fixed -> w/h 'hug'/'fill'/number.
4. Use the closest fonts available in Atelier (list them in the skill typography) and tell me which substitutions you made.
5. Screenshot your result and compare to a Figma export. Fix the biggest differences.
6. Give me a short report: what matched, what was approximated, what was skipped.
```

## Mapping cheat sheet (for the agent and for the Phase 10 importer)
| Figma | Atelier |
|---|---|
| FRAME / COMPONENT / INSTANCE | frame |
| RECTANGLE | rect (radius from cornerRadius) |
| ELLIPSE | ellipse |
| TEXT | text (fontFamily, fontSize, fontWeight, lineHeight = lineHeightPx/fontSize, letterSpacing in em, textAlign) |
| layoutMode HORIZONTAL / VERTICAL | layout row / column |
| itemSpacing | gap |
| paddingLeft/Right/Top/Bottom | padding [t,r,b,l] |
| primaryAxisAlignItems MIN/CENTER/MAX/SPACE_BETWEEN | justify start/center/end/between |
| counterAxisAlignItems MIN/CENTER/MAX | align start/center/end |
| layoutSizingHorizontal/Vertical FIXED/HUG/FILL | w/h number/'hug'/'fill' |
| fills SOLID / GRADIENT_LINEAR | fill hex / linear-gradient(...) |
| strokes + strokeWeight + strokeAlign | stroke, strokeWidth, strokeAlign |
| effects DROP_SHADOW / INNER_SHADOW / LAYER_BLUR / BACKGROUND_BLUR | shadow[] (inset) / blur / backdropBlur |
| clipsContent | clip |
| image fills / vectors / boolean ops | image node (export as PNG/SVG asset) |
| variants, prototype links, plugins | not supported: flatten to the visible variant |
