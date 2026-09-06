//! The library: the sources a project's numbers rest on, the claims that cite them, and the
//! candidates waiting to be read (ADR-0025, item T.3). Reads the project's own files as they
//! are -- `sources.json`, the PDFs and their text cache, `claims.json` -- and adds one file of
//! its own, `candidates.json`. A shared library folder (another project's, or a common one) is
//! read the same way and its shelves are shown beside the project's.

use crate::config::{self, Library as Hooks};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Source {
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub year: Value,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub venue: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub licence: String,
    #[serde(default)]
    pub canonical: bool,
    #[serde(default)]
    pub settles: String,
    #[serde(default)]
    pub supplies: Vec<String>,
    #[serde(default)]
    pub target: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
    // computed
    #[serde(default)]
    pub origin: String,
    #[serde(default)]
    pub pdf: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub claims: Vec<usize>,
    #[serde(default)]
    pub items: Vec<String>,
    /// Files under docs/ and Tools/ that name this source (slug, or first author's surname with the year).
    #[serde(default)]
    pub cited_in: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Check {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Claim {
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub line: u64,
    #[serde(default)]
    pub section: String,
    #[serde(default)]
    pub claim: String,
    #[serde(default)]
    pub principle: String,
    #[serde(default)]
    pub cites_source: bool,
    #[serde(default)]
    pub checks: Vec<Check>,
    // computed
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub sources: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Candidate {
    #[serde(default)]
    pub slug: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub year: Value,
    #[serde(default)]
    pub venue: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub domain: String,
    /// Why it is proposed: what it would settle or supply.
    #[serde(default)]
    pub why: String,
    /// Recency, as a sentence: what has been published since and whether this is still the reference.
    #[serde(default)]
    pub recency: String,
    /// Credentials: affiliation, prior work in the field, the venue's standing -- what was verified and how.
    #[serde(default)]
    pub credentials: String,
    /// The contradictions pass: which shelf papers it agrees or disagrees with, and where.
    #[serde(default)]
    pub contradictions: String,
    #[serde(default)]
    pub proposed_by: String,
    #[serde(default)]
    pub proposed_at: String,
    /// proposed | accepted | rejected
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub decision_note: String,
    #[serde(default)]
    pub decided_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Library {
    pub enabled: bool,
    pub sources: Vec<Source>,
    pub claims: Vec<Claim>,
    pub candidates: Vec<Candidate>,
    pub domains: Vec<String>,
    pub contradictions: Vec<String>,
    pub shelves: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Hit {
    pub slug: String,
    pub title: String,
    pub where_: String,
    pub snippet: String,
}

fn hooks(root: &Path) -> Option<Hooks> {
    config::load(root).library
}

fn read_sources(dir_root: &Path, sources_rel: &str, papers_rel: &str, text_rel: &str, origin: &str) -> Vec<Source> {
    let Ok(text) = fs::read_to_string(dir_root.join(sources_rel)) else { return vec![] };
    let Ok(v) = serde_json::from_str::<Value>(&text) else { return vec![] };
    let arr = v.get("sources").and_then(|s| s.as_array()).cloned().or_else(|| v.as_array().cloned()).unwrap_or_default();
    arr.into_iter()
        .filter_map(|s| serde_json::from_value::<Source>(s).ok())
        .map(|mut s| {
            let pdf = dir_root.join(papers_rel).join(format!("{}.pdf", s.slug));
            let txt = dir_root.join(text_rel).join(format!("{}.txt", s.slug));
            s.pdf = if pdf.exists() { pdf.to_string_lossy().to_string() } else { String::new() };
            s.text = if txt.exists() { txt.to_string_lossy().to_string() } else { String::new() };
            s.origin = origin.to_string();
            s
        })
        .collect()
}

fn surname(author: &str) -> String {
    author.split_whitespace().last().unwrap_or("").trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()
}

fn year_str(v: &Value) -> String {
    match v {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        _ => String::new(),
    }
}

/// A claim cites a source when the ledger line names the first author's surname and the year,
/// or the source's slug. Best effort, and said so: the ledgers cite in prose.
fn link_claims(sources: &mut [Source], claims: &mut [Claim], root: &Path) {
    let mut file_cache: HashMap<String, Vec<String>> = HashMap::new();
    for (ci, c) in claims.iter_mut().enumerate() {
        let lines = file_cache.entry(c.file.clone()).or_insert_with(|| {
            fs::read_to_string(root.join(&c.file)).map(|t| t.lines().map(str::to_string).collect()).unwrap_or_default()
        });
        // The claim is a bold line; its citation sits in the paragraph under it, up to the blank.
        if c.line >= 1 && (c.line as usize) <= lines.len() {
            let mut para = vec![];
            for l in &lines[c.line as usize - 1..] {
                if l.trim().is_empty() { break; }
                para.push(l.trim().to_string());
            }
            c.text = para.join(" ");
        }
        let hay = format!("{} {} {}", c.text, c.claim, c.principle).to_lowercase();
        for s in sources.iter_mut() {
            let yr = year_str(&s.year);
            let first = s.authors.first().map(|a| surname(a)).unwrap_or_default();
            let hit = (!s.slug.is_empty() && hay.contains(&s.slug.to_lowercase()))
                || (!first.is_empty() && first.len() > 2 && !yr.is_empty() && hay.contains(&first) && hay.contains(&yr));
            if hit {
                s.claims.push(ci);
                c.sources.push(s.slug.clone());
            }
        }
    }
}

fn link_items(sources: &mut [Source], root: &Path) {
    let items = crate::items::load_all(root).unwrap_or_default();
    for s in sources.iter_mut() {
        let first = s.authors.first().map(|a| surname(a)).unwrap_or_default();
        let yr = year_str(&s.year);
        for it in &items {
            let hay = format!("{} {}", it.title, it.body).to_lowercase();
            if (!s.slug.is_empty() && hay.contains(&s.slug.to_lowercase()))
                || (first.len() > 2 && !yr.is_empty() && hay.contains(&first) && hay.contains(&yr))
            {
                s.items.push(it.id.clone());
            }
        }
    }
}

/// Where each source is read: every .md and .py under docs/ and Tools/ (skipping the papers and
/// the text cache) that names the slug, or the first author's surname together with the year.
fn link_files(sources: &mut [Source], root: &Path, skip: &[PathBuf]) {
    fn walk(dir: &Path, skip: &[PathBuf], out: &mut Vec<PathBuf>) {
        let Ok(rd) = fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if skip.iter().any(|s| p.starts_with(s)) { continue; }
            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if p.is_dir() {
                if !(name.starts_with('.') || name == "node_modules" || name == "target" || name == "__pycache__" || name == "desk") {
                    walk(&p, skip, out);
                }
            } else if name.ends_with(".md") || name.ends_with(".py") || name.ends_with(".json") {
                out.push(p);
            }
        }
    }
    let mut files = vec![];
    for top in ["docs", "Tools"] {
        walk(&root.join(top), skip, &mut files);
    }
    let keys: Vec<(String, String, String)> = sources.iter().map(|s| (s.slug.to_lowercase(), s.authors.first().map(|a| surname(a)).unwrap_or_default(), year_str(&s.year))).collect();
    for f in files {
        let Ok(text) = fs::read_to_string(&f) else { continue };
        let hay = text.to_lowercase();
        let rel = f.strip_prefix(root).unwrap_or(&f).to_string_lossy().replace('\\', "/");
        for (i, (slug, first, yr)) in keys.iter().enumerate() {
            if rel.ends_with("sources.json") || rel.ends_with("candidates.json") { continue; }
            // The slug; or surname with the year; or a distinctive surname (6+ letters) on its own
            // as a whole word -- "Melosh" is named without a year in the ADR that rests on it.
            let named = (!slug.is_empty() && hay.contains(slug))
                || (first.len() > 2 && !yr.is_empty() && hay.contains(first) && hay.contains(yr))
                || (first.len() >= 6 && has_word(&hay, first));
            if named {
                sources[i].cited_in.push(rel.clone());
            }
        }
    }
}

fn has_word(hay: &str, word: &str) -> bool {
    let mut from = 0;
    while let Some(pos) = hay[from..].find(word) {
        let at = from + pos;
        let before = hay[..at].chars().next_back().map_or(true, |c| !c.is_alphanumeric());
        let after = hay[at + word.len()..].chars().next().map_or(true, |c| !c.is_alphanumeric());
        if before && after {
            return true;
        }
        from = at + word.len();
    }
    false
}

pub fn candidates_path(root: &Path) -> Option<PathBuf> {
    hooks(root).map(|h| root.join(if h.candidates.is_empty() { "docs/science/candidates.json".to_string() } else { h.candidates.clone() }))
}

fn read_candidates(root: &Path) -> Vec<Candidate> {
    let Some(p) = candidates_path(root) else { return vec![] };
    fs::read_to_string(p).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.get("candidates").cloned()).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

fn write_candidates(root: &Path, list: &[Candidate]) -> Result<(), String> {
    let p = candidates_path(root).ok_or("no library in desk.json")?;
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    let doc = serde_json::json!({
        "_comment": "Candidates for the library, proposed by the research action (docs/LIBRARY.md in the Desk). A candidate becomes a source by being read and accepted; the desk appends it to sources.json and runs the project's fetch and render hooks.",
        "candidates": list,
    });
    fs::write(&p, serde_json::to_string_pretty(&doc).unwrap() + "\n").map_err(|e| e.to_string())
}

pub fn load(root: &Path) -> Library {
    let Some(h) = hooks(root) else { return Library::default() };
    let papers = if h.papers.is_empty() { "docs/science/papers".to_string() } else { h.papers.clone() };
    let textdir = if h.text.is_empty() { "docs/science/.textcache".to_string() } else { h.text.clone() };
    let mut sources = read_sources(root, &h.sources, &papers, &textdir, "project");
    let mut shelves = vec!["project".to_string()];
    for shared in &h.shared {
        let sp = PathBuf::from(shared);
        // A shared shelf is a folder with sources.json, papers/ and text/ inside it.
        let more = read_sources(&sp, "sources.json", "papers", "text", shared);
        if !more.is_empty() {
            shelves.push(shared.clone());
        }
        sources.extend(more);
    }
    let mut claims: Vec<Claim> = fs::read_to_string(root.join(&h.claims)).ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.get("claims").cloned()).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    link_claims(&mut sources, &mut claims, root);
    link_items(&mut sources, root);
    link_files(&mut sources, root, &[root.join(&papers), root.join(&textdir)]);
    let mut domains: Vec<String> = sources.iter().map(|s| s.domain.clone()).filter(|d| !d.is_empty()).collect();
    domains.sort();
    domains.dedup();
    let contradictions = if h.contradictions.is_empty() { vec![] } else {
        fs::read_to_string(root.join(&h.contradictions)).map(|t| t.lines().filter(|l| l.starts_with("## ")).map(|l| l.trim_start_matches("## ").to_string()).collect()).unwrap_or_default()
    };
    Library { enabled: true, sources, claims, candidates: read_candidates(root), domains, contradictions, shelves }
}

/// Search titles, authors, what a source settles and supplies, and the text cache. A few
/// snippets per source, so the result reads like a card rather than a dump.
pub fn search(root: &Path, query: &str, per_source: usize) -> Vec<Hit> {
    let q = query.trim().to_lowercase();
    if q.len() < 2 {
        return vec![];
    }
    let lib = load(root);
    let mut hits = vec![];
    for s in &lib.sources {
        let meta = format!("{} | {} | {} | {}", s.title, s.authors.join(", "), s.settles, s.supplies.join(" / "));
        if meta.to_lowercase().contains(&q) {
            hits.push(Hit { slug: s.slug.clone(), title: s.title.clone(), where_: "metadata".into(), snippet: meta.chars().take(220).collect() });
        }
        if s.text.is_empty() {
            continue;
        }
        let Ok(text) = fs::read_to_string(&s.text) else { continue };
        let lower = text.to_lowercase();
        let mut from = 0;
        let mut n = 0;
        while let Some(pos) = lower[from..].find(&q) {
            let at = from + pos;
            let start = text[..at].char_indices().rev().nth(120).map(|(i, _)| i).unwrap_or(0);
            let end = text[at..].char_indices().nth(q.len() + 160).map(|(i, _)| at + i).unwrap_or(text.len());
            let snippet = text[start..end].replace(['\n', '\r'], " ");
            hits.push(Hit { slug: s.slug.clone(), title: s.title.clone(), where_: "text".into(), snippet: format!("…{}…", snippet.trim()) });
            n += 1;
            if n >= per_source {
                break;
            }
            from = at + q.len();
        }
    }
    hits
}

pub fn propose(root: &Path, mut c: Candidate) -> Result<Candidate, String> {
    if c.title.trim().is_empty() || c.url.trim().is_empty() {
        return Err("a candidate needs at least a title and a url".into());
    }
    if c.slug.trim().is_empty() {
        let first = c.authors.first().map(|a| surname(a)).unwrap_or_else(|| "source".into());
        let words: String = c.title.to_lowercase().split_whitespace().take(4).map(|w| w.chars().filter(|ch| ch.is_alphanumeric()).collect::<String>()).collect::<Vec<_>>().join("-");
        c.slug = format!("{}_{}-{}", if c.domain.is_empty() { "candidate" } else { c.domain.as_str() }, first, words);
    }
    if c.credentials.trim().is_empty() || c.recency.trim().is_empty() || c.contradictions.trim().is_empty() {
        return Err("the selection process needs all three: recency, credentials, contradictions (each a sentence saying what was checked)".into());
    }
    c.status = "proposed".into();
    c.proposed_at = crate::runner::now();
    let mut list = read_candidates(root);
    list.retain(|x| x.slug != c.slug);
    list.push(c.clone());
    write_candidates(root, &list)?;
    Ok(c)
}

/// Accept a candidate into sources.json (and run the project's fetch and render hooks), or reject it.
pub fn decide(root: &Path, slug: &str, accept: bool, note: &str) -> Result<Candidate, String> {
    let h = hooks(root).ok_or("no library in desk.json")?;
    let mut list = read_candidates(root);
    let idx = list.iter().position(|c| c.slug == slug).ok_or_else(|| format!("no candidate {slug}"))?;
    let mut c = list[idx].clone();
    if accept {
        let p = root.join(&h.sources);
        let mut doc: Value = fs::read_to_string(&p).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(serde_json::json!({"sources": []}));
        let entry = serde_json::json!({
            "slug": c.slug, "domain": c.domain, "year": c.year, "authors": c.authors, "title": c.title,
            "venue": c.venue, "url": c.url, "licence": "", "canonical": false,
            "settles": c.why, "supplies": [], "target": "",
            "accepted": {"at": crate::runner::now(), "note": note, "recency": c.recency, "credentials": c.credentials, "contradictions": c.contradictions},
        });
        let arr = doc.get_mut("sources").and_then(|s| s.as_array_mut()).ok_or("sources.json has no `sources` array")?;
        if arr.iter().any(|s| s.get("slug").and_then(|x| x.as_str()) == Some(c.slug.as_str())) {
            return Err(format!("{} is already in sources.json", c.slug));
        }
        arr.push(entry);
        fs::write(&p, serde_json::to_string_pretty(&doc).unwrap() + "\n").map_err(|e| e.to_string())?;
        let cfg = config::load(root);
        for hook in [&h.fetch, &h.render] {
            if !hook.is_empty() {
                let args: Vec<String> = hook.iter().map(|a| cfg.expand(root, a)).collect();
                let _ = crate::workspace::python_argv(root, &args);
            }
        }
        c.status = "accepted".into();
    } else {
        c.status = "rejected".into();
    }
    c.decision_note = note.to_string();
    c.decided_at = crate::runner::now();
    list[idx] = c.clone();
    write_candidates(root, &list)?;
    Ok(c)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn surnames_and_years_read_the_way_ledgers_cite() {
        assert_eq!(surname("H. Jay Melosh"), "melosh");
        assert_eq!(surname("van Heck"), "heck");
        assert_eq!(year_str(&serde_json::json!(1989)), "1989");
        assert_eq!(year_str(&serde_json::json!("2025")), "2025");
    }

    #[test]
    fn the_live_library_links_something_when_present() {
        let Ok(root) = crate::workspace::find_root() else { return };
        let lib = load(&root);
        if !lib.enabled {
            return;
        }
        assert!(!lib.sources.is_empty());
        assert!(lib.sources.iter().all(|s| !s.slug.is_empty()));
        // Basin's narrative ledgers cite gate checks, not papers; the papers are read by the baker
        // docs and ADRs. So the file scan must find Melosh 1989 somewhere under docs/ or Tools/.
        assert!(lib.sources.iter().any(|s| !s.cited_in.is_empty()), "no source is named by any doc or tool");
        let hits = search(&root, "crater", 2);
        assert!(hits.iter().any(|h| h.where_ == "text"), "the text cache was not searched");
    }
}
