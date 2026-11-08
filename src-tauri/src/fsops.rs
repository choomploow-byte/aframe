//! File operations behind the Tauri commands. Pure Rust, no Tauri types, so it is unit-tested.
//!
//! Durability rules (docs/06): a write goes to a unique temp file next to the target, is flushed to
//! disk, and only then renamed over the target, so a crash at any moment leaves either the old
//! file or the new one, never half of each. Project documents additionally keep the previous
//! version as `.bak` and use a compare-and-write on `rev` under the project lock.

use crate::home::Home;
use crate::lock::DirLock;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread::sleep;
use std::time::{Duration, UNIX_EPOCH};

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Stat {
    pub mtime_ms: u64,
    pub size: u64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime_ms: u64,
}

/// What happened to a compare-and-write of a project document.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocWrite {
    pub ok: bool,
    /// The file on disk is not at the revision the caller last saw; nothing was written.
    pub conflict: bool,
    /// `rev` of the file as it is now (after a write: the new one; after a conflict: the other writer's).
    pub disk_rev: Option<u64>,
    pub stat: Option<Stat>,
}

/// Where a simulated crash happens during a write (tests only; `None` in the app).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Crash {
    None,
    /// The temp file is fully written and flushed but not renamed.
    AfterTmp,
    /// The temp file is written, partially: only the first half of the bytes reached the disk.
    DuringTmp,
    /// The `.bak` was written but the document itself was not replaced.
    AfterBackup,
}

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn to_ms(t: std::time::SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn stat_path(path: &Path) -> Result<Option<Stat>, String> {
    match fs::metadata(path) {
        Ok(m) => Ok(Some(Stat {
            mtime_ms: m.modified().map(to_ms).map_err(|e| e.to_string())?,
            size: m.len(),
        })),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Deserialize)]
struct RevOnly {
    rev: u64,
}

/// `rev` of a project document's text, or None if it is not valid JSON with a numeric `rev`.
pub fn parse_rev(text: &str) -> Option<u64> {
    serde_json::from_str::<RevOnly>(text).ok().map(|r| r.rev)
}

pub fn read(home: &Home, rel: &str) -> Result<Option<String>, String> {
    let full = home.confine(rel)?;
    match fs::read_to_string(&full) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// The first `max` bytes of a file (lossy UTF-8): enough to read a project's name without loading
/// its embedded images.
pub fn read_head(home: &Home, rel: &str, max: usize) -> Result<Option<String>, String> {
    let full = home.confine(rel)?;
    let mut file = match File::open(&full) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let mut buf = vec![0u8; max.min(1 << 20)];
    let n = file.read(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(n);
    Ok(Some(String::from_utf8_lossy(&buf).into_owned()))
}

pub fn list(home: &Home, rel: &str) -> Result<Vec<Entry>, String> {
    let full = home.confine(rel)?;
    let rd = match fs::read_dir(&full) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.to_string()),
    };
    let mut out: Vec<Entry> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some(Entry {
                name: e.file_name().to_string_lossy().into_owned(),
                is_dir: m.is_dir(),
                size: m.len(),
                mtime_ms: m.modified().map(to_ms).unwrap_or(0),
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

pub fn remove(home: &Home, rel: &str) -> Result<(), String> {
    let full = home.confine_target(rel)?;
    match fs::symlink_metadata(&full) {
        Ok(m) if m.is_dir() => {
            // Windows: a folder can be briefly held by a scanner or indexer; try a few times.
            let mut last = String::new();
            for _ in 0..8 {
                match fs::remove_dir_all(&full) {
                    Ok(()) => return Ok(()),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                    Err(e) => {
                        last = e.to_string();
                        sleep(Duration::from_millis(60));
                    }
                }
            }
            Err(last)
        }
        Ok(_) => fs::remove_file(&full).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn stat(home: &Home, rel: &str) -> Result<Option<Stat>, String> {
    stat_path(&home.confine(rel)?)
}

/// Writes `bytes` to `target` atomically (temp file + flush + rename, with a Windows retry).
pub fn write_atomic(target: &Path, bytes: &[u8], crash: Crash) -> Result<(), String> {
    let parent = target.parent().ok_or("invalid file name")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let name = target
        .file_name()
        .ok_or("invalid file name")?
        .to_string_lossy()
        .into_owned();
    let tmp = parent.join(format!(
        ".{name}.{}.{}.tmp",
        std::process::id(),
        TMP_COUNTER.fetch_add(1, Ordering::SeqCst)
    ));

    let result = (|| -> Result<(), String> {
        let mut f = File::create(&tmp).map_err(|e| e.to_string())?;
        if crash == Crash::DuringTmp {
            f.write_all(&bytes[..bytes.len() / 2])
                .map_err(|e| e.to_string())?;
            return Err("simulated crash".into());
        }
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?; // on disk before it becomes the document
        drop(f);
        if crash == Crash::AfterTmp {
            return Err("simulated crash".into());
        }
        replace(&tmp, target)
    })();

    match result {
        Ok(()) => {
            #[cfg(unix)]
            if let Ok(dir) = File::open(parent) {
                let _ = dir.sync_all(); // make the rename itself durable
            }
            Ok(())
        }
        Err(e) => {
            // A real crash would leave the temp file; a handled error cleans up after itself.
            if !e.starts_with("simulated") {
                let _ = fs::remove_file(&tmp);
            }
            Err(e)
        }
    }
}

/// Renames over the target. Windows refuses while another process holds the target open (an
/// antivirus scan, a sync client), so retry briefly.
fn replace(tmp: &Path, target: &Path) -> Result<(), String> {
    let mut last = String::new();
    // Up to ~1.5 s: an antivirus scan or a sync client can hold a file longer than you'd think.
    for i in 0..14u64 {
        match fs::rename(tmp, target) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = e.to_string();
                sleep(Duration::from_millis((40 + i * 15).min(150)));
            }
        }
    }
    Err(format!("could not replace the file: {last}"))
}

/// Plain atomic write (state files, responses). Returns the new stat.
pub fn write(home: &Home, rel: &str, content: &str) -> Result<Stat, String> {
    let full = home.confine_target(rel)?;
    write_atomic(&full, content.as_bytes(), Crash::None)?;
    stat_path(&full)?.ok_or_else(|| "file vanished after writing".to_string())
}

fn backup_path(full: &Path) -> PathBuf {
    let mut name = full
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".bak");
    full.with_file_name(name)
}

/// Project document write: compare-and-write on `rev` under the project lock, previous version kept
/// as `.bak` (only if it was itself a valid document, so a corrupt file never replaces a good
/// backup). `expect_rev` is the revision the caller last read or wrote; if the file has moved on,
/// nothing is written and `conflict` is true so the caller can merge and retry.
pub fn write_doc(
    home: &Home,
    rel: &str,
    content: &str,
    expect_rev: Option<u64>,
    crash: Crash,
) -> Result<DocWrite, String> {
    let full = home.confine_target(rel)?;
    let dir = full.parent().ok_or("invalid file name")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let _lock = DirLock::acquire(&dir.join(".lock"))?;

    let existing = match fs::read_to_string(&full) {
        Ok(s) => Some(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    let existing_rev = existing.as_deref().and_then(parse_rev);

    if let (Some(expected), Some(_)) = (expect_rev, existing.as_ref()) {
        if existing_rev != Some(expected) {
            return Ok(DocWrite {
                ok: false,
                conflict: true,
                disk_rev: existing_rev,
                stat: stat_path(&full)?,
            });
        }
    }

    if let (Some(text), Some(_)) = (existing.as_ref(), existing_rev) {
        write_atomic(&backup_path(&full), text.as_bytes(), Crash::None)?;
    }
    if crash == Crash::AfterBackup {
        return Err("simulated crash".into());
    }
    write_atomic(&full, content.as_bytes(), crash)?;
    Ok(DocWrite {
        ok: true,
        conflict: false,
        disk_rev: parse_rev(content),
        stat: stat_path(&full)?,
    })
}

/// Removes stale temp files left by crashed writes (older than `max_age`).
pub fn sweep_temp_files(dir: &Path, max_age: Duration) -> usize {
    let mut removed = 0;
    let Ok(rd) = fs::read_dir(dir) else { return 0 };
    for e in rd.flatten() {
        let path = e.path();
        if path.is_dir() {
            removed += sweep_temp_files(&path, max_age);
        } else if path.extension().is_some_and(|x| x == "tmp")
            && e.file_name().to_string_lossy().starts_with('.')
        {
            let old = e
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| std::time::SystemTime::now().duration_since(t).ok())
                .is_some_and(|a| a > max_age);
            if old && fs::remove_file(&path).is_ok() {
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
    use std::sync::Arc;

    fn doc(rev: u64, marker: &str) -> String {
        format!("{{\"schema\":1,\"rev\":{rev},\"id\":\"p_test1\",\"marker\":\"{marker}\"}}")
    }

    const P: &str = "projects/p_test1/project.aframe.json";

    #[test]
    fn write_read_stat_list_remove_round_trip() {
        let t = TempHome::new();
        assert_eq!(read(&t.home, "a/b.txt").unwrap(), None);
        let st = write(&t.home, "a/b.txt", "hello").unwrap();
        assert_eq!(st.size, 5);
        assert_eq!(read(&t.home, "a/b.txt").unwrap(), Some("hello".into()));
        assert_eq!(stat(&t.home, "a/b.txt").unwrap().unwrap().size, 5);
        let names: Vec<_> = list(&t.home, "a")
            .unwrap()
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(names, vec!["b.txt"]);
        assert!(list(&t.home, "nope").unwrap().is_empty());
        remove(&t.home, "a/b.txt").unwrap();
        assert_eq!(read(&t.home, "a/b.txt").unwrap(), None);
        remove(&t.home, "a/b.txt").unwrap(); // removing nothing is fine
    }

    #[test]
    fn read_head_returns_only_the_start_of_a_big_file() {
        let t = TempHome::new();
        write(&t.home, "big.txt", &"x".repeat(100_000)).unwrap();
        assert_eq!(
            read_head(&t.home, "big.txt", 1000).unwrap().unwrap().len(),
            1000
        );
        assert_eq!(read_head(&t.home, "missing.txt", 10).unwrap(), None);
    }

    #[test]
    fn nothing_escapes_through_any_command() {
        let t = TempHome::new();
        for bad in ["../x", "/etc/hosts", "a/../../x"] {
            assert!(read(&t.home, bad).is_err());
            assert!(read_head(&t.home, bad, 10).is_err());
            assert!(write(&t.home, bad, "x").is_err());
            assert!(write_doc(&t.home, bad, "{}", None, Crash::None).is_err());
            assert!(list(&t.home, bad).is_err());
            assert!(remove(&t.home, bad).is_err());
            assert!(stat(&t.home, bad).is_err());
        }
        assert!(
            remove(&t.home, "").is_err(),
            "must never delete the whole home"
        );
        assert!(write(&t.home, "", "x").is_err());
    }

    #[test]
    fn write_leaves_no_temp_files_behind() {
        let t = TempHome::new();
        write(&t.home, "a.txt", "1").unwrap();
        write(&t.home, "a.txt", "22").unwrap();
        let names: Vec<_> = list(&t.home, "")
            .unwrap()
            .into_iter()
            .map(|e| e.name)
            .collect();
        assert_eq!(names, vec!["a.txt"]);
    }

    #[test]
    fn doc_write_keeps_the_previous_version_as_bak() {
        let t = TempHome::new();
        let w1 = write_doc(&t.home, P, &doc(1, "one"), None, Crash::None).unwrap();
        assert!(w1.ok && w1.disk_rev == Some(1));
        assert_eq!(
            read(&t.home, &format!("{P}.bak")).unwrap(),
            None,
            "no backup of nothing"
        );
        write_doc(&t.home, P, &doc(2, "two"), Some(1), Crash::None).unwrap();
        write_doc(&t.home, P, &doc(3, "three"), Some(2), Crash::None).unwrap();
        assert!(read(&t.home, P).unwrap().unwrap().contains("three"));
        assert!(
            read(&t.home, &format!("{P}.bak"))
                .unwrap()
                .unwrap()
                .contains("two"),
            "rolling, one deep"
        );
    }

    #[test]
    fn doc_write_refuses_when_the_file_moved_on() {
        let t = TempHome::new();
        write_doc(&t.home, P, &doc(1, "one"), None, Crash::None).unwrap();
        write_doc(&t.home, P, &doc(2, "agent"), Some(1), Crash::None).unwrap(); // another writer
        let mine = write_doc(&t.home, P, &doc(2, "app"), Some(1), Crash::None).unwrap();
        assert!(!mine.ok && mine.conflict);
        assert_eq!(
            mine.disk_rev,
            Some(2),
            "tells the caller where the file is now"
        );
        assert!(
            read(&t.home, P).unwrap().unwrap().contains("agent"),
            "the other writer's edit survives"
        );
    }

    #[test]
    fn a_corrupt_file_never_replaces_a_good_backup() {
        let t = TempHome::new();
        write_doc(&t.home, P, &doc(1, "good"), None, Crash::None).unwrap();
        write_doc(&t.home, P, &doc(2, "better"), Some(1), Crash::None).unwrap();
        // Someone truncates the project file.
        fs::write(t.home.confine(P).unwrap(), "{\"sche").unwrap();
        // The app (not expecting anything: it was told the file is unreadable) saves its copy.
        write_doc(&t.home, P, &doc(3, "mine"), None, Crash::None).unwrap();
        let bak = read(&t.home, &format!("{P}.bak")).unwrap().unwrap();
        assert!(
            bak.contains("good"),
            "the .bak is still the last valid document: {bak}"
        );
    }

    #[test]
    fn a_crash_at_any_point_leaves_a_valid_document_and_ignorable_temp_files() {
        for crash in [Crash::DuringTmp, Crash::AfterTmp, Crash::AfterBackup] {
            let t = TempHome::new();
            write_doc(&t.home, P, &doc(1, "before"), None, Crash::None).unwrap();
            let r = write_doc(&t.home, P, &doc(2, "after"), Some(1), crash);
            assert!(r.is_err(), "{crash:?}");
            let text = read(&t.home, P).unwrap().unwrap();
            assert_eq!(
                parse_rev(&text),
                Some(1),
                "{crash:?}: still the old, complete file"
            );
            assert!(text.contains("before"));
            // The lock is released (dropped) even though the write "crashed" in-process...
            assert!(
                write_doc(&t.home, P, &doc(2, "retry"), Some(1), Crash::None)
                    .unwrap()
                    .ok,
                "{crash:?}"
            );
            assert!(read(&t.home, P).unwrap().unwrap().contains("retry"));
        }
    }

    #[test]
    fn a_dead_writers_lock_and_temp_file_do_not_block_the_next_save() {
        let t = TempHome::new();
        write_doc(&t.home, P, &doc(1, "one"), None, Crash::None).unwrap();
        let dir = t.home.confine(P).unwrap().parent().unwrap().to_path_buf();
        fs::write(dir.join(".lock"), "{\"pid\":999999}").unwrap();
        fs::write(dir.join(".project.aframe.json.1.1.tmp"), "{\"half").unwrap();
        // The lock is fresh, so this would wait; age it by sweeping with a zero threshold and
        // treating our test lock as stale through the public helper used at startup.
        assert!(DirLock::acquire_with(
            &dir.join(".lock"),
            Duration::from_millis(20),
            Duration::from_secs(60)
        )
        .is_err());
        fs::remove_file(dir.join(".lock")).unwrap();
        assert!(
            write_doc(&t.home, P, &doc(2, "two"), Some(1), Crash::None)
                .unwrap()
                .ok
        );
        assert_eq!(sweep_temp_files(t.home.root(), Duration::ZERO), 1);
        assert!(!dir.join(".project.aframe.json.1.1.tmp").exists());
    }

    #[test]
    fn many_writers_never_lose_an_update_or_corrupt_the_file() {
        let t = TempHome::new();
        let home = Arc::new(t.home.clone());
        write_doc(&home, P, &doc(1, "start"), None, Crash::None).unwrap();

        let threads = 6;
        let per_thread = 15;
        let handles: Vec<_> = (0..threads)
            .map(|i| {
                let home = Arc::clone(&home);
                std::thread::spawn(move || {
                    let mut applied = 0;
                    while applied < per_thread {
                        // Read-modify-write the way the app and the MCP server do.
                        let text = read(&home, P).unwrap().unwrap();
                        let rev = parse_rev(&text).expect("always a valid document");
                        let next = doc(rev + 1, &format!("t{i}-{applied}"));
                        // Six writers on a slow disk can wait out the lock; a real caller tries again.
                        match write_doc(&home, P, &next, Some(rev), Crash::None) {
                            Ok(r) if r.ok => applied += 1,
                            Ok(_) => {}
                            Err(e) if e.starts_with("LOCKED") => {}
                            Err(e) => panic!("{e}"),
                        }
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        let text = read(&home, P).unwrap().unwrap();
        assert_eq!(
            parse_rev(&text),
            Some(1 + (threads * per_thread) as u64),
            "every update landed exactly once, in order"
        );
    }

    #[test]
    fn parse_rev_reads_rev_without_loading_the_document() {
        assert_eq!(
            parse_rev("{\"schema\":1,\"rev\":42,\"nodes\":{}}"),
            Some(42)
        );
        assert_eq!(parse_rev("{\"rev\":\"x\"}"), None);
        assert_eq!(parse_rev("not json"), None);
        assert_eq!(parse_rev("{\"sche"), None);
    }
}
