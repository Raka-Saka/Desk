//! The View panel: a chosen viewpoint on a running game (ADR-0026 in Basin, item T.4).
//!
//! Three things, kept apart: launching a development run with its remote console on (through
//! the runner, so it streams and is recorded like any command); a place picker that turns a
//! click on a baked cube-sphere face into latitude and longitude with the bake's own axes; and
//! the remote console itself -- HTTP on localhost, one console command per call -- through
//! which the desk moves the camera (`Basin.ViewAt`, game item 3.24) and takes a picture
//! (`HighResShot`), then files the PNG with the frame that produced it.

use crate::config::{self, View as Cfg};
use crate::media::{self, MediaRecord};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Frame {
    pub name: String,
    #[serde(default)]
    pub body: String,
    pub lat: f64,
    pub lon: f64,
    #[serde(default)]
    pub yaw: f64,
    #[serde(default)]
    pub pitch: f64,
    #[serde(default = "two")]
    pub height: f64,
    #[serde(default = "noon")]
    pub hour: f64,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub created: String,
    /// Media ids of pictures taken from this frame, newest last.
    #[serde(default)]
    pub shots: Vec<String>,
}
fn two() -> f64 { 2.0 }
fn noon() -> f64 { 12.0 }

#[derive(Debug, Clone, Serialize)]
pub struct FaceAxes { pub out: [f64; 3], pub right: [f64; 3], pub up: [f64; 3] }

#[derive(Debug, Clone, Serialize)]
pub struct FaceMap { pub face: String, pub path: String, pub axes: FaceAxes }

#[derive(Debug, Clone, Serialize)]
pub struct Place { pub label: String, pub lat: f64, pub lon: f64, pub why: String, pub elevation_m: f64 }

#[derive(Debug, Clone, Serialize, Default)]
pub struct ViewState {
    pub enabled: bool,
    pub port: u16,
    pub body: String,
    pub resolution: u32,
    pub overlap: u32,
    pub faces: Vec<FaceMap>,
    pub places: Vec<Place>,
    pub frames: Vec<Frame>,
    pub view_command: String,
    pub shoot_command: String,
    pub width: u32,
    pub height: u32,
    /// Whether something answers on the port right now.
    pub live: bool,
}

fn cfg(root: &Path) -> Option<Cfg> {
    config::load(root).view
}

fn frames_path(root: &Path, c: &Cfg) -> PathBuf {
    root.join(&c.frames)
}

pub fn load_frames(root: &Path) -> Vec<Frame> {
    let Some(c) = cfg(root) else { return vec![] };
    fs::read_to_string(frames_path(root, &c)).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v.get("frames").cloned()).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
}

fn save_frames(root: &Path, list: &[Frame]) -> Result<(), String> {
    let c = cfg(root).ok_or("no view block in desk.json")?;
    let p = frames_path(root, &c);
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    let doc = json!({
        "_comment": "Viewpoints for visual checks (ADR-0026): the desk's View panel writes these; a frame is a place on the body, a camera and an hour, so the same picture can be taken again after a change. lat/lon are in the bake's body frame: lat = asin(z), lon = atan2(y, x), degrees.",
        "frames": list,
    });
    fs::write(&p, serde_json::to_string_pretty(&doc).unwrap() + "\n").map_err(|e| e.to_string())
}

fn vec3(v: &Value) -> [f64; 3] {
    let a = v.as_array().cloned().unwrap_or_default();
    [a.first().and_then(|x| x.as_f64()).unwrap_or(0.0), a.get(1).and_then(|x| x.as_f64()).unwrap_or(0.0), a.get(2).and_then(|x| x.as_f64()).unwrap_or(0.0)]
}

/// Direction from a face and its (u, v) in the extended wedge, exactly as `export.face_directions`
/// builds it: d = out + u*right + v*up, normalised.
pub fn direction(axes: &FaceAxes, u: f64, v: f64) -> [f64; 3] {
    let d = [
        axes.out[0] + u * axes.right[0] + v * axes.up[0],
        axes.out[1] + u * axes.right[1] + v * axes.up[1],
        axes.out[2] + u * axes.right[2] + v * axes.up[2],
    ];
    let n = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt().max(1e-12);
    [d[0] / n, d[1] / n, d[2] / n]
}

