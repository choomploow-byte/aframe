# Phase 9: Skills, Lint, Critique, Evals

**Read:** everything in `skills/`, docs/13 (lint rules), docs/08 (behaviours + evals).

## Goal
Make the AI's output consistently good, and prove it.

## Tasks
1. **Skills pipeline**: build step converts `skills/*.md` -> `src/core/skills/*.ts` string modules (frontmatter parsed for name/description). `list_skills`/`load_skill` implemented; user skills folder `~/.aframe/skills/` merged in (user overrides shipped). MCP resources `aframe://skills/<name>`.
2. **Review and improve the shipped skills** with the actual tool names and node properties (consistency checklist in docs/20). Make them concrete: numbers, ratios, do/don't pairs, tiny worked examples in tool-call form.
3. **`lint_design`**: implement all rules in docs/13 with fix suggestions as `Op[]`; contrast with background resolution through ancestors and gradient handling; tests with seeded bad fixtures.
4. **UI**: Lint results panel (click to focus node, "Fix" button applying `fix` ops), badge count in the top bar.
5. **Critique flow**: prompt + tool combo (`screenshot` + `lint_design` + heuristics) producing a plain-language critique with 3-7 prioritized issues; "Critique my design" action in chat and as an MCP prompt.
6. **Eval harness** `evals/`: 10 tasks (docs/08) with fixtures, a runner that drives the in-app agent loop with a real provider (reads key from env) or replays recorded transcripts, collects: final doc, screenshots, lint output, token usage; scoring script computing automatic metrics (auto-layout usage %, token usage %, lint errors, spacing on-scale %, contrast failures) plus a rubric file for human 1-5 ratings.
7. **Tune** the system prompts/skills against the eval; record before/after scores in `evals/RESULTS.md`.
8. Skill authoring guide `skills/README.md` + template for community skills.

## Acceptance
- Eval average >= 4/5 human rating on the 10-task set with a strong model; automatic metrics show >= 80% auto-layout usage, 0 contrast errors, >= 90% spacing on-scale after agent edits.
- Lint catches seeded issues (low contrast, 10px text, off-scale spacing, overflow, tiny tap target).

## Report back with
Before/after eval table, the 3 biggest quality levers you found, and failure modes that remain.
