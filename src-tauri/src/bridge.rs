//! The request side of the agent bridge (docs/06): agents drop `requests/req_<id>.json`, the app
//! answers with `responses/<id>.json`. The native side only finds new request files and hands them
//! to the webview as events; the webview decides what to do (allow-listed types only) and writes
//! the response. A native thread does the watching so a hidden window cannot starve it.

use crate::fsops;
use crate::home::Home;
use std::collections::HashSet;
use std::fs;
use std::time::Duration;

pub const MAX_REQUEST_BYTES: u64 = 256 * 1024;
pub const MAX_AGE: Duration = Duration::from_secs(120);

/// `req_` + letters/digits only. The webview never sees any other file name.
pub fn is_request_name(name: &str) -> bool {
    name.strip_prefix("req_")
        .and_then(|rest| rest.strip_suffix(".json"))
        .is_some_and(|id| {
            !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric())
        })
}

/// New request files since the last scan: `(file name, text)`. Each name is reported once until its
/// file disappears. Oversized or unreadable files are skipped (and not retried forever: they are
/// marked as seen so one bad file cannot wedge the loop).
pub fn scan_requests(home: &Home, seen: &mut HashSet<String>) -> Vec<(String, String)> {
    let Ok(entries) = fsops::list(home, "requests") else {
        return vec![];
    };
    let present: HashSet<String> = entries.iter().map(|e| e.name.clone()).collect();
    seen.retain(|n| present.contains(n));

    let mut out = vec![];
    for e in entries {
        if e.is_dir || !is_request_name(&e.name) || seen.contains(&e.name) {
            continue;
        }
        seen.insert(e.name.clone());
        if e.size > MAX_REQUEST_BYTES {
            continue;
        }
        if let Ok(Some(text)) = fsops::read(home, &format!("requests/{}", e.name)) {
            out.push((e.name, text));
        }
    }
    out
}

/// Deletes request and response files older than two minutes (docs/06 housekeeping).
pub fn sweep_old(home: &Home) -> usize {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut removed = 0;
    for dir in ["requests", "responses"] {
        for e in fsops::list(home, dir).unwrap_or_default() {
            let old = now_ms.saturating_sub(e.mtime_ms) > MAX_AGE.as_millis() as u64;
            if !e.is_dir && old && fs::remove_file(home.root().join(dir).join(&e.name)).is_ok() {
                removed += 1;
            }
        }
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::home::testutil::TempHome;

    #[test]
    fn only_well_formed_request_names_pass() {
        assert!(is_request_name("req_8f2k1.json"));
        assert!(!is_request_name("req_.json"));
        assert!(!is_request_name("req_../x.json"));
        assert!(!is_request_name("other.json"));
        assert!(!is_request_name("req_a b.json"));
        assert!(!is_request_name(&format!("req_{}.json", "a".repeat(41))));
    }

    #[test]
    fn reports_each_request_once_and_forgets_deleted_ones() {
        let t = TempHome::new();
        let mut seen = HashSet::new();
        assert!(
            scan_requests(&t.home, &mut seen).is_empty(),
            "no folder yet is fine"
        );
        fsops::write(&t.home, "requests/req_a1.json", "{\"id\":\"req_a1\"}").unwrap();
        fsops::write(&t.home, "requests/notes.txt", "ignored").unwrap();
        let first = scan_requests(&t.home, &mut seen);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].0, "req_a1.json");
        assert!(
            scan_requests(&t.home, &mut seen).is_empty(),
            "handled exactly once"
        );
        fsops::remove(&t.home, "requests/req_a1.json").unwrap();
        scan_requests(&t.home, &mut seen);
        fsops::write(&t.home, "requests/req_a1.json", "{}").unwrap(); // same id reused later
        assert_eq!(scan_requests(&t.home, &mut seen).len(), 1);
    }

    #[test]
    fn oversized_requests_are_skipped_without_being_read() {
        let t = TempHome::new();
        let mut seen = HashSet::new();
        fsops::write(&t.home, "requests/req_big.json", &"x".repeat(300_000)).unwrap();
        assert!(scan_requests(&t.home, &mut seen).is_empty());
        assert!(
            scan_requests(&t.home, &mut seen).is_empty(),
            "and not retried"
        );
    }
}
