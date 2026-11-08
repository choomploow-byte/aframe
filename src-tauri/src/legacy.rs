//! The product used to be called Atelier and kept its data in `~/.atelier`. If only that folder
//! exists it is moved to the new name (one atomic rename on the same disk), so projects, notes and the
//! asset library carry over. If the move is refused (the old app still running holds a file), the old
//! folder keeps being used. The legacy name is literal on purpose: scripts/rename.mjs skips this file.

use std::fs;
use std::path::{Path, PathBuf};

const LEGACY_HOME: &str = ".atelier";
/// The credential-store service the old version kept API keys and the Figma token under.
pub const LEGACY_KEY_SERVICE: &str = "atelier-ai";

/// The data folder under `user_home`: the new one, or the old one if it could not be moved.
pub fn choose_home(user_home: &Path, new_name: &str) -> PathBuf {
    let next = user_home.join(new_name);
    let old = user_home.join(LEGACY_HOME);
    if next.exists() || !old.exists() {
        return next;
    }
    match fs::rename(&old, &next) {
        Ok(()) => next,
        Err(_) => old,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static N: AtomicU32 = AtomicU32::new(0);

    fn temp() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "legacy-home-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn moves_the_old_folder_with_its_contents() {
        let h = temp();
        fs::create_dir_all(h.join(".atelier/projects/p_1")).unwrap();
        fs::write(h.join(".atelier/projects/p_1/project.json"), "{}").unwrap();
        let chosen = choose_home(&h, ".newname");
        assert_eq!(chosen, h.join(".newname"));
        assert!(h.join(".newname/projects/p_1/project.json").exists());
        assert!(!h.join(".atelier").exists());
        let _ = fs::remove_dir_all(&h);
    }

    #[test]
    fn leaves_both_alone_when_the_new_one_exists() {
        let h = temp();
        fs::create_dir_all(h.join(".atelier")).unwrap();
        fs::create_dir_all(h.join(".newname")).unwrap();
        assert_eq!(choose_home(&h, ".newname"), h.join(".newname"));
        assert!(h.join(".atelier").exists());
        let _ = fs::remove_dir_all(&h);
    }

    #[test]
    fn a_fresh_machine_just_gets_the_new_name() {
        let h = temp();
        assert_eq!(choose_home(&h, ".newname"), h.join(".newname"));
        assert!(!h.join(".newname").exists());
        let _ = fs::remove_dir_all(&h);
    }
}
