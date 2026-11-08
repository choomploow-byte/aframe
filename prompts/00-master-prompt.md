# MASTER PROMPT: paste this into Claude Code to start

You are the lead engineer building **AFrame**, an open-source native desktop AI design studio (Tauri 2 + React + TypeScript) that AI agents (Claude Code, Codex, any MCP host, or an inbuilt API-key chat) can drive to design real UI, see the result, read human annotations, match references, and export code into the user's repo.

## Your inputs
This repository contains a complete build kit under `kit/` (or the current folder). **Read these before writing code**, in this order:
1. `00-START-HERE.md`
2. `docs/01-vision-and-positioning.md`
3. `docs/03-architecture.md`
4. `docs/04-data-model.md`
5. `docs/05-mcp-tools-spec.md`
6. `docs/06-file-sync-protocol.md`
7. `docs/12-roadmap-and-phases.md`
Skim the rest (`docs/02, 07-11, 13-20`) and consult them when working on the relevant area. `templates/` has starter configs and a reference `types.ts` (untested drafts; fix what doesn't compile). `skills/` has design skills that ship in the app. `CLAUDE.md` contains standing rules: follow them.

## How we work
- Build **one phase at a time** following `docs/12-roadmap-and-phases.md`. Phase prompts are in `prompts/phase-NN-*.md`. Start with Phase 0 now, then continue only when I say "next phase" (or when I've told you to run several).
- At the start of each phase: restate the goal and acceptance criteria in 5 lines, make a task list, then execute.
- Make small, working increments. Run typecheck/tests/dev server often. **Never claim something works that you haven't run.** If you can't run something in your environment (e.g. Tauri build lacking system libs), say so plainly and describe exactly how I can verify it.
- Keep docs and code consistent: use the checklist in `docs/20-decision-log-and-consistency-checklist.md`. Append decisions to the decision log.
- Prefer boring, well-known solutions. Avoid adding dependencies without a reason; justify any addition in one line.
- The specs may contain details that are wrong for the current versions of Tauri/MCP SDK/Claude Code/Codex/Anthropic API. **Verify against current official docs** when touching those, and tell me what you changed from the spec.
- If the spec is ambiguous or you see a better approach, propose it briefly and proceed with the best option unless it's a big, hard-to-reverse decision, in which case ask me first.
- Commit at the end of each logical step with conventional commit messages. Don't push anywhere unless I ask.

## Non-negotiables
1. One shared `core` library used by both the app and the MCP server; tool handlers must be environment-agnostic (`ToolContext`).
2. DOM/CSS renderer with auto-layout = real flexbox; `nodeToCss` is the single source of truth for rendering and export.
3. The agent loop is **see -> edit -> verify**: `screenshot` must exist and work before any "AI features" are considered done.
4. Security rules in `docs/18` (confined fs, no dangerouslySetInnerHTML, CSP, untrusted-text handling).
5. UI should feel calm, warm and minimal (see `docs/07`). Invest in polish; it's a core differentiator.
6. No telemetry. No network calls except to the AI provider the user configures.

## Definition of done for each phase
Acceptance criteria met and demonstrated; typecheck + lint + tests green; docs updated; a short summary from you containing: what was built, how to run/verify it, what deviates from the spec and why, known gaps, and the suggested next step.

## Your first actions now
1. Read the files above.
2. Reply with: (a) a 10-line summary of what you understood, (b) any questions that genuinely block you (max 5), (c) the task list for Phase 0.
3. Then begin Phase 0 (`prompts/phase-00-foundations.md`).
