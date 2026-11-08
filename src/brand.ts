// The one place product-name literals live. Phase 11's rename script edits this file
// (plus tauri.conf.json / Cargo.toml). Do not scatter these strings elsewhere.
export const BRAND = {
  name: 'AFrame',
  /** Lower-case slug used for npm package, file extension and CLI. */
  slug: 'aframe',
  bundleId: 'dev.aframe.app',
  /** Directory under the user's home that holds projects, bridge files and skills. */
  homeDirName: '.aframe',
  /** Env var that overrides the home directory (tests, dev mode). */
  homeEnvVar: 'AFRAME_HOME',
  projectFileName: 'project.aframe.json',
  mcpServerName: 'aframe',
} as const;
