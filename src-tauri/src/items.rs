//! Work items: `docs/tracker/items/<id>.md`. Same fields, same order, same encoding as
//! `Tools/tracker/tracker.py`, so a file written by either side is byte-identical.

use crate::frontmatter::{self, Field};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Item {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub status: String,
    pub phase: String,
    pub priority: String,
    pub severity: String,
    pub parent: String,
    pub sheet: String,
    pub files: Vec<String>,
    pub tests: Vec<String>,
    pub adrs: Vec<String>,
    pub commits: Vec<String>,
    pub tags: Vec<String>,
    pub done_when: String,
    pub created: String,
    pub updated: String,
    pub closed: String,
    pub body: String,
}

pub const KINDS: &[&str] = &["epic", "task", "bug", "defect", "question", "chore", "reference"];
pub const STATUSES: &[&str] = &["now", "next", "later", "yours", "watch", "parked", "done"];
pub const PRIORITIES: &[&str] = &["P0", "P1", "P2", "P3"];

pub fn items_dir(root: &Path) -> PathBuf {
    root.join("docs").join("tracker").join("items")
}

fn get_str(fm: &std::collections::BTreeMap<String, Field>, key: &str) -> Result<String, String> {
    match fm.get(key) {
        None => Ok(String::new()),
        Some(Field::Str(s)) => Ok(s.clone()),
        Some(Field::List(_)) => Err(format!("{key} must be a string")),
    }
}

fn get_list(fm: &std::collections::BTreeMap<String, Field>, key: &str) -> Result<Vec<String>, String> {
    match fm.get(key) {
        None => Ok(vec![]),
        Some(Field::List(l)) => Ok(l.clone()),
        Some(Field::Str(s)) if s.is_empty() => Ok(vec![]),
        Some(Field::Str(s)) => Ok(vec![s.clone()]),
    }
}

pub fn parse_item(text: &str, expected_id: Option<&str>) -> Result<Item, String> {
    let (fm, body) = frontmatter::parse(text)?;
    let item = Item {
        id: get_str(&fm, "id")?,
        title: get_str(&fm, "title")?,
        kind: get_str(&fm, "kind")?,
        status: get_str(&fm, "status")?,
        phase: get_str(&fm, "phase")?,
        priority: get_str(&fm, "priority")?,
        severity: get_str(&fm, "severity")?,
        parent: get_str(&fm, "parent")?,
        sheet: get_str(&fm, "sheet")?,
        files: get_list(&fm, "files")?,
        tests: get_list(&fm, "tests")?,
        adrs: get_list(&fm, "adrs")?,
        commits: get_list(&fm, "commits")?,
        tags: get_list(&fm, "tags")?,
        done_when: get_str(&fm, "done_when")?,
        created: get_str(&fm, "created")?,
        updated: get_str(&fm, "updated")?,
        closed: get_str(&fm, "closed")?,
        body,
    };
    if let Some(id) = expected_id {
        if item.id != id {
            return Err(format!("id {:?} does not match file name {:?}", item.id, id));
        }
    }
    Ok(item)
}

pub fn render_item(it: &Item) -> String {
    let s = frontmatter::encode_str;
    let l = frontmatter::encode_list;
    let mut out = String::from("---\n");
    for (k, v) in [
        ("id", s(&it.id)),
        ("title", s(&it.title)),
        ("kind", s(&it.kind)),
        ("status", s(&it.status)),
        ("phase", s(&it.phase)),
        ("priority", s(&it.priority)),
        ("severity", s(&it.severity)),
        ("parent", s(&it.parent)),
        ("sheet", s(&it.sheet)),
        ("files", l(&it.files)),
        ("tests", l(&it.tests)),
        ("adrs", l(&it.adrs)),
        ("commits", l(&it.commits)),
        ("tags", l(&it.tags)),
        ("done_when", s(&it.done_when)),
        ("created", s(&it.created)),
        ("updated", s(&it.updated)),
        ("closed", s(&it.closed)),
    ] {
        out.push_str(k);
        out.push_str(": ");
        out.push_str(&v);
        out.push('\n');
    }
    out.push_str("---\n");
    let body = it.body.trim_end_matches('\n');
    if !body.is_empty() {
        out.push_str(body);
        out.push('\n');
    }
    out
}

