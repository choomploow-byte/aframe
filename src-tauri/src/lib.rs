//! AFrame desktop shell.
//!
//! The webview gets a tiny, confined file API (every path is relative to `~/.aframe`, see
//! `home.rs`), a way to tell the native side what is open, and events for agent requests. There is
//! no general file-system plugin and no shell: a compromised page can reach exactly these commands.

mod ai;
mod appstate;
mod bridge;
mod export;
mod figma;
mod fsops;
mod home;
mod layout;
mod legacy;
mod lock;

use appstate::SharedState;
use export::{ExportFile, ExportRoot, WriteReport};
use fsops::{Crash, DocWrite, Entry, Stat};
use home::Home;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager, State, WindowEvent};

/// The MCP server this app carries (see build.rs); installed into the home on launch when newer.
const BUNDLED_MCP: &str = include_str!(concat!(env!("OUT_DIR"), "/aframe-mcp.mjs"));

const REQUEST_EVENT: &str = "aframe://request";
const CLOSE_EVENT: &str = "aframe://close-requested";
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
async fn aframe_home(home: State<'_, Home>) -> Result<String, String> {
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

/// The folder the user picked for exports this session, if any (for display).
#[tauri::command]
async fn export_folder(root: State<'_, ExportRoot>) -> Result<Option<String>, String> {
    Ok(root.0.lock().unwrap().as_deref().map(export::display))
}

/// Opens the system "choose a folder" dialog. The page never names a folder: whatever the user
/// picks here is the only place `export_files` will write.
#[tauri::command]
async fn export_pick_folder(
    app: tauri::AppHandle,
    root: State<'_, ExportRoot>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Choose a folder for the export")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let real = export::check_root(&path, dirs::home_dir().as_deref())?;
    let shown = export::display(&real);
    *root.0.lock().unwrap() = Some(real);
    Ok(Some(shown))
}

/// Writes an export into the folder the user picked. See `export.rs` for the rules.
#[tauri::command]
async fn export_files(
    root: State<'_, ExportRoot>,
    files: Vec<ExportFile>,
    overwrite: bool,
) -> Result<WriteReport, String> {
    let chosen = root
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or("Choose a folder first.")?;
    // Checked again now: the folder may have changed (replaced by a link) since it was picked.
    let real = export::check_root(&chosen, dirs::home_dir().as_deref())?;
    export::write_files(&real, &files, overwrite)
}

/// Whether a key is stored for a provider. The key itself never leaves the credential store.
#[tauri::command]
async fn ai_key_status(provider: String) -> Result<bool, String> {
    ai::key_present(ai::Provider::parse(&provider)?)
}

#[tauri::command]
async fn ai_key_set(provider: String, key: String) -> Result<(), String> {
    ai::key_set(ai::Provider::parse(&provider)?, &key)
}

#[tauri::command]
async fn ai_key_clear(provider: String) -> Result<(), String> {
    ai::key_clear(ai::Provider::parse(&provider)?)
}

/// Sends one request body to the provider with the stored key. See `ai.rs` for what the page can
/// and cannot influence (the address is fixed per provider; a custom one is checked).
#[tauri::command]
async fn ai_send(
    provider: String,
    base_url: Option<String>,
    body: serde_json::Value,
) -> Result<ai::AiReply, String> {
    let provider = ai::Provider::parse(&provider)?;
    tauri::async_runtime::spawn_blocking(move || ai::send(provider, base_url.as_deref(), &body))
        .await
        .map_err(|_| "The request was interrupted.".to_string())?
}

/// One Figma request with the stored token. See `figma.rs` for what the page can and cannot ask.
#[tauri::command]
async fn figma_get(
    kind: String,
    key: String,
    ids: Option<String>,
    depth: Option<u8>,
) -> Result<figma::FigmaReply, String> {
    tauri::async_runtime::spawn_blocking(move || figma::get(&kind, &key, ids.as_deref(), depth))
        .await
        .map_err(|_| "The request was interrupted.".to_string())?
}

/// Downloads a picture from an address Figma gave back (https, Figma's own hosts only).
#[tauri::command]
async fn figma_download(url: String) -> Result<figma::Picture, String> {
    tauri::async_runtime::spawn_blocking(move || figma::download(&url))
        .await
        .map_err(|_| "The request was interrupted.".to_string())?
}

/// The page has flushed its unsaved work; now the window may really close.
#[tauri::command]
async fn app_quit(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

fn spawn_request_watcher(app: tauri::AppHandle, home: Home) {
    std::thread::Builder::new()
        .name("aframe-requests".into())
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
        .plugin(tauri_plugin_dialog::init())
        .manage(ExportRoot::default())
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
            aframe_home,
            fs_read,
            fs_read_head,
            fs_write,
            fs_write_doc,
            fs_list,
            fs_remove,
            fs_stat,
            app_state_set,
            bridge_resync,
            app_quit,
            export_folder,
            export_pick_folder,
            export_files,
            ai_key_status,
            ai_key_set,
            ai_key_clear,
            ai_send,
            figma_get,
            figma_download
        ])
        .run(tauri::generate_context!())
        .expect("error while running AFrame");
}
