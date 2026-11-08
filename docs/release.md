# Releasing AFrame

What exists, what you have to supply, and what has not been proved. Read it before pushing the first tag.

## What a release does (`.github/workflows/release.yml`)

Push a tag `vX.Y.Z`:

1. **check**: the tag must equal the version in `package.json`, `src-tauri/Cargo.toml` and
   `src-tauri/tauri.conf.json`. Bump all three together (and run `npm run build:mcp`, which embeds the
   version in the MCP server; the app only refreshes the installed server when its version is newer).
2. **desktop** (Windows, macOS universal, Linux): builds the installers with `tauri-action` into a **draft
   pre-release** and uploads `SHA256SUMS-<os>.txt` beside them. You publish the draft by hand after
   trying an installer.
3. **npm-mcp**: `npm run pack:mcp` then `npm publish --provenance` of `aframe-mcp`.

**Not yet proved.** The workflow has never run. The Windows installer has been built and smoke-tested by
hand on a Windows machine (silent install, launch, check, uninstall: `tests/e2e/installer-smoke.mjs`).
macOS and Linux have never been built by the author; the Rust tests and the app are written to be portable
(Linux needs `libdbus-1-dev` for the keychain crate, which the workflow installs), but the first run is the
test. Expect to fix something. The `aframe-mcp` package has been packed and installed from a clean folder
in a test (`tests/node/npm-package.test.ts`) and has not been published.

## What you must supply

| Secret | For | How to get it |
|---|---|---|
| `NPM_TOKEN` | publishing `aframe-mcp` | npmjs.com > Access Tokens > an automation token for the account that will own the name. Check the name `aframe-mcp` is free first, or rename (see below). |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | signing and notarising the macOS app | An Apple Developer account (paid). Without them the app is unsigned: macOS Gatekeeper blocks it until the user right-clicks > Open. |
| Windows signing | removing SmartScreen's "unknown publisher" | An EV or standard code-signing certificate, or Azure Artifact Signing; wire it into `tauri.conf.json` (`bundle.windows.signCommand` or certificate thumbprint). Note a new certificate does not give instant SmartScreen reputation. |
| `TAURI_SIGNING_PRIVATE_KEY` (and `_PASSWORD`) | the auto-updater | `npx tauri signer generate -w ~/.tauri/aframe.key`, keep the key secret, put the public key in `tauri.conf.json`. |

Unsigned installers work and are what the first pre-release ships. The release notes must say so.

## Auto-update (not built)

There is no in-app updater: `tauri-plugin-updater` needs a signing key pair that only you can create, and a
public key baked into the app. When you have generated the key pair: add the plugin
(`tauri-plugin-updater`, `@tauri-apps/plugin-updater`), set `plugins.updater.pubkey` and `endpoints` (the
GitHub release's `latest.json`) in `tauri.conf.json`, give the main window the `updater:default` permission,
build with `TAURI_SIGNING_PRIVATE_KEY`, and add a "Check for updates" action. The MCP server inside the app
already refreshes itself on launch when the app is newer (`src-tauri/src/layout.rs`). Until then users
download a new installer; `docs/14-open-source-and-release.md` tracks it.

## Choosing the final name

`node scripts/rename.mjs --name "Foo Studio" --slug foostudio --bundle-id com.foo.studio` (dry run first,
then `--apply` on a clean checkout, then `npm run build:mcp && npm test`). It rewrites 220+ tracked files and
renames the files whose names contain the old one, keeps `CHANGELOG.md` as history, and leaves links to this
GitHub repository alone (add `--rename-repo-urls` once the repository is renamed). It has been proved by
running it on a clone: the renamed project type-checks, builds the MCP bundle and passes the unit suite.
It cannot change the logo and app icons (images), rename the GitHub repository, or pick a free npm name.

## The checklist

See `docs/14-open-source-and-release.md` (Release checklist) for the state of each item.
