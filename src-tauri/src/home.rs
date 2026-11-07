//! The Atelier home directory and the one function every file command goes through to stay inside it.
//!
//! Everything the webview can touch is RELATIVE to the home (`~/.atelier`, or `$ATELIER_HOME`).
//! Absolute paths, `..`, drive prefixes, `:` (Windows alternate streams) and symlinks that lead
//! outside are rejected here, once, so no command can forget to check (docs/06, docs/18).

use std::fs;
use std::path::{Component, Path, PathBuf};

// Mirrors src/brand.ts (the one place the product name lives on the TypeScript side).
pub const HOME_DIR_NAME: &str = ".atelier";
pub const HOME_ENV_VAR: &str = "ATELIER_HOME";

#[derive(Clone, Debug)]
pub struct Home {
    root: PathBuf,
}

impl Home {
    pub fn new(root: PathBuf) -> Self {
        Home { root }
    }

    pub fn from_env() -> Result<Self, String> {
        if let Ok(p) = std::env::var(HOME_ENV_VAR) {
            if !p.is_empty() {
                return Ok(Home::new(PathBuf::from(p)));
            }
        }
        dirs::home_dir()
            .map(|h| Home::new(h.join(HOME_DIR_NAME)))
            .ok_or_else(|| "could not determine the home directory".to_string())
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Creates the home directory (private to the user where the platform supports it).
    pub fn ensure(&self) -> Result<(), String> {
        fs::create_dir_all(&self.root)
            .map_err(|e| format!("could not create the home directory: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&self.root, fs::Permissions::from_mode(0o700));
        }
        Ok(())
    }

    /// Resolves a relative path to a full path inside the home. The empty path and "." mean the
    /// home itself and are allowed (listing the root); use [`Home::confine_target`] for anything
    /// that writes or deletes.
    pub fn confine(&self, rel: &str) -> Result<PathBuf, String> {
        self.ensure()?;
        if rel.contains('\0') {
            return Err("invalid path".into());
        }
        let rel_path = Path::new(rel);
        if rel_path.is_absolute() || rel.starts_with('/') || rel.starts_with('\\') {
            return Err("absolute paths are not allowed".into());
        }
        for c in rel_path.components() {
            match c {
                Component::Normal(name) => {
                    if name.to_string_lossy().contains(':') {
                        return Err("invalid path component".into());
                    }
                }
                Component::CurDir => {}
                _ => return Err("invalid path component".into()),
            }
        }

        let full = self.root.join(rel_path);

        // Symlink-escape protection: canonicalise the deepest ancestor that exists and make sure
        // it is still under the (canonical) home.
        let mut probe = full.clone();
        while !probe.exists() {
            if !probe.pop() {
                break;
            }
        }
        let canon_probe = probe.canonicalize().map_err(|e| e.to_string())?;
        let canon_home = self.root.canonicalize().map_err(|e| e.to_string())?;
        if !canon_probe.starts_with(&canon_home) {
            return Err("path escapes the Atelier home directory".into());
        }
        Ok(full)
    }

    /// Like [`Home::confine`], but refuses the home directory itself (so a stray `fs_remove("")`
    /// can never delete everything).
    pub fn confine_target(&self, rel: &str) -> Result<PathBuf, String> {
        let full = self.confine(rel)?;
        if full == self.root
            || rel
                .trim_matches(|c| c == '.' || c == '/' || c == '\\')
                .is_empty()
        {
            return Err("a file or folder inside the home is required".into());
        }
        Ok(full)
    }
}

/// ISO-8601 UTC timestamp for "now" (no chrono needed for one format).
pub fn iso_now() -> String {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    iso_from_ms(ms)
}

pub fn iso_from_ms(ms: u64) -> String {
    let secs = ms / 1000;
    let millis = ms % 1000;
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Civil-from-days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!(
        "{year:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

#[cfg(test)]
pub(crate) mod testutil {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static N: AtomicU64 = AtomicU64::new(0);

    /// A fresh, empty home under the OS temp dir, removed on drop.
    pub struct TempHome {
        pub home: Home,
        dir: PathBuf,
    }

    impl TempHome {
        pub fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "atelier-rs-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::SeqCst)
            ));
            let _ = fs::remove_dir_all(&dir);
            let home = Home::new(dir.join("home"));
            home.ensure().unwrap();
            TempHome { home, dir }
        }

        /// A directory next to (not inside) the home, for escape tests.
        pub fn outside(&self) -> PathBuf {
            let p = self.dir.join("outside");
            fs::create_dir_all(&p).unwrap();
            p
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testutil::TempHome;
    use super::*;

    #[test]
    fn accepts_nested_relative_paths() {
        let t = TempHome::new();
        assert!(t
            .home
            .confine("projects/p_abc12/project.atelier.json")
            .is_ok());
        assert!(t.home.confine("./a/./b.txt").is_ok());
        assert!(t.home.confine("").is_ok());
    }

    #[test]
    fn rejects_parent_directory_anywhere() {
        let t = TempHome::new();
        for p in [
            "../evil",
            "a/../../evil",
            "a/..",
            "..",
            "a/b/../../../x",
            "a\\..\\..\\x",
        ] {
            // On unix a backslash is an ordinary character, so only assert for the portable ones.
            if p.contains('\\') && !cfg!(windows) {
                continue;
            }
            assert!(t.home.confine(p).is_err(), "should reject {p}");
        }
    }

    #[test]
    fn rejects_absolute_and_rooted_paths() {
        let t = TempHome::new();
        assert!(t.home.confine("/etc/passwd").is_err());
        assert!(t.home.confine("\\windows\\system32").is_err());
        if cfg!(windows) {
            assert!(t.home.confine("C:\\Windows\\win.ini").is_err());
            assert!(t.home.confine("C:win.ini").is_err());
            assert!(t.home.confine("\\\\server\\share\\x").is_err());
        }
    }

    #[test]
    fn rejects_colons_nul_and_alternate_streams() {
        let t = TempHome::new();
        assert!(t.home.confine("a.json:stream").is_err());
        assert!(t.home.confine("a\0b").is_err());
    }

    #[test]
    fn writes_and_deletes_need_a_real_target() {
        let t = TempHome::new();
        for p in ["", ".", "./", "a/..", "projects/.."] {
            assert!(t.home.confine_target(p).is_err(), "should refuse {p:?}");
        }
        assert!(t.home.confine_target("projects").is_ok());
    }

    #[test]
    fn rejects_a_symlinked_folder_that_leads_outside() {
        let t = TempHome::new();
        let outside = t.outside();
        let link = t.home.root().join("link");
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&outside, &link).is_ok();
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_dir(&outside, &link).is_ok();
        if !made {
            eprintln!("skipped: this account may not create symlinks");
            return;
        }
        assert!(t.home.confine("link").is_err());
        assert!(t.home.confine("link/secret.txt").is_err());
        assert!(t.home.confine("link/new/dir/file").is_err());
    }

    #[test]
    fn rejects_a_symlinked_file_that_leads_outside() {
        let t = TempHome::new();
        let outside = t.outside();
        let target = outside.join("secret.txt");
        fs::write(&target, "x").unwrap();
        let link = t.home.root().join("secret-link.txt");
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&target, &link).is_ok();
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_file(&target, &link).is_ok();
        if !made {
            eprintln!("skipped: this account may not create symlinks");
            return;
        }
        assert!(t.home.confine("secret-link.txt").is_err());
    }

    #[test]
    fn iso_timestamps_are_correct() {
        assert_eq!(iso_from_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_from_ms(1_709_164_800_123), "2024-02-29T00:00:00.123Z"); // a leap day
        assert_eq!(iso_from_ms(1_767_225_599_999), "2025-12-31T23:59:59.999Z");
        assert!(iso_now().ends_with('Z'));
    }
}
