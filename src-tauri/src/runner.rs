//! Runs the project's own commands (check.py, pytest, the editor build, the gate, the game's
//! screenshot switches) and streams their output to the window. Every run leaves a small JSON
//! record under `docs/tracker/runs/` -- the evidence "verified" needs -- and its full log under
//! `Saved/Desk/runs/`, which git ignores.

use crate::config::{self, CommandDef, Config};
use crate::workspace::{git, runs_dir, RunRecord};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

/// Where run events go: the window (Tauri events), or nowhere (the MCP server, a test). The
/// runner and the suites take this rather than a window handle, so the same code serves both
/// (ADR-0025: one writer).
pub trait Events: Send + Sync {
    fn emit(&self, name: &str, payload: Value);
}

impl Events for tauri::AppHandle {
    fn emit(&self, name: &str, payload: Value) {
        let _ = tauri::Emitter::emit(self, name, payload);
    }
}

pub struct NoEvents;

impl Events for NoEvents {
    fn emit(&self, _name: &str, _payload: Value) {}
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandSpec {
    pub name: String,
    pub label: String,
    pub description: String,
    pub group: String,
    pub program: String,
    pub args: Vec<String>,
    pub minutes: u32,
}

fn spec_from(cfg: &Config, root: &Path, d: &CommandDef) -> CommandSpec {
    CommandSpec {
        name: d.name.clone(),
        label: if d.label.is_empty() { d.name.clone() } else { d.label.clone() },
        description: d.description.clone(),
        group: if d.group.is_empty() { "tools".into() } else { d.group.clone() },
        program: cfg.expand(root, &d.program),
        args: d.args.iter().map(|a| cfg.expand(root, a)).collect(),
        minutes: d.minutes.max(1),
    }
}

/// `shot:<Switch>`: the project's own screenshot switches, from desk.json `shots`.
pub fn shot_spec(root: &Path, switch: &str) -> Option<CommandSpec> {
    let cfg = config::load(root);
    let shots = cfg.shots.as_ref()?;
    let label = shots.list.iter().find(|(s, _)| s == switch).map(|(_, l)| l.clone()).unwrap_or_else(|| switch.to_string());
    Some(CommandSpec {
        name: format!("shot:{switch}"),
        label: format!("Shot · {label}"),
        description: format!("Runs the game with -{switch}; the picture lands in the media inbox."),
        group: "shots".into(),
        program: cfg.expand(root, &shots.program),
        args: shots.args.iter().map(|a| cfg.expand(root, &a.replace("${switch}", switch))).collect(),
        minutes: shots.minutes.max(1),
    })
}

/// `automation:<filter>`: the project's filtered test runner, from desk.json `filter_command`.
pub fn automation_spec(root: &Path, filter: &str) -> Option<CommandSpec> {
    let cfg = config::load(root);
    let fc = cfg.filter_command.as_ref()?;
    Some(CommandSpec {
        name: format!("automation:{filter}"),
        label: fc.label.replace("${filter}", filter),
        description: format!("filtered test run: {filter}"),
        group: if fc.group.is_empty() { "tests".into() } else { fc.group.clone() },
        program: cfg.expand(root, &fc.program),
        args: fc.args.iter().map(|a| cfg.expand(root, &a.replace("${filter}", filter))).collect(),
        minutes: fc.minutes.max(1),
    })
}

/// Every command desk.json declares, plus one entry per shot.
pub fn catalogue(root: &Path) -> Vec<CommandSpec> {
    let cfg = config::load(root);
    let mut v: Vec<CommandSpec> = cfg.commands.iter().map(|d| spec_from(&cfg, root, d)).collect();
    if let Some(shots) = &cfg.shots {
        for (switch, _) in &shots.list {
            if let Some(s) = shot_spec(root, switch) {
                v.push(s);
            }
        }
    }
    v
}

/// Resolve a name from the catalogue, or a dynamic `automation:<filter>` / `shot:<Switch>`.
pub fn resolve(root: &Path, name: &str) -> Option<CommandSpec> {
    if let Some(f) = name.strip_prefix("automation:") {
        return automation_spec(root, f);
    }
    if let Some(sw) = name.strip_prefix("shot:") {
        return shot_spec(root, sw);
    }
    catalogue(root).into_iter().find(|c| c.name == name)
}

#[derive(Default)]
pub struct Running(pub Arc<Mutex<HashMap<String, Child>>>);

pub fn now() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn stamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

/// Lines worth keeping in the record: the check.py layer lines, pytest's tail, UBT's result.
fn is_summary(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("PASS") || t.starts_with("FAIL") || t.starts_with("WARN") || t.starts_with("OK:") || t.starts_with("FAILED")
        || t.contains(" passed") || t.contains(" failed") || t.starts_with("[tracker]") || t.starts_with("Result:")
        || t.contains("error C") || t.contains("Total execution time") || t.starts_with("rendered ")
        || t.contains("[Verify] RESULT") || t.contains("Shot:") || t.contains("Screenshot saved")
        || t.contains("[Recipes]")
}

fn test_result(line: &str) -> Option<bool> {
    let i = line.find("Test Completed. Result={")?;
    let rest = &line[i + "Test Completed. Result={".len()..];
    Some(rest.starts_with("Success"))
}

/// Run one command to completion, streaming lines as `run-line` events under `run_id`, and
/// write its record. This is the one place a process is spawned; `start` runs it on a thread
/// and the suite runner calls it in sequence.
pub fn run_blocking(app: &dyn Events, running: &Arc<Mutex<HashMap<String, Child>>>, root: &Path, spec: &CommandSpec, run_id: &str) -> Result<RunRecord, String> {
    let log_dir = root.join("Saved").join("Desk").join("runs");
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    let log_path = log_dir.join(format!("{run_id}.log"));
    let mut log = fs::File::create(&log_path).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args).current_dir(root).stdout(Stdio::piped()).stderr(Stdio::piped()).stdin(Stdio::null());
    cmd.env("PYTHONUNBUFFERED", "1").env("PYTHONIOENCODING", "utf-8");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let mut child = cmd.spawn().map_err(|e| format!("{}: {e}", spec.program))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    running.lock().unwrap().insert(run_id.to_string(), child);

