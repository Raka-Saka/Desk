//! Writing decisions back: sign-off, notes, and the staleness token.
//!
//! Everything here rewrites the file that owns the fact, so a change is visible
//! to git, to tracker.py, and to an agent reading the repo next session. There
//! is no sidecar store, because a comment nobody else can read is not a comment.

use crate::workspace::{adrs_in, Adr};
use std::fs;
use std::path::Path;

/// Rewrite an ADR's `- **Status:**` line, stamped and attributed.
pub fn set_adr_status(root: &Path, number: &str, status: &str, who: &str) -> Result<Adr, String> {
    let adr = adrs_in(root)
        .into_iter()
        .find(|a| a.number == number)
        .ok_or_else(|| format!("no ADR numbered {number}"))?;

    let path = root.join(&adr.path);
    let text = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    let signed = if who.trim().is_empty() {
        format!("{status} {today}")
    } else {
        format!("{status} {today} by {}", who.trim())
    };

    let mut out = String::new();
    let mut replaced = false;
    for line in text.lines() {
        if !replaced && line.trim_start().starts_with("- **Status:**") {
            out.push_str("- **Status:** ");
            out.push_str(&signed);
            out.push('\n');
            replaced = true;
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    if !replaced {
        return Err("that file has no '- **Status:**' line to update".into());
    }
    fs::write(&path, out).map_err(|e| format!("{}: {e}", path.display()))?;

    adrs_in(root)
        .into_iter()
        .find(|a| a.number == number)
        .ok_or_else(|| "wrote the file but could not read it back".to_string())
}

/// Append a dated, attributed note under a `## Notes` heading, creating the
/// heading if it is missing. Works on any repo file: an ADR, an item, a doc.
pub fn append_note(root: &Path, rel: &str, text: &str, who: &str) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("empty note".into());
    }
    let path = crate::inside(root, rel)?;
    let mut body = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;

    let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
    let author = if who.trim().is_empty() { "user" } else { who.trim() };

    if !body.ends_with('\n') {
        body.push('\n');
    }
    if !body.contains("## Notes") {
        body.push('\n');
        body.push_str("## Notes\n");
    }
    body.push('\n');
    body.push_str("**");
    body.push_str(author);
    body.push_str(" · ");
    body.push_str(&stamp);
    body.push_str("**\n\n");
    body.push_str(text.trim());
    body.push('\n');

    fs::write(&path, body).map_err(|e| format!("{}: {e}", path.display()))
}

/// Modification time in seconds since the epoch, or 0 if unknown.
///
/// Used as a staleness token. The window can hold a file in memory while an
/// agent rewrites the same file; without this the window's save wins silently
/// and the other edit is gone with no error and no trace.
pub fn file_stamp(root: &Path, rel: &str) -> u64 {
    let Ok(path) = crate::inside(root, rel) else {
        return 0;
    };
    fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
