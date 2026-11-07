# Release Prompt

```
Prepare release v{X.Y.Z}. Follow docs/14 release checklist.
1. Verify clean working tree; run typecheck, lint, unit, MCP integration, e2e, round-trip export tests; report results.
2. Bump versions consistently (package.json, Cargo.toml, tauri.conf.json, MCP server constant, doc schema if changed + migration test).
3. Rebuild the MCP bundle and confirm the app embeds the new one; run `doctor` against a fresh ATELIER_HOME.
4. Update CHANGELOG.md (Keep a Changelog), README screenshots/GIF if UI changed, and the Connect dialog text against current Claude Code/Codex docs (verify!).
5. Run security checks: npm audit, cargo audit, CSP check, capability review.
6. Build installers locally for the platforms available; list what CI will build for the rest.
7. Draft GitHub Release notes (highlights, install, upgrade notes, known issues, thanks).
8. Do NOT tag or publish: output the exact commands for me to run.
```
