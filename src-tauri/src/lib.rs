//! Atelier desktop shell. Phase 0 only opens the web UI in a window; the confined fs commands,
//! single-instance and window-state plugins arrive in Phase 4 (docs/06, docs/18).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Atelier");
}
