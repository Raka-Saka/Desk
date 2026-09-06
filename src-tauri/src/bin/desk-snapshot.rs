// Write the workspace the window would load as one JSON file, so the page can render without
// its host (preview mode: a browser, a design tool). Usage: desk-snapshot [out.json]
// Default: <this crate's>/../public/snapshot.json, i.e. what `vite build` serves as /snapshot.json.
fn main() {
    let root = match desk_lib::workspace::find_root() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("desk-snapshot: {e}");
            std::process::exit(2);
        }
    };
    let out = std::env::args().nth(1).map(std::path::PathBuf::from).unwrap_or_else(|| {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("public").join("snapshot.json")
    });
    let ws = match desk_lib::workspace::load(&root) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("desk-snapshot: {e}");
            std::process::exit(1);
        }
    };
    let mut v = serde_json::to_value(&ws).expect("workspace serialises");
    v["commands"] = serde_json::to_value(desk_lib::runner::catalogue(&root)).unwrap();
    v["stamp"] = serde_json::json!(desk_lib::workspace::tree_stamp(&root));
    if let Some(p) = out.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    std::fs::write(&out, serde_json::to_string(&v).unwrap()).expect("write snapshot");
    println!("{} ({} items) -> {}", ws.config.get("project").and_then(|p| p.as_str()).unwrap_or("project"), ws.items.len(), out.display());
}
