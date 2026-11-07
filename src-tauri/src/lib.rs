//! Atelier desktop shell.
//!
//! The webview gets a tiny, confined file API (every path is relative to `~/.atelier`, see
//! `home.rs`), a way to tell the native side what is open, and events for agent requests. There is
//! no general file-system plugin and no shell: a compromised page can reach exactly these commands.

mod appstate;
mod bridge;
mod fsops;
mod home;
mod layout;
mod lock;

use appstate::SharedState;
use fsops::{Crash, DocWrite, Entry, Stat};
use home::Home;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager, State, WindowEvent};

/// The MCP server this app carries (see build.rs); installed into the home on launch when newer.
const BUNDLED_MCP: &str = include_str!(concat!(env!("OUT_DIR"), "/atelier-mcp.mjs"));

const REQUEST_EVENT: &str = "atelier://request";
const CLOSE_EVENT: &str = "atelier://close-requested";
/// If the page does not confirm it has saved within this time, quit anyway.
const CLOSE_GRACE: Duration = Duration::from_secs(4);

#[derive(Default)]
struct BridgeSeen(Mutex<HashSet<String>>);

#[derive(Serialize, Clone)]
struct RequestEvent {
    name: String,
    content: String,
}

#[tauri::command]
async fn atelier_home(home: State<'_, Home>) -> Result<String, String> {
    home.ensure()?;
    Ok(home.root().to_string_lossy().into_owned())
}

#[tauri::command]
async fn fs_read(home: State<'_, Home>, path: String) -> Result<Option<String>, String> {
    fsops::read(&home, &path)
}

#[tauri::command]
async fn fs_read_head(
    home: State<'_, Home>,
    path: String,
    max: usize,
) -> Result<Option<String>, String> {
    fsops::read_head(&home, &path, max)
}

#[tauri::command]
async fn fs_write(home: State<'_, Home>, path: String, content: String) -> Result<Stat, String> {
    fsops::write(&home, &path, &content)
}

#[tauri::command]
async fn fs_write_doc(
    home: State<'_, Home>,
    path: String,
    content: String,
    expect_rev: Option<u64>,
) -> Result<DocWrite, String> {
    fsops::write_doc(&home, &path, &content, expect_rev, Crash::None)
}

#[tauri::command]
async fn fs_list(home: State<'_, Home>, path: String) -> Result<Vec<Entry>, String> {
    fsops::list(&home, &path)
}

#[tauri::command]
async fn fs_remove(home: State<'_, Home>, path: String) -> Result<(), String> {
    fsops::remove(&home, &path)
}

#[tauri::command]
async fn fs_stat(home: State<'_, Home>, path: String) -> Result<Option<Stat>, String> {
    fsops::stat(&home, &path)
}

/// The webview reports what is open; the heartbeat thread publishes it in `app-state.json`.
#[tauri::command]
async fn app_state_set(
    state: State<'_, Arc<SharedState>>,
    current_project: Option<String>,
    selection: Vec<String>,
) -> Result<(), String> {
    state.set(current_project, selection);
    Ok(())
}

/// Requests that arrived before the page was listening are announced again.
#[tauri::command]
async fn bridge_resync(seen: State<'_, BridgeSeen>) -> Result<(), String> {
    seen.0.lock().unwrap().clear();
    Ok(())
}

/// The page has flushed its unsaved work; now the window may really close.
#[tauri::command]
async fn app_quit(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

fn spawn_request_watcher(app: tauri::AppHandle, home: Home) {
    std::thread::Builder::new()
        .name("atelier-requests".into())
        .spawn(move || {
            let mut sweeps = 0u32;
            loop {
                let seen = app.state::<BridgeSeen>();
                let found = {
                    let mut g = seen.0.lock().unwrap();
                    bridge::scan_requests(&home, &mut g)
                };
                for (name, content) in found {
                    let _ = app.emit(REQUEST_EVENT, RequestEvent { name, content });
                }
                sweeps += 1;
                if sweeps.is_multiple_of(240) {
                    bridge::sweep_old(&home); // about once a minute
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        })
        .expect("could not start the request watcher");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let closing = Arc::new(AtomicBool::new(false));

    tauri::Builder::default()
        // Must be first: a second launch focuses the running window instead of opening another
        // (two apps on one home directory would fight over the same files).
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(BridgeSeen::default())
        .manage(Arc::new(SharedState::default()))
        .setup(|app| {
            let home = Home::from_env()?;
            layout::ensure_layout(&home, BUNDLED_MCP)?;
            appstate::spawn_heartbeat(
                home.clone(),
                Arc::clone(&app.state::<Arc<SharedState>>()),
                app.package_info().version.to_string(),
            );
            spawn_request_watcher(app.handle().clone(), home.clone());
            app.manage(home);
            Ok(())
        })
        .on_window_event(move |window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Let the page save first. It answers with `app_quit`; if it never does (a hung
                // page), the grace period below quits anyway so the window can always be closed.
                if closing.swap(true, Ordering::SeqCst) {
                    return; // second attempt: close now
                }
                api.prevent_close();
                let _ = window.emit(CLOSE_EVENT, ());
                let app = window.app_handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(CLOSE_GRACE);
                    app.exit(0);
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            atelier_home,
            fs_read,
            fs_read_head,
            fs_write,
            fs_write_doc,
            fs_list,
            fs_remove,
            fs_stat,
            app_state_set,
            bridge_resync,
            app_quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running Atelier");
}
