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
4. **Showcase**: before/after GIFs of vibe-coded apps improved by AFrame. This *is* the marketing.
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
Check availability: GitHub org/repo, npm package (`aframe-mcp`), domain, existing trademarks (the word "AFrame" is used by other software; verify or rename). Logo: simple monogram on warm background; icon set via `tauri icon`.

## Sustainability (optional, decide early so it doesn't surprise you)
GitHub Sponsors / Open Collective; optional paid hosted add-ons later (cloud sync, team sharing) while core stays MIT; avoid relicensing traps.

## Telemetry
**None by default.** If ever added: opt-in, anonymous, documented, with a visible kill switch. Open-source trust is the product.

## Security disclosure
`SECURITY.md` with private reporting via GitHub Security Advisories; response within 72 h.

## Release checklist
State as of 2026-11-08 (docs/release.md has the how):
- [ ] Version bumped in package.json, Cargo.toml, tauri.conf.json, MCP server constant: **to do at release**; the new tools (export, lint fixOps, skills) need version 0.1.3 or later for installed apps to refresh their server, and the release workflow refuses a tag that disagrees
- [x] Doc `schema` migration: schema 1 is the only version; a newer one is refused with a clear message (tested). Nothing to migrate yet
- [x] `aframe-mcp` bundle rebuilt and embedded in the app on every build
- [ ] Installers signed/notarised: **not done** (needs your certificates). Windows installer smoke-tested by script on this machine; **no clean-VM run, and macOS/Linux never built**
- [ ] Install text (Connect dialog) verified against current Claude Code/Codex docs: written against the docs read earlier, not re-verified; run the Connect steps with the real CLIs before launch (docs/manual-e2e.md)
- [ ] Changelog + release notes + GIFs: changelog done; release notes and GIFs to do (docs/demo-script.md is the script)
- [ ] npm publish (package built and tested from a clean install, not published); GitHub Release (v0.1.2 pre-release exists; the release workflow has never run); update docs site
- [ ] Live-provider check of the built-in chat, a real Figma file and the eval harness with a real model: **none done**; they need your keys and files
- [ ] Auto-updater: not built (needs a signing key pair; docs/release.md)

### Outstanding risks
1. Everything model-facing (chat, evals) is proved against scripted replies, not a live model.
2. Three platforms are claimed by the code and proved on one.
3. Unsigned installers will scare some first users.
4. Figma import is untested on real files; the web-page import is a prototype.
5. The Claude/Codex install text may drift from those tools' current behaviour.

### Recommended alpha invitees
Five to ten people who build with Claude Code, Codex or Cursor, are not designers, and are on Windows. See docs/alpha-kit.md.
