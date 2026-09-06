//! Projects: the one thing the Desk keeps for itself -- a list of the project folders it has
//! opened (`%APPDATA%\Desk\projects.json`) -- and the two actions the Projects screen offers:
//! create a project (run the tracker's `init` for the user) and open one (relaunch on it).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Known {
    pub path: String,
    pub name: String,
    pub last_opened: String,
    #[serde(default)]
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct Store {
    projects: Vec<Known>,
}

fn store_path() -> Option<PathBuf> {
    let base = std::env::var("APPDATA").ok().map(PathBuf::from).or_else(|| dirs_fallback())?;
    Some(base.join("Desk").join("projects.json"))
}

fn dirs_fallback() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(|h| PathBuf::from(h).join(".config"))
}

fn load() -> Store {
    store_path().and_then(|p| fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save(store: &Store) -> Result<(), String> {
    let p = store_path().ok_or("no APPDATA")?;
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(&p, serde_json::to_string_pretty(store).unwrap() + "\n").map_err(|e| e.to_string())
}

pub fn list() -> Vec<Known> {
    let mut v = load().projects;
    for k in &mut v {
        k.exists = Path::new(&k.path).join(crate::config::FILE).exists();
    }
    v.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    v
}

pub fn remember(root: &Path) -> Result<(), String> {
    let name = crate::config::load(root).project;
    let path = root.to_string_lossy().to_string();
    let mut store = load();
    store.projects.retain(|k| !k.path.eq_ignore_ascii_case(&path));
    store.projects.insert(0, Known { path, name, last_opened: crate::runner::now(), exists: true });
    store.projects.truncate(20);
    save(&store)
}

pub fn forget(path: &str) -> Result<(), String> {
    let mut store = load();
    store.projects.retain(|k| !k.path.eq_ignore_ascii_case(path));
    save(&store)
}

/// The Desk's own folder: the executable sits at <desk>/src-tauri/target/<profile>/desk.exe.
/// `DESK_HOME` overrides, for an executable that was moved.
pub fn desk_home() -> Option<PathBuf> {
    if let Ok(h) = std::env::var("DESK_HOME") {
        let p = PathBuf::from(h);
        if p.join("tracker").join("tracker.py").exists() {
            return Some(p);
        }
    }
    let exe = std::env::current_exe().ok()?;
    let mut p: Option<&Path> = exe.parent();
    while let Some(dir) = p {
        if dir.join("tracker").join("tracker.py").exists() && dir.join("src-tauri").exists() {
            return Some(dir.to_path_buf());
        }
        p = dir.parent();
    }
    None
}

fn hidden(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
}

/// Create a project folder, make it a git repository if it is not one, and run the tracker's
/// `init` in it. Returns the new root.
pub fn create(parent: &str, folder: &str, name: &str) -> Result<PathBuf, String> {
    let folder = folder.trim();
    if folder.is_empty() || folder.contains(['/', '\\', ':']) {
        return Err("folder must be a plain name".into());
    }
    let root = PathBuf::from(parent).join(folder);
    if root.join(crate::config::FILE).exists() {
        return Err(format!("{} already has a desk.json", root.display()));
    }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    if !root.join(".git").exists() {
        let mut git = Command::new("git");
        git.args(["init", "-q", "-b", "main"]).current_dir(&root);
        hidden(&mut git);
        let _ = git.status();
    }
    let home = desk_home().ok_or("cannot find the Desk's own folder (set DESK_HOME)")?;
    let tracker = home.join("tracker").join("tracker.py");
    let mut py = Command::new("python");
    py.args([tracker.to_string_lossy().as_ref(), "init", "--project", name.trim(), "--dir", root.to_string_lossy().as_ref()]).current_dir(&root);
    hidden(&mut py);
    let out = py.output().map_err(|e| format!("python: {e}"))?;
    if !out.status.success() {
        return Err(format!("init failed:\n{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)));
    }
    remember(&root)?;
    Ok(root)
}

/// Relaunch the desk on another project. The caller exits this instance afterwards.
pub fn spawn_on(root: &Path) -> Result<(), String> {
    if !root.join(crate::config::FILE).exists() {
        return Err(format!("{} has no desk.json", root.display()));
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut cmd = Command::new(exe);
    cmd.current_dir(root).env("DESK_ROOT", root);
    cmd.spawn().map_err(|e| e.to_string())?;
    remember(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_known_list_round_trips_in_memory() {
        let mut s = Store::default();
        s.projects.push(Known { path: "X:/one".into(), name: "One".into(), last_opened: "2026-09-06 10:00:00".into(), exists: false });
        let text = serde_json::to_string(&s).unwrap();
        let back: Store = serde_json::from_str(&text).unwrap();
        assert_eq!(back.projects[0].name, "One");
    }

    #[test]
    fn create_refuses_a_path_as_folder_name() {
        assert!(create("X:/nowhere", "a/b", "Bad").is_err());
        assert!(create("X:/nowhere", "", "Bad").is_err());
    }
}
