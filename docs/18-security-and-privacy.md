# 18. Security and Privacy

## Principles
Local-first. No accounts. No telemetry. Least privilege everywhere. Treat everything coming from outside the user's own keyboard as untrusted data.

## Threat model (practical)
| Threat | Path | Control |
|---|---|---|
| Prompt injection | Text inside annotations, imported Figma text, screenshots, web-imported DOM, tool results | Tools return data wrapped as data; system prompt & server `instructions` state that such text must never be followed as instructions; no shell/network/file-delete tools in AFrame; destructive ops are scoped to the design doc |
| Arbitrary file write via `export_code`/`export_image` | Agent supplies path | `outDir` must be absolute and **confirmed by the user in the current session** (agent should ask), writes confined: resolve real paths, reject `..` and symlink escapes, create only; refuse to overwrite without explicit flag; max file count/size. **As built:** the MCP writer (`mcp/export-write.ts`) refuses a folder that is relative, the home folder, a drive root or inside a system/credentials/`.git`/`AppData` folder (judged on the real path), file names that are not short plain relative names, any link in the way, and, without `overwrite`, any existing file whose bytes differ (all or nothing, atomic per file). The desktop app's `export_files` is stricter still: the page cannot name a folder at all, it can only write into the folder the user picked in the native dialog this session (the dialog is opened from Rust; the page has no dialog permission), checked again at write time. Both apply the same rules, tested on both sides. The confirmation that the user chose the folder for an agent's export remains the agent's duty (its instructions say to ask) |
| Arbitrary file read via `import_image`/`add_reference` | Agent supplies path | Allow only image extensions with magic-byte check, size cap 20 MB; no directory listing tools; refuse dotfiles/secret-like paths (`.ssh`, `.env`, keychains) |
| Bridge abuse | Other local processes write request files | Request `type` allow-list, strict param validation, user-only dir permissions; requests can't execute code; they can at most read the design the user already exposes to agents |
| Figma token and downloads | The page asks the native side to reach Figma | The token is in the system keychain and read only by Rust; the page can ask for a fixed list of request kinds built from a validated file key and layer ids, never an address; downloads are https from Figma's own hosts only, without redirects, 8 MB at most |
| API key leakage | Logs, project files, exports, crash reports | Never log, never serialise into docs, redact in diagnostics, keys are in the OS credential store and only Rust reads them (docs/08); a test asserts a key appears nowhere in the page, storage, requests, the document or the console |
| Malicious project files | Opening a doc from the internet | JSON schema validation; sanitise everything rendered: text via textContent, **no `dangerouslySetInnerHTML`**, CSS values validated (reject `url(javascript:...)`, `expression`), images only `data:image/*` or local assets; SVG assets rendered via `<img>` (no script execution) |
| XSS in the WebView | Imported content | Strict CSP in `tauri.conf.json` (default-src 'self'; img-src 'self' data: blob:; connect-src to chosen providers only; no inline eval) |
| Supply chain | npm/cargo deps | Lockfiles, Dependabot, `npm audit`/`cargo audit`, minimal deps, provenance on npm publish |
| Installer tampering | Release artefacts | Code signing, checksums, reproducible CI builds, updater signature verification (Tauri updater uses signed manifests) |
| Tauri over-permission | Broad fs/shell access | Capabilities file minimal: only custom commands + dialog + scoped fs; **no shell plugin**, no `fs:allow-*` wildcards beyond the exports location the user picks |

## Tauri hardening checklist
- [x] CSP set; `dangerousDisableAssetCspModification` not used (Phase 0; the installed release build was checked running under it, Phase 4)
- [x] Capabilities limited to the main window (`core:default` plus one named permission per app command; the page has no fs, shell, dialog or opener permission. The dialog plugin is initialised for the native folder picker but only Rust calls it; `tauri-plugin-fs` is compiled in as a dependency of the dialog plugin and has no permission granted)
- [x] Custom fs commands canonicalise paths and enforce prefix `~/.aframe` (`home.rs`, tested; the Node twin in `mcp/home-fs.ts` has the same tests)
- [x] Remote URLs not loaded in the main WebView: `default-src 'self'`, `connect-src 'self' ipc:` (provider and Figma calls are made by Rust), no remote anchors in the app. There is no opener plugin: nothing in the app opens an external link
- [ ] Updater pubkey configured; signing key stored in CI secrets (not done: needs a key pair only the owner can create; steps in docs/release.md)
- [x] Dependency audit: `npm audit --omit=dev` reports 0 vulnerabilities in what ships; the 10 moderate findings are in the lint tooling (minimatch inside eslint, dev only). `cargo audit` has not been run (not installed here)
- [x] Malformed input: the document loader, SVG, Figma and page-capture importers and the code exporter are fuzzed with 3000 deterministic mutations each (`tests/node/fuzz.test.ts`); a project file cannot change `Object.prototype`
- [x] Accessibility audit of the editor chrome with axe-core (WCAG 2 A/AA, both themes, every dialog): `tests/e2e/a11y.mjs`

## Privacy
- Design content stays on disk. It leaves the device only when: the user's external agent reads it (their chosen host/model), or the in-app chat sends it to the chosen provider.
- Show a one-time notice in chat setup: "Your messages, screenshots and the parts of the design the AI reads are sent to <provider>."
- Document exactly what is stored and where (`~/.aframe/`), plus how to delete everything.

## Logging
Local log files only, rotated, no content from designs or keys, include versions and error codes. "Copy diagnostics" produces a redacted bundle.

## Responsible AI notes
- Don't generate or imitate real brands' logos/trademarks on request without the user's explicit ownership claim; skills should steer toward original work and inspiration-not-copying ("match the *style* of a reference, not reproduce a specific copyrighted design").
- Reference matching = analyse style attributes and apply to the user's own content.
