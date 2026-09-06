//! Basin Desk -- the desktop over `docs/tracker/`. Reads and writes the same files the
//! Python tracker and a Claude session do, and runs the project's own checks.

pub mod config;
pub mod design;
pub mod frontmatter;
pub mod items;
pub mod mcp;
pub mod media;
pub mod projects;
pub mod runner;
pub mod sessions;
pub mod suites;
pub mod workspace;

use items::Item;
use runner::{CommandSpec, Running};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

struct Root(PathBuf);

fn inside(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.contains("..") {
        return Err("path escapes the project".into());
    }
    Ok(root.join(rel))
}

#[tauri::command]
fn load_workspace(root: State<Root>) -> Result<workspace::Workspace, String> {
    if root.0.as_os_str().is_empty() {
        return Err("NO_PROJECT".into());
    }
    let ws = workspace::load(&root.0)?;
    let _ = projects::remember(&root.0);
    Ok(ws)
}

// --- projects ----------------------------------------------------------------------------------

#[tauri::command]
fn projects_recent() -> Vec<projects::Known> {
    projects::list()
}

#[tauri::command]
fn projects_forget(path: String) -> Result<(), String> {
    projects::forget(&path)
}

#[tauri::command]
fn projects_home() -> Option<String> {
    projects::desk_home().map(|p| p.to_string_lossy().to_string())
}

/// Native folder picker, async so the blocking dialog never sits on the main thread.
#[tauri::command]
async fn projects_pick_folder(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog().file().blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn projects_create(parent: String, folder: String, name: String) -> Result<String, String> {
    projects::create(&parent, &folder, &name).map(|p| p.to_string_lossy().to_string())
}

/// Relaunch on another project and close this window.
#[tauri::command]
fn projects_open(app: AppHandle, path: String) -> Result<(), String> {
    projects::spawn_on(Path::new(&path))?;
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(600));
        app.exit(0);
    });
    Ok(())
}

#[tauri::command]
fn save_item(root: State<Root>, mut item: Item) -> Result<Item, String> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    if item.created.is_empty() {
        item.created = today.clone();
    }
    item.updated = today.clone();
    if item.status == "done" && item.closed.is_empty() {
        item.closed = today;
    }
    if item.status != "done" {
        item.closed.clear();
    }
    items::save(&root.0, &item)?;
    Ok(item)
}

#[tauri::command]
fn next_id(root: State<Root>, prefix: String) -> Result<String, String> {
    let items = items::load_all(&root.0)?;
    let max = items
        .iter()
        .filter_map(|i| i.id.strip_prefix(&format!("{prefix}.")))
        .filter_map(|n| n.parse::<u64>().ok())
        .max()
        .unwrap_or(0);
    Ok(format!("{prefix}.{}", max + 1))
}

#[tauri::command]
fn read_text(root: State<Root>, rel: String) -> Result<String, String> {
    let p = inside(&root.0, &rel)?;
    fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))
}

#[tauri::command]
fn save_qa_run(root: State<Root>, run: Value) -> Result<String, String> {
    let dir = workspace::qa_runs_dir(&root.0);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let id = run
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| chrono::Local::now().format("%Y%m%d-%H%M%S").to_string());
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("bad run id".into());
    }
    let mut run = run;
    run["id"] = Value::String(id.clone());
    fs::write(dir.join(format!("{id}.json")), serde_json::to_string_pretty(&run).unwrap()).map_err(|e| e.to_string())?;
    Ok(id)
}

/// Regenerate docs/backlog.md through the one renderer, synchronously and without a run record.
#[tauri::command]
fn render_backlog(root: State<Root>) -> Result<String, String> {
    workspace::render_backlog(&root.0)
}

#[tauri::command]
fn commits_for(root: State<Root>, paths: Vec<String>) -> Vec<workspace::Commit> {
    workspace::git_log(&root.0, 30, &paths)
}

#[tauri::command]
fn commands(root: State<Root>) -> Vec<CommandSpec> {
    runner::catalogue(&root.0)
}

#[tauri::command]
fn run_command(app: AppHandle, root: State<Root>, running: State<Running>, name: String) -> Result<String, String> {
    let spec = runner::resolve(&root.0, &name).ok_or("unknown command")?;
    runner::start(Arc::new(app), running.0.clone(), root.0.clone(), spec)
}

// --- media -------------------------------------------------------------------------------------

#[tauri::command]
fn media_inbox(root: State<Root>) -> Vec<media::InboxFile> {
    media::inbox(&root.0)
}

