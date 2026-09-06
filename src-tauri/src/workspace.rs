//! Everything the desk reads from the repo besides items: phases, ADRs, git, QA sheets and
//! runs. Nothing here is a second home for a fact -- each reader points at the file that
//! owns it (roadmap prose is mirrored by phases.json, and tracker.py checks that mirror).

use crate::items::{self, Item};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Adr {
    pub number: String,
    pub title: String,
    pub status: String,
    pub date: String,
    pub phase: String,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Commit {
    pub hash: String,
    pub date: String,
    pub subject: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SheetRow {
    pub id: String,
    pub do_: String,
    pub expect: String,
    pub log: String,
    pub automated: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Sheet {
    pub id: String,
    pub title: String,
    pub fault: String,
    pub rows: Vec<SheetRow>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RunRecord {
    pub id: String,
    pub name: String,
    pub started: String,
    pub finished: String,
    pub exit_code: i32,
    pub commit: String,
    pub summary: Vec<String>,
    pub log_path: String,
    #[serde(default)]
    pub tests_passed: usize,
    #[serde(default)]
    pub tests_total: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodeArea {
    pub label: String,
    pub files: usize,
    pub lines: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CodeStats {
    pub areas: Vec<CodeArea>,
    pub automation_tests: usize,
    pub items_files_missing: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Workspace {
    pub root: String,
    pub items: Vec<Item>,
    pub phases: Value,
    pub adrs: Vec<Adr>,
    pub commits: Vec<Commit>,
    pub dirty: Vec<String>,
    pub head: String,
    pub branch: String,
    pub sheets: Vec<Sheet>,
    pub qa_runs: Vec<Value>,
    pub runs: Vec<RunRecord>,
    pub stats: CodeStats,
    pub roadmap_phase_line: String,
    pub problems: Vec<String>,
    pub media: Vec<crate::media::MediaRecord>,
    pub inbox: Vec<crate::media::InboxFile>,
    pub suites: Vec<crate::suites::Suite>,
    pub tests: Vec<crate::suites::TestInfo>,
    /// docs/design/recipes.json as it is on disk, for the Design view.
    pub recipes: Value,
    /// A fingerprint of the files the desk shows, so the window can notice another writer.
    pub stamp: String,
    pub sessions: Vec<crate::sessions::SessionRecord>,
    /// desk.json as data, for the window (project name, gate boxes, builds, design hooks).
    pub config: Value,
    pub commands: Vec<crate::runner::CommandSpec>,
}

/// Newest mtime and file count under the folders the desk shows. Cheap enough to poll.
pub fn tree_stamp(root: &Path) -> String {
    fn walk(dir: &Path, depth: usize, newest: &mut std::time::SystemTime, count: &mut usize) {
        let Ok(rd) = fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                if depth > 0 { walk(&p, depth - 1, newest, count); }
            } else if let Ok(m) = e.metadata() {
                *count += 1;
                if let Ok(t) = m.modified() { if t > *newest { *newest = t; } }
            }
        }
    }
    let mut newest = std::time::UNIX_EPOCH;
    let mut count = 0;
    for rel in ["docs/tracker", "docs/tracker/sessions", "docs/design", "docs/media", "Saved/Screenshots"] {
        walk(&root.join(rel), 3, &mut newest, &mut count);
    }
    let secs = newest.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("{secs}:{count}")
}

/// The project root is the folder holding `desk.json` (ADR-0025). DESK_ROOT or BASIN_ROOT
/// override the search, which otherwise walks up from the working directory and the executable.
pub fn find_root() -> Result<PathBuf, String> {
    for var in ["DESK_ROOT", "BASIN_ROOT"] {
        if let Ok(env) = std::env::var(var) {
            let p = PathBuf::from(env);
            if p.join(crate::config::FILE).exists() {
                return Ok(p);
            }
        }
    }
    let mut starts = vec![];
    if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        starts.push(exe);
    }
    for start in starts {
        let mut p: Option<&Path> = Some(&start);
        while let Some(dir) = p {
            if dir.join(crate::config::FILE).exists() {
                return Ok(dir.to_path_buf());
            }
            p = dir.parent();
        }
    }
    Err("desk.json not found above the working directory or the executable; run `tracker.py init` in the project, or set DESK_ROOT".into())
}

pub fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(root);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Run a project Python script and return (ok, stdout+stderr). Shared by the window and the MCP server.
pub fn python(root: &Path, args: &[&str]) -> Result<(bool, String), String> {
    let mut cmd = Command::new("python");
    cmd.args(args).current_dir(root).env("PYTHONIOENCODING", "utf-8");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().map_err(|e| format!("python: {e}"))?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    Ok((out.status.success(), text))
}

/// Run any program from its argv (the first element is the program), the way the design hooks are written.
pub fn python_argv(root: &Path, argv: &[String]) -> Result<(bool, String), String> {
    let (program, rest) = argv.split_first().ok_or("empty command")?;
    let mut cmd = Command::new(program);
    cmd.args(rest).current_dir(root).env("PYTHONIOENCODING", "utf-8");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().map_err(|e| format!("{program}: {e}"))?;
    let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    Ok((out.status.success(), text))
}

/// Regenerate docs/backlog.md through the one renderer (desk.json `tracker`).
pub fn render_backlog(root: &Path) -> Result<String, String> {
    let cfg = crate::config::load(root);
    let tracker = root.join(&cfg.tracker).to_string_lossy().to_string();
    let (ok, text) = python(root, &[tracker.as_str(), "render"])?;
    if ok { Ok(text) } else { Err(text) }
}

pub fn git_log(root: &Path, n: usize, paths: &[String]) -> Vec<Commit> {
    let n = n.to_string();
    let mut args: Vec<&str> = vec!["log", "-n", &n, "--date=format:%Y-%m-%d %H:%M", "--format=%h%x1f%ad%x1f%s"];
    if !paths.is_empty() {
        args.push("--");
        for p in paths {
            args.push(p);
        }
    }
    git(root, &args)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| {
            let mut parts = l.split('\u{1f}');
            Some(Commit { hash: parts.next()?.into(), date: parts.next()?.into(), subject: parts.next()?.into() })
        })
        .collect()
}

fn adrs(root: &Path) -> Vec<Adr> {
    let dir = root.join("docs").join("decisions");
    let mut out = vec![];
    let Ok(rd) = fs::read_dir(&dir) else { return out };
    for e in rd.flatten() {
        let path = e.path();
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
        if !name.ends_with(".md") || name.starts_with("0000") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let mut adr = Adr { number: name[..4].to_string(), title: String::new(), status: String::new(), date: String::new(), phase: String::new(), path: format!("docs/decisions/{name}") };
        for line in text.lines().take(12) {
            if let Some(rest) = line.strip_prefix("# ") {
                adr.title = rest.splitn(2, " — ").nth(1).unwrap_or(rest).trim().to_string();
            } else if let Some(rest) = line.strip_prefix("**Status:**") {
                adr.status = rest.trim().to_string();
            } else if let Some(rest) = line.strip_prefix("**Date:**") {
                adr.date = rest.trim().to_string();
            } else if let Some(rest) = line.strip_prefix("**Phase:**") {
                adr.phase = rest.trim().to_string();
            }
        }
        out.push(adr);
    }
    out.sort_by(|a, b| a.number.cmp(&b.number));
    out
}

fn sheets(root: &Path) -> Vec<Sheet> {
    let rel = crate::config::load(root).docs.sheets;
    if rel.is_empty() {
        return vec![];
    }
    let path = root.join(rel);
    let Ok(text) = fs::read_to_string(&path) else { return vec![] };
    let mut out: Vec<Sheet> = vec![];
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("## MC-") {
            let (num, title) = rest.split_once(" — ").unwrap_or((rest, ""));
            out.push(Sheet { id: format!("MC-{}", num.trim()), title: title.trim().to_string(), fault: String::new(), rows: vec![] });
            continue;
        }
        let Some(cur) = out.last_mut() else { continue };
        if let Some(rest) = line.strip_prefix("*Fault it catches:") {
            cur.fault = rest.trim().trim_end_matches('*').trim().to_string();
            continue;
        }
        if line.starts_with('|') {
            let cells: Vec<String> = line.trim_matches('|').split('|').map(|c| c.trim().to_string()).collect();
            if cells.len() < 3 {
                continue;
            }
            let id = cells[0].clone();
            let is_row = id.split_once('.').map(|(a, b)| a.chars().all(|c| c.is_ascii_digit()) && b.chars().all(|c| c.is_ascii_digit())).unwrap_or(false);
            if !is_row {
                continue;
            }
            let automated = cells[1].starts_with("~~");
            cur.rows.push(SheetRow {
                id,
                do_: cells[1].replace("~~", ""),
                expect: cells[2].clone(),
                log: cells.get(3).cloned().unwrap_or_default().replace('—', "").trim().to_string(),
                automated,
            });
        }
    }
    out
}

fn json_dir(dir: &Path) -> Vec<Value> {
    let mut out = vec![];
    let Ok(rd) = fs::read_dir(dir) else { return out };
    let mut paths: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.extension().and_then(|s| s.to_str()) == Some("json")).collect();
    paths.sort();
    for p in paths {
        if let Ok(text) = fs::read_to_string(&p) {
            if let Ok(mut v) = serde_json::from_str::<Value>(&text) {
                if let Some(obj) = v.as_object_mut() {
                    obj.entry("id").or_insert(Value::String(p.file_stem().unwrap().to_string_lossy().to_string()));
                }
                out.push(v);
            }
        }
    }
    out.reverse();
    out
}

pub fn runs_dir(root: &Path) -> PathBuf {
    root.join("docs").join("tracker").join("runs")
}

pub fn qa_runs_dir(root: &Path) -> PathBuf {
    root.join("docs").join("tracker").join("qa").join("runs")
}

fn runs(root: &Path) -> Vec<RunRecord> {
    json_dir(&runs_dir(root)).into_iter().filter_map(|v| serde_json::from_value(v).ok()).collect()
}

fn count_lines(dir: &Path, exts: &[String], skip: &[String], files: &mut usize, lines: &mut usize) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if skip.iter().any(|s| s == name) {
                continue;
            }
            count_lines(&p, exts, skip, files, lines);
        } else if p.extension().and_then(|s| s.to_str()).map(|e| exts.iter().any(|x| x == e)).unwrap_or(false) {
            if let Ok(t) = fs::read_to_string(&p) {
                *files += 1;
                *lines += t.lines().count();
            }
        }
    }
}