pub fn lat_lon(d: [f64; 3]) -> (f64, f64) {
    (d[2].clamp(-1.0, 1.0).asin().to_degrees(), d[1].atan2(d[0]).to_degrees())
}

/// The bake's site.json holds two places: the sandbox site (top level) and the spawn (`start`).
fn places(bake: &Path, meta: &Value) -> Vec<Place> {
    let Ok(text) = fs::read_to_string(bake.join("site.json")) else { return vec![] };
    let Ok(site) = serde_json::from_str::<Value>(&text) else { return vec![] };
    let res = meta.get("resolution").and_then(|x| x.as_u64()).unwrap_or(512) as f64;
    let overlap = meta.get("overlap_px").and_then(|x| x.as_u64()).unwrap_or(8) as f64;
    let limit = 1.0 + 2.0 * overlap / res;
    let axes_of = |face: &str| meta.get("face_axes").and_then(|f| f.get(face)).map(|a| FaceAxes { out: vec3(&a["out"]), right: vec3(&a["right"]), up: vec3(&a["up"]) });
    let one = |v: &Value, label: &str| -> Option<Place> {
        let face = v.get("face")?.as_str()?;
        let uv = v.get("uv")?.as_array()?;
        // site.json's uv is a 0..1 texture coordinate over the face including its border:
        // px/(n-1) with n = resolution + 2*overlap; the wedge coordinate is -limit..limit, v flipped.
        let (tu, tv) = (uv.first()?.as_f64()?, uv.get(1)?.as_f64()?);
        let u = -limit + tu * 2.0 * limit;
        let vv = limit - tv * 2.0 * limit;
        let (lat, lon) = lat_lon(direction(&axes_of(face)?, u, vv));
        Some(Place { label: label.to_string(), lat, lon, why: v.get("why").and_then(|x| x.as_str()).unwrap_or("").to_string(), elevation_m: v.get("elevation_m").and_then(|x| x.as_f64()).unwrap_or(0.0) })
    };
    let mut out = vec![];
    if let Some(p) = site.get("start").and_then(|s| one(s, "spawn (site.json start)")) { out.push(p); }
    if let Some(p) = one(&site, "sandbox site (greatest relief)") { out.push(p); }
    out
}

pub fn live(port: u16) -> bool {
    ureq::AgentBuilder::new().timeout(Duration::from_millis(400)).build()
        .get(&format!("http://127.0.0.1:{port}/remote/info")).call().is_ok()
}

