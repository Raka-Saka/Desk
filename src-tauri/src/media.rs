//! Media: screenshots, renders, videos and phone photos, filed by phase under `docs/media/`
//! and indexed in `docs/media/media.json`. The inbox is whatever the game and the phone have
//! dropped that nobody has filed yet.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MediaRecord {
    pub id: String,
    /// Repo-relative, forward slashes.
    pub file: String,
    pub phase: String,
    #[serde(default)]
    pub item: String,
    /// A QA run id this is evidence for, if any.
    #[serde(default)]
    pub run: String,
    /// screenshot | render | video | photo | diagram
    pub kind: String,
    #[serde(default)]
    pub caption: String,
    pub date: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MediaIndex {
    pub media: Vec<MediaRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxFile {
    /// Absolute path, as the OS gives it.
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub modified: String,
    pub source: String,
}

const EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "mov"];

pub fn media_dir(root: &Path) -> PathBuf {
    root.join("docs").join("media")
}

fn index_path(root: &Path) -> PathBuf {
    media_dir(root).join("media.json")
}

pub fn load_index(root: &Path) -> MediaIndex {
    fs::read_to_string(index_path(root)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save_index(root: &Path, idx: &MediaIndex) -> Result<(), String> {
    fs::create_dir_all(media_dir(root)).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(idx).unwrap() + "\n";
    fs::write(index_path(root), text).map_err(|e| e.to_string())
}

pub fn kind_for(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "webm" | "mov" => "video",
        _ => "screenshot",
    }
}

fn is_media(p: &Path) -> bool {
    p.extension().and_then(|s| s.to_str()).map(|e| EXTS.contains(&e.to_ascii_lowercase().as_str())).unwrap_or(false)
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth > 0 {
                walk(&p, depth - 1, out);
            }
        } else if is_media(&p) {
            out.push(p);
        }
    }
}

fn modified(p: &Path) -> String {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .map(|t| chrono::DateTime::<chrono::Local>::from(t).format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_default()
}

/// Files the game, the phone or a bake have produced that are not yet in the index.
pub fn inbox(root: &Path) -> Vec<InboxFile> {
    let idx = load_index(root);
    let filed: std::collections::HashSet<PathBuf> = idx.media.iter().map(|m| root.join(&m.file)).collect();
    let sources = crate::config::load(root).media_sources;
    let mut out = vec![];
    for src in &sources {
        let (label, dir, depth) = (src.label.as_str(), root.join(&src.path), src.depth);
        let mut files = vec![];
        walk(&dir, depth, &mut files);
        for p in files {
            if filed.contains(&p) {
                continue;
            }
            // A source may name a prefix, so a folder of data textures only offers its renders.
            if !src.prefix.is_empty() && !p.file_name().and_then(|s| s.to_str()).unwrap_or("").starts_with(src.prefix.as_str()) {
                continue;
            }
            out.push(InboxFile {
                path: p.to_string_lossy().to_string(),
                name: p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string(),
                bytes: fs::metadata(&p).map(|m| m.len()).unwrap_or(0),
                modified: modified(&p),
                source: label.to_string(),
            });
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out
}

fn safe_name(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' }).collect()
}

/// Copy `source` into docs/media/phase-<phase>/ and record it. A source already under
/// docs/media is recorded where it is.
pub fn file(root: &Path, source: &str, mut rec: MediaRecord) -> Result<MediaRecord, String> {
    let src = PathBuf::from(source);
    let src = if src.is_absolute() { src } else { root.join(&src) };
    if !src.exists() {
        return Err(format!("{} does not exist", src.display()));
    }
    let name = src.file_name().and_then(|s| s.to_str()).ok_or("bad file name")?.to_string();
    let media = media_dir(root);
    let dest = if src.starts_with(&media) {
        src.clone()
    } else {
        let dir = media.join(format!("phase-{}", safe_name(&rec.phase)));
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
        let dest = dir.join(format!("{stamp}_{}", safe_name(&name)));
        fs::copy(&src, &dest).map_err(|e| format!("copy: {e}"))?;
        dest
    };
    let rel = dest.strip_prefix(root).map_err(|_| "outside the repo")?.to_string_lossy().replace('\\', "/");
    let mut idx = load_index(root);
    rec.id = if rec.id.is_empty() { format!("m-{}", chrono::Local::now().format("%Y%m%d-%H%M%S-%3f")) } else { rec.id };
    rec.file = rel;
    if rec.kind.is_empty() {
        rec.kind = kind_for(&name).to_string();
    }
    if rec.date.is_empty() {
        rec.date = modified(&dest).chars().take(10).collect();
    }
    rec.bytes = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    idx.media.retain(|m| m.id != rec.id);
    idx.media.push(rec.clone());
    idx.media.sort_by(|a, b| b.date.cmp(&a.date).then(b.id.cmp(&a.id)));
    save_index(root, &idx)?;
    Ok(rec)
}

pub fn update(root: &Path, rec: MediaRecord) -> Result<MediaRecord, String> {
    let mut idx = load_index(root);
    let pos = idx.media.iter().position(|m| m.id == rec.id).ok_or("unknown media id")?;
    idx.media[pos] = rec.clone();
    save_index(root, &idx)?;
    Ok(rec)
}

pub fn remove(root: &Path, id: &str, delete_file: bool) -> Result<(), String> {
    let mut idx = load_index(root);
    let pos = idx.media.iter().position(|m| m.id == id).ok_or("unknown media id")?;
    let rec = idx.media.remove(pos);
    save_index(root, &idx)?;
    if delete_file {
        let p = root.join(&rec.file);
        if p.starts_with(media_dir(root)) {
            fs::remove_file(&p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