    let started = now();
    let commit = git(root, &["rev-parse", "--short", "HEAD"]).unwrap_or_default().trim().to_string();
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    for reader in [Box::new(stdout) as Box<dyn std::io::Read + Send>, Box::new(stderr)] {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let mut r = BufReader::new(reader);
            let mut buf = vec![];
            loop {
                buf.clear();
                match r.read_until(b'\n', &mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let _ = tx.send(Some(String::from_utf8_lossy(&buf).trim_end().to_string()));
                    }
                }
            }
            let _ = tx.send(None);
        });
    }
    drop(tx);

    let mut summary = vec![];
    let (mut passed, mut total) = (0usize, 0usize);
    let mut open_readers = 2;
    while open_readers > 0 {
        match rx.recv() {
            Ok(Some(line)) => {
                let _ = writeln!(log, "{line}");
                if let Some(ok) = test_result(&line) {
                    total += 1;
                    if ok {
                        passed += 1;
                    }
                }
                if is_summary(&line) && summary.len() < 40 {
                    summary.push(line.clone());
                }
                app.emit("run-line", json!({"run_id": run_id, "line": line}));
            }
            Ok(None) => open_readers -= 1,
            Err(_) => break,
        }
    }
    // The engine's own log may carry the results rather than stdout; count from the project's
    // test logs when stdout had none, so a filtered run still reports numbers.
    if total == 0 && spec.name.starts_with("automation") {
        for log in &config::load(root).tests.logs {
            let Ok(t) = fs::read_to_string(root.join(log)) else { continue };
            let mut p = 0;
            let mut n = 0;
            for l in t.lines() {
                if let Some(ok) = test_result(l) {
                    n += 1;
                    if ok { p += 1; }
                }
            }
            if n > 0 {
                passed = p;
                total = n;
                break;
            }
        }
    }
    let exit_code = {
        let child = running.lock().unwrap().remove(run_id);
        match child {
            Some(mut c) => c.wait().map(|s| s.code().unwrap_or(-1)).unwrap_or(-1),
            None => -1,
        }
    };
    if total > 0 {
        summary.push(format!("{passed}/{total} tests passed"));
    }
    let record = RunRecord {
        id: run_id.to_string(),
        name: spec.name.clone(),
        started,
        finished: now(),
        exit_code,
        commit,
        summary,
        log_path: log_path.to_string_lossy().to_string(),
        tests_passed: passed,
        tests_total: total,
    };
    let dir = runs_dir(root);
    let _ = fs::create_dir_all(&dir);
    let _ = fs::write(dir.join(format!("{run_id}.json")), serde_json::to_string_pretty(&record).unwrap());
    app.emit("run-done", json!({"run_id": run_id, "record": record}));
    Ok(record)
}

pub fn start(app: Arc<dyn Events>, running: Arc<Mutex<HashMap<String, Child>>>, root: PathBuf, spec: CommandSpec) -> Result<String, String> {
    let run_id = format!("{}_{}", stamp(), spec.name.replace([':', '.'], "-"));
    // Fail fast on a missing program, on the caller's thread, so the window hears about it.
    if spec.program.contains(['/', '\\']) && !Path::new(&spec.program).exists() {
        return Err(format!("{} does not exist (UE_ROOT?)", spec.program));
    }
    let id = run_id.clone();
    std::thread::spawn(move || {
        if let Err(e) = run_blocking(&*app, &running, &root, &spec, &id) {
            app.emit("run-line", json!({"run_id": id, "line": format!("could not start: {e}")}));
            let record = RunRecord { id: id.clone(), name: spec.name.clone(), started: now(), finished: now(), exit_code: -1, commit: String::new(), summary: vec![e], log_path: String::new(), tests_passed: 0, tests_total: 0 };
            app.emit("run-done", json!({"run_id": id, "record": record}));
        }
    });
    Ok(run_id)
}

pub fn cancel(running: &Mutex<HashMap<String, Child>>, run_id: &str) -> bool {
    if let Some(child) = running.lock().unwrap().get_mut(run_id) {
        return child.kill().is_ok();
    }
    false
}
