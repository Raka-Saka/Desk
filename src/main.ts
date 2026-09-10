// Basin Desk. One state object, one render, clicks by delegation. The Rust side owns the files.
import { api, blankItem, blankMedia, KINDS, PRIORITIES, SEVERITIES, STATUSES, type CommandSpec, type Item, type MediaRecord, type QaRun, type SuiteRun, type Workspace } from "./api";
import { design, recipesOf, type DesignState } from "./design";
import { dev, type ConsoleState } from "./dev";
import { media, type MediaState } from "./media";
import { isSuite, qa, type QaState } from "./qa";
import { projects, type ProjectsState } from "./projects";
import { citation, findAll, library, type LibraryState } from "./library";
import { blankFrame, latLonFromPixel, viewPanel, type ViewPanelState } from "./view";
import { adrDrawer, board, bugs, currentPhase, dashboard, itemHeader, production, scope } from "./views";
import { cmpId, esc, md, option, today } from "./util";
import { mediaUrl } from "./api";
import { invoke } from "./api";
import { HAS_TAURI, READ_ONLY } from "./preview";

type View = "dashboard" | "board" | "scope" | "bugs" | "qa" | "media" | "design" | "library" | "view" | "production" | "dev" | "guide" | "projects";

function freshDraft(kind: "sheets" | "playtest"): QaRun {
  return { kind, date: today(), commit: "", build: "PIE", tester: "", results: {}, gate: {}, minutes: 30, notes: "" };
}

const state = {
  ws: null as Workspace | null,
  view: (localStorage.getItem("view") as View) || "dashboard",
  boardPhase: localStorage.getItem("boardPhase") || "all",
  bugsClosed: false,
  qa: { tab: "suites", draft: freshDraft("sheets"), target: null, live: null, tester: localStorage.getItem("tester") || "", build: "PIE", openRun: null } as QaState,
  media: { phase: "all", kind: "all", filing: null, open: null, editing: false } as MediaState,
  design: { draft: null, selected: "", report: null, loading: false, problems: null, places: [], dirty: false } as DesignState,
  drawer: null as { item: Item; editing: boolean; isNew: boolean; stamp?: number } | null,
  adrOpen: null as string | null,
  projects: { known: [], home: null, creating: null, busy: "", error: "" } as ProjectsState,
  library: { tab: "sources", domain: "all", query: "", hits: null, searching: false, open: null, proposing: false, onlyUnsourced: false, reader: null } as LibraryState,
  noProject: false,
  palette: { open: false, q: "", sel: 0 },
  viewp: { v: null, frame: blankFrame(), busy: "", log: [], last: null, console: "" } as ViewPanelState,
  commands: [] as CommandSpec[],
  console: null as ConsoleState | null,
  guide: "",
  toast: "",
  logView: null as string | null,
};

const app = document.getElementById("app")!;

const NAV: [View, string, string][] = [
  ["dashboard", "Overview", "what needs attention now"],
  ["board", "Work board", "move work through the loop"],
  ["scope", "Scope map", "phase → epic → item"],
  ["bugs", "Defects", "triage what is broken"],
  ["qa", "Quality", "prove the build"],
  ["media", "Media inbox", "evidence and captures"],
  ["design", "Recipes", "balance cost and value"],
  ["library", "Research", "sources and claims"],
  ["view", "Viewfinder", "a chosen viewpoint, live"],
  ["production", "Roadmap", "phases, gates, decisions"],
  ["dev", "Workbench", "checks, builds, commits"],
  ["guide", "Playbook", "how Desk is managed"],
  ["projects", "Projects", "open or create a project"],
];

async function loadProjects() {
  state.projects.known = await api.projectsRecent().catch(() => []);
  state.projects.home = await api.projectsHome().catch(() => null);
}

function renderNoProject() {
  app.innerHTML = `<aside class="side"><div class="brand"><span class="brand-mark">D</span><span class="brand-name">Desk</span><small>workspace OS</small></div><div class="nav-label">Workspace</div><nav><a class="active"><span class="nav-icon">●</span><span><b>Projects</b><small>choose a workspace</small></span></a></nav><div class="side-foot"><div class="muted small">No project connected</div></div></aside><main class="main"><header class="topbar"><div class="breadcrumbs"><span class="muted">Desk</span><span>/</span><strong>Projects</strong></div></header><div class="page-content">${projects(state.projects, null)}</div></main>${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ""}`;
}

function toast(msg: string, ms = 2500) {
  state.toast = msg;
  render();
  setTimeout(() => { if (state.toast === msg) { state.toast = ""; render(); } }, ms);
}

async function reload() {
  try {
    state.ws = await api.load();
    if (!state.commands.length) {
      const v = await invoke<string>("startup_view").catch(() => "");
      if (v) state.view = v as View;
      if (state.view === "design") setTimeout(refreshDesign, 0);
    }
    if (!state.commands.length) state.commands = await api.commands();
    if (!state.guide) state.guide = await api.readText(state.ws.config.docs?.guide || "docs/tracker/GUIDE.md").catch(() => "No guide: set docs.guide in desk.json.");
  } catch (e) {
    if (String(e).includes("NO_PROJECT")) {
      state.noProject = true;
      await loadProjects();
      renderNoProject();
      return;
    }
    app.innerHTML = `<div class="fatal"><h1>The desk could not load this project</h1><pre>${esc(String(e))}</pre><p>Run it from inside a folder with a <code>desk.json</code>, or set <code>DESK_ROOT</code>.</p></div>`;
    return;
  }
  render();
}

