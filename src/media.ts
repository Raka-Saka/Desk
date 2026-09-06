// Media: what the game, the phone and the bakes have produced, filed by phase. The inbox is
// what nobody has filed yet.
import { mediaUrl, type MediaRecord, type Workspace } from "./api";
import { badge, cmpId, esc, option } from "./util";

export interface MediaState {
  phase: string; // "all" | "inbox" | phase id
  kind: string; // "all" | kind
  filing: { source: string; record: MediaRecord; queue: string[] } | null;
  open: MediaRecord | null;
  editing: boolean;
}

const KINDS = ["screenshot", "render", "video", "photo", "diagram"];

function thumb(ws: Workspace, file: string, kind: string, cls = "thumb"): string {
  const url = mediaUrl(ws.root, file);
  if (kind === "video" || /\.(mp4|webm|mov)$/i.test(file)) return `<video class="${cls}" src="${esc(url)}" muted preload="metadata"></video>`;
  return `<img class="${cls}" src="${esc(url)}" loading="lazy" alt="">`;
}

function fmtBytes(b: number): string {
  return b > 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : `${Math.round(b / 1000)} kB`;
}

export function media(ws: Workspace, st: MediaState): string {
  const phases = ws.phases.phases;
  const counts = new Map<string, number>();
  for (const m of ws.media) counts.set(m.phase, (counts.get(m.phase) ?? 0) + 1);
  const tabs = [
    `<button class="tab${st.phase === "all" ? " active" : ""}" data-action="media-phase" data-phase="all">All <span class="muted">${ws.media.length}</span></button>`,
    ...phases.filter((p) => counts.get(p.id) || p.status === "open").map((p) => `<button class="tab${st.phase === p.id ? " active" : ""}" data-action="media-phase" data-phase="${esc(p.id)}">${esc(p.name.replace(/ — .*/, ""))} <span class="muted">${counts.get(p.id) ?? 0}</span></button>`),
    `<button class="tab inbox${st.phase === "inbox" ? " active" : ""}" data-action="media-phase" data-phase="inbox">Inbox <span class="${ws.inbox.length ? "warn" : "muted"}">${ws.inbox.length}</span></button>`,
  ];
  const shots = ws.suites.length ? "" : "";
  let body = "";
  if (st.phase === "inbox") body = inbox(ws);
  else {
    const list = ws.media.filter((m) => (st.phase === "all" || m.phase === st.phase) && (st.kind === "all" || m.kind === st.kind));
    body = list.length
      ? `<div class="media-grid">${list.map((m) => card(ws, m)).join("")}</div>`
      : `<p class="muted">Nothing filed here yet. File from the Inbox, add files, or capture from the game.</p>`;
  }
  return `
  <div class="toolbar">
    ${tabs.join("")}
    <span class="spacer"></span>
    <label>Kind <select data-action="media-kind"><option value="all">all</option>${KINDS.map((k) => option(k, k, st.kind === k)).join("")}</select></label>
    <button data-action="media-add">+ Add files…</button>
    ${ws.commands.some((c) => c.group === "shots") ? `<label>Capture from the project <select data-action="media-capture"><option value="">choose a shot…</option>${shotOptions(ws)}</select></label>` : ""}
    ${shots}
  </div>
  ${body}
  ${st.filing ? filingForm(ws, st) : ""}
  ${st.open ? lightbox(ws, st) : ""}`;
}

function shotOptions(ws: Workspace): string {
  return ws.commands.filter((c) => c.group === "shots").map((c) => `<option value="${esc(c.name)}">${esc(c.label.replace(/^Shot · /, ""))}</option>`).join("");
}

function card(ws: Workspace, m: MediaRecord): string {
  const item = ws.items.find((i) => i.id === m.item);
  return `<div class="media-card" data-action="media-open" data-id="${esc(m.id)}">
    ${thumb(ws, m.file, m.kind)}
    <div class="media-meta">
      <div>${badge(m.kind)} <span class="muted small">${esc(m.date)}</span>${m.run ? ` <span class="muted small">· run</span>` : ""}</div>
      <div class="media-caption">${esc(m.caption || m.file.split("/").pop())}</div>
      ${item ? `<div class="muted small"><span class="id">${esc(item.id)}</span> ${esc(item.title)}</div>` : ""}
    </div>
  </div>`;
}

function inbox(ws: Workspace): string {
  if (!ws.inbox.length) return `<p class="muted">Inbox empty. It fills from the media sources desk.json names when a shot runs or a file is dropped there.</p>`;
  return `<p class="muted small">Unfiled files from the sources desk.json names. Filing copies the file into docs/media/phase-N and records it; the original stays.</p>
  <table class="items wide">
    ${ws.inbox.map((f) => `<tr>
      <td class="inbox-thumb">${thumb(ws, f.path, f.name.match(/\.(mp4|webm|mov)$/i) ? "video" : "screenshot", "thumb small")}</td>
      <td><code>${esc(f.name)}</code><div class="muted small">${esc(f.source)} · ${fmtBytes(f.bytes)} · ${esc(f.modified)}</div></td>
      <td><button data-action="media-file" data-path="${esc(f.path)}">File…</button></td>
      <td><button class="small" data-action="open-abs" data-path="${esc(f.path)}">open</button></td>
    </tr>`).join("")}
  </table>`;
}

