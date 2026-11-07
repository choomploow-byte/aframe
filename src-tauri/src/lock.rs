//! A tiny advisory lock: an exclusively-created `.lock` file next to the thing being protected.
//!
//! Atomic rename protects readers from half-written files but not writers from each other: two
//! read-modify-write cycles can still lose an update. Every writer of a project file (this app and
//! the MCP server, which implements the same protocol in Node) holds `<project>/.lock` for the few
//! milliseconds of its compare-and-write. A lock older than `STALE` belongs to a crashed process
//! and is taken over. Protocol: docs/06.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread::sleep;
use std::time::{Duration, SystemTime};

pub const STALE: Duration = Duration::from_secs(5);
pub const WAIT: Duration = Duration::from_secs(3);
const POLL: Duration = Duration::from_millis(15);

pub struct DirLock {
    path: PathBuf,
}

impl DirLock {
    pub fn acquire(path: &Path) -> Result<DirLock, String> {
        Self::acquire_with(path, WAIT, STALE)
    }

    pub fn acquire_with(path: &Path, wait: Duration, stale: Duration) -> Result<DirLock, String> {
        let started = std::time::Instant::now();
        loop {
            match OpenOptions::new().write(true).create_new(true).open(path) {
                Ok(mut f) => {
                    let _ = write!(f, "{{\"pid\":{}}}", std::process::id());
                    return Ok(DirLock {
                        path: path.to_path_buf(),
                    });
                }
                // Windows reports "Access is denied" instead of "already exists" while another
                // process is in the middle of deleting the lock file: also contention, so wait.
                Err(e)
                    if e.kind() == std::io::ErrorKind::AlreadyExists
                        || e.kind() == std::io::ErrorKind::PermissionDenied =>
                {
                    let age = fs::metadata(path)
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| SystemTime::now().duration_since(t).ok());
                    if age.is_some_and(|a| a > stale) {
                        // Left behind by a process that died while holding it.
                        let _ = fs::remove_file(path);
                        continue;
                    }
                    if started.elapsed() >= wait {
                        return Err(
                            "LOCKED: another Atelier process is writing this project".into()
                        );
                    }
                    sleep(POLL);
                }
                Err(e) => return Err(format!("could not take the project lock: {e}")),
            }
        }
    }
}

impl Drop for DirLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::home::testutil::TempHome;

    #[test]
    fn is_exclusive_and_released_on_drop() {
        let t = TempHome::new();
        let path = t.home.root().join("x.lock");
        let a = DirLock::acquire_with(&path, Duration::from_millis(50), STALE).unwrap();
        assert!(DirLock::acquire_with(&path, Duration::from_millis(50), STALE).is_err());
        drop(a);
        assert!(DirLock::acquire_with(&path, Duration::from_millis(50), STALE).is_ok());
        assert!(!path.exists(), "dropped locks leave no file");
    }

    #[test]
    fn takes_over_a_lock_left_by_a_crashed_process() {
        let t = TempHome::new();
        let path = t.home.root().join("x.lock");
        fs::write(&path, "{\"pid\":1}").unwrap();
        // Not stale yet: refused.
        assert!(
            DirLock::acquire_with(&path, Duration::from_millis(30), Duration::from_secs(60))
                .is_err()
        );
        // Treated as stale after a (here tiny) timeout: taken over.
        sleep(Duration::from_millis(30));
        assert!(DirLock::acquire_with(
            &path,
            Duration::from_millis(200),
            Duration::from_millis(10)
        )
        .is_ok());
    }
}
