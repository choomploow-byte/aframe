//! The folders under the home (docs/06) and the placeholder files the app writes on launch.

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

/// Marker on the first line of generated files, so a later phase may replace them while a file the
/// user edited is left alone.
#[cfg_attr(not(test), allow(dead_code))] // read by Phase 5, which replaces generated files
pub const GENERATED: &str = "atelier-generated";

const MCP_PLACEHOLDER: &str =
    "// atelier-generated placeholder. The real MCP server is bundled here in Phase 5.\n\
console.error('Atelier MCP server: not installed yet (this build has no MCP bundle).');\n\
process.exit(1);\n";

const SKILLS_README: &str = "<!-- atelier-generated -->\n\
Skills are markdown files the AI agent loads on demand. Atelier's own skills are installed here\n\
by a later version; put your own `*.md` files here too.\n";

pub fn ensure_layout(home: &Home) -> Result<(), String> {
    home.ensure()?;
    for d in DIRS {
        fs::create_dir_all(home.confine(d)?).map_err(|e| e.to_string())?;
    }
    for (rel, text) in [
        ("mcp/atelier-mcp.mjs", MCP_PLACEHOLDER),
        ("skills/README.md", SKILLS_README),
    ] {
        let path = home.confine_target(rel)?;
        if !path.exists() {
            write_atomic(&path, text.as_bytes(), Crash::None)?;
        }
    }
    // Leftovers of writes that were cut short by a crash.
    sweep_temp_files(home.root(), Duration::from_secs(120));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::home::testutil::TempHome;

    #[test]
    fn creates_the_folders_and_placeholders_once() {
        let t = TempHome::new();
        ensure_layout(&t.home).unwrap();
        for d in DIRS {
            assert!(t.home.root().join(d).is_dir(), "{d}");
        }
        let mcp = t.home.root().join("mcp/atelier-mcp.mjs");
        assert!(fs::read_to_string(&mcp).unwrap().contains(GENERATED));
        // A file the user (or a later phase) replaced is never overwritten by a relaunch.
        fs::write(&mcp, "// mine").unwrap();
        ensure_layout(&t.home).unwrap();
        assert_eq!(fs::read_to_string(&mcp).unwrap(), "// mine");
    }
}
