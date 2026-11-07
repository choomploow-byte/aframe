# 14. Open Source and Release

## Licence
MIT recommended (simplest; maximum adoption). Alternative: Apache-2.0 (explicit patent grant). Decide once, add SPDX headers optional. Keep `THIRD_PARTY_NOTICES.md`.

## Repo hygiene
- `README.md`: 15-second pitch, GIF, install, "Connect Claude Code" paste block, features, FAQ, contributing link.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant), `SECURITY.md` (how to report), `CHANGELOG.md` (Keep a Changelog), `ROADMAP.md` (public subset of doc 12), issue/PR templates (`templates/github/`), labels (`good first issue`, `skills`, `exporter`, `importer`, `design-quality`).
- Branching: trunk-based, short-lived PR branches, conventional commits (`feat:`, `fix:`, `docs:`).
- Releases: semver, `0.x` until stable doc schema; schema version tracked separately and migrations tested.

## Community levers (what makes open source projects actually grow)
1. **Skills as the contribution on-ramp.** Skills are markdown: anyone can contribute "SaaS dashboard patterns", "e-commerce product page", "brutalist style". Create `skills/community/` with a template and a PR checklist; show gallery in README.
2. **Templates/sample projects** (landing, dashboard, mobile, pricing, portfolio, docs site).
3. **Exporters/importers registry** with clear interfaces: "add a Vue exporter" as a good first issue.
4. **Showcase**: before/after GIFs of vibe-coded apps improved by Atelier. This *is* the marketing.
5. **Discord or GitHub Discussions** from day one.
6. Public roadmap + monthly release notes.

## Launch plan
| When | What |
|---|---|
| T-4 weeks | Private alpha with 10 vibe coders; collect transcripts and failures; fix install friction |
| T-2 weeks | Record demo video (60-90 s): paste one line into Claude Code -> design transforms -> code in repo |
| T-1 week | Docs site, README polish, signed installers, npm package, sample projects |
| Launch day | Post to Hacker News (Show HN), r/ClaudeAI, r/vibecoding, X, Product Hunt, relevant Discords; be present for 24h |
| After | Weekly releases for a month; respond to every issue within 24h; highlight community skills |

## Naming and branding checklist
Check availability: GitHub org/repo, npm package (`atelier-mcp`), domain, existing trademarks (the word "Atelier" is used by other software; verify or rename). Logo: simple monogram on warm background; icon set via `tauri icon`.

## Sustainability (optional, decide early so it doesn't surprise you)
GitHub Sponsors / Open Collective; optional paid hosted add-ons later (cloud sync, team sharing) while core stays MIT; avoid relicensing traps.

## Telemetry
**None by default.** If ever added: opt-in, anonymous, documented, with a visible kill switch. Open-source trust is the product.

## Security disclosure
`SECURITY.md` with private reporting via GitHub Security Advisories; response within 72 h.

## Release checklist
- [ ] Version bumped in package.json, Cargo.toml, tauri.conf.json, MCP server constant
- [ ] Doc `schema` migration tested from previous release fixtures
- [ ] `atelier-mcp` bundle rebuilt and embedded in the app
- [ ] Installers signed/notarised; smoke-tested on clean VMs
- [ ] Install text (Connect dialog) verified against current Claude Code/Codex docs
- [ ] Changelog + release notes + GIFs
- [ ] npm publish; GitHub Release; update docs site
