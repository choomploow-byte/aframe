//! Saving an export to a folder the user chose (docs/10, docs/18).
//!
//! The webview never names a folder. It asks for a native "choose a folder" dialog; the folder the
//! user picks is remembered here (`ExportRoot`) and `export_files` writes only inside it. So even a
//! compromised page can write nothing outside a folder the user picked this session, and only plain
//! source files: the same rules the MCP server applies (`src/core/export/paths.ts`, mirrored below
//! and by the tests at the bottom of this file).
//!
//! Rules: names are short relative paths of plain segments (no `..`, drive letters, dot-files,
//! Windows device names); the folder is not the home folder, a system or credentials folder; links
//! are never followed or replaced; an existing file is only replaced with `overwrite` (identical bytes
//! are left alone); a conflict stops the whole export before anything is written; each file is written
//! atomically.

use crate::fsops::{write_atomic, Crash};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

pub const MAX_FILES: usize = 200;
pub const MAX_FILE_BYTES: usize = 25 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: usize = 80 * 1024 * 1024;
const MAX_DEPTH: usize = 4;
const MAX_PATH_LEN: usize = 120;

/// The folder the user picked in the native dialog. Nothing is written without one.
#[derive(Default)]
pub struct ExportRoot(pub Mutex<Option<PathBuf>>);

#[derive(Deserialize)]
pub struct ExportFile {
    pub path: String,
    /// Exactly one of `text` and `base64` is set.
    pub text: Option<String>,
    pub base64: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct WriteReport {
    pub root: String,
    pub written: Vec<String>,
    pub unchanged: Vec<String>,
}

const RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com0", "com1", "com2", "com3", "com4", "com5", "com6", "com7",
    "com8", "com9", "lpt0", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7",
];

fn segment_ok(s: &str) -> bool {
    let mut chars = s.chars();
    let first_ok = chars
        .next()
        .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
    first_ok && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ' ' | '-' | '@'))
}

/// Why a relative file name may not be written, or None when it is fine.
pub fn path_problem(rel: &str) -> Option<String> {
    if rel.is_empty() || rel.len() > MAX_PATH_LEN {
        return Some("the path is empty or too long".into());
    }
    if rel.contains('\\') || rel.contains(':') || rel.contains('\0') {
        return Some("the path uses a backslash, a colon or a control character".into());
    }
    if rel.starts_with('/') {
        return Some("the path is absolute".into());
    }
    let parts: Vec<&str> = rel.split('/').collect();
    if parts.len() > MAX_DEPTH {
        return Some("the path is nested too deeply".into());
    }
    for part in parts {
        if part == "." || part == ".." {
            return Some("the path climbs out of the folder".into());
        }
        if !segment_ok(part) {
            return Some("a name starts with a dot or has unusual characters".into());
        }
        if part.ends_with('.') || part.ends_with(' ') {
            return Some("a name ends with a dot or a space".into());
        }
        let stem = part.split('.').next().unwrap_or("").to_ascii_lowercase();
        if RESERVED.contains(&stem.as_str()) {
            return Some(format!("\"{part}\" is a reserved name on Windows"));
        }
    }
    None
}

const BLOCKED_ANYWHERE: [&str; 12] = [
    ".ssh",
    ".aws",
    ".gnupg",
    ".azure",
    ".kube",
    ".docker",
    ".npm",
    ".git",
    ".config",
    "keychains",
    "credentials",
    "appdata",
];
const BLOCKED_TOP: [&str; 14] = [
    "windows",
    "program files",
    "program files (x86)",
    "programdata",
    "etc",
    "usr",
    "bin",
    "sbin",
    "var",
    "system",
    "library",
    "proc",
    "sys",
    "boot",
];

