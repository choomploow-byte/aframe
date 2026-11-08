//! The folders under the home (docs/06) and the files the app writes on launch: the MCP server
//! (embedded in the app) and a short note for the skills folder.

use crate::fsops::{sweep_temp_files, write_atomic, Crash};
use crate::home::Home;
use std::fs;
use std::time::Duration;

pub const DIRS: &[&str] = &[
    "projects",
    "requests",
    "responses",
    "mcp",
    "skills",
    "exports",
    "logs",
    "agents",
];

/// Marker on generated files that are only stand-ins, so a real one may replace them while a file
/// the user edited is left alone.
pub const GENERATED: &str = "aframe-generated";

/// First line of the MCP bundle: `// aframe-mcp-version: 0.1.0` (written by scripts/build-mcp.mjs).
const VERSION_HEADER: &str = "// aframe-mcp-version: ";

const MCP_FILE: &str = "mcp/aframe-mcp.mjs";

const SKILLS_README: &str = "<!-- aframe-generated -->\n\
Skills are markdown files the AI agent loads on demand. AFrame's own skills are built into the MCP\n\
server (load them with load_skill); put your own `*.md` files here too.\n";

/// A stand-in marks itself in its first lines. Look only there: the real server's own source
/// contains the marker text (the installer checks for it), so a search of the whole file would take
/// the real server for a stand-in and overwrite it on every launch.
pub fn is_stand_in(text: &str) -> bool {
    text.lines()
        .take(2)
        .any(|l| l.trim_start().starts_with("//") && l.contains(GENERATED))
}

/// `(major, minor, patch)` from the bundle's version header, if it has one.
pub fn bundle_version(text: &str) -> Option<(u64, u64, u64)> {
    let line = text
        .lines()
        .take(5)
        .find_map(|l| l.strip_prefix(VERSION_HEADER))?;
    let mut parts = line.trim().split('.').map(|p| {
        p.split(|c: char| !c.is_ascii_digit())
            .next()?
            .parse::<u64>()
            .ok()
    });
    Some((parts.next()??, parts.next()??, parts.next()??))
}

/// Whether the copy in the home should be replaced by the bundle this app carries.
/// - nothing there: yes
/// - a stand-in (placeholder): yes, if the app's bundle is a real one
/// - a real bundle: only if the app's is a newer version (an equal or newer file is kept)
/// - anything else (a file the user changed): never
pub fn should_install(existing: Option<&str>, bundled: &str) -> bool {
    let bundled_is_real = bundle_version(bundled).is_some();
    match existing {
        None => true,
        Some(text) if is_stand_in(text) => bundled_is_real,
        Some(text) => match (bundle_version(text), bundle_version(bundled)) {
            (Some(have), Some(offered)) => offered > have,
            _ => false,
        },
    }
}