function render() {
  if (state.noProject) { renderNoProject(); return; }
  const ws = state.ws;
  if (!ws) return;
  const ph = currentPhase(ws);
  const openCount = ws.items.filter((i) => i.status !== "done" && i.kind !== "epic").length;
  let body = "";
  switch (state.view) {
    case "dashboard": body = dashboard(ws); break;
    case "board": body = board(ws, state.boardPhase); break;
    case "scope": body = scope(ws); break;
    case "bugs": body = bugs(ws, state.bugsClosed); break;
    case "qa": body = qa(ws, state.qa); break;
    case "media": body = media(ws, state.media); break;
    case "design": body = design(ws, state.design); break;
    case "production": body = production(ws); break;
    case "dev": body = dev(ws, state.commands, state.console); break;
    case "guide": body = `<section class="card md guide">${md(state.guide)}</section>`; break;
    case "projects": body = projects(state.projects, ws.root); break;
    case "library": body = library(ws, state.library); break;
    case "view": body = viewPanel(ws, state.viewp); if (!state.viewp.v) setTimeout(refreshView, 0); break;
  }
  const live = state.qa.live && state.qa.live.status === "running" ? state.qa.live : null;
  const focusItem = ws.items.filter((i) => ["now", "yours"].includes(i.status) && i.kind !== "epic").sort((a, b) => a.priority.localeCompare(b.priority) || cmpId(a.id, b.id))[0];
  app.innerHTML = `${HAS_TAURI ? "" : `<div class="preview-banner">${esc(READ_ONLY)}</div>`}
    <aside class="side">
      <div class="brand"><span class="brand-mark">D</span><span class="brand-word">Desk</span></div>
      <div class="rail-caption">Navigate</div>
      <nav class="rail-nav">${NAV.filter(([v]) => (v !== "design" || ws.config.design) && (v !== "library" || ws.library.enabled) && (v !== "view" || ws.config.view)).map(([v, l, d]) => `<a class="${state.view === v ? "active" : ""}" data-view="${v}" title="${esc(d)}"><span class="nav-icon">${["⌂","◈","⌁","!","✓","▧","◇","⌕","◉","◷","⌘","☰","●"][NAV.findIndex(([n]) => n === v)]}</span><span class="rail-text"><b>${l}</b>${v === "media" && ws.inbox.length ? ` <span class="pill">${ws.inbox.length}</span>` : ""}</span></a>`).join("")}</nav>
      <div class="side-foot">
        <div class="avatar">${esc((ws.config.project ?? "D").slice(0,1).toUpperCase())}</div>
        <button data-action="reload" title="Re-read the repo">↻</button>
      </div>
    </aside>
    <aside class="context-rail"><div class="context-kicker">Workspace</div><h2>${esc(ws.config.project ?? "Desk")}</h2><div class="branch-line"><span class="status-dot good"></span>${esc(ws.branch)}</div><div class="context-rule"></div><div class="context-kicker">Current phase</div><div class="phase-name">${esc(ph.name)}</div><p class="context-copy">${esc(ph.gate)}</p><div class="context-stat"><span>Open work</span><strong>${openCount}</strong></div><div class="context-stat"><span>Attention</span><strong>${ws.items.filter((i) => i.status === "yours").length}</strong></div><div class="context-stat"><span>Working tree</span><strong>${ws.dirty.length || "—"}</strong></div><div class="context-bottom">${live ? `<div class="live"><span class="spin"></span>${esc(live.suite_name)}</div>` : `<span class="status-dot good"></span> Synced`}<span class="muted small">${ws.dirty.length ? "changes pending" : "all clear"}</span></div></aside>
    <main class="main"><header class="topbar"><div class="breadcrumbs"><span class="context-mobile">${esc(ws.config.project ?? "Project")} · </span><strong>${esc(NAV.find(([v]) => v === state.view)?.[1] ?? "Workspace")}</strong></div><div class="top-actions"><button class="search-trigger" data-action="palette"><span class="search-icon">⌕</span> Find an item <kbd>Ctrl K</kbd></button><button class="primary" data-action="new-item">Create item <span class="plus">+</span></button></div></header><div class="page-content"><div class="focus-ribbon"><span class="focus-mark">●</span><span class="eyebrow">In focus</span><strong>${focusItem ? `${esc(focusItem.id)} · ${esc(focusItem.title)}` : "Your queue is clear"}</strong><span class="muted">${focusItem ? "next verifiable action" : "choose a workspace to continue"}</span><span class="ribbon-status">${ws.dirty.length ? `${ws.dirty.length} files to commit` : "working tree clean"}</span></div>${body}</div></main>
    ${state.drawer ? drawer(ws, state.drawer) : ""}
    ${state.adrOpen ? (ws.adrs.find((a) => a.number === state.adrOpen) ? adrDrawer(ws.adrs.find((a) => a.number === state.adrOpen)!) : "") : ""}
    ${state.logView !== null ? `<div class="modal" data-action="close-log"><pre class="log">${esc(state.logView)}</pre></div>` : ""}
    ${state.palette.open ? palette(ws) : ""}
    ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ""}`;
  if (state.palette.open) {
    const inp = document.querySelector<HTMLInputElement>("[data-palette]");
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }
  const con = document.getElementById("console");
  if (con) con.scrollTop = con.scrollHeight;
  // Thumbnails rendered by qa.ts carry a repo-relative path; resolve them here where root is known.
  for (const img of app.querySelectorAll<HTMLImageElement>("img[data-src]")) img.src = mediaUrl(ws.root, img.dataset.src!);
}

// --- Item drawer ---------------------------------------------------------------------------------

