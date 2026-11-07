# Phase 11: Polish, Packaging, Launch

**Read:** docs/14, docs/19, docs/07 (onboarding), docs/09 (distribution), docs/18 (hardening checklist).

## Goal
Something strangers can install in two minutes and love.

## Tasks
1. **Onboarding**: welcome flow, sample projects/templates (landing, dashboard, mobile app, pricing, portfolio) as JSON in the bundle; first-run connect experience; helpful empty states everywhere.
2. **Performance pass** per docs/19: profile 2,000-node doc, add culling, optimise hot paths, add debug HUD, add CI benchmark. Report before/after.
3. **Accessibility pass** (editor chrome): keyboard map complete, roles/labels, contrast audit both themes, reduced motion, screen-reader announcements.
4. **Error handling**: global error boundary with "Copy diagnostics", log rotation, corruption recovery flows, MCP version mismatch warning.
5. **Auto-update** (`tauri-plugin-updater`) with signed manifests; update notification UX; MCP bundle refresh on update.
6. **Signing/notarisation** in release workflow (document required secrets; works unsigned for alpha with clear notes).
7. **Release workflow**: tag -> build 3 OSes -> GitHub Release with checksums; publish `atelier-mcp` to npm (provenance); changelog automation.
8. **Docs site/README**: hero GIF, quick start, "Connect Claude Code" paste block, FAQ, troubleshooting matrix (docs/09), contributing, roadmap, skills gallery. `docs/user-guide.md` with every feature.
9. **Security review**: walk the docs/18 checklist; run `npm audit`/`cargo audit`; CSP verification; fuzz the doc loader with malformed JSON.
10. **Alpha test kit**: feedback form template, script to capture diagnostics, 10 test tasks for testers.
11. **Rename tooling**: a script that replaces the placeholder name everywhere (package names, bundle id, strings, paths) so the final name is a 1-minute change.

## Acceptance
- Clean-machine install on Windows/macOS/Linux in < 2 min (state which you actually tested).
- Cold start < 2 s; 2,000-node doc stays interactive.
- New contributor runs the dev environment in 10 min following the README alone (test it with a fresh clone).
- Security checklist fully ticked or each gap documented.

## Report back with
The launch checklist state (docs/14), outstanding risks, and the recommended alpha invitees' profile.
