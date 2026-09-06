// Development: the project's own commands with a live console, the working tree, and the
// map from files to the items that claim them.
import type { CommandSpec, Workspace } from "./api";
import { badge, cmpId, esc, fileLink } from "./util";

export interface ConsoleState {
  runId: string;
  name: string;
  lines: string[];
  done: boolean;
  exit: number | null;
}

export function dev(ws: Workspace, commands: CommandSpec[], con: ConsoleState | null): string {
  const fileMap = new Map<string, string[]>();
  for (const i of ws.items) for (const f of i.files) fileMap.set(f, [...(fileMap.get(f) ?? []), i.id]);
  const byDir = new Map<string, string[]>();
  for (const f of [...fileMap.keys()].sort()) {
    const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ".";
    byDir.set(dir, [...(byDir.get(dir) ?? []), f]);
  }
  const s = ws.stats;
  return `
  <div class="cols dev">
    <section class="card">
      <h2>Commands <span class="muted">each run leaves a record under docs/tracker/runs</span></h2>
      <table class="items">
        ${commands.map((c) => {
          const last = ws.runs.find((r) => r.name === c.name);
          return `<tr><td><button data-action="run" data-name="${esc(c.name)}"${con && !con.done ? " disabled" : ""}>${esc(c.label)}</button></td><td class="muted small">${esc(c.description)} ~${c.minutes} min</td><td class="small">${last ? `<span class="dot ${last.exit_code === 0 ? "ok" : "bad"}"></span> ${esc(last.started)}` : ""}</td></tr>`;
        }).join("")}
      </table>
      <div class="console-head">
        <span>${con ? `<code>${esc(con.name)}</code> ${con.done ? (con.exit === 0 ? "<span class='ok-text'>exit 0</span>" : `<span class='bad-text'>exit ${con.exit}</span>`) : "<span class='spin'></span> running"}` : "<span class='muted'>no run yet</span>"}</span>
        ${con && !con.done ? `<button data-action="cancel" data-run="${esc(con.runId)}">cancel</button>` : ""}
      </div>
      <pre class="console" id="console">${con ? esc(con.lines.slice(-400).join("\n")) : ""}</pre>
    </section>
    <div>
      <section class="card">
        <h2>Working tree <span class="muted">${esc(ws.branch)} @ ${esc(ws.head)}</span></h2>
        ${ws.dirty.length ? `<ul class="dirty">${ws.dirty.map((d) => `<li><code>${esc(d.slice(0, 2))}</code> ${fileLink(d.slice(3).trim())}</li>`).join("")}</ul>` : "<p class='muted'>Clean.</p>"}
        <div class="stats">
          ${s.areas.map((a) => `<span><b>${a.lines.toLocaleString()}</b> lines ${esc(a.label)} in ${a.files} files</span>`).join("")}
          <span><b>${s.automation_tests}</b> automation tests</span>
          <span><b>${ws.adrs.length}</b> ADRs</span>
        </div>
      </section>
      <section class="card">
        <h2>Sessions <span class="muted">docs/tracker/sessions · who did what, on what evidence</span></h2>
        <table class="items">${ws.sessions.slice(0, 8).map((x) => `<tr><td class="id">${esc(x.started.slice(0, 16))}</td><td>${esc(x.agent)}</td><td>${x.compartment ? badge("tag", x.compartment) : ""}</td><td class="small">${esc(x.purpose)}</td><td class="small">${x.closures.map((c) => `${badge(c.class === "stamped" ? "st-done" : c.class === "user" ? "st-yours" : "st-later", c.class)} ${esc(c.item)}`).join(" ")}</td><td class="muted small">${x.ended ? "" : "open"}${x.left_for_user.length ? ` · ${x.left_for_user.length} for you` : ""}</td></tr>`).join("") || "<tr><td class='muted'>none yet: agents open one with desk_start_session</td></tr>"}</table>
      </section>
      <section class="card">
        <h2>Recent runs</h2>
        <table class="items">${ws.runs.slice(0, 8).map((r) => `<tr><td><span class="dot ${r.exit_code === 0 ? "ok" : "bad"}"></span></td><td>${esc(r.name)}</td><td class="muted small">${esc(r.started)} @ ${esc(r.commit)}</td><td class="small">${esc(r.summary.slice(-1)[0] ?? "")}</td><td><button class="small" data-action="show-log" data-path="${esc(r.log_path)}">log</button></td></tr>`).join("") || "<tr><td class='muted'>none</td></tr>"}</table>
      </section>
      <section class="card">
        <h2>Commits</h2>
        <ul class="commits">${ws.commits.slice(0, 25).map((c) => `<li><code>${esc(c.hash)}</code> <span class="muted">${esc(c.date)}</span> ${esc(c.subject)}</li>`).join("")}</ul>
      </section>
    </div>
  </div>
  <section class="card">
    <h2>Files → items <span class="muted">what each file is claimed by; click to open</span></h2>
    <div class="filemap">
      ${[...byDir.entries()].map(([dir, files]) => `<div class="dir"><h4>${esc(dir)}</h4><ul>${files.map((f) => `<li>${fileLink(f)} <span class="muted small">${(fileMap.get(f) ?? []).sort(cmpId).map((id) => `<a class="item-link" data-item="${esc(id)}">${esc(id)}</a>`).join(" ")}</span></li>`).join("")}</ul></div>`).join("")}
    </div>
  </section>`;
}
