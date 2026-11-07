# Phase 6: Annotations, References, Selection (the signature loop)

**Read:** docs/07 (Annotations, References), docs/05 (human-feedback tools), docs/08 (reference-matching pipeline), `skills/reference-matching.md`.

## Goal
A human can point at things and show examples; the agent sees both and responds. This is the first public-demo milestone.

## Tasks
1. **Annotation tool (A)**: click for numbered pin, drag for region; inline popover composer; stored in `doc.annotations` with `nodeId` auto-detected under the pin (store pin offset relative to the node so it follows when the node moves/reflows).
2. **Overlay rendering** in a separate layer, excluded from design export/screenshots by default; pins stay a constant screen size at any zoom.
3. **Notes tab** in the right panel: list, filter (open/resolved/all), click to focus + pan to the pin, resolve/reopen, delete, show agent replies, author badges (you / agent).
4. **Agent tools**: finalise `get_annotations` (include outline of the node under each pin and the parent frame), `add_annotation`, `resolve_annotation(reply)`; app shows a toast + pulse when the agent resolves one.
5. **Screenshot with annotations**: composite numbered pins (and region rectangles) onto the PNG so the agent can see exactly what the human marked. Test that pin positions match for nested nodes, zoom levels and scrolled canvas.
6. **References**: Assets > References UI: add (drop/paste/picker/`add_reference`), name, note, scope (style/layout/everything), delete. **Compare mode**: side-by-side and overlay with opacity slider for the selected frame vs a reference.
7. `get_reference` returns the image + note; `list_references`; reference ids shown in the UI so users can say "follow reference 2".
8. **`get_selection`**: selection written to `state.json` (throttled); tool returns node outlines.
9. **"Ask AI to address N open notes"** button: if the in-app chat is configured (Phase 7) it sends the prompt; otherwise copies "in atelier, address my open annotations" to clipboard with a toast.
10. Prompts: write `prompts/design-agent-prompts.md` recipes if not present; ensure the SKILL.md and server instructions describe the annotation workflow (`get_annotations` -> fix -> screenshot -> `resolve_annotation`).
11. Tests: annotation CRUD + persistence; follow-node behaviour; screenshot compositing positions (pixel assertions on fixture); MCP test for annotation tools.

## Acceptance
- Drop a pin on a button with "make this pop"; in Claude Code say "in atelier, address my annotations" -> the button changes, a screenshot was taken, the annotation is resolved with a reply visible in the UI.
- Add a reference image with note "match spacing and type, not colours"; "in atelier, follow my reference" produces a result that visibly shifts spacing/type while keeping the palette.
- `get_selection` reflects the live selection within 500 ms.

## Report back with
A recorded GIF or screenshots sequence (puppeteer) of the loop, plus the exact prompts you used to test with an agent.