pub fn load(root: &Path) -> ViewState {
    let Some(c) = cfg(root) else { return ViewState::default() };
    let bake = root.join(&c.bake);
    let meta: Value = fs::read_to_string(bake.join("meta.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
    let faces = ["PX", "NX", "PY", "NY", "PZ", "NZ"].iter().filter_map(|f| {
        let a = meta.get("face_axes")?.get(*f)?;
        let path = bake.join(c.face_map.replace("{face}", f));
        Some(FaceMap { face: f.to_string(), path: if path.exists() { path.to_string_lossy().to_string() } else { String::new() }, axes: FaceAxes { out: vec3(&a["out"]), right: vec3(&a["right"]), up: vec3(&a["up"]) } })
    }).collect();
    ViewState {
        enabled: true,
        port: c.port,
        body: meta.get("body").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        resolution: meta.get("resolution").and_then(|x| x.as_u64()).unwrap_or(512) as u32,
        overlap: meta.get("overlap_px").and_then(|x| x.as_u64()).unwrap_or(8) as u32,
        faces,
        places: places(&bake, &meta),
        frames: load_frames(root),
        view_command: c.view_command.clone(),
        shoot_command: c.shoot_command.clone(),
        width: c.width,
        height: c.height,
        live: live(c.port),
    }
}

/// The launch, as a runner command: the game with its remote console on.
pub fn launch_spec(root: &Path) -> Option<crate::runner::CommandSpec> {
    let full = config::load(root);
    let c = full.view.as_ref()?;
    Some(crate::runner::CommandSpec {
        name: "view:game".into(),
        label: "View · game with remote console".into(),
        description: format!("Starts the game windowed with its remote console on port {}; the View panel drives it.", c.port),
        group: "view".into(),
        program: full.expand(root, &c.program),
        args: c.args.iter().map(|a| full.expand(root, a)).collect(),
        minutes: 240,
    })
}

/// The world the console commands run in. `ExecuteConsoleCommand` without a world goes to the
/// console manager only; with one it reaches the first player's viewport, which is where
/// `HighResShot` lives. Proven 2026-09-06: the same call wrote a PNG with the world and nothing
/// without it.
pub fn world_path(root: &Path, c: &Cfg) -> String {
    if !c.world.is_empty() {
        return c.world.clone();
    }
    let ini = fs::read_to_string(root.join("Config").join("DefaultEngine.ini")).unwrap_or_default();
    let map = ini.lines().find_map(|l| l.trim().strip_prefix("GameDefaultMap=")).unwrap_or("").trim().to_string();
    if map.is_empty() {
        return String::new();
    }
    let short = map.rsplit('/').next().unwrap_or("").to_string();
    if short.contains('.') { map } else { format!("{map}.{short}") }
}

/// One console command over the remote channel. Returns the server's reply text.
pub fn console(root: &Path, port: u16, command: &str) -> Result<String, String> {
    let c = cfg(root).ok_or("no view block in desk.json")?;
    let world = world_path(root, &c);
    let mut params = json!({"Command": command});
    if !world.is_empty() {
        params["WorldContextObject"] = json!(world);
    }
    let body = json!({
        "objectPath": "/Script/Engine.Default__KismetSystemLibrary",
        "functionName": "ExecuteConsoleCommand",
        "parameters": params,
        "generateTransaction": false,
    });
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(10)).build();
    match agent.put(&format!("http://127.0.0.1:{port}/remote/object/call")).send_json(body) {
        Ok(r) => Ok(r.into_string().unwrap_or_default()),
        Err(ureq::Error::Status(code, r)) => Err(format!("the game answered {code}: {}", r.into_string().unwrap_or_default().chars().take(300).collect::<String>())),
        Err(e) => Err(format!("no game on port {port}: {e}. Launch it from the View panel first.")),
    }
}

fn fill(template: &str, f: &Frame, c: &Cfg) -> String {
    template
        .replace("{lat}", &format!("{:.5}", f.lat)).replace("{lon}", &format!("{:.5}", f.lon))
        .replace("{yaw}", &format!("{:.1}", f.yaw)).replace("{pitch}", &format!("{:.1}", f.pitch))
        .replace("{height}", &format!("{:.2}", f.height)).replace("{hour}", &format!("{:.2}", f.hour))
        .replace("{w}", &c.width.to_string()).replace("{h}", &c.height.to_string())
        .replace("{name}", &f.name)
}

/// Move the camera to the frame. The game side is `Basin.ViewAt` (item 3.24); the remote
/// console accepts unknown commands silently, so the caller reads the game log to know.
pub fn go(root: &Path, f: &Frame) -> Result<String, String> {
    let c = cfg(root).ok_or("no view block in desk.json")?;
    let cmd = fill(&c.view_command, f, &c);
    console(root, c.port, &cmd)?;
    Ok(cmd)
}

fn newest_png(dir: &Path, after: SystemTime) -> Option<PathBuf> {
    fn walk(d: &Path, after: SystemTime, best: &mut Option<(SystemTime, PathBuf)>) {
        let Ok(rd) = fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() { walk(&p, after, best); continue; }
            if p.extension().map(|x| x.eq_ignore_ascii_case("png")).unwrap_or(false) {
                if let Ok(m) = p.metadata().and_then(|m| m.modified()) {
                    if m >= after && best.as_ref().map_or(true, |(t, _)| m > *t) { *best = Some((m, p)); }
                }
            }
        }
    }
    let mut best = None;
    walk(dir, after, &mut best);
    best.map(|(_, p)| p)
}