/// Why a destination folder may not be used. `segments` are the folders of its real path without
/// the drive or filesystem root.
pub fn root_problem(segments: &[String]) -> Option<String> {
    if segments.len() < 2 {
        return Some("that folder is too broad: choose a project folder".into());
    }
    let top = segments[0].to_lowercase();
    if BLOCKED_TOP.contains(&top.as_str()) {
        return Some(format!("\"{}\" is a system folder", segments[0]));
    }
    // macOS keeps /etc as a link to /private/etc, so the real path of /etc/x starts with "private".
    // (Temporary folders live under /private/var/folders, which stays allowed.)
    if top == "private"
        && segments
            .get(1)
            .is_some_and(|s| s.eq_ignore_ascii_case("etc"))
    {
        return Some("\"/private/etc\" is a system folder".into());
    }
    for s in segments {
        if BLOCKED_ANYWHERE.contains(&s.to_lowercase().as_str()) {
            return Some(format!("\"{s}\" is a system or credentials folder"));
        }
    }
    None
}

/// The real path of a folder that may not exist yet: the nearest existing ancestor, resolved, plus
/// the missing names.
fn real_root(input: &Path) -> Result<PathBuf, String> {
    let mut missing: Vec<std::ffi::OsString> = Vec::new();
    let mut cur = input.to_path_buf();
    loop {
        match fs::canonicalize(&cur) {
            Ok(real) => {
                if !real.is_dir() {
                    return Err(format!("{} is a file, not a folder.", cur.display()));
                }
                let mut out = real;
                for name in missing.iter().rev() {
                    out.push(name);
                }
                return Ok(out);
            }
            Err(_) => {
                let name = cur
                    .file_name()
                    .ok_or_else(|| format!("{} is not a usable folder.", input.display()))?
                    .to_os_string();
                missing.push(name);
                if !cur.pop() {
                    return Err(format!("{} is not a usable folder.", input.display()));
                }
            }
        }
    }
}

fn segments_of(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect()
}