function itemOptions(ws: Workspace, selected: string): string {
  const items = [...ws.items].sort((a, b) => cmpId(a.id, b.id));
  return `<option value="">— none —</option>` + items.map((i) => option(i.id, `${i.id} ${i.title}`, i.id === selected)).join("");
}

function runOptions(ws: Workspace, selected: string): string {
  return `<option value="">— none —</option>` + ws.qa_runs.map((r) => {
    const label = r.kind === "suite" ? `${r.date} suite ${(r as { suite_name: string }).suite_name}` : `${r.date} ${r.kind}`;
    return option(r.id ?? "", label, r.id === selected);
  }).join("");
}

function filingForm(ws: Workspace, st: MediaState): string {
  const f = st.filing!;
  const r = f.record;
  const name = f.source.split(/[\\/]/).pop() ?? "";
  return `<div class="drawer-back" data-action="media-cancel"></div>
  <aside class="drawer narrow">
    <div class="drawer-tools"><h2>File media${f.queue.length ? ` <span class="muted small">${f.queue.length} more after this</span>` : ""}</h2><button class="right" data-action="media-cancel">✕</button></div>
    ${thumb(ws, f.source, r.kind || (name.match(/\.(mp4|webm|mov)$/i) ? "video" : "screenshot"), "thumb preview")}
    <div class="muted small"><code>${esc(f.source)}</code></div>
    <form id="media-form" class="item-form">
      <div class="grid2">
        <label>Phase <select name="phase">${ws.phases.phases.map((p) => option(p.id, p.name, p.id === r.phase)).join("")}</select></label>
        <label>Kind <select name="kind">${KINDS.map((k) => option(k, k, k === (r.kind || (name.match(/\.(mp4|webm|mov)$/i) ? "video" : "screenshot")))).join("")}</select></label>
      </div>
      <label>Item <select name="item">${itemOptions(ws, r.item)}</select></label>
      <label>Evidence for QA run <select name="run">${runOptions(ws, r.run)}</select></label>
      <label>Caption <span class="muted small">what it shows, and what it proves or fails</span><textarea name="caption" rows="3">${esc(r.caption)}</textarea></label>
      <label>Tags <span class="muted small">comma separated</span><input name="tags" value="${esc(r.tags.join(", "))}"></label>
      <div class="toolbar"><button type="submit" class="primary">File it</button><button type="button" data-action="media-cancel">Cancel</button></div>
    </form>
  </aside>`;
}

function lightbox(ws: Workspace, st: MediaState): string {
  const m = st.open!;
  const item = ws.items.find((i) => i.id === m.item);
  const run = ws.qa_runs.find((r) => r.id === m.run);
  const view = `<div class="lightbox-view">${thumb(ws, m.file, m.kind, "full")}</div>`;
  const side = st.editing
    ? `<form id="media-edit" class="item-form">
        <div class="grid2">
          <label>Phase <select name="phase">${ws.phases.phases.map((p) => option(p.id, p.name, p.id === m.phase)).join("")}</select></label>
          <label>Kind <select name="kind">${KINDS.map((k) => option(k, k, k === m.kind)).join("")}</select></label>
        </div>
        <label>Item <select name="item">${itemOptions(ws, m.item)}</select></label>
        <label>QA run <select name="run">${runOptions(ws, m.run)}</select></label>
        <label>Date <input name="date" value="${esc(m.date)}"></label>
        <label>Caption <textarea name="caption" rows="4">${esc(m.caption)}</textarea></label>
        <label>Tags <input name="tags" value="${esc(m.tags.join(", "))}"></label>
        <div class="toolbar"><button type="submit" class="primary">Save</button><button type="button" data-action="media-edit-cancel">Cancel</button><button type="button" class="danger" data-action="media-delete" data-id="${esc(m.id)}">Delete file</button></div>
      </form>`
    : `<h2>${esc(m.caption || m.file.split("/").pop())}</h2>
       <div>${badge(m.kind)} <span class="muted">${esc(m.date)} · ${fmtBytes(m.bytes)}</span></div>
       <p class="muted small"><code>${esc(m.file)}</code></p>
       ${item ? `<p><a class="item-link" data-item="${esc(item.id)}"><span class="id">${esc(item.id)}</span> ${esc(item.title)}</a></p>` : ""}
       ${run ? `<p class="muted small">Evidence for ${esc(run.kind)} run ${esc(run.date)}${run.kind === "suite" ? ` · ${esc((run as { suite_name: string }).suite_name)}` : ""}</p>` : ""}
       ${m.tags.length ? `<p>${m.tags.map((t) => badge("tag", t)).join("")}</p>` : ""}
       <div class="toolbar"><button data-action="media-edit">Edit</button><button data-action="open-abs" data-path="${esc(m.file)}">Open file</button></div>`;
  return `<div class="modal" data-action="media-close"><div class="lightbox" data-stop>${view}<aside class="lightbox-side">${side}<button class="right close" data-action="media-close">✕</button></aside></div></div>`;
}