function drawer(ws: Workspace, d: { item: Item; editing: boolean; isNew: boolean }): string {
  const it = d.item;
  const epics = ws.items.filter((i) => i.kind === "epic").sort((a, b) => cmpId(a.id, b.id));
  const mediaFor = ws.media.filter((m) => m.item === it.id);
  const form = `
    <form id="item-form" class="item-form">
      <div class="grid2">
        <label>Id <input name="id" value="${esc(it.id)}"${d.isNew ? "" : " readonly"}></label>
        <label>Phase <select name="phase">${ws.phases.phases.map((p) => option(p.id, p.name, p.id === it.phase)).join("")}</select></label>
      </div>
      <label>Title <input name="title" value="${esc(it.title)}" required></label>
      <div class="grid4">
        <label>Kind <select name="kind">${KINDS.map((k) => option(k, k, k === it.kind)).join("")}</select></label>
        <label>Status <select name="status">${STATUSES.map((k) => option(k, k.toUpperCase(), k === it.status)).join("")}</select></label>
        <label>Priority <select name="priority">${PRIORITIES.map((k) => option(k, k, k === it.priority)).join("")}</select></label>
        <label>Severity <select name="severity">${SEVERITIES.map((k) => option(k, k || "—", k === it.severity)).join("")}</select></label>
      </div>
      <div class="grid2">
        <label>Epic <select name="parent"><option value="">— none —</option>${epics.map((e) => option(e.id, `${e.id} ${e.title}`, e.id === it.parent)).join("")}</select></label>
        <label>Found by sheet <select name="sheet"><option value="">—</option>${ws.sheets.map((s) => option(s.id, `${s.id} ${s.title}`, s.id === it.sheet)).join("")}</select></label>
      </div>
      <label>Done when <span class="muted small">a condition someone can check, not a feeling</span><textarea name="done_when" rows="2">${esc(it.done_when)}</textarea></label>
      <div class="grid3">
        <label>Files <span class="muted small">one per line, repo-relative</span><textarea name="files" rows="4">${esc(it.files.join("\n"))}</textarea></label>
        <label>Tests <span class="muted small">Basin.System.Case or pytest ids</span><textarea name="tests" rows="4">${esc(it.tests.join("\n"))}</textarea></label>
        <label>ADRs <span class="muted small">numbers, one per line</span><textarea name="adrs" rows="4">${esc(it.adrs.join("\n"))}</textarea></label>
      </div>
      <label>Body <span class="muted small">markdown: why it exists, evidence when done, the log line for a bug</span><textarea name="body" rows="10">${esc(it.body)}</textarea></label>
      <div class="toolbar">
        <button type="submit" class="primary">Save</button>
        <button type="button" data-action="drawer-cancel">Cancel</button>
        <span class="muted small">Saving writes docs/tracker/items/${esc(it.id || "<id>")}.md and re-renders backlog.md.</span>
      </div>
    </form>`;
  const gallery = mediaFor.length ? `<h4>Media</h4><div class="media-grid small">${mediaFor.map((m) => `<div class="media-card" data-action="media-open" data-id="${esc(m.id)}"><img class="thumb" data-src="${esc(m.file)}" alt=""><div class="media-meta"><div class="media-caption">${esc(m.caption || m.file.split("/").pop())}</div></div></div>`).join("")}</div>` : "";
  return `<div class="drawer-back" data-action="drawer-close"></div>
  <aside class="drawer">
    <div class="drawer-tools">
      ${d.editing ? "" : `<button data-action="drawer-edit">Edit</button>`}
      ${d.editing ? "" : `<button data-action="open-item-file">Open .md</button>`}
      ${d.editing ? "" : `<label>Status <select data-action="quick-status">${STATUSES.map((k) => option(k, k.toUpperCase(), k === it.status)).join("")}</select></label>`}
      <button data-action="drawer-close" class="right">✕</button>
    </div>
    ${d.editing ? `<h2>${d.isNew ? "New item" : esc(it.id)}</h2>${form}` : `<h2>${esc(it.title)}</h2>${itemHeader(ws, it)}${gallery}`}
  </aside>`;
}

async function refreshView() {
  state.viewp.v = await api.viewState().catch(() => null);
  if (state.viewp.v && !state.viewp.frame.body) state.viewp.frame.body = state.viewp.v.body;
  if (state.view === "view") render();
}

function vlog(line: string) { state.viewp.log.push(`${new Date().toLocaleTimeString()}  ${line}`); }

async function viewAction(kind: "go" | "shoot" | "both") {
  const vp = state.viewp;
  const f = { ...vp.frame };
  try {
    if (kind !== "shoot") {
      vp.busy = "moving the camera"; render();
      const cmd = await api.viewGo(f); vlog(`sent: ${cmd}`);
      await new Promise((r) => setTimeout(r, 2500));
    }
    if (kind !== "go") {
      vp.busy = "waiting for the picture"; render();
      const rec = await api.viewShoot(f, currentPhase(state.ws!).id);
      vp.last = rec; vlog(`filed ${rec.file}`);
      await reload();
    }
  } catch (e) { vlog(String(e)); toast(String(e), 8000); }
  vp.busy = ""; await refreshView();
}

function readerFind() {
  const r = state.library.reader; if (!r) return;
  const q = document.querySelector<HTMLInputElement>("[data-reader-q]")?.value ?? "";
  r.q = q; r.hits = r.text ? findAll(r.text, q) : []; r.cur = 0;
  render(); scrollToHit();
  const inp = document.querySelector<HTMLInputElement>("[data-reader-q]"); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
}

function scrollToHit() {
  setTimeout(() => document.getElementById("reader-cur")?.scrollIntoView({ block: "center" }), 0);
}