#[tauri::command]
fn file_media(root: State<Root>, source: String, record: media::MediaRecord) -> Result<media::MediaRecord, String> {
    media::file(&root.0, &source, record)
}

#[tauri::command]
fn update_media(root: State<Root>, record: media::MediaRecord) -> Result<media::MediaRecord, String> {
    media::update(&root.0, record)
}

#[tauri::command]
fn remove_media(root: State<Root>, id: String, delete_file: bool) -> Result<(), String> {
    media::remove(&root.0, &id, delete_file)
}

/// Native file picker. Async so the blocking dialog never sits on the main thread.
#[tauri::command]
async fn pick_files(app: AppHandle) -> Vec<String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .add_filter("Media", &["png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "mov"])
        .blocking_pick_files();
    picked.unwrap_or_default().into_iter().filter_map(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string()).collect()
}

// --- design ------------------------------------------------------------------------------------

#[tauri::command]
fn design_report(root: State<Root>, draft: Option<String>, places: Vec<(f64, f64)>) -> Result<Value, String> {
    design::report(&root.0, draft, &places)
}

#[tauri::command]
fn save_recipes(root: State<Root>, recipes: Value) -> Result<Vec<String>, String> {
    design::save_recipes(&root.0, recipes)
}

#[tauri::command]
fn check_recipes(root: State<Root>) -> Result<Vec<String>, String> {
    design::check_recipes(&root.0)
}

#[tauri::command]
fn tree_stamp(root: State<Root>) -> String {
    workspace::tree_stamp(&root.0)
}

// --- suites ------------------------------------------------------------------------------------

#[tauri::command]
fn run_suite(app: AppHandle, root: State<Root>, running: State<Running>, suite: String, tester: String, build: String) -> Result<String, String> {
    suites::start(Arc::new(app), running.0.clone(), root.0.clone(), &suite, tester, build)
}

#[tauri::command]
fn complete_suite_step(root: State<Root>, suite_run_id: String, step_index: usize, payload: Value) -> Result<suites::SuiteRun, String> {
    suites::complete_manual(&root.0, &suite_run_id, step_index, payload)
}

#[tauri::command]
fn suite_run(root: State<Root>, id: String) -> Result<suites::SuiteRun, String> {
    suites::load_run(&root.0, &id)
}

#[tauri::command]
fn cancel_run(running: State<Running>, run_id: String) -> bool {
    runner::cancel(&running.0, &run_id)
}

/// BASIN_DESK_VIEW=qa opens on that view; used by scripted screenshots.
#[tauri::command]
fn startup_view() -> String {
    std::env::var("BASIN_DESK_VIEW").unwrap_or_default()
}

#[tauri::command]
fn read_log(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Open a project file in VS Code when it is on PATH, otherwise with whatever the OS uses.
#[tauri::command]
fn open_path(app: AppHandle, root: State<Root>, rel: String, line: Option<u32>) -> Result<(), String> {
    let p = inside(&root.0, &rel)?;
    if !p.exists() {
        return Err(format!("{} does not exist", p.display()));
    }
    let target = match line {
        Some(l) => format!("{}:{l}", p.display()),
        None => p.display().to_string(),
    };
    let mut cmd = Command::new("cmd");
    cmd.args(["/C", "code", "-g", &target]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    if let Ok(status) = cmd.status() {
        if status.success() {
            return Ok(());
        }
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_path(p.to_string_lossy().to_string(), None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // No project is not an error: the window opens on the Projects screen instead.
    let root = workspace::find_root().unwrap_or_else(|e| {
        eprintln!("{e}");
        PathBuf::new()
    });
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Root(root))
        .manage(Running::default())
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") {
                let root = app.state::<Root>();
                let title = if root.0.as_os_str().is_empty() { "Desk".to_string() } else { format!("{} Desk", config::load(&root.0).project) };
                let _ = w.set_title(&title);
                let _ = w.maximize();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_workspace,
            projects_recent,
            projects_forget,
            projects_home,
            projects_pick_folder,
            projects_create,
            projects_open,
            save_item,
            next_id,
            read_text,
            save_qa_run,
            commits_for,
            render_backlog,
            commands,
            run_command,
            cancel_run,
            read_log,
            startup_view,
            open_path,
            media_inbox,
            file_media,
            update_media,
            remove_media,
            pick_files,
            run_suite,
            complete_suite_step,
            suite_run,
            design_report,
            save_recipes,
            check_recipes,
            tree_stamp
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
