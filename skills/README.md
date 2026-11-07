# Skills

Skills are markdown documents of design knowledge that agents load on demand via `list_skills` / `load_skill` (and that ship inside the Atelier app). They are the easiest way to contribute to the project and the biggest lever on output quality.

## Shipped skills
| File | Name | Use |
|---|---|---|
| `atelier-SKILL.md` | atelier | **Claude Code skill** installed to `~/.claude/skills/atelier/SKILL.md`; teaches the loop and tools. Not loaded via `load_skill` |
| `design-fundamentals.md` | design-fundamentals | Always load first |
| `typography.md` | typography | Fonts, scale, pairings |
| `color.md` | color | Palettes, contrast, dark mode |
| `layout-and-spacing.md` | layout-and-spacing | Auto-layout structure, grids, responsive |
| `patterns.md` | patterns | Landing, pricing, dashboard, forms, mobile… |
| `accessibility.md` | accessibility | Contrast, targets, semantics, export props |
| `reference-matching.md` | reference-matching | Style briefs and comparison loop |
| `critique.md` | critique | Review checklist and report format |
| `tokens.md` | tokens | Design systems and export mapping |
| `game-ui.md` | game-ui | Game HUDs, shops, inventories, chunky buttons, icons, patterns, bevels, component states |

## File format
```
---
name: kebab-case-name          # unique; used by load_skill
description: One sentence saying WHEN to load this (agents choose by description)
---
# Title
Markdown body…
```

## Writing a good skill
1. **Concrete over abstract**: numbers, ratios, do/don't pairs, tiny worked examples in Atelier tool-call form.
2. **Short and scannable**: tables and lists; target < 250 lines; agents pay tokens for every line.
3. **Actionable procedures**: "Step 1…", "If X then Y".
4. **Use Atelier's real vocabulary**: node properties from `docs/04`, tool names from `docs/05`, bundled fonts.
5. **Original writing**: synthesise; don't paste text from books/sites. Credit inspirations in the PR description.
6. **Test it**: run 3 tasks with and without the skill using the eval harness; include results in your PR.

## Where skills live at runtime
- Shipped: bundled into the app and MCP bundle (as TS string modules generated at build).
- User: `~/.atelier/skills/*.md` (override shipped skills of the same name).
- Community collection: `skills/community/` in the repo.

## Ideas for community skills
E-commerce product pages · SaaS onboarding flows · developer docs sites · portfolio sites · mobile fintech · editorial/blog layouts · brutalist/neo-brutalist style · glassmorphism done tastefully · data-dense admin tables · email templates · slide-like layouts · illustration prompts · motion principles (for later).
