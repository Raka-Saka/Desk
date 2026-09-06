// The View panel (ADR-0026): a chosen viewpoint on a running game. Pick a place on the six
// baked faces or a named one, set the camera and the hour, send it to the game over its remote
// console, take the picture, and keep the frame so the same picture can be taken again.
import type { Frame, MediaRecord, ViewState, Workspace } from "./api";
import { mediaUrl } from "./api";
import { esc } from "./util";

export interface ViewPanelState {
  v: ViewState | null;
  frame: Frame;
  busy: string;
  log: string[];
  last: MediaRecord | null;
  console: string;
}

export function blankFrame(): Frame {
  return { name: "", body: "", lat: 0, lon: 0, yaw: 0, pitch: 0, height: 2, hour: 12, note: "", created: "", shots: [] };
}

// --- the cube-sphere arithmetic, the bake's own (export.face_directions) ------------------------

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function limitOf(v: ViewState): number { return 1 + (2 * v.overlap) / v.resolution; }

/** Pixel (x, y) in a face image of size (w, h) -> lat, lon in degrees. */
export function latLonFromPixel(v: ViewState, face: string, x: number, y: number, w: number, h: number): [number, number] | null {
  const f = v.faces.find((m) => m.face === face);
  if (!f) return null;
  const L = limitOf(v);
  const u = -L + (x / Math.max(1, w - 1)) * 2 * L;
  const vv = L - (y / Math.max(1, h - 1)) * 2 * L;
  const d: V3 = [f.axes.out[0] + u * f.axes.right[0] + vv * f.axes.up[0], f.axes.out[1] + u * f.axes.right[1] + vv * f.axes.up[1], f.axes.out[2] + u * f.axes.right[2] + vv * f.axes.up[2]];
  const n = Math.hypot(...d) || 1;
  const z = Math.max(-1, Math.min(1, d[2] / n));
  return [(Math.asin(z) * 180) / Math.PI, (Math.atan2(d[1], d[0]) * 180) / Math.PI];
}

/** lat, lon -> the face that owns the direction and the (0..1, 0..1) position on its image. */
export function pixelFromLatLon(v: ViewState, lat: number, lon: number): { face: string; fx: number; fy: number } | null {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  const d: V3 = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  let best: { face: string; fx: number; fy: number } | null = null;
  let bestDot = -1;
  const L = limitOf(v);
  for (const f of v.faces) {
    const o = dot(d, f.axes.out);
    if (o <= bestDot || o <= 0) continue;
    const u = dot(d, f.axes.right) / o, vv = dot(d, f.axes.up) / o;
    if (Math.abs(u) > L || Math.abs(vv) > L) continue;
    bestDot = o;
    best = { face: f.face, fx: (u + L) / (2 * L), fy: (L - vv) / (2 * L) };
  }
  return best;
}

// --- rendering ------------------------------------------------------------------------------------

// The six faces laid out as a cross: NZ (south pole) at the bottom, PZ (north) on top.
const CROSS: Record<string, [number, number]> = { PZ: [2, 1], NX: [1, 2], PY: [2, 2], PX: [3, 2], NY: [4, 2], NZ: [2, 3] };

