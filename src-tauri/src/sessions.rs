//! Sessions: who did what, on what evidence (ADR-0025). One JSON per session under
//! `docs/tracker/sessions/`. Every writing MCP tool appends to the open session, and a closure is
//! classified from what it cites rather than from what it claims.

use crate::workspace::git;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const COMPARTMENTS: &[&str] = &["assets", "logic", "research", "docs", "qa", "tooling", "design", "science"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Closure {
    pub item: String,
    /// stamped | machine | user
    pub class: String,
    #[serde(default)]
    pub run_id: String,
    #[serde(default)]
    pub commit: String,
    #[serde(default)]
    pub note: String,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecord {
    pub id: String,
    pub agent: String,
    pub purpose: String,
    pub compartment: String,
    pub started: String,
    #[serde(default)]
    pub ended: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub commit_at_start: String,
    #[serde(default)]
    pub items_touched: Vec<String>,
    #[serde(default)]
    pub items_created: Vec<String>,
    #[serde(default)]
    pub runs: Vec<String>,
    #[serde(default)]
    pub media: Vec<String>,
    #[serde(default)]
    pub closures: Vec<Closure>,
    #[serde(default)]
    pub left_for_user: Vec<String>,
}

pub fn dir(root: &Path) -> PathBuf {
    root.join("docs").join("tracker").join("sessions")
}

fn safe(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect()
}

pub fn start(root: &Path, agent: &str, purpose: &str, compartment: &str) -> Result<SessionRecord, String> {
    let agent = if agent.trim().is_empty() { "agent" } else { agent.trim() };
    let rec = SessionRecord {
        id: format!("{}_{}", crate::runner::stamp(), safe(agent)),
        agent: agent.to_string(),
        purpose: purpose.to_string(),
        compartment: compartment.to_string(),
        started: crate::runner::now(),
        ended: String::new(),
        summary: String::new(),
        commit_at_start: git(root, &["rev-parse", "--short", "HEAD"]).unwrap_or_default().trim().to_string(),
        items_touched: vec![],
        items_created: vec![],
        runs: vec![],
        media: vec![],
        closures: vec![],
        left_for_user: vec![],
    };
    save(root, &rec)?;
    Ok(rec)
}

pub fn save(root: &Path, rec: &SessionRecord) -> Result<(), String> {
    let d = dir(root);
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    fs::write(d.join(format!("{}.json", rec.id)), serde_json::to_string_pretty(rec).unwrap() + "\n").map_err(|e| e.to_string())
}

pub fn list(root: &Path) -> Vec<SessionRecord> {
    let mut out = vec![];
    let Ok(rd) = fs::read_dir(dir(root)) else { return out };
    for e in rd.flatten() {
        if let Ok(t) = fs::read_to_string(e.path()) {
            if let Ok(r) = serde_json::from_str::<SessionRecord>(&t) {
                out.push(r);
            }
        }
    }
    out.sort_by(|a, b| b.id.cmp(&a.id));
    out
}

impl SessionRecord {
    pub fn touch(&mut self, item: &str) {
        if !self.items_touched.iter().any(|i| i == item) {
            self.items_touched.push(item.to_string());
        }
    }
}

/// What a closure is worth: a run that passed at a commit is `stamped`; a YOURS item closed on
/// the user's word is `user`; anything else an agent closes is `machine`.
pub fn classify(root: &Path, item_status_before: &str, run_exit: Option<i32>, run_commit: &str, attested_by_user: bool) -> Result<String, String> {
    if item_status_before == "yours" {
        if !attested_by_user {
            return Err("this item is YOURS: it needs the user, not the machine. Close it only with attested_by_user=true and the user's words in `attestation`".into());
        }
        return Ok("user".into());
    }
    let _ = root;
    match run_exit {
        Some(0) if !run_commit.is_empty() => Ok("stamped".into()),
        _ => Ok("machine".into()),
    }
}