/// Take a picture from the current camera and file it under the frame. Waits up to ten seconds
/// for the PNG to appear; the engine writes it a few frames after the request.
pub fn shoot(root: &Path, f: &Frame, phase: &str) -> Result<MediaRecord, String> {
    let c = cfg(root).ok_or("no view block in desk.json")?;
    let dir = root.join(&c.screenshots);
    let started = SystemTime::now() - Duration::from_secs(1);
    console(root, c.port, &fill(&c.shoot_command, f, &c))?;
    let t0 = Instant::now();
    let png = loop {
        if let Some(p) = newest_png(&dir, started) {
            // wait until the file stops growing
            let a = p.metadata().map(|m| m.len()).unwrap_or(0);
            std::thread::sleep(Duration::from_millis(600));
            let b = p.metadata().map(|m| m.len()).unwrap_or(0);
            if a == b && a > 0 { break p; }
        }
        if t0.elapsed() > Duration::from_secs(12) {
            return Err(format!("the game did not write a PNG under {} within 12 s", dir.display()));
        }
        std::thread::sleep(Duration::from_millis(400));
    };
    let rec = MediaRecord {
        id: String::new(),
        file: String::new(),
        phase: phase.to_string(),
        item: String::new(),
        run: String::new(),
        kind: "screenshot".into(),
        caption: format!("{} — lat {:.2}°, lon {:.2}°, yaw {:.0}°, pitch {:.0}°, {:.1} m up, {:02.0}:{:02.0} local{}", f.name, f.lat, f.lon, f.yaw, f.pitch, f.height, f.hour.floor(), (f.hour.fract() * 60.0).round(), if f.note.is_empty() { String::new() } else { format!(" — {}", f.note) }),
        date: chrono::Local::now().format("%Y-%m-%d").to_string(),
        tags: vec!["view".into(), format!("frame:{}", f.name)],
        bytes: 0,
    };
    let filed = media::file(root, &png.to_string_lossy(), rec)?;
    // remember the shot on the frame, if the frame is saved
    let mut list = load_frames(root);
    if let Some(fr) = list.iter_mut().find(|x| x.name == f.name) {
        fr.shots.push(filed.id.clone());
        let _ = save_frames(root, &list);
    }
    Ok(filed)
}

pub fn save_frame(root: &Path, mut f: Frame) -> Result<Vec<Frame>, String> {
    if f.name.trim().is_empty() {
        return Err("a frame needs a name".into());
    }
    let mut list = load_frames(root);
    if let Some(old) = list.iter().find(|x| x.name == f.name) {
        f.shots = old.shots.clone();
        f.created = old.created.clone();
    }
    if f.created.is_empty() { f.created = crate::runner::now(); }
    list.retain(|x| x.name != f.name);
    list.push(f);
    list.sort_by(|a, b| a.name.cmp(&b.name));
    save_frames(root, &list)?;
    Ok(list)
}

pub fn delete_frame(root: &Path, name: &str) -> Result<Vec<Frame>, String> {
    let mut list = load_frames(root);
    list.retain(|x| x.name != name);
    save_frames(root, &list)?;
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn face_centres_point_along_their_axes() {
        let pz = FaceAxes { out: [0.0, 0.0, 1.0], right: [0.0, 1.0, 0.0], up: [-1.0, 0.0, 0.0] };
        let (lat, _) = lat_lon(direction(&pz, 0.0, 0.0));
        assert!((lat - 90.0).abs() < 1e-9);
        let px = FaceAxes { out: [1.0, 0.0, 0.0], right: [0.0, 1.0, 0.0], up: [0.0, 0.0, 1.0] };
        let (lat, lon) = lat_lon(direction(&px, 0.0, 0.0));
        assert!(lat.abs() < 1e-9 && lon.abs() < 1e-9);
        let (_, lon) = lat_lon(direction(&px, 1.0, 0.0));
        assert!((lon - 45.0).abs() < 1e-9, "u=1 on PX is 45 degrees east");
    }

    #[test]
    fn the_live_bake_gives_two_places_when_present() {
        let Ok(root) = crate::workspace::find_root() else { return };
        let v = load(&root);
        if !v.enabled { return; }
        assert_eq!(v.faces.len(), 6);
        assert!(v.places.len() >= 1, "site.json should give at least the spawn");
        for p in &v.places {
            assert!(p.lat.abs() <= 90.0 && p.lon.abs() <= 180.0);
        }
    }
}
