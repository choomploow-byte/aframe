# Skills

Skills are markdown documents of design knowledge that agents load on demand via `list_skills` / `load_skill` (and that ship inside the AFrame app). They are the easiest way to contribute to the project and the biggest lever on output quality.

## Shipped skills
| File | Name | Use |
|---|---|---|
| `aframe-SKILL.md` | aframe | **Claude Code skill** installed to `~/.claude/skills/aframe/SKILL.md`; teaches the loop and tools. Not loaded via `load_skill` |
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
1. **Concrete over abstract**: numbers, ratios, do/don't pairs, tiny worked examples in AFrame tool-call form.
2. **Short and scannable**: tables and lists; target < 250 lines; agents pay tokens for every line.
3. **Actionable procedures**: "Step 1…", "If X then Y".
4. **Use AFrame's real vocabulary**: node properties from `docs/04`, tool names from `docs/05`, bundled fonts.
5. **Original writing**: synthesise; don't paste text from books/sites. Credit inspirations in the PR description.
6. **Test it**: run 3 tasks with and without the skill using the eval harness; include results in your PR.

## Where skills live at runtime
- Shipped: bundled into the app and MCP bundle (as TS string modules generated at build).
- User: `~/.aframe/skills/*.md` (override shipped skills of the same name).

### Your own skills
Put a `.md` file in `~/.aframe/skills/` and it is available the next time an agent (or the in-app assistant) lists skills; no restart. Rules:
- The file needs a frontmatter block with `description`; `name` is optional (the file name is used) and must be lowercase letters, digits and dashes, at most 41 characters.
- A skill of yours with the same name as a shipped one replaces it; `list_skills` marks yours "(your own)".
- Up to 50 files, 200 KB each; links, folders and files that are not valid skills are ignored.
- A skill is instructions for the assistant: only keep ones you wrote or trust, as with any prompt.

### Template for a community skill
```
---
name: brand-voice
description: When to load this, in one sentence an agent can match against a request
---
# Title
## When to use
## Rules (numbers, ratios, do/don't)
## Worked example (in tool-call form)
```
- Community collection: `skills/community/` in the repo.

## Ideas for community skills
E-commerce product pages · SaaS onboarding flows · developer docs sites · portfolio sites · mobile fintech · editorial/blog layouts · brutalist/neo-brutalist style · glassmorphism done tastefully · data-dense admin tables · email templates · slide-like layouts · illustration prompts · motion principles (for later).