fn stats(root: &Path, items: &[Item]) -> CodeStats {
    let cfg = crate::config::load(root);
    let mut s = CodeStats { areas: vec![], automation_tests: 0, items_files_missing: vec![] };
    for area in &cfg.code {
        let (mut files, mut lines) = (0, 0);
        count_lines(&root.join(&area.dir), &area.ext, &area.skip, &mut files, &mut lines);
        s.areas.push(CodeArea { label: area.label.clone(), files, lines });
    }
    s.automation_tests = crate::suites::test_inventory(root).len();
    for it in items.iter().filter(|i| i.status == "done") {
        for f in &it.files {
            if !root.join(f).exists() {
                s.items_files_missing.push(format!("{}: {}", it.id, f));
            }
        }
    }
    s
}

fn roadmap_phase_line(root: &Path) -> String {
    let rel = crate::config::load(root).docs.roadmap;
    if rel.is_empty() {
        return String::new();
    }
    fs::read_to_string(root.join(rel))
        .ok()
        .and_then(|t| t.lines().find(|l| l.starts_with("**Phase ")).map(|l| l.to_string()))
        .unwrap_or_default()
}

pub fn load(root: &Path) -> Result<Workspace, String> {
    let mut problems = vec![];
    let items = match items::load_all(root) {
        Ok(v) => v,
        Err(e) => {
            problems.push(e);
            vec![]
        }
    };
    let phases: Value = fs::read_to_string(root.join("docs").join("tracker").join("phases.json"))
        .map_err(|e| e.to_string())
        .and_then(|t| serde_json::from_str(&t).map_err(|e| e.to_string()))
        .unwrap_or_else(|e| {
            problems.push(format!("phases.json: {e}"));
            serde_json::json!({ "phases": [] })
        });
    let cfg = crate::config::load(root);
    let recipes_path = cfg.design.as_ref().map(|d| d.recipes.clone()).unwrap_or_default();
    let dirty: Vec<String> = git(root, &["status", "--porcelain"]).unwrap_or_default().lines().map(|l| l.to_string()).collect();
    let head = git(root, &["rev-parse", "--short", "HEAD"]).unwrap_or_default().trim().to_string();
    let branch = git(root, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_default().trim().to_string();
    let stats = stats(root, &items);
    for m in &stats.items_files_missing {
        problems.push(format!("item file missing: {m}"));
    }
    Ok(Workspace {
        root: root.to_string_lossy().to_string(),
        commits: git_log(root, 120, &[]),
        dirty,
        head,
        branch,
        adrs: adrs(root),
        sheets: sheets(root),
        qa_runs: json_dir(&qa_runs_dir(root)),
        runs: runs(root),
        roadmap_phase_line: roadmap_phase_line(root),
        media: crate::media::load_index(root).media,
        inbox: crate::media::inbox(root),
        suites: crate::suites::load(root).suites,
        tests: crate::suites::test_inventory(root),
        recipes: (!recipes_path.is_empty()).then(|| fs::read_to_string(root.join(&recipes_path)).ok()).flatten()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
            .and_then(|v| v.get("recipes").cloned())
            .unwrap_or_else(|| Value::Array(vec![])),
        stamp: tree_stamp(root),
        sessions: crate::sessions::list(root).into_iter().take(20).collect(),
        config: crate::config::as_value(root),
        commands: crate::runner::catalogue(root),
        stats,
        items,
        phases,
        problems,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_real_sheets_when_run_inside_the_repo() {
        let Ok(root) = find_root() else { return };
        let s = sheets(&root);
        assert!(s.len() >= 9, "expected MC-1..MC-9, got {}", s.len());
        let mc7 = s.iter().find(|x| x.id == "MC-7").unwrap();
        assert!(mc7.rows.iter().any(|r| r.id == "7.7" && r.automated));
        assert_eq!(s[0].rows[0].id, "1.1");
        assert!(!adrs(&root).is_empty());
    }
}
