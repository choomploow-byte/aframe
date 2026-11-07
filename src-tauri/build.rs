fn main() {
    // Declaring the app's own commands makes each one a named permission (`allow-fs-read`, ...)
    // that capabilities/default.json must grant, instead of every command being open to every window.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "atelier_home",
            "fs_read",
            "fs_read_head",
            "fs_write",
            "fs_write_doc",
            "fs_list",
            "fs_remove",
            "fs_stat",
            "app_state_set",
            "bridge_resync",
            "app_quit",
            "export_folder",
            "export_pick_folder",
            "export_files",
        ]),
    ))
    .expect("failed to run the Tauri build script");

    embed_mcp_bundle();
}

/// The app carries the MCP server and installs it into ~/.atelier/mcp on launch. The bundle is built
/// by `npm run build:mcp` (the release build runs it first). A build without it (cargo test, a quick
/// `tauri dev`) embeds a clearly marked placeholder instead of failing.
fn embed_mcp_bundle() {
    use std::{env, fs, path::Path};
    let out = Path::new(&env::var("OUT_DIR").expect("OUT_DIR")).join("atelier-mcp.mjs");
    let bundle = Path::new("..")
        .join("mcp")
        .join("dist")
        .join("atelier-mcp.mjs");
    println!("cargo:rerun-if-changed={}", bundle.display());
    let content = fs::read_to_string(&bundle).unwrap_or_else(|_| {
        "// atelier-generated placeholder. This build of the app was made without the MCP bundle.
console.error('Atelier MCP server: not included in this build (run npm run build:mcp, then rebuild the app).');
process.exit(1);
"
            .to_string()
    });
    fs::write(out, content).expect("could not write the embedded MCP bundle");
}