function paletteMatches(ws: Workspace): Item[] {
  const q = state.palette.q.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const pool = ws.items.filter((i) => i.kind !== "epic" || words.length);
  const scored = pool.filter((i) => {
    if (!words.length) return i.status === "now" || i.status === "yours" || i.status === "next";
    const hay = `${i.id} ${i.title} ${i.tags.join(" ")} ${i.kind} ${i.status} ${i.phase}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  scored.sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0) || a.priority.localeCompare(b.priority) || cmpId(a.id, b.id));
  return scored.slice(0, 14);
}

function palette(ws: Workspace): string {
  const hits = paletteMatches(ws);
  return `<div class="palette-back" data-action="palette-close"><div class="palette" data-action="palette-stay">
    <input data-palette value="${esc(state.palette.q)}" placeholder="Find an item by id, title, tag, status… (Esc closes)">
    ${hits.length ? `<ul>${hits.map((i, n) => `<li class="${n === state.palette.sel ? "sel" : ""}" data-item="${esc(i.id)}"><span class="id">${esc(i.id)}</span><span>${esc(i.title)}</span><small>${esc(i.kind)} · ${esc(i.status)}</small></li>`).join("")}</ul>` : `<div class="nothing">Nothing matches.</div>`}
  </div></div>`;
}

document.addEventListener("keydown", (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
    ev.preventDefault();
    if (!state.ws || state.noProject) return;
    state.palette = { open: !state.palette.open, q: "", sel: 0 };
    render();
    return;
  }
  if (state.library.reader && (ev.target as HTMLElement)?.matches?.("[data-reader-q]") && ev.key === "Enter") { ev.preventDefault(); readerFind(); return; }
  if (state.library.reader && ev.key === "Escape" && !state.palette.open) { state.library.reader = null; render(); return; }
  if (!state.palette.open || !state.ws) return;
  if (ev.key === "Escape") { state.palette.open = false; render(); }
  else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    const n = paletteMatches(state.ws).length;
    if (n) state.palette.sel = (state.palette.sel + (ev.key === "ArrowDown" ? 1 : n - 1)) % n;
    render();
  } else if (ev.key === "Enter") {
    const hit = paletteMatches(state.ws)[state.palette.sel];
    if (hit) { state.palette.open = false; openItem(hit.id); }
  }
});

app.addEventListener("input", (ev) => {
  const t = ev.target as HTMLInputElement;
  if (t.dataset.palette !== undefined) { state.palette.q = t.value; state.palette.sel = 0; render(); }
  if (t.dataset.vf) {
    const f = state.viewp.frame as unknown as Record<string, unknown>;
    const k = t.dataset.vf;
    f[k] = k === "name" || k === "note" ? t.value : Number(t.value);
    if (k === "hour" || k === "lat" || k === "lon") render(); // marker and clock follow
  }
  if (t.dataset.viewConsole !== undefined) state.viewp.console = t.value;
});

async function openItem(id: string) {
  const it = state.ws?.items.find((i) => i.id === id);
  if (!it) return;
  state.media.open = null;
  const stamp = await api.fileStamp(`docs/tracker/items/${it.id}.md`).catch(() => 0);
  state.drawer = { item: structuredClone(it), editing: false, isNew: false, stamp };
  render();
  if (it.files.length) {
    const commits = await api.commitsFor(it.files).catch(() => []);
    const el = document.getElementById("item-commits");
    if (el && commits.length) el.innerHTML = `<h4>Commits touching these files</h4><ul class="commits">${commits.slice(0, 10).map((c) => `<li><code>${esc(c.hash)}</code> <span class="muted">${esc(c.date)}</span> ${esc(c.subject)}</li>`).join("")}</ul>`;
  }
}

async function newItem(kind: string) {
  const ws = state.ws!;
  const phase = state.boardPhase !== "all" ? state.boardPhase : currentPhase(ws).id;
  const it = blankItem(phase);
  it.kind = kind;
  if (kind === "bug") { it.severity = "S2"; it.status = "next"; it.priority = "P1"; }
  it.id = await api.nextId(phase);
  state.drawer = { item: it, editing: true, isNew: true };
  render();
}

async function saveForm(form: HTMLFormElement) {
  const fd = new FormData(form);
  const d = state.drawer!;
  const it: Item = { ...d.item };
  const lines = (k: string) => String(fd.get(k) ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  for (const k of ["id", "title", "kind", "status", "phase", "priority", "severity", "parent", "sheet", "done_when"] as const) it[k] = String(fd.get(k) ?? "").trim();
  it.body = String(fd.get("body") ?? "");
  it.files = lines("files"); it.tests = lines("tests"); it.adrs = lines("adrs");
  if (d.isNew && state.ws!.items.some((x) => x.id === it.id)) { toast(`${it.id} already exists`); return; }
  try {
    const saved = await api.saveItem(it, d.stamp);
    await api.renderBacklog().catch((e) => toast("saved, but backlog render failed: " + e, 6000));
    await reload();
    state.drawer = { item: saved, editing: false, isNew: false, stamp: await api.fileStamp(`docs/tracker/items/${saved.id}.md`).catch(() => 0) };
    render();
    toast(`saved ${saved.id}`);
  } catch (e) {
    toast("not saved: " + String(e), 6000);
  }
}

async function quickStatus(status: string) {
  const d = state.drawer!;
  try {
    const saved = await api.saveItem({ ...d.item, status }, d.stamp);
    await api.renderBacklog().catch(() => {});
    await reload();
    state.drawer = { item: saved, editing: false, isNew: false };
    render();
    toast(`${saved.id} → ${status.toUpperCase()}`);
  } catch (e) {
    toast("not saved: " + String(e), 6000);
    render();
  }
}

// --- QA ----------------------------------------------------------------------------------------------

function readQaInputs() {
  const d = state.qa.draft;
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-qa]")) {
    const k = el.dataset.qa!;
    if (k === "minutes") d.minutes = Number(el.value) || 0;
    else (d as unknown as Record<string, string>)[k] = el.value;
  }
  const g: Record<string, boolean> = {};
  for (const el of document.querySelectorAll<HTMLInputElement>("[data-gate]")) g[el.dataset.gate!] = el.checked;
  if (Object.keys(g).length) d.gate = g;
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-qa-head]")) {
    if (el.dataset.qaHead === "tester") { state.qa.tester = el.value; localStorage.setItem("tester", el.value); }
    if (el.dataset.qaHead === "build") state.qa.build = el.value;
  }
}

async function saveQa() {
  readQaInputs();
  const d = state.qa.draft;
  const manualKind = state.qa.tab === "playtest" ? "playtest" : "sheets";
  d.kind = manualKind;
  if (d.kind === "sheets" && !Object.keys(d.results).length) { toast("Record at least one row first."); return; }
  d.commit = d.commit || state.ws!.head;
  try {
    if (state.qa.target) {
      const t = state.qa.target;
      await api.completeSuiteStep(t.runId, t.stepIndex, { results: d.results, gate: d.gate, notes: d.notes, tester: d.tester, build: d.build });
      state.qa.target = null;
      state.qa.openRun = t.runId;
    } else {
      await api.saveQaRun(d);
    }
    state.qa.draft = freshDraft(manualKind);
    await reload();
    state.qa.tab = "history";
    render();
    toast("recorded");
  } catch (e) {
    toast("not saved: " + String(e), 6000);
  }
}

function targetStep(run: SuiteRun, stepIndex: number) {
  const step = run.steps[stepIndex]?.step;
  if (!step) return;
  state.qa.target = { runId: run.id, stepIndex, sheets: step.sheets ?? [] };
  state.qa.draft = freshDraft(step.type === "playtest" ? "playtest" : "sheets");
  state.qa.draft.commit = run.commit;
  state.qa.draft.tester = run.tester || state.qa.tester;
  state.qa.draft.build = run.build || state.qa.build;
  state.qa.tab = step.type === "playtest" ? "playtest" : "sheets";
  state.view = "qa";
  render();
}

// --- Media ---------------------------------------------------------------------------------------------

function startFiling(paths: string[], preset: Partial<MediaRecord> = {}) {
  if (!paths.length) return;
  const ws = state.ws!;
  const rec = { ...blankMedia(currentPhase(ws).id), ...preset };
  state.media.filing = { source: paths[0], record: rec, queue: paths.slice(1) };
  state.view = "media";
  render();
}

async function fileCurrent(form: HTMLFormElement) {
  const f = state.media.filing!;
  const fd = new FormData(form);
  const rec: MediaRecord = { ...f.record };
  for (const k of ["phase", "kind", "item", "run", "caption"] as const) rec[k] = String(fd.get(k) ?? "").trim();
  rec.tags = String(fd.get("tags") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  try {
    await api.fileMedia(f.source, rec);
    const next = f.queue;
    await reload();
    if (next.length) state.media.filing = { source: next[0], record: { ...rec, caption: "" }, queue: next.slice(1) };
    else { state.media.filing = null; state.media.phase = rec.phase; }
    render();
    toast("filed");
  } catch (e) {
    toast("not filed: " + String(e), 6000);
  }
}

async function saveMediaEdit(form: HTMLFormElement) {
  const m = state.media.open!;
  const fd = new FormData(form);
  const rec: MediaRecord = { ...m };
  for (const k of ["phase", "kind", "item", "run", "caption", "date"] as const) rec[k] = String(fd.get(k) ?? "").trim();
  rec.tags = String(fd.get("tags") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const saved = await api.updateMedia(rec);
    await reload();
    state.media.open = saved; state.media.editing = false;
    render();
    toast("saved");
  } catch (e) {
    toast("not saved: " + String(e), 6000);
  }
}

// --- Design -------------------------------------------------------------------------------------------

async function refreshDesign() {
  const ws = state.ws!;
  state.design.loading = true;
  render();
  try {
    const draft = state.design.draft ? JSON.stringify({ recipes: state.design.draft }) : null;
    state.design.report = await api.designReport(draft, state.design.places);
  } catch (e) {
    toast("simulator: " + String(e).slice(0, 300), 8000);
  }
  state.design.loading = false;
  if (!state.design.selected) state.design.selected = recipesOf(ws, state.design)[0]?.id ?? "";
  render();
}

function applyRecipeForm(form: HTMLFormElement) {
  const ws = state.ws!;
  const fd = new FormData(form);
  const oldId = form.dataset.id!;
  const recipes = structuredClone(recipesOf(ws, state.design));
  const idx = recipes.findIndex((r) => r.id === oldId);
  const inputs: Record<string, number> = {};
  for (let i = 0; i < 12; i++) {
    const res = String(fd.get(`in_res_${i}`) ?? "");
    const n = Number(fd.get(`in_n_${i}`) ?? 0);
    if (res && n > 0) inputs[res] = n;
  }
  const r = {
    id: String(fd.get("id") ?? "").trim(), name: String(fd.get("name") ?? "").trim(), inputs,
    output: String(fd.get("output") ?? ""), count: Number(fd.get("count") ?? 1) || 1,
    station: String(fd.get("station") ?? "none"), note: String(fd.get("note") ?? ""),
  };
  if (!r.id) { toast("a recipe needs an id"); return; }
  if (idx >= 0) recipes[idx] = r; else recipes.push(r);
  state.design.draft = recipes; state.design.selected = r.id; state.design.dirty = true; state.design.problems = null;
  refreshDesign();
}

// --- Runs ---------------------------------------------------------------------------------------------

async function runCommand(name: string) {
  try {
    const runId = await api.run(name);
    state.console = { runId, name, lines: [], done: false, exit: null };
    state.view = "dev";
    render();
  } catch (e) {
    toast("could not start: " + String(e), 6000);
  }
}

// --- Events -----------------------------------------------------------------------------------------------

// The Projects screen shares the same delegation, with or without a project loaded.
app.addEventListener("click", async (ev) => {
  const target = ev.target as HTMLElement;
  const t = target.closest<HTMLElement>("[data-view],[data-item],[data-open],[data-open-url],[data-action]");
  if (!t) return;
  if (t.dataset.openUrl) { ev.preventDefault(); api.openUrl(t.dataset.openUrl).catch((e) => toast(String(e), 5000)); return; }
  // A click inside the lightbox must not close it.
  if (t.dataset.action === "media-close" && target.closest("[data-stop]")) return;
  if (t.dataset.view) {
    state.view = t.dataset.view as View; localStorage.setItem("view", state.view); render();
    if (state.view === "design" && !state.design.report) refreshDesign();
    if (state.view === "projects") { await loadProjects(); render(); }
    return;
  }
  if (t.dataset.open) { ev.preventDefault(); api.open(t.dataset.open).catch((e) => toast(String(e), 5000)); return; }
  if (t.dataset.item && !t.dataset.action) { state.palette.open = false; openItem(t.dataset.item); return; }
  const ws = state.ws ?? ({ items: [], sheets: [], qa_runs: [], media: [], config: {} } as unknown as Workspace);
  switch (t.dataset.action) {
    case "reload": await reload(); toast("reloaded"); break;

    // --- Decisions. Every one of these writes the .md file itself.
    case "adr-open": state.adrOpen = t.dataset.adr ?? null; render(); break;
    case "open-adr-file": {
      const a = ws.adrs.find((x) => x.number === state.adrOpen);
      if (a) await api.openUrl(a.path).catch((e: unknown) => toast(String(e)));
      break;
    }
    case "adr-accept": await signAdr("accepted"); break;
    case "adr-reject": await signAdr("rejected"); break;
    case "adr-supersede": await signAdr("superseded"); break;
    case "adr-note": {
      const a = ws.adrs.find((x) => x.number === state.adrOpen);
      const box = document.querySelector<HTMLTextAreaElement>("[data-note]");
      if (!a || !box) break;
      await saveNote(a.path, box.value);
      break;
    }
    case "item-note": {
      const d = state.drawer;
      const box = document.querySelector<HTMLTextAreaElement>("[data-note]");
      if (!d || !box) break;
      await saveNote(`docs/tracker/items/${d.item.id}.md`, box.value);
      break;
    }
    // Projects
    case "proj-new": state.projects.creating = { parent: "", folder: "", name: "" }; state.projects.error = ""; render(); break;
    case "proj-cancel": state.projects.creating = null; render(); break;
    case "proj-parent": {
      const p = await api.projectsPickFolder().catch(() => null);
      if (p && state.projects.creating) { state.projects.creating.parent = p; render(); }
      break;
    }
    case "proj-pick": {
      const p = await api.projectsPickFolder().catch(() => null);
      if (!p) break;
      try { await api.projectsOpen(p); toast("opening " + p); } catch (e) { state.projects.error = String(e); render(); }
      break;
    }
    case "proj-open": {
      try { await api.projectsOpen(t.dataset.path!); toast("opening " + t.dataset.path); } catch (e) { state.projects.error = String(e); render(); }
      break;
    }
    case "proj-forget": await api.projectsForget(t.dataset.path!).catch(() => {}); await loadProjects(); render(); break;
    // Library
    case "lib-tab": state.library.tab = t.dataset.tab!; render(); break;
    // Reader
    case "lib-read": {
      const src = state.ws!.library.sources.find((x) => x.slug === t.dataset.slug);
      if (!src) break;
      state.library.reader = { slug: src.slug, tab: src.text ? "text" : "pdf", text: null, q: "", hits: [], cur: 0 };
      render();
      if (src.text) { state.library.reader.text = await api.readLog(src.text).catch((e) => `could not read the text cache: ${e}`); render(); }
      break;
    }
    case "reader-close": state.library.reader = null; render(); break;
    case "reader-tab": state.library.reader!.tab = t.dataset.tab as "text" | "pdf"; render(); break;
    case "reader-find": readerFind(); break;
    case "reader-next": case "reader-prev": {
      const r = state.library.reader!; if (!r.hits.length) break;
      r.cur = (r.cur + (t.dataset.action === "reader-next" ? 1 : r.hits.length - 1)) % r.hits.length; render(); scrollToHit(); break;
    }
    case "reader-goto": state.library.reader!.cur = Number(t.dataset.i); render(); scrollToHit(); break;
    case "reader-shelf": {
      const r = state.library.reader!; const q = (document.querySelector<HTMLInputElement>("[data-reader-q]")?.value ?? r.q).trim();
      if (q.length < 2) { toast("type a word to search the shelf for"); break; }
      state.library.reader = null; state.library.tab = "search"; state.library.query = q; state.library.searching = true; render();
      state.library.hits = await api.librarySearch(q).catch(() => []); state.library.searching = false; render(); break;
    }
    case "reader-cite": {
      const r = state.library.reader!; const src = state.ws!.library.sources.find((x) => x.slug === r.slug); if (!src) break;
      const quote = (window.getSelection()?.toString() ?? "").replace(/\s+/g, " ").trim();
      const text = citation(src, quote);
      try { await navigator.clipboard.writeText(text); toast(`copied: ${text.slice(0, 90)}${text.length > 90 ? "…" : ""}`, 5000); } catch { prompt("copy this citation", text); }
      break;
    }
    case "lib-open": state.library.open = t.dataset.slug!; render(); break;
    case "lib-close": state.library.open = null; render(); break;
    case "lib-unsourced": state.library.onlyUnsourced = (t as HTMLInputElement).checked; render(); break;
    case "lib-propose": state.library.proposing = true; render(); break;
    case "lib-propose-cancel": state.library.proposing = false; render(); break;
    case "lib-search": {
      const q = (document.querySelector('[data-lib="query"]') as HTMLInputElement)?.value ?? "";
      state.library.query = q; state.library.searching = true; render();
      state.library.hits = await api.librarySearch(q).catch(() => []);
      state.library.searching = false; render(); break;
    }
    case "lib-decide": {
      const accept = t.dataset.accept === "1";
      const note = prompt(accept ? "You have read it. Why does it belong on the shelf?" : "Why not?") ?? "";
      if (!note.trim()) break;
      try { await api.libraryDecide(t.dataset.slug!, accept, note); await reload(); render(); toast(accept ? "accepted into sources.json" : "rejected"); } catch (e) { toast(String(e), 6000); }
      break;
    }
    case "new-item": newItem("task"); break;
    case "palette": state.palette = { open: true, q: "", sel: 0 }; render(); break;
    case "palette-close": state.palette.open = false; render(); break;
    case "palette-stay": break;
    // Viewfinder
    case "view-launch": try { state.viewp.busy = "launching"; render(); const id = await api.viewLaunch(); vlog(`launched, run ${id}`); state.view = "view"; } catch (e) { toast(String(e), 6000); } state.viewp.busy = ""; setTimeout(refreshView, 4000); render(); break;
    case "view-quit": await api.viewConsole("quit").then(() => vlog("quit sent")).catch((e) => vlog(String(e))); setTimeout(refreshView, 1500); render(); break;
    case "view-go": await viewAction("go"); break;
    case "view-shoot": await viewAction("shoot"); break;
    case "view-go-shoot": await viewAction("both"); break;
    case "view-save": try { state.viewp.v!.frames = await api.viewSaveFrame(state.viewp.frame); toast("frame saved"); } catch (e) { toast(String(e), 5000); } render(); break;
    case "view-load": { const fr = state.viewp.v?.frames.find((x) => x.name === t.dataset.name); if (fr) state.viewp.frame = { ...fr }; render(); break; }
    case "view-reshoot": { const fr = state.viewp.v?.frames.find((x) => x.name === t.dataset.name); if (fr) { state.viewp.frame = { ...fr }; await viewAction("both"); } break; }
    case "view-delete": if (confirm(`Delete frame ${t.dataset.name}?`)) { state.viewp.v!.frames = await api.viewDeleteFrame(t.dataset.name!).catch(() => state.viewp.v!.frames); render(); } break;
    case "view-place": state.viewp.frame.lat = Number(t.dataset.lat); state.viewp.frame.lon = Number(t.dataset.lon); render(); break;
    case "view-face": {
      const img = t as HTMLImageElement; const me = ev as MouseEvent;
      const hit = state.viewp.v ? latLonFromPixel(state.viewp.v, img.dataset.face!, me.offsetX, me.offsetY, img.clientWidth, img.clientHeight) : null;
      if (hit) { state.viewp.frame.lat = hit[0]; state.viewp.frame.lon = hit[1]; render(); }
      break;
    }
    case "view-console": {
      const inp = document.querySelector<HTMLInputElement>("[data-view-console]"); const cmd = inp?.value.trim() ?? "";
      if (!cmd) break;
      state.viewp.console = "";
      await api.viewConsole(cmd).then((r) => vlog(`${cmd} -> ${r.replace(/\s+/g, " ").slice(0, 120) || "ok"}`)).catch((e) => vlog(String(e)));
      render(); break;
    }
    case "new-bug": newItem("bug"); break;
    case "drawer-close": state.adrOpen = null; state.drawer = null; render(); break;
    case "drawer-cancel": if (state.drawer?.isNew) state.drawer = null; else state.drawer!.editing = false; render(); break;
    case "drawer-edit": state.drawer!.editing = true; render(); break;
    case "open-item-file": api.open(`docs/tracker/items/${state.drawer!.item.id}.md`).catch((e) => toast(String(e), 5000)); break;
    case "open-abs": api.open(t.dataset.path!).catch((e) => toast(String(e), 5000)); break;
    case "bugs-closed": state.bugsClosed = (t as HTMLInputElement).checked; render(); break;
    // QA
    case "qa-tab": readQaInputs(); state.qa.tab = t.dataset.tab!; render(); break;
    case "qa-untarget": state.qa.target = null; render(); break;
    case "qa-open": state.qa.openRun = state.qa.openRun === t.dataset.run ? null : t.dataset.run!; render(); break;
    case "qa-attach": { const inbox = await api.mediaInbox(); if (!inbox.length) { toast("Inbox is empty. Capture a shot first."); break; } startFiling(inbox.map((f) => f.path), { run: t.dataset.run! }); break; }
    case "sheet-res": readQaInputs(); state.qa.draft.results[t.dataset.row!] = t.dataset.val!; render(); break;
    // (the projects cases above run with or without a workspace)
    case "sheet-all": {
      readQaInputs();
      const s = ws.sheets.find((x) => x.id === t.dataset.sheet);
      for (const r of s?.rows ?? []) if (!r.automated) state.qa.draft.results[r.id] = "PASS";
      render(); break;
    }
    case "qa-save": saveQa(); break;
    case "suite-run": {
      readQaInputs();
      try {
        const id = await api.runSuite(t.dataset.suite!, state.qa.tester, state.qa.build || (ws.config.builds?.[0] ?? ""));
        state.qa.live = await api.suiteRun(id);
        state.console = { runId: "", name: `suite ${t.dataset.suite}`, lines: [], done: false, exit: null };
        render();
        toast(`suite started: ${id}`);
      } catch (e) { toast("could not start: " + String(e), 6000); }
      break;
    }
    case "suite-complete": {
      const run = ws.qa_runs.find((r) => r.id === t.dataset.run);
      if (run && isSuite(run)) targetStep(run, Number(t.dataset.step));
      break;
    }
    case "run": runCommand(t.dataset.name!); break;
    case "cancel": await api.cancel(t.dataset.run!); toast("cancel requested"); break;
    case "show-log": state.logView = await api.readLog(t.dataset.path!).catch((e) => String(e)); render(); break;
    case "close-log": state.logView = null; render(); break;
    // Design
    case "design-select": state.design.selected = t.dataset.id!; render(); break;
    case "design-add": {
      const recipes = structuredClone(recipesOf(ws, state.design));
      let n = recipes.length + 1; let id = `recipe-${n}`;
      while (recipes.some((r) => r.id === id)) id = `recipe-${++n}`;
      recipes.push({ id, name: "New recipe", inputs: { forage: 1 }, output: "cord", count: 1, station: "none", note: "" });
      state.design.draft = recipes; state.design.selected = id; state.design.dirty = true; render(); break;
    }
    case "design-delete": {
      const recipes = recipesOf(ws, state.design).filter((r) => r.id !== t.dataset.id);
      state.design.draft = recipes; state.design.selected = recipes[0]?.id ?? ""; state.design.dirty = true; refreshDesign(); break;
    }
    case "design-revert": state.design.draft = null; state.design.dirty = false; state.design.problems = null; refreshDesign(); break;
    case "design-save": {
      try {
        state.design.problems = await api.saveRecipes(recipesOf(ws, state.design));
        state.design.draft = null; state.design.dirty = false;
        await reload();
        await refreshDesign();
        toast(state.design.problems.length ? `saved, ${state.design.problems.length} problem(s)` : "saved recipes.json");
      } catch (e) { toast("not saved: " + String(e), 6000); }
      break;
    }
    case "design-place": {
      const lat = Number((document.querySelector('[data-design="lat"]') as HTMLInputElement)?.value);
      const lon = Number((document.querySelector('[data-design="lon"]') as HTMLInputElement)?.value);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90) { state.design.places.push([lat, lon]); refreshDesign(); }
      else toast("latitude −90..90, longitude −180..180");
      break;
    }
    // Media
    case "media-phase": state.media.phase = t.dataset.phase!; render(); break;
    case "media-add": { const picked = await api.pickFiles().catch(() => [] as string[]); startFiling(picked); break; }
    case "media-file": startFiling([t.dataset.path!]); break;
    case "media-cancel": state.media.filing = null; render(); break;
    case "media-open": state.media.open = ws.media.find((m) => m.id === t.dataset.id) ?? null; state.media.editing = false; render(); break;
    case "media-close": state.media.open = null; state.media.editing = false; render(); break;
    case "media-edit": state.media.editing = true; render(); break;
    case "media-edit-cancel": state.media.editing = false; render(); break;
    case "media-delete": {
      if (!confirm("Delete this file from docs/media and its record? This cannot be undone here.")) break;
      try { await api.removeMedia(t.dataset.id!, true); state.media.open = null; await reload(); render(); toast("deleted"); } catch (e) { toast(String(e), 6000); }
      break;
    }
  }
});

app.addEventListener("change", (ev) => {
  const t = ev.target as HTMLSelectElement;
  if (t.dataset.action === "board-phase") { state.boardPhase = t.value; localStorage.setItem("boardPhase", t.value); render(); }
  if (t.dataset.action === "quick-status") quickStatus(t.value);
  if (t.dataset.action === "media-kind") { state.media.kind = t.value; render(); }
  if (t.dataset.action === "lib-domain") { state.library.domain = t.value; render(); }
  if (t.dataset.action === "media-capture" && t.value) { runCommand(t.value); t.value = ""; }
});

app.addEventListener("submit", (ev) => {
  const f = ev.target as HTMLFormElement;
  if (f.id === "item-form") { ev.preventDefault(); saveForm(f); }
  if (f.id === "media-form") { ev.preventDefault(); fileCurrent(f); }
  if (f.id === "media-edit") { ev.preventDefault(); saveMediaEdit(f); }
  if (f.id === "recipe-form") { ev.preventDefault(); applyRecipeForm(f); }
  if (f.id === "lib-propose-form") {
    ev.preventDefault();
    const fd = new FormData(f);
    const g = (k: string) => String(fd.get(k) ?? "").trim();
    api.libraryPropose({ title: g("title"), url: g("url"), authors: g("authors").split(",").map((x) => x.trim()).filter(Boolean), year: Number(g("year")) || undefined, venue: g("venue"), domain: g("domain"), why: g("why"), recency: g("recency"), credentials: g("credentials"), contradictions: g("contradictions"), proposed_by: "you" })
      .then(async () => { state.library.proposing = false; await reload(); state.library.tab = "candidates"; render(); toast("proposed"); })
      .catch((e) => toast(String(e), 8000));
  }
  if (f.id === "proj-form") {
    ev.preventDefault();
    const fd = new FormData(f);
    const parent = String(fd.get("parent") ?? "").trim(), folder = String(fd.get("folder") ?? "").trim(), name = String(fd.get("name") ?? "").trim();
    state.projects.creating = { parent, folder, name };
    state.projects.busy = `creating ${name}…`; state.projects.error = ""; render();
    api.projectsCreate(parent, folder, name)
      .then(async (path) => { state.projects.busy = "opening…"; render(); await api.projectsOpen(path); })
      .catch((e) => { state.projects.busy = ""; state.projects.error = String(e); render(); });
  }
});

// The desk holds no state of its own, so when another writer (a Claude session, the game, the
// tracker script) changes the files, the window follows. Every few seconds, cheaply.
setInterval(async () => {
  if (!state.ws || state.drawer?.editing || state.media.filing) return;
  const stamp = await api.treeStamp().catch(() => null);
  if (stamp && stamp !== state.ws.stamp) {
    await reload();
    if (state.view === "design" && !state.design.dirty) refreshDesign();
  }
}, 4000);

// The Viewfinder asks the game whether it answers, every few seconds while the panel is open.
// A single check after Launch was the bug: the game takes twenty to sixty seconds to come up,
// so the panel believed nothing was live and greyed every button out.
setInterval(async () => {
  const vp = state.viewp;
  if (state.view !== "view" || !vp.v || !vp.v.enabled || vp.busy) return;
  const v = await api.viewState().catch(() => null);
  if (!v) return;
  const changed = v.live !== vp.v.live || v.frames.length !== vp.v.frames.length;
  vp.v = v;
  if (changed && !document.activeElement?.matches("input, textarea")) render();
}, 3000);

api.onLine(({ run_id, line }) => {
  const c = state.console;
  if (!c) return;
  // A suite's steps each have their own run id; the console follows whatever is running.
  if (c.runId !== run_id) { if (c.name.startsWith("suite")) c.runId = run_id; else return; }
  c.lines.push(line);
  const pre = document.getElementById("console");
  if (pre) { pre.textContent += (pre.textContent ? "\n" : "") + line; pre.scrollTop = pre.scrollHeight; }
});

api.onDone(async ({ run_id, record }) => {
  const c = state.console;
  if (c && c.runId === run_id && !c.name.startsWith("suite")) { c.done = true; c.exit = record.exit_code; }
  await reload();
  const isShot = record.name.startsWith("shot:");
  toast(isShot ? `${record.name}: exit ${record.exit_code} · ${state.ws?.inbox.length ?? 0} in the media inbox` : `${record.name}: exit ${record.exit_code}`, isShot ? 5000 : 2500);
});

api.onSuite(({ run }) => { state.qa.live = run; render(); });
api.onSuiteDone(async ({ run }) => {
  state.qa.live = run;
  if (state.console?.name.startsWith("suite")) { state.console.done = true; state.console.exit = run.status === "fail" ? 1 : 0; }
  await reload();
  const pending = run.steps.findIndex((s) => s.status === "pending");
  if (pending >= 0) { toast(`suite ${run.suite_name}: automated steps done, ${run.steps.filter((s) => s.status === "pending").length} manual step(s) waiting`, 6000); state.qa.openRun = run.id; }
  else toast(`suite ${run.suite_name}: ${run.status}`, 5000);
  render();
});

reload();


// --- Decisions ------------------------------------------------------------------------------------
//
// Sign-off and notes both rewrite the markdown file. Nothing is stored beside
// the repo, so git sees it and the next session reads it.

async function signAdr(status: string) {
  if (!state.adrOpen) return;
  const who = (state.ws?.config as { signer?: string } | undefined)?.signer ?? "";
  try {
    await api.setAdrStatus(state.adrOpen, status, who);
    await reload();
    render();
    toast(`ADR-${state.adrOpen} ${status}`);
  } catch (e) {
    toast("not signed: " + String(e), 6000);
  }
}

async function saveNote(rel: string, text: string) {
  if (!text.trim()) { toast("nothing to save"); return; }
  const who = (state.ws?.config as { signer?: string } | undefined)?.signer ?? "";
  try {
    await api.appendNote(rel, text, who);
    await reload();
    render();
    toast("note saved");
  } catch (e) {
    toast("not saved: " + String(e), 6000);
  }
}