pub fn ensure_layout(home: &Home, bundled_mcp: &str) -> Result<(), String> {
    home.ensure()?;
    for d in DIRS {
        fs::create_dir_all(home.confine(d)?).map_err(|e| e.to_string())?;
    }

    let mcp = home.confine_target(MCP_FILE)?;
    let existing = fs::read_to_string(&mcp).ok();
    if should_install(existing.as_deref(), bundled_mcp) {
        write_atomic(&mcp, bundled_mcp.as_bytes(), Crash::None)?;
    }

    let readme = home.confine_target("skills/README.md")?;
    if !readme.exists() {
        write_atomic(&readme, SKILLS_README.as_bytes(), Crash::None)?;
    }
    // Leftovers of writes that were cut short by a crash.
    sweep_temp_files(home.root(), Duration::from_secs(120));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::home::testutil::TempHome;

    const PLACEHOLDER: &str = "// aframe-generated placeholder\nconsole.error('x');\n";
    fn real(version: &str) -> String {
        format!("#!/usr/bin/env node\n// aframe-mcp-version: {version}\nconsole.log('server');\n")
    }

    #[test]
    fn the_real_server_is_not_mistaken_for_a_stand_in_because_it_mentions_the_marker() {
        let real_with_marker = format!(
            "{}const MARKER = 'aframe-generated placeholder';\n",
            real("0.1.0")
        );
        assert!(!is_stand_in(&real_with_marker));
        assert!(is_stand_in(PLACEHOLDER));
        // So a launch with the same or an older app leaves it alone.
        assert!(!should_install(Some(&real_with_marker), &real("0.1.0")));
        assert!(!should_install(Some(&real_with_marker), &real("0.0.9")));
        assert!(should_install(Some(&real_with_marker), &real("0.2.0")));
    }

    #[test]
    fn reads_versions_from_the_header() {
        assert_eq!(bundle_version(&real("0.1.0")), Some((0, 1, 0)));
        assert_eq!(bundle_version(&real("12.30.4-beta.1")), Some((12, 30, 4)));
        assert_eq!(bundle_version("// aframe-mcp-version: nope\n"), None);
        assert_eq!(bundle_version(PLACEHOLDER), None);
        assert_eq!(bundle_version(""), None);
    }

    #[test]
    fn installs_only_when_it_should() {
        let v1 = real("0.1.0");
        let v2 = real("0.2.0");
        assert!(should_install(None, &v1), "nothing there");
        assert!(
            should_install(Some(PLACEHOLDER), &v1),
            "a stand-in is replaced by a real bundle"
        );
        assert!(
            !should_install(Some(PLACEHOLDER), PLACEHOLDER),
            "but not by another stand-in"
        );
        assert!(should_install(Some(&v1), &v2), "older is replaced by newer");
        assert!(!should_install(Some(&v2), &v1), "never downgraded");
        assert!(!should_install(Some(&v1), &v1), "same version: left alone");
        assert!(
            !should_install(Some("// my own edit\n"), &v2),
            "a file the user changed is never replaced"
        );
        assert!(
            !should_install(Some(&v2), PLACEHOLDER),
            "a real file is never replaced by a stand-in"
        );
        assert!(
            should_install(Some(&real("0.9.0")), &real("0.10.0")),
            "numeric, not alphabetical"
        );
    }

    #[test]
    fn creates_the_folders_and_manages_the_server_file() {
        let t = TempHome::new();
        let v1 = real("0.1.0");
        ensure_layout(&t.home, &v1).unwrap();
        for d in DIRS {
            assert!(t.home.root().join(d).is_dir(), "{d}");
        }
        let mcp = t.home.root().join(MCP_FILE);
        assert_eq!(fs::read_to_string(&mcp).unwrap(), v1);

        // A relaunch with the same bundle changes nothing; a newer app upgrades it.
        ensure_layout(&t.home, &v1).unwrap();
        assert_eq!(fs::read_to_string(&mcp).unwrap(), v1);
        let v2 = real("0.2.0");
        ensure_layout(&t.home, &v2).unwrap();
        assert_eq!(fs::read_to_string(&mcp).unwrap(), v2);

        // A file the user (or `install` from a newer copy) put there is never overwritten.
        fs::write(&mcp, "// mine").unwrap();
        ensure_layout(&t.home, &real("9.0.0")).unwrap();
        assert_eq!(fs::read_to_string(&mcp).unwrap(), "// mine");
    }

    #[test]
    fn a_stand_in_from_an_earlier_launch_is_upgraded() {
        let t = TempHome::new();
        ensure_layout(&t.home, PLACEHOLDER).unwrap(); // a build without the bundle
        let mcp = t.home.root().join(MCP_FILE);
        assert!(fs::read_to_string(&mcp).unwrap().contains(GENERATED));
        ensure_layout(&t.home, &real("0.1.0")).unwrap();
        assert!(fs::read_to_string(&mcp)
            .unwrap()
            .contains("aframe-mcp-version"));
    }
}