export function viewPanel(ws: Workspace, st: ViewPanelState): string {
  const v = st.v;
  if (!v) return `<section class="card"><h2>Viewfinder</h2><p class="muted">Loading the bake…</p></section>`;
  if (!v.enabled) return `<section class="card"><h2>Viewfinder</h2><p class="muted">This project has no <code>view</code> block in desk.json.</p></section>`;
  const f = st.frame;
  const mark = pixelFromLatLon(v, f.lat, f.lon);
  return `<div class="cols view">
    <section class="card">
      <div class="toolbar"><h2 style="margin:0">Where</h2><span class="muted small">${esc(v.body)} · click a face to place the camera · height map, ${v.resolution}+2·${v.overlap} px per face</span></div>
      <div class="view-cross">
        ${v.faces.map((m) => { const [c, r] = CROSS[m.face] ?? [1, 1]; const here = mark && mark.face === m.face; return `<div class="face" style="grid-column:${c};grid-row:${r}">
          ${m.path ? `<img data-action="view-face" data-face="${m.face}" src="${mediaUrl(ws.root, m.path)}" alt="${m.face}" draggable="false">` : `<div class="face-missing">${m.face}<br><small>no map</small></div>`}
          <span class="face-label">${m.face}</span>
          ${here ? `<span class="marker" style="left:${(mark!.fx * 100).toFixed(2)}%;top:${(mark!.fy * 100).toFixed(2)}%"></span>` : ""}
        </div>`; }).join("")}
      </div>
      <h4>Named places</h4>
      <div class="places">${v.places.map((p) => `<button class="small" data-action="view-place" data-lat="${p.lat}" data-lon="${p.lon}" title="${esc(p.why)}">${esc(p.label)} <span class="muted">${p.lat.toFixed(1)}°, ${p.lon.toFixed(1)}° · ${p.elevation_m.toFixed(0)} m</span></button>`).join("") || "<span class='muted small'>site.json gave no places</span>"}</div>
      <h4>Saved frames (${v.frames.length})</h4>
      ${v.frames.length ? `<table class="items"><tr><th>frame</th><th>where</th><th>camera</th><th>hour</th><th>shots</th><th></th></tr>
        ${v.frames.map((fr) => `<tr class="${fr.name === f.name ? "sel" : ""}"><td><a class="item-link" data-action="view-load" data-name="${esc(fr.name)}"><b>${esc(fr.name)}</b></a>${fr.note ? `<div class="muted small">${esc(fr.note)}</div>` : ""}</td>
          <td class="small">${fr.lat.toFixed(2)}°, ${fr.lon.toFixed(2)}°</td><td class="small">yaw ${fr.yaw.toFixed(0)}° · pitch ${fr.pitch.toFixed(0)}° · ${fr.height} m</td><td class="small">${hhmm(fr.hour)}</td>
          <td class="small">${fr.shots.length}</td>
          <td><button class="small" data-action="view-reshoot" data-name="${esc(fr.name)}" title="go there and shoot">⟲</button> <button class="small" data-action="view-delete" data-name="${esc(fr.name)}">✕</button></td></tr>`).join("")}</table>` : "<p class='muted small'>None yet. Set a frame on the right and save it.</p>"}
    </section>
    <section class="card">
      <div class="toolbar">
        <h2 style="margin:0">Game</h2>
        <span class="dot ${v.live ? "ok" : ""}"></span> <span class="small">${v.live ? `remote console on :${v.port}` : "not running"}</span>
        <span class="spacer"></span>
        ${v.live ? `<button data-action="view-quit">Quit game</button>` : `<button class="primary" data-action="view-launch"${st.busy ? " disabled" : ""}>▶ Launch with remote console</button>`}
      </div>
      <p class="muted small">A windowed development run with the engine's Remote Control console on localhost. It takes about a minute to come up; the dot turns green when it answers.</p>
      <h4>Frame</h4>
      <div class="grid2">
        <label>Name <input data-vf="name" value="${esc(f.name)}" placeholder="ore site at dawn"></label>
        <label>Note <input data-vf="note" value="${esc(f.note)}" placeholder="what this picture is for"></label>
      </div>
      <div class="grid4">
        <label>Latitude ° <input data-vf="lat" type="number" step="0.01" value="${f.lat.toFixed(4)}"></label>
        <label>Longitude ° <input data-vf="lon" type="number" step="0.01" value="${f.lon.toFixed(4)}"></label>
        <label>Yaw ° <span class="muted small">0 = local north</span><input data-vf="yaw" type="number" step="5" value="${f.yaw}"></label>
        <label>Pitch ° <span class="muted small">− looks down</span><input data-vf="pitch" type="number" step="5" value="${f.pitch}"></label>
      </div>
      <div class="grid2">
        <label>Height above ground, m <input data-vf="height" type="number" step="1" value="${f.height}"></label>
        <label>Local hour <b>${hhmm(f.hour)}</b><input data-vf="hour" type="range" min="0" max="24" step="0.25" value="${f.hour}"></label>
      </div>
      <div class="toolbar">
        <button class="primary" data-action="view-go"${v.live && !st.busy ? "" : " disabled"}>Go there</button>
        <button class="primary" data-action="view-shoot"${v.live && !st.busy ? "" : " disabled"}>📷 Shoot</button>
        <button data-action="view-go-shoot"${v.live && !st.busy ? "" : " disabled"}>Go there, then shoot</button>
        <button data-action="view-save"${f.name.trim() ? "" : " disabled"}>Save frame</button>
        ${st.busy ? `<span class="spin"></span> <span class="small muted">${esc(st.busy)}</span>` : ""}
      </div>
      <p class="muted small">Go there sends <code>${esc(v.view_command)}</code>; Shoot sends <code>${esc(v.shoot_command)}</code> and files the PNG into this phase's media with the frame in its caption. Until the game has <code>Basin.ViewAt</code> (item 3.24), Go there is accepted and ignored: the picture is from wherever the player stands.</p>
      ${st.last ? `<h4>Last picture</h4><a class="media-card" data-open="${esc(st.last.file)}"><img class="thumb" src="${mediaUrl(ws.root, st.last.file)}" alt=""><div class="media-meta small">${esc(st.last.caption)}<br><span class="muted">${esc(st.last.file)}</span></div></a>` : ""}
      <h4>Console</h4>
      <div class="toolbar"><input data-view-console value="${esc(st.console)}" placeholder="any console command, e.g. stat fps" size="40"${v.live ? "" : " disabled"}><button data-action="view-console"${v.live ? "" : " disabled"}>Send</button></div>
      ${st.log.length ? `<pre class="log small">${st.log.slice(-12).map(esc).join("\n")}</pre>` : ""}
    </section>
  </div>`;
}

export function hhmm(h: number): string {
  const hh = Math.floor(h) % 24, mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
