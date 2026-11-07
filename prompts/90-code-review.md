# Code Review Prompt (use after any phase)

```
Act as a senior reviewer who did not write this code. Review the changes from the last phase against the build kit (docs/ and CLAUDE.md). Be specific and skeptical. Do not fix anything yet.

Check, in order:
1. SPEC COMPLIANCE: does it meet each acceptance criterion in docs/12 for this phase? Mark each Met / Partly / Not met with evidence (file + behaviour). Anything unverified = "Not verified".
2. CONSISTENCY (docs/20 checklist): tool names/params, node properties, file paths, versions, skill names across code, docs, SKILL.md, prompts, tests.
3. CORRECTNESS: edge cases in ops/apply/style/sync (empty docs, deep trees, huge text, missing parents, cycles, NaN, undefined tokens, concurrent writes, Windows paths, spaces in paths, non-ASCII names).
4. SECURITY (docs/18): path confinement, dangerouslySetInnerHTML, CSP, key leakage in logs, prompt-injection exposure, over-broad Tauri capabilities.
5. PERFORMANCE: unnecessary re-renders, layout thrash in overlays, unbounded history/memory, big JSON parsing on main thread.
6. UX: empty/error states, keyboard access, theme parity, copy tone.
7. TESTS: what's untested that matters? Flaky tests? Do tests assert behaviour, not implementation?
8. DEPENDENCIES: anything added without need; licence problems.

Output: a prioritised list (Blocker / Major / Minor / Nit), each with file:line, why it matters, and a suggested fix. End with a go/no-go for moving to the next phase.
```