/// Windows paths from `canonicalize` carry a `\\?\` prefix; show people the plain form.
pub fn display(path: &Path) -> String {
    let s = path.to_string_lossy();
    s.strip_prefix(r"\\?\").unwrap_or(&s).to_string()
}

/// Checks a chosen folder and returns its real path.
pub fn check_root(input: &Path, home: Option<&Path>) -> Result<PathBuf, String> {
    if !input.is_absolute() {
        return Err("The folder must be an absolute path.".into());
    }
    let root = real_root(input)?;
    if let Some(h) = home {
        if let Ok(real_home) = fs::canonicalize(h) {
            if root == real_home {
                return Err("That is your home folder; choose a project folder inside it.".into());
            }
        }
    }
    if let Some(problem) = root_problem(&segments_of(&root)) {
        return Err(format!("Refusing to write there: {problem}."));
    }
    Ok(root)
}

fn decode(file: &ExportFile) -> Result<Vec<u8>, String> {
    match (&file.text, &file.base64) {
        (Some(t), None) => Ok(t.as_bytes().to_vec()),
        (None, Some(b)) => STANDARD
            .decode(b)
            .map_err(|_| format!("{}: the content is not valid base64", file.path)),
        _ => Err(format!("{}: give either text or base64", file.path)),
    }
}

fn is_link(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok_and(|m| m.file_type().is_symlink())
}

/// Writes the files under `root` (already checked with `check_root`).
pub fn write_files(
    root: &Path,
    files: &[ExportFile],
    overwrite: bool,
) -> Result<WriteReport, String> {
    if files.is_empty() {
        return Err("Refusing this export: there is nothing to write.".into());
    }
    if files.len() > MAX_FILES {
        return Err(format!(
            "Refusing this export: more than {MAX_FILES} files."
        ));
    }
    let mut seen = std::collections::HashSet::new();
    let mut total = 0usize;
    let mut plan: Vec<(String, PathBuf, Vec<u8>, bool)> = Vec::new();
    let mut conflicts: Vec<String> = Vec::new();
    for f in files {
        if let Some(p) = path_problem(&f.path) {
            return Err(format!("Refusing this export: \"{}\": {p}.", f.path));
        }
        if !seen.insert(f.path.to_lowercase()) {
            return Err(format!(
                "Refusing this export: \"{}\" appears twice (names are case-insensitive).",
                f.path
            ));
        }
        let bytes = decode(f)?;
        if bytes.len() > MAX_FILE_BYTES {
            return Err(format!(
                "Refusing this export: \"{}\" is too large.",
                f.path
            ));
        }
        total += bytes.len();
        if total > MAX_TOTAL_BYTES {
            return Err("Refusing this export: the export is too large.".into());
        }
        let mut target = root.to_path_buf();
        let parts: Vec<&str> = f.path.split('/').collect();
        for part in &parts[..parts.len() - 1] {
            target.push(part);
            if is_link(&target) {
                return Err(format!(
                    "{}: {part} is a link, which is never followed.",
                    f.path
                ));
            }
            if target.exists() && !target.is_dir() {
                return Err(format!("{}: {part} exists and is not a folder.", f.path));
            }
        }
        target.push(parts[parts.len() - 1]);
        let mut same = false;
        if fs::symlink_metadata(&target).is_ok() {
            if is_link(&target) {
                return Err(format!("{} is a link, which is never replaced.", f.path));
            }
            if !target.is_file() {
                return Err(format!("{} exists and is not a file.", f.path));
            }
            same = fs::read(&target).map(|b| b == bytes).unwrap_or(false);
            if !same && !overwrite {
                conflicts.push(f.path.clone());
            }
        }
        plan.push((f.path.clone(), target, bytes, same));
    }
    if !conflicts.is_empty() {
        let shown: Vec<&str> = conflicts.iter().take(8).map(String::as_str).collect();
        return Err(format!(
            "FILE_EXISTS: {} file(s) already exist with different content: {}{}. Nothing was written.",
            conflicts.len(),
            shown.join(", "),
            if conflicts.len() > 8 { ", ..." } else { "" }
        ));
    }
    let mut report = WriteReport {
        root: display(root),
        written: Vec::new(),
        unchanged: Vec::new(),
    };
    for (rel, target, bytes, same) in plan {
        if same {
            report.unchanged.push(rel);
            continue;
        }
        write_atomic(&target, &bytes, Crash::None)?;
        report.written.push(rel);
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static N: AtomicU32 = AtomicU32::new(0);

    struct Dir(PathBuf);
    impl Dir {
        fn new() -> Dir {
            let p = std::env::temp_dir().join(format!(
                "aframe-export-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::SeqCst)
            ));
            fs::create_dir_all(&p).unwrap();
            Dir(p)
        }
    }
    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn text(path: &str, content: &str) -> ExportFile {
        ExportFile {
            path: path.into(),
            text: Some(content.into()),
            base64: None,
        }
    }

    fn segs(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn accepts_plain_relative_names() {
        for p in [
            "index.html",
            "assets/hero-image.png",
            "src/design/Card.module.css",
            "My Card.tsx",
            "a_b-c.d.ts",
            "hero@2x.png",
        ] {
            assert_eq!(path_problem(p), None, "{p}");
        }
    }

    #[test]
    fn refuses_names_that_escape_or_are_odd() {
        let long = "a".repeat(130);
        for p in [
            "",
            "../x",
            "a/../../x",
            "/etc/passwd",
            "C:/x",
            "a\\b",
            ".env",
            "a/.git/config",
            "a//b",
            "con.txt",
            "NUL",
            "aux.css",
            "a/b/c/d/e.txt",
            "trailing.",
            "trailing ",
            "x\0y",
            "name:stream",
            "~/x",
            long.as_str(),
        ] {
            assert!(path_problem(p).is_some(), "should refuse {p:?}");
        }
    }

    #[test]
    fn judges_folders_like_the_node_writer() {
        assert!(root_problem(&segs(&[])).is_some());
        assert!(root_problem(&segs(&["Users"])).is_some());
        assert!(root_problem(&segs(&["Windows", "Temp"])).is_some());
        assert!(root_problem(&segs(&["etc", "app"])).is_some());
        assert!(root_problem(&segs(&["Users", "me", ".ssh"])).is_some());
        assert!(root_problem(&segs(&["home", "me", "p", ".git", "hooks"])).is_some());
        assert!(root_problem(&segs(&["Users", "me", "AppData", "Local"])).is_some());
        assert!(root_problem(&segs(&["dev", "app"])).is_none());
        assert!(root_problem(&segs(&["Users", "me", "Documents", "site"])).is_none());
        assert!(root_problem(&segs(&["home", "me", "library-site"])).is_none());
    }

    #[test]
    fn refuses_relative_and_broad_folders() {
        assert!(check_root(Path::new("relative/out"), None).is_err());
        let root = std::env::temp_dir()
            .ancestors()
            .last()
            .unwrap()
            .to_path_buf();
        assert!(check_root(&root, None).is_err());
        let system = if cfg!(windows) {
            r"C:\Windows\Temp\x"
        } else {
            "/etc/x"
        };
        assert!(check_root(Path::new(system), None).is_err());
    }

    #[test]
    fn refuses_the_home_folder_itself() {
        let d = Dir::new();
        assert!(check_root(&d.0, Some(&d.0)).is_err());
    }

    #[test]
    fn writes_text_and_bytes_and_creates_folders() {
        let d = Dir::new();
        let files = vec![
            text("a.txt", "hello"),
            ExportFile {
                path: "assets/b.bin".into(),
                text: None,
                base64: Some(STANDARD.encode([1u8, 2, 3])),
            },
        ];
        let r = write_files(&d.0, &files, false).unwrap();
        assert_eq!(r.written.len(), 2);
        assert_eq!(fs::read_to_string(d.0.join("a.txt")).unwrap(), "hello");
        assert_eq!(fs::read(d.0.join("assets/b.bin")).unwrap(), vec![1, 2, 3]);
        // No temp files left beside them.
        let names: Vec<_> = fs::read_dir(&d.0)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(names.iter().all(|n| !n.ends_with(".tmp")), "{names:?}");
    }

    #[test]
    fn identical_files_are_left_and_different_ones_stop_everything() {
        let d = Dir::new();
        write_files(&d.0, &[text("a.txt", "one"), text("b.txt", "two")], false).unwrap();
        let again =
            write_files(&d.0, &[text("a.txt", "one"), text("b.txt", "two")], false).unwrap();
        assert!(again.written.is_empty());
        assert_eq!(again.unchanged.len(), 2);

        fs::write(d.0.join("b.txt"), "edited by hand").unwrap();
        let err =
            write_files(&d.0, &[text("a.txt", "NEW"), text("b.txt", "two")], false).unwrap_err();
        assert!(err.starts_with("FILE_EXISTS"), "{err}");
        assert_eq!(fs::read_to_string(d.0.join("a.txt")).unwrap(), "one"); // all or nothing
        assert_eq!(
            fs::read_to_string(d.0.join("b.txt")).unwrap(),
            "edited by hand"
        );

        let forced =
            write_files(&d.0, &[text("a.txt", "NEW"), text("b.txt", "two")], true).unwrap();
        assert_eq!(forced.written.len(), 2);
        assert_eq!(fs::read_to_string(d.0.join("b.txt")).unwrap(), "two");
    }

    #[test]
    fn rejects_bad_names_empty_and_duplicate_exports_and_writes_nothing() {
        let d = Dir::new();
        assert!(write_files(&d.0, &[], false).is_err());
        assert!(write_files(&d.0, &[text("../escape.txt", "x")], false).is_err());
        assert!(write_files(&d.0, &[text("A.txt", "x"), text("a.txt", "y")], false).is_err());
        let both = ExportFile {
            path: "x.txt".into(),
            text: Some("a".into()),
            base64: Some("YQ==".into()),
        };
        assert!(write_files(&d.0, &[both], false).is_err());
        let bad64 = ExportFile {
            path: "x.txt".into(),
            text: None,
            base64: Some("***".into()),
        };
        assert!(write_files(&d.0, &[bad64], false).is_err());
        assert_eq!(fs::read_dir(&d.0).unwrap().count(), 0);
        assert!(!d.0.parent().unwrap().join("escape.txt").exists());
    }

    #[test]
    fn never_writes_through_a_linked_folder() {
        let d = Dir::new();
        let outside = Dir::new();
        // A directory symlink on unix, a junction on Windows (no privilege needed).
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&outside.0, d.0.join("assets")).is_ok();
        #[cfg(windows)]
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(d.0.join("assets"))
            .arg(&outside.0)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !made {
            eprintln!("SKIPPED: this machine cannot make links");
            return;
        }
        let err = write_files(&d.0, &[text("assets/x.png", "x")], false).unwrap_err();
        assert!(err.contains("link"), "{err}");
        assert_eq!(fs::read_dir(&outside.0).unwrap().count(), 0);
    }
}
