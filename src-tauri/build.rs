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
        ]),
    ))
    .expect("failed to run the Tauri build script");
}
