// The one place product-name literals live. Phase 11's rename script edits this file
// (plus tauri.conf.json / Cargo.toml). Do not scatter these strings elsewhere.
export const BRAND = {
  name: 'Atelier',
  /** Lower-case slug used for npm package, file extension and CLI. */
  slug: 'atelier',
  bundleId: 'dev.atelier.app',
  /** Directory under the user's home that holds projects, bridge files and skills. */
  homeDirName: '.atelier',
  /** Env var that overrides the home directory (tests, dev mode). */
  homeEnvVar: 'ATELIER_HOME',
  projectFileName: 'project.atelier.json',
  mcpServerName: 'atelier',
} as const;
