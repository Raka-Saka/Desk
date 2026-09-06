//! `desk.json`: everything the desk knows about the project it sits over. The desk itself
//! is generic (ADR-0025); this file is the adapter, and it is the root marker.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub const FILE: &str = "desk.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CommandDef {
    pub name: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub group: String,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub minutes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FilterCommand {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub group: String,
    #[serde(default)]
    pub minutes: u32,
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Shots {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub minutes: u32,
    #[serde(default)]
    pub list: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CodeArea {
    pub label: String,
    pub dir: String,
    pub ext: Vec<String>,
    #[serde(default)]
    pub skip: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Tests {
    #[serde(default)]
    pub dir: String,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub logs: Vec<String>,
    #[serde(default = "default_result_pattern")]
    pub result_pattern: String,
}

fn default_result_pattern() -> String {
    "Test Completed. Result={".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MediaSource {
    pub label: String,
    pub path: String,
    #[serde(default)]
    pub depth: usize,
    #[serde(default)]
    pub prefix: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Docs {
    #[serde(default)]
    pub sheets: String,
    #[serde(default)]
    pub roadmap: String,
    #[serde(default)]
    pub guide: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Design {
    pub recipes: String,
    pub report: Vec<String>,
    #[serde(default)]
    pub check: Vec<String>,
    #[serde(default)]
    pub check_filter: String,
    #[serde(default)]
    pub push_suite: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Library {
    pub sources: String,
    #[serde(default)]
    pub papers: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub claims: String,
    #[serde(default)]
    pub contradictions: String,
    #[serde(default)]
    pub candidates: String,
    #[serde(default)]
    pub fetch: Vec<String>,
    #[serde(default)]
    pub render: Vec<String>,
    #[serde(default)]
    pub shared: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    #[serde(default = "default_project")]
    pub project: String,
    #[serde(default = "default_python")]
    pub python: String,
    #[serde(default = "default_tracker")]
    pub tracker: String,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub docs: Docs,
    #[serde(default)]
    pub code: Vec<CodeArea>,
    #[serde(default)]
    pub tests: Tests,
    #[serde(default)]
    pub media_sources: Vec<MediaSource>,
    #[serde(default)]
    pub playtest_gate: Vec<(String, String)>,
    #[serde(default = "default_builds")]
    pub builds: Vec<String>,
    #[serde(default)]
    pub commands: Vec<CommandDef>,
    #[serde(default)]
    pub filter_command: Option<FilterCommand>,
    #[serde(default)]
    pub shots: Option<Shots>,
    #[serde(default)]
    pub design: Option<Design>,
    #[serde(default)]
    pub library: Option<Library>,
}

fn default_project() -> String { "Project".into() }
fn default_python() -> String { "python".into() }
fn default_tracker() -> String { "Tools/desk/tracker/tracker.py".into() }
fn default_builds() -> Vec<String> { vec!["dev".into(), "release".into()] }

pub fn load(root: &Path) -> Config {
    fs::read_to_string(root.join(FILE))
        .ok()
        .and_then(|t| serde_json::from_str::<Config>(&t).ok())
        .unwrap_or_default()
}

pub fn as_value(root: &Path) -> Value {
    fs::read_to_string(root.join(FILE)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null)
}

impl Config {
    /// `${root}`, `${ue_root}` and any key of `env` (from the environment first, then the file).
    pub fn expand(&self, root: &Path, s: &str) -> String {
        let mut out = s.replace("${root}", &root.to_string_lossy());
        for (k, v) in &self.env {
            let val = std::env::var(k).unwrap_or_else(|_| v.clone());
            out = out.replace(&format!("${{{}}}", k.to_lowercase()), &val).replace(&format!("${{{}}}", k), &val);
        }
        out
    }

    pub fn python_tracker(&self, root: &Path) -> (String, PathBuf) {
        (self.python.clone(), root.join(&self.tracker))
    }
}
