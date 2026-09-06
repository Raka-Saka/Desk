//! The Design view's backend, shared by the window and the MCP server: the project's own
//! projection command and the one file its recipes live in (ADR-0024), both from desk.json.

use crate::config;
use crate::workspace::python_argv;
use serde_json::Value;
use std::fs;
use std::path::Path;

fn hooks(root: &Path) -> Result<config::Design, String> {
    config::load(root).design.ok_or_else(|| "desk.json has no `design` block: this project has no recipe hooks".to_string())
}

/// Run the project's report command. `draft` is a recipes body to project instead of the file.
pub fn report(root: &Path, draft: Option<String>, places: &[(f64, f64)]) -> Result<Value, String> {
    let d = hooks(root)?;
    let cfg = config::load(root);
    let mut args: Vec<String> = d.report.iter().map(|a| cfg.expand(root, a)).collect();
    let tmp = root.join("Saved").join("Desk").join("recipes-draft.json");
    if let Some(text) = draft {
        fs::create_dir_all(tmp.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::write(&tmp, text).map_err(|e| e.to_string())?;
        args.push("--recipes".into());
        args.push(tmp.to_string_lossy().to_string());
    }
    for (lat, lon) in places {
        args.push("--place".into());
        args.push(format!("{lat},{lon}"));
    }
    let (ok, text) = python_argv(root, &args)?;
    if !ok {
        return Err(text);
    }
    let line = text.lines().rev().find(|l| l.trim_start().starts_with('{')).ok_or_else(|| format!("no JSON in the report output:\n{text}"))?;
    serde_json::from_str(line).map_err(|e| format!("{e}: {line}"))
}

/// Write the recipes file (the one home), then say what the project's check thinks of it.
pub fn save_recipes(root: &Path, recipes: Value) -> Result<Vec<String>, String> {
    let d = hooks(root)?;
    let path = root.join(&d.recipes);
    let existing: Value = fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(serde_json::json!({}));
    let mut doc = serde_json::Map::new();
    if let Some(c) = existing.get("_comment") {
        doc.insert("_comment".into(), c.clone());
    }
    doc.insert("recipes".into(), recipes);
    let text = serde_json::to_string_pretty(&Value::Object(doc)).map_err(|e| e.to_string())? + "\n";
    fs::write(&path, text).map_err(|e| e.to_string())?;
    check_recipes(root)
}

/// The project's check, filtered to its recipe lines. Empty means clean.
pub fn check_recipes(root: &Path) -> Result<Vec<String>, String> {
    let d = hooks(root)?;
    if d.check.is_empty() {
        return Ok(vec![]);
    }
    let cfg = config::load(root);
    let args: Vec<String> = d.check.iter().map(|a| cfg.expand(root, a)).collect();
    let (_, text) = python_argv(root, &args)?;
    Ok(text.lines().filter(|l| d.check_filter.is_empty() || l.contains(&d.check_filter)).map(|l| l.trim().trim_start_matches("FAIL").trim().to_string()).collect())
}
