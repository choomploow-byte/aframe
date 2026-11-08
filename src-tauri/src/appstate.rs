//! `app-state.json`: "the app is alive and this is what it is looking at".
//!
//! Written by a native thread, not by the webview: a minimized or hidden window throttles its
//! timers to once a second or worse, which would make the heartbeat look dead exactly when an
//! agent asks for a screenshot. The webview only tells us the current project and selection.
//!
//! Split from the agents' own files (`agents/<pid>.json`, Phase 5) so there is exactly one writer
//! per file: read-modify-write on a shared `state.json` would lose updates (docs/06).

use crate::fsops::{write_atomic, Crash};
use crate::home::{iso_now, Home};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const HEARTBEAT: Duration = Duration::from_secs(2);
const TICK: Duration = Duration::from_millis(100);
const MIN_GAP: Duration = Duration::from_millis(200);
const MAX_SELECTION: usize = 500;

#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub current_project: Option<String>,
    pub selection: Vec<String>,
}

#[derive(Default)]
pub struct SharedState {
    inner: Mutex<(Snapshot, bool)>, // (snapshot, changed since last write)
}

/// Ids look like `n_ab12cd`, `p_sample`. Anything else is dropped rather than written to a file
/// other processes read.
pub fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

impl SharedState {
    pub fn set(&self, current_project: Option<String>, selection: Vec<String>) {
        let snap = Snapshot {
            current_project: current_project.filter(|p| valid_id(p)),
            selection: selection
                .into_iter()
                .filter(|s| valid_id(s))
                .take(MAX_SELECTION)
                .collect(),
        };
        let mut g = self.inner.lock().unwrap();
        if g.0 != snap {
            *g = (snap, true);
        }
    }

    fn take(&self) -> (Snapshot, bool) {
        let mut g = self.inner.lock().unwrap();
        let changed = g.1;
        g.1 = false;
        (g.0.clone(), changed)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StateFile<'a> {
    app_heartbeat: String,
    app_pid: u32,
    app_version: &'a str,
    current_project: &'a Option<String>,
    selection: &'a [String],
}

pub const STATE_FILE: &str = "app-state.json";

pub fn write_state(home: &Home, snap: &Snapshot, version: &str) -> Result<(), String> {
    let file = StateFile {
        app_heartbeat: iso_now(),
        app_pid: std::process::id(),
        app_version: version,
        current_project: &snap.current_project,
        selection: &snap.selection,
    };
    let json = serde_json::to_string(&file).map_err(|e| e.to_string())?;
    write_atomic(
        &home.confine_target(STATE_FILE)?,
        json.as_bytes(),
        Crash::None,
    )
}

/// Heartbeat every 2 s, and immediately (at most every 200 ms) when the project or selection changes.
pub fn spawn_heartbeat(home: Home, state: Arc<SharedState>, version: String) {
    thread::Builder::new()
        .name("aframe-heartbeat".into())
        .spawn(move || {
            let mut last_write: Option<Instant> = None;
            loop {
                let (snap, changed) = state.take();
                let due = last_write.is_none_or(|t| t.elapsed() >= HEARTBEAT);
                let soon = last_write.is_none_or(|t| t.elapsed() >= MIN_GAP);
                if due || (changed && soon) {
                    if let Err(e) = write_state(&home, &snap, &version) {
                        eprintln!("heartbeat: {e}");
                    }
                    last_write = Some(Instant::now());
                } else if changed {
                    // Too soon after the last write: put the change back for the next tick.
                    let mut g = state.inner.lock().unwrap();
                    g.1 = true;
                }
                thread::sleep(TICK);
            }
        })
        .expect("could not start the heartbeat thread");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fsops::read;
    use crate::home::testutil::TempHome;

    #[test]
    fn state_file_has_the_fields_agents_read() {
        let t = TempHome::new();
        let snap = Snapshot {
            current_project: Some("p_abc12".into()),
            selection: vec!["n_1".into(), "n_2".into()],
        };
        write_state(&t.home, &snap, "0.1.0").unwrap();
        let v: serde_json::Value =
            serde_json::from_str(&read(&t.home, STATE_FILE).unwrap().unwrap()).unwrap();
        assert_eq!(v["currentProject"], "p_abc12");
        assert_eq!(v["selection"], serde_json::json!(["n_1", "n_2"]));
        assert_eq!(v["appVersion"], "0.1.0");
        assert_eq!(v["appPid"], std::process::id());
        assert!(v["appHeartbeat"].as_str().unwrap().ends_with('Z'));
    }

    #[test]
    fn ids_from_the_webview_are_validated_and_capped() {
        let s = SharedState::default();
        let many: Vec<String> = (0..2000).map(|i| format!("n_{i}")).collect();
        let mut sel = many;
        sel.push("../../etc".into());
        sel.push("has space".into());
        s.set(Some("../x".into()), sel);
        let (snap, changed) = s.take();
        assert!(changed);
        assert_eq!(snap.current_project, None, "a bad project id is dropped");
        assert_eq!(snap.selection.len(), MAX_SELECTION);
        assert!(snap.selection.iter().all(|x| valid_id(x)));
        // Setting the same thing again is not a change (no needless writes).
        s.set(None, snap.selection.clone());
        assert!(!s.take().1);
    }

    #[test]
    fn the_heartbeat_thread_writes_and_follows_changes() {
        let t = TempHome::new();
        let state = Arc::new(SharedState::default());
        spawn_heartbeat(t.home.clone(), Arc::clone(&state), "9.9.9".into());
        let wait_for = |pred: &dyn Fn(&serde_json::Value) -> bool| {
            for _ in 0..60 {
                if let Ok(Some(text)) = read(&t.home, STATE_FILE) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                        if pred(&v) {
                            return true;
                        }
                    }
                }
                thread::sleep(Duration::from_millis(50));
            }
            false
        };
        assert!(
            wait_for(&|v| v["appVersion"] == "9.9.9"),
            "first heartbeat is immediate"
        );
        state.set(Some("p_live1".into()), vec!["n_9".into()]);
        assert!(
            wait_for(&|v| v["currentProject"] == "p_live1" && v["selection"][0] == "n_9"),
            "changes are written within ~200 ms, not on the next 2 s beat"
        );
    }
}
