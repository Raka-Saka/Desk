//! QA suites: a named list of steps a QA manager can start with one button. Automated steps
//! (a catalogue command, an automation filter, a game shot) run in sequence on a thread and
//! stream through the same `run-line` events as a single command; manual steps (sheets, a
//! playtest) are left pending in the suite run for a person to complete from the QA view.

use crate::runner::{self, CommandSpec, Events};
use crate::workspace::{git, qa_runs_dir};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Step {
    /// command | automation | shot | sheets | playtest
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub filter: String,
    #[serde(default)]
    pub switch: String,
    #[serde(default)]
    pub sheets: Vec<String>,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Suite {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub cadence: String,
    pub steps: Vec<Step>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Suites {
    pub suites: Vec<Suite>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    pub step: Step,
    /// pending | running | pass | fail | recorded | skipped
    pub status: String,
    #[serde(default)]
    pub run_id: String,
    #[serde(default)]
    pub exit_code: i32,
    #[serde(default)]
    pub summary: Vec<String>,
    #[serde(default)]
    pub tests_passed: usize,
    #[serde(default)]
    pub tests_total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuiteRun {
    pub id: String,
    pub kind: String,
    pub suite: String,
    pub suite_name: String,
    pub date: String,
    pub started: String,
    #[serde(default)]
    pub finished: String,
    pub commit: String,
    pub steps: Vec<StepResult>,
    /// pass | fail | pending (manual steps outstanding) | running
    pub status: String,
    #[serde(default)]
    pub results: HashMap<String, String>,
    #[serde(default)]
    pub gate: HashMap<String, bool>,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub tester: String,
    #[serde(default)]
    pub build: String,
}

pub fn suites_path(root: &Path) -> PathBuf {
    root.join("docs").join("tracker").join("qa").join("suites.json")
}

pub fn load(root: &Path) -> Suites {
    fs::read_to_string(suites_path(root)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn run_path(root: &Path, id: &str) -> PathBuf {
    qa_runs_dir(root).join(format!("{id}.json"))
}

pub fn load_run(root: &Path, id: &str) -> Result<SuiteRun, String> {
    let t = fs::read_to_string(run_path(root, id)).map_err(|e| e.to_string())?;
    serde_json::from_str(&t).map_err(|e| e.to_string())
}

fn save_run(root: &Path, run: &SuiteRun) -> Result<(), String> {
    fs::create_dir_all(qa_runs_dir(root)).map_err(|e| e.to_string())?;
    fs::write(run_path(root, &run.id), serde_json::to_string_pretty(run).unwrap() + "\n").map_err(|e| e.to_string())
}

fn spec_for(root: &Path, step: &Step) -> Option<CommandSpec> {
    match step.kind.as_str() {
        "command" => runner::resolve(root, &step.name),
        "automation" => runner::automation_spec(root, &step.filter),
        "shot" => runner::shot_spec(root, &step.switch),
        _ => None,
    }
}

fn overall(run: &SuiteRun) -> String {
    if run.steps.iter().any(|s| s.status == "running") {
        return "running".into();
    }
    if run.steps.iter().any(|s| s.status == "fail") {
        return "fail".into();
    }
    if run.steps.iter().any(|s| s.status == "pending") {
        return "pending".into();
    }
    "pass".into()
}

fn suite_event(id: &str, run: &SuiteRun) -> Value {
    serde_json::json!({"suite_run_id": id, "run": run})
}

pub fn start(app: Arc<dyn Events>, running: Arc<Mutex<HashMap<String, Child>>>, root: PathBuf, suite_id: &str, tester: String, build: String) -> Result<String, String> {
    let suite = load(&root).suites.into_iter().find(|s| s.id == suite_id).ok_or("unknown suite")?;
    let id = format!("{}_suite-{}", runner::stamp(), suite.id);
    let commit = git(&root, &["rev-parse", "--short", "HEAD"]).unwrap_or_default().trim().to_string();
    let mut run = SuiteRun {
        id: id.clone(),
        kind: "suite".into(),
        suite: suite.id.clone(),
        suite_name: suite.name.clone(),
        date: chrono::Local::now().format("%Y-%m-%d").to_string(),
        started: runner::now(),
        finished: String::new(),
        commit,
        steps: suite.steps.iter().map(|s| StepResult { step: s.clone(), status: "pending".into(), run_id: String::new(), exit_code: 0, summary: vec![], tests_passed: 0, tests_total: 0 }).collect(),
        status: "running".into(),
        results: HashMap::new(),
        gate: HashMap::new(),
        notes: String::new(),
        tester,
        build,
    };
    save_run(&root, &run)?;
    app.emit("suite-step", suite_event(&id, &run));

    let thread_id = id.clone();
    std::thread::spawn(move || {
        let id = thread_id;
        for i in 0..run.steps.len() {
            let Some(spec) = spec_for(&root, &run.steps[i].step) else { continue }; // manual: stays pending
            run.steps[i].status = "running".into();
            run.status = overall(&run);
            let _ = save_run(&root, &run);
            app.emit("suite-step", suite_event(&id, &run));
            let run_id = format!("{}_{}", runner::stamp(), spec.name.replace([':', '.'], "-"));
            match runner::run_blocking(&*app, &running, &root, &spec, &run_id) {
                Ok(rec) => {
                    let s = &mut run.steps[i];
                    s.run_id = rec.id;
                    s.exit_code = rec.exit_code;
                    s.summary = rec.summary;
                    s.tests_passed = rec.tests_passed;
                    s.tests_total = rec.tests_total;
                    // A shot that ran is a pass; whether the picture is right is the sheet's job.
                    s.status = if rec.exit_code == 0 { "pass".into() } else { "fail".into() };
                }
                Err(e) => {
                    run.steps[i].status = "fail".into();
                    run.steps[i].summary = vec![e];
                }
            }
            run.status = overall(&run);
            let _ = save_run(&root, &run);
            app.emit("suite-step", suite_event(&id, &run));
        }
        run.finished = runner::now();
        run.status = overall(&run);
        let _ = save_run(&root, &run);
        app.emit("suite-done", suite_event(&id, &run));
    });
    Ok(id)
}

/// A person finished a manual step: sheet results or the playtest form land on the suite run.
pub fn complete_manual(root: &Path, suite_run_id: &str, step_index: usize, payload: Value) -> Result<SuiteRun, String> {
    let mut run = load_run(root, suite_run_id)?;
    let step = run.steps.get_mut(step_index).ok_or("no such step")?;
    match step.step.kind.as_str() {
        "sheets" => {
            let results = payload.get("results").and_then(|v| v.as_object()).ok_or("results missing")?;
            let mut fails = 0;
            let mut n = 0;
            for (k, v) in results {
                let s = v.as_str().unwrap_or("").to_string();
                if s == "FAIL" {
                    fails += 1;
                }
                if !s.is_empty() {
                    n += 1;
                }
                run.results.insert(k.clone(), s);
            }
            step.status = if fails > 0 { "fail".into() } else { "pass".into() };
            step.summary = vec![format!("{n} rows recorded, {fails} FAIL")];
        }
        "playtest" => {
            let gate = payload.get("gate").and_then(|v| v.as_object()).ok_or("gate missing")?;
            let mut yes = 0;
            for (k, v) in gate {
                let b = v.as_bool().unwrap_or(false);
                if b {
                    yes += 1;
                }
                run.gate.insert(k.clone(), b);
            }
            step.status = if yes == gate.len() && !gate.is_empty() { "pass".into() } else { "fail".into() };
            step.summary = vec![format!("{yes}/{} gate boxes", gate.len())];
        }
        other => return Err(format!("step {other} is not manual")),
    }
    if let Some(n) = payload.get("notes").and_then(|v| v.as_str()) {
        if !n.is_empty() {
            if !run.notes.is_empty() {
                run.notes.push_str("\n\n");
            }
            run.notes.push_str(n);
        }
    }
    if let Some(t) = payload.get("tester").and_then(|v| v.as_str()) {
        if !t.is_empty() {
            run.tester = t.to_string();
        }
    }
    if let Some(b) = payload.get("build").and_then(|v| v.as_str()) {
        if !b.is_empty() {
            run.build = b.to_string();
        }
    }
    run.status = overall(&run);
    if run.status != "pending" && run.status != "running" && run.finished.is_empty() {
        run.finished = runner::now();
    }
    save_run(root, &run)?;
    Ok(run)
}

/// Every test name the C++ declares, by system, with the last result the logs hold.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestInfo {
    pub name: String,
    pub system: String,
    pub file: String,
    pub last_result: String,
    pub last_seen: String,
}

pub fn test_inventory(root: &Path) -> Vec<TestInfo> {
    let cfg = crate::config::load(root);
    let mut tests = vec![];
    if cfg.tests.dir.is_empty() {
        return tests;
    }
    let needle = format!("\"{}", cfg.tests.prefix);
    let dir = root.join(&cfg.tests.dir);
    if let Ok(rd) = fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            let Ok(text) = fs::read_to_string(&p) else { continue };
            let file = format!("{}/{}", cfg.tests.dir.trim_end_matches('/'), p.file_name().and_then(|s| s.to_str()).unwrap_or(""));
            let mut rest = text.as_str();
            while let Some(i) = rest.find(needle.as_str()) {
                let after = &rest[i + 1..];
                let end = after.find('"').unwrap_or(after.len());
                let name = &after[..end];
                if name.matches('.').count() >= 2 && !name.contains(' ') {
                    let system = name.split('.').nth(1).unwrap_or("").to_string();
                    tests.push(TestInfo { name: name.to_string(), system, file: file.clone(), last_result: String::new(), last_seen: String::new() });
                }
                rest = &after[end..];
            }
        }
    }
    // Newest log that carries results wins: the desk's own automation runs, then check.py's.
    let mut logs: Vec<(String, PathBuf)> = vec![];
    if let Ok(rd) = fs::read_dir(root.join("Saved").join("Desk").join("runs")) {
        for e in rd.flatten() {
            let p = e.path();
            let n = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
            if n.contains("automation") || n.contains("_check") {
                logs.push((n, p));
            }
        }
    }
    logs.sort();
    let mut candidates: Vec<PathBuf> = logs.into_iter().rev().map(|(_, p)| p).collect();
    for log in &cfg.tests.logs {
        candidates.push(root.join(log));
    }
    for log in candidates {
        let Ok(text) = fs::read_to_string(&log) else { continue };
        if !text.contains("Test Completed. Result=") {
            continue;
        }
        let seen = fs::metadata(&log).and_then(|m| m.modified()).map(|t| chrono::DateTime::<chrono::Local>::from(t).format("%Y-%m-%d %H:%M").to_string()).unwrap_or_default();
        for line in text.lines() {
            let Some(i) = line.find("Test Completed. Result={") else { continue };
            let rest = &line[i + "Test Completed. Result={".len()..];
            let result = rest.split('}').next().unwrap_or("");
            let Some(j) = line.find("Path={") else { continue };
            let path = line[j + 6..].split('}').next().unwrap_or("");
            if let Some(t) = tests.iter_mut().find(|t| t.name == path) {
                if t.last_result.is_empty() {
                    t.last_result = result.to_string();
                    t.last_seen = seen.clone();
                }
            }
        }
        if tests.iter().all(|t| !t.last_result.is_empty()) {
            break;
        }
    }
    tests.sort_by(|a, b| a.name.cmp(&b.name));
    tests.dedup_by(|a, b| a.name == b.name);
    tests
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inventory_and_suites_read_the_live_tree() {
        let Ok(root) = crate::workspace::find_root() else { return };
        let tests = test_inventory(&root);
        assert!(tests.len() >= 40, "expected the C++ tests to be found, got {}", tests.len());
        assert!(tests.iter().any(|t| t.name == "Basin.Gate.Walk" && t.system == "Gate"));
        let suites = load(&root).suites;
        assert!(suites.iter().any(|s| s.id == "smoke"));
        for s in &suites {
            for step in &s.steps {
                match step.kind.as_str() {
                    "command" => assert!(runner::resolve(&root, &step.name).is_some(), "{}: unknown command {}", s.id, step.name),
                    "shot" => assert!(runner::shot_spec(&root, &step.switch).is_some(), "{}: unknown shot {}", s.id, step.switch),
                    "automation" | "sheets" | "playtest" => {}
                    other => panic!("{}: unknown step type {other}", s.id),
                }
            }
        }
        let _ = crate::media::inbox(&root);
    }
}
