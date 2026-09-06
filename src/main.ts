// Basin Desk. One state object, one render, clicks by delegation. The Rust side owns the files.
import { api, blankItem, blankMedia, KINDS, PRIORITIES, SEVERITIES, STATUSES, type CommandSpec, type Item, type MediaRecord, type QaRun, type SuiteRun, type Workspace } from "./api";
import { design, recipesOf, type DesignState } from "./design";
import { dev, type ConsoleState } from "./dev";
import { media, type MediaState } from "./media";
import { isSuite, qa, type QaState } from "./qa";
import { projects, type ProjectsState } from "./projects";
import { board, bugs, currentPhase, dashboard, itemHeader, production, scope } from "./views";
import { cmpId, esc, md, option, today } from "./util";
import { mediaUrl } from "./api";
import { invoke } from "@tauri-apps/api/core";

type View = "dashboard" | "board" | "scope" | "bugs" | "qa" | "media" | "design" | "production" | "dev" | "guide" | "projects";

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
  drawer: null as { item: Item; editing: boolean; isNew: boolean } | null,
  projects: { known: [], home: null, creating: null, busy: "", error: "" } as ProjectsState,
  noProject: false,
  commands: [] as CommandSpec[],
  console: null as ConsoleState | null,
  guide: "",
  toast: "",
  logView: null as string | null,
};

const app = document.getElementById("app")!;

const NAV: [View, string, string][] = [
  ["dashboard", "Dashboard", "where the game is, what to do next"],
  ["board", "Board", "every item by status"],
  ["scope", "Scope", "phase → epic → item"],
  ["bugs", "Bugs", "bugs and defects, by severity"],
  ["qa", "QA", "suites, sheets, playtests, tests"],
  ["media", "Media", "screenshots and video, by phase"],
  ["design", "Design", "recipes: cost, value, push to the project"],
  ["production", "Production", "phases, gates, decisions"],
  ["dev", "Development", "run checks, builds; files and commits"],
  ["guide", "Guide", "how this is managed"],
  ["projects", "Projects", "open or create a project"],
];

async function loadProjects() {
  state.projects.known = await api.projectsRecent().catch(() => []);
  state.projects.home = await api.projectsHome().catch(() => null);
}

function renderNoProject() {
  app.innerHTML = `<aside class="side"><div class="brand"><span>Desk</span></div><div class="side-foot muted small">no project open</div></aside><main class="main">${projects(state.projects, null)}</main>${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ""}`;
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
  }
  const live = state.qa.live && state.qa.live.status === "running" ? state.qa.live : null;
  app.innerHTML = `
    <aside class="side">
      <div class="brand">${esc(ws.config.project ?? "")}<span>Desk</span></div>
      <nav>${NAV.filter(([v]) => v !== "design" || ws.config.design).map(([v, l, d]) => `<a class="${state.view === v ? "active" : ""}" data-view="${v}"><b>${l}${v === "media" && ws.inbox.length ? ` <span class="pill">${ws.inbox.length}</span>` : ""}</b><small>${d}</small></a>`).join("")}</nav>
      <div class="side-foot">
        ${live ? `<div class="live"><span class="spin"></span> suite ${esc(live.suite_name)} · step ${live.steps.filter((s) => s.status !== "pending" && s.status !== "running").length + 1}/${live.steps.length}</div>` : ""}
        <div class="muted small">${esc(ph.name)}</div>
        <div class="muted small">${openCount} open items · ${esc(ws.head)}${ws.dirty.length ? ` · ${ws.dirty.length} dirty` : ""}</div>
        <button data-action="reload" title="Re-read the repo">↻ reload</button>
      </div>
    </aside>
    <main class="main">${body}</main>
    ${state.drawer ? drawer(ws, state.drawer) : ""}
    ${state.logView !== null ? `<div class="modal" data-action="close-log"><pre class="log">${esc(state.logView)}</pre></div>` : ""}
    ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ""}`;
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

async function openItem(id: string) {
  const it = state.ws?.items.find((i) => i.id === id);
  if (!it) return;
  state.media.open = null;
  state.drawer = { item: structuredClone(it), editing: false, isNew: false };
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
    const saved = await api.saveItem(it);
    await api.renderBacklog().catch((e) => toast("saved, but backlog render failed: " + e, 6000));
    await reload();
    state.drawer = { item: saved, editing: false, isNew: false };
    render();
    toast(`saved ${saved.id}`);
  } catch (e) {
    toast("not saved: " + String(e), 6000);
  }
}

async function quickStatus(status: string) {
  const d = state.drawer!;
  try {
    const saved = await api.saveItem({ ...d.item, status });
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
  const t = target.closest<HTMLElement>("[data-view],[data-item],[data-open],[data-action]");
  if (!t) return;
  // A click inside the lightbox must not close it.
  if (t.dataset.action === "media-close" && target.closest("[data-stop]")) return;
  if (t.dataset.view) {
    state.view = t.dataset.view as View; localStorage.setItem("view", state.view); render();
    if (state.view === "design" && !state.design.report) refreshDesign();
    if (state.view === "projects") { await loadProjects(); render(); }
    return;
  }
  if (t.dataset.open) { ev.preventDefault(); api.open(t.dataset.open).catch((e) => toast(String(e), 5000)); return; }
  if (t.dataset.item && !t.dataset.action) { openItem(t.dataset.item); return; }
  const ws = state.ws ?? ({ items: [], sheets: [], qa_runs: [], media: [], config: {} } as unknown as Workspace);
  switch (t.dataset.action) {
    case "reload": await reload(); toast("reloaded"); break;
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
    case "new-item": newItem("task"); break;
    case "new-bug": newItem("bug"); break;
    case "drawer-close": state.drawer = null; render(); break;
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
  if (t.dataset.action === "media-capture" && t.value) { runCommand(t.value); t.value = ""; }
});

app.addEventListener("submit", (ev) => {
  const f = ev.target as HTMLFormElement;
  if (f.id === "item-form") { ev.preventDefault(); saveForm(f); }
  if (f.id === "media-form") { ev.preventDefault(); fileCurrent(f); }
  if (f.id === "media-edit") { ev.preventDefault(); saveMediaEdit(f); }
  if (f.id === "recipe-form") { ev.preventDefault(); applyRecipeForm(f); }
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