pub fn validate(it: &Item) -> Result<(), String> {
    if it.id.is_empty() || !it.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_') {
        return Err(format!("bad id {:?}", it.id));
    }
    if it.title.trim().is_empty() {
        return Err("empty title".into());
    }
    if !KINDS.contains(&it.kind.as_str()) {
        return Err(format!("kind {:?} not one of {:?}", it.kind, KINDS));
    }
    if !STATUSES.contains(&it.status.as_str()) {
        return Err(format!("status {:?} not one of {:?}", it.status, STATUSES));
    }
    if !PRIORITIES.contains(&it.priority.as_str()) {
        return Err(format!("priority {:?} not one of {:?}", it.priority, PRIORITIES));
    }
    if (it.kind == "bug" || it.kind == "defect") && it.severity.is_empty() {
        return Err(format!("a {} needs a severity", it.kind));
    }
    if (it.status == "now" || it.status == "next") && it.done_when.trim().is_empty() {
        return Err("NOW and NEXT items need a done-when: write the condition first".into());
    }
    Ok(())
}

pub fn load_all(root: &Path) -> Result<Vec<Item>, String> {
    let dir = items_dir(root);
    let mut items = vec![];
    let entries = fs::read_dir(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    for entry in entries {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let text = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        let item = parse_item(&text, Some(&stem)).map_err(|e| format!("{}: {e}", path.display()))?;
        items.push(item);
    }
    items.sort_by_key(|i| id_key(&i.id));
    Ok(items)
}

/// Sort ids the way a person reads them: 2.9 before 2.10, digits before letters.
pub fn id_key(id: &str) -> Vec<(u8, u64, String)> {
    id.split('.')
        .map(|p| match p.parse::<u64>() {
            Ok(n) => (0, n, String::new()),
            Err(_) => (1, 0, p.to_string()),
        })
        .collect()
}

pub fn save(root: &Path, it: &Item) -> Result<PathBuf, String> {
    validate(it)?;
    let dir = items_dir(root);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.md", it.id));
    fs::write(&path, render_item(it)).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_matches_the_python_layout() {
        let it = Item {
            id: "3.16".into(),
            title: "The ground does not build fast enough to arrive somewhere.".into(),
            kind: "bug".into(),
            status: "next".into(),
            phase: "3".into(),
            priority: "P0".into(),
            severity: "S1".into(),
            parent: "E.7".into(),
            sheet: "MC-1".into(),
            files: vec!["Source/Basin/Planet/BasinPlanet.cpp".into()],
            tests: vec!["Basin.Gate.Walk".into()],
            adrs: vec![],
            commits: vec![],
            tags: vec![],
            done_when: "Blocks landing.".into(),
            created: "2026-09-04".into(),
            updated: "2026-09-06".into(),
            closed: "".into(),
            body: "Falls at 34 m/s.\n".into(),
        };
        let text = render_item(&it);
        assert!(text.starts_with("---\nid: 3.16\ntitle: \"The ground does not build fast enough to arrive somewhere.\"\nkind: bug\n"));
        assert!(text.contains("\nfiles: [\"Source/Basin/Planet/BasinPlanet.cpp\"]\n"));
        assert!(text.contains("\nclosed: \n---\nFalls at 34 m/s.\n"));
        let back = parse_item(&text, Some("3.16")).unwrap();
        assert_eq!(back, it);
    }

    #[test]
    fn validation_catches_the_same_things_as_python() {
        let mut it = Item { id: "9.1".into(), title: "x".into(), kind: "bug".into(), status: "next".into(), phase: "3".into(), priority: "P1".into(), ..Default::default() };
        assert!(validate(&it).is_err(), "bug without severity");
        it.severity = "S2".into();
        assert!(validate(&it).is_err(), "next without done_when");
        it.done_when = "it works".into();
        assert!(validate(&it).is_ok());
    }

    #[test]
    fn ids_sort_like_a_person_reads_them() {
        let mut v = vec!["2.10", "2.9", "C.1", "3.1", "E.2"];
        v.sort_by_key(|s| id_key(s));
        assert_eq!(v, vec!["2.9", "2.10", "3.1", "C.1", "E.2"]);
    }
}

#[cfg(test)]
mod live_tree {
    use super::*;

    /// The Python side wrote every file in docs/tracker/items; re-rendering each through the
    /// Rust writer must give back the bytes on disk, or the two writers have drifted.
    #[test]
    fn every_python_written_item_rerenders_identically() {
        let Ok(root) = crate::workspace::find_root() else { return };
        let dir = items_dir(&root);
        let Ok(rd) = fs::read_dir(&dir) else { return };
        let mut n = 0;
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("md") { continue; }
            let text = fs::read_to_string(&p).unwrap();
            let item = parse_item(&text, None).unwrap_or_else(|err| panic!("{}: {err}", p.display()));
            // git may check the tree out with CRLF (core.autocrlf); the writer always emits LF.
            assert_eq!(render_item(&item), text.replace("\r\n", "\n"), "{} does not round-trip", p.display());
            n += 1;
        }
        assert!(n > 0);
    }
}
