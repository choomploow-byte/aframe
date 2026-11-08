# Debugging Prompts

## General bug
```
Bug: {describe what you did, what you expected, what happened}. 
Reproduce it first (write a failing test or a script if possible; if UI-only, drive it with puppeteer and capture a screenshot). Find the root cause, not a symptom patch. Explain the cause in 3 lines. Fix it, add a regression test, run the full test suite, and update docs if behaviour changed. List any similar code paths that might have the same bug.
```

## Sync / file bridge issue
```
Sync misbehaving: {symptom}. Check docs/06. Enable verbose sync logging, then reproduce with two processes: the app (or dev adapter) and a script mutating the project file. Record the sequence of rev numbers, mtimes, and which side wrote when. Identify whether it's a lost update, a missed mtime change, a dirty-merge bug, or a platform rename issue. Add a deterministic test using the fake fs that reproduces it before fixing.
```

## MCP host problem
```
The MCP server doesn't work in {Claude Code | Codex | Cursor}: {symptom}. Run `node aframe-mcp.mjs doctor`. Verify: Node version, path quoting/spaces, that stdout contains only protocol messages (anything else on stdout breaks MCP - logs must go to stderr), the host's current config format (check official docs), tool listing via the SDK test client, and image result handling. Report findings, fix, and add the case to the troubleshooting matrix in docs/09 and to `doctor`.
```

## Screenshot looks different from the canvas
```
The screenshot differs from what I see: {describe}. Compare DOM capture vs live render. Check: fonts loaded before capture, images decoded, CSS the capture library can't handle (backdrop-filter, mix-blend, filters), webview differences (WebKit vs Chromium), device pixel ratio, scaling transforms on the world layer being included in the capture. Fix in the capture path, and add a fixture to the visual regression suite. If a limitation is inherent, document it and add a fallback.
```

## Agent behaves badly
```
The agent {describe: ignores references / uses absolute positioning / never screenshots / over-edits}. Reproduce with the eval harness using the same prompt. Inspect the transcript: what tools did it call, what did it see? Decide whether the fix belongs in: server instructions, SKILL.md, a skill document, tool descriptions/error hints, or tool behaviour (e.g. make a mistake impossible). Prefer making the right path easy over longer instructions. Re-run evals; report before/after metrics.
```

## Performance regression
```
Interaction is slow with {N} nodes. Profile (Performance panel / performance.mark HUD). Identify the hot path: re-renders, layout thrash, history cloning, overlay measurements, sync parsing. Fix the biggest cost first, show before/after numbers, and add a benchmark to CI with a threshold.
```
