// The read-mostly views: dashboard, board, scope, bugs, production. Each returns HTML; main.ts
// wires clicks by delegation (data-item, data-open, data-action).
import type { Item, Workspace } from "./api";
import { STATUS_HELP } from "./api";
import { badge, cmpId, daysSince, esc, fileLink, itemLink, md, queueOrder } from "./util";

function open(items: Item[]): Item[] {
  return items.filter((i) => i.status !== "done");
}

function phaseOf(ws: Workspace, id: string) {
  return ws.phases.phases.find((p) => p.id === id);
}

export function currentPhase(ws: Workspace) {
  return ws.phases.phases.find((p) => p.status === "open") ?? ws.phases.phases[0];
}

function lastRun(ws: Workspace, name: string) {
  return ws.runs.find((r) => r.name === name);
}

function ageText(iso: string): string {
  const d = daysSince(iso);
  if (d === null) return "";
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${d} d ago`;
}

function itemRow(it: Item, extra = ""): string {
  const sev = it.severity ? badge("sev", it.severity) : "";
  return `<tr data-item="${esc(it.id)}" class="row-${esc(it.status)}">
    <td class="id">${esc(it.id)}</td>
    <td>${badge(it.kind)}${sev}</td>
    <td>${badge("p", it.priority)}</td>
    <td class="title">${esc(it.title)}</td>
    <td>${badge("st-" + it.status, it.status.toUpperCase())}</td>
    ${extra}
  </tr>`;
}

// --- Dashboard ---------------------------------------------------------------------------------

export function dashboard(ws: Workspace): string {
  const ph = currentPhase(ws);
  const items = ws.items;
  const phaseItems = items.filter((i) => i.phase === ph.id && i.kind !== "epic");
  const done = phaseItems.filter((i) => i.status === "done").length;
  const queue = open(items).filter((i) => ["now", "next", "later"].includes(i.status) && i.kind !== "epic").sort(queueOrder);
  const yours = open(items).filter((i) => i.status === "yours").sort((a, b) => a.priority.localeCompare(b.priority) || cmpId(a.id, b.id));
  const bugs = open(items).filter((i) => i.kind === "bug" || i.kind === "defect");
  const p0 = open(items).filter((i) => i.priority === "P0" && i.kind !== "epic");
  const check = lastRun(ws, "check") ?? lastRun(ws, "check-quick");
  const warnings: string[] = [];
  for (const i of items) {
    if (i.status === "now" && (daysSince(i.updated) ?? 0) > 7) warnings.push(`${i.id} has been NOW for ${daysSince(i.updated)} days without an update.`);
    if (["now", "next"].includes(i.status) && !i.done_when.trim()) warnings.push(`${i.id} is ${i.status.toUpperCase()} with no done-when.`);
  }
  if (!check) warnings.push("No recorded run of Tools/check.py from this tool yet. Development → Check.");
  else if (check.exit_code !== 0) warnings.push(`The last check (${check.started}) FAILED.`);
  else if ((daysSince(check.started) ?? 0) > 3) warnings.push(`The last passing check is ${ageText(check.started)}.`);
  if (ws.dirty.length) warnings.push(`${ws.dirty.length} uncommitted change${ws.dirty.length > 1 ? "s" : ""} in the working tree.`);
  for (const p of ws.problems) warnings.push(p);
  const days = daysSince(ph.started);

  return `
  <section class="hero">
    <div class="hero-main">
      <div class="eyebrow">Current phase · started ${esc(ph.started)}${days !== null ? ` · day ${days + 1}` : ""}</div>
      <h1>${esc(ph.name)}</h1>
      <p class="gate"><strong>Done when</strong> ${esc(ph.gate)}</p>
      <p class="trap"><strong>The trap</strong> ${esc(ph.trap)}</p>
      <div class="progress"><div style="width:${phaseItems.length ? Math.round((100 * done) / phaseItems.length) : 0}%"></div></div>
      <div class="muted">${done} of ${phaseItems.length} phase items verified done · loop: <em>${esc(ws.phases.loop)}</em></div>
    </div>
    <div class="tiles">
      <div class="tile"><div class="n">${p0.length}</div><div class="l">P0 · blocks the gate</div></div>
      <div class="tile"><div class="n">${queue.filter((i) => i.status !== "later").length}</div><div class="l">NOW + NEXT</div></div>
      <div class="tile"><div class="n">${yours.length}</div><div class="l">need your eyes</div></div>
      <div class="tile"><div class="n">${bugs.length}</div><div class="l">open bugs &amp; defects</div></div>
      <div class="tile ${check ? (check.exit_code === 0 ? "ok" : "bad") : "warn"}"><div class="n">${check ? (check.exit_code === 0 ? "PASS" : "FAIL") : "—"}</div><div class="l">last check ${check ? ageText(check.started) : "never"}</div></div>
    </div>
  </section>

  <div class="cols">
    <section class="card">
      <h2>Do next <span class="muted">the machine's queue, by priority</span></h2>
      <table class="items">${queue.slice(0, 10).map((i) => itemRow(i, `<td class="dw">${esc(i.done_when)}</td>`)).join("")}</table>
      ${queue.length > 10 ? `<div class="muted">${queue.length - 10} more in Board.</div>` : ""}
    </section>
    <section class="card">
      <h2>Needs your eyes <span class="muted">the machine cannot judge these</span></h2>
      <table class="items">${yours.map((i) => itemRow(i, `<td class="dw">${esc(i.done_when)}</td>`)).join("") || "<tr><td class='muted'>Nothing waiting on you.</td></tr>"}</table>
    </section>
  </div>

  <div class="cols">
    <section class="card">
      <h2>Warnings</h2>
      ${warnings.length ? `<ul class="warn-list">${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : "<p class='muted'>Nothing stale, nothing missing.</p>"}
    </section>
    <section class="card">
      <h2>Recent commits <span class="muted">${esc(ws.branch)} @ ${esc(ws.head)}</span></h2>
      <ul class="commits">${ws.commits.slice(0, 8).map((c) => `<li><code>${esc(c.hash)}</code> <span class="muted">${esc(c.date)}</span> ${esc(c.subject)}</li>`).join("")}</ul>
    </section>
  </div>`;
}

// --- Board ---------------------------------------------------------------------------------------

export function board(ws: Workspace, phaseFilter: string): string {
  const cols = ["now", "next", "yours", "watch", "later", "parked", "done"];
  const items = ws.items.filter((i) => (phaseFilter === "all" || i.phase === phaseFilter) && i.kind !== "epic");
  const phases = ws.phases.phases;
  return `
  <div class="toolbar">
    <label>Phase
      <select data-action="board-phase">
        <option value="all"${phaseFilter === "all" ? " selected" : ""}>all</option>
        ${phases.map((p) => `<option value="${esc(p.id)}"${phaseFilter === p.id ? " selected" : ""}>${esc(p.name)}</option>`).join("")}
      </select>
    </label>
    <button data-action="new-item">+ New item</button>
    <span class="muted">Click a card to open it. Status changes are made in the card.</span>
  </div>
  <div class="board">
    ${cols.map((st) => {
      const list = items.filter((i) => i.status === st).sort(queueOrder);
      return `<div class="col col-${st}">
        <h3>${st.toUpperCase()} <span class="muted">${list.length}</span><div class="muted small">${esc(STATUS_HELP[st])}</div></h3>
        ${list.map((i) => `<div class="cardlet" data-item="${esc(i.id)}">
            <div class="cardlet-head"><span class="id">${esc(i.id)}</span>${badge(i.kind)}${i.severity ? badge("sev", i.severity) : ""}${badge("p", i.priority)}</div>
            <div class="cardlet-title">${esc(i.title)}</div>
            ${i.parent ? `<div class="muted small">↳ ${esc(i.parent)}</div>` : ""}
          </div>`).join("")}
      </div>`;
    }).join("")}
  </div>`;
}

// --- Scope: macro -> micro ------------------------------------------------------------------------

export function scope(ws: Workspace): string {
  const items = ws.items;
  const byParent = new Map<string, Item[]>();
  for (const i of items) {
    if (i.kind === "epic") continue;
    const k = i.parent || "";
    byParent.set(k, [...(byParent.get(k) ?? []), i]);
  }
  const bar = (list: Item[]) => {
    const d = list.filter((i) => i.status === "done").length;
    return `<span class="mini-progress" title="${d}/${list.length} done"><span style="width:${list.length ? (100 * d) / list.length : 0}%"></span></span> <span class="muted">${d}/${list.length}</span>`;
  };
  const leaf = (i: Item) => `<li class="leaf leaf-${esc(i.status)}" data-item="${esc(i.id)}"><span class="id">${esc(i.id)}</span> ${badge("st-" + i.status, i.status.toUpperCase())} ${badge(i.kind)} ${esc(i.title)}</li>`;
  return `<p class="muted">Macro is a phase and its gate. Meso is an epic: a capability the gate needs. Micro is an item: one session, one verifiable done-when. Orphans are items with no epic — give them one, or accept they are small.</p>
  ${ws.phases.phases.map((p) => {
    const epics = items.filter((i) => i.kind === "epic" && i.phase === p.id).sort((a, b) => cmpId(a.id, b.id));
    const orphans = (byParent.get("") ?? []).filter((i) => i.phase === p.id);
    const all = items.filter((i) => i.phase === p.id && i.kind !== "epic");
    if (!all.length && !epics.length) return "";
    return `<section class="card scope-phase">
      <h2>${esc(p.name)} ${badge("ph-" + p.status, p.status)} ${bar(all)}</h2>
      <p class="gate">${esc(p.gate)}</p>
      ${epics.map((e) => {
        const kids = (byParent.get(e.id) ?? []).sort((a, b) => cmpId(a.id, b.id));
        return `<div class="epic"><h3 data-item="${esc(e.id)}"><span class="id">${esc(e.id)}</span> ${esc(e.title)} ${badge("p", e.priority)} ${bar(kids)}</h3>
          <div class="muted small">${esc(e.done_when)}</div>
          <ul class="tree">${kids.map(leaf).join("") || "<li class='muted'>no items yet</li>"}</ul></div>`;
      }).join("")}
      ${orphans.length ? `<div class="epic"><h3>No epic</h3><ul class="tree">${orphans.sort((a, b) => cmpId(a.id, b.id)).map(leaf).join("")}</ul></div>` : ""}
    </section>`;
  }).join("")}`;
}

// --- Bugs ------------------------------------------------------------------------------------------

export function bugs(ws: Workspace, showClosed: boolean): string {
  const all = ws.items.filter((i) => i.kind === "bug" || i.kind === "defect");
  const list = (showClosed ? all : all.filter((i) => i.status !== "done")).sort((a, b) => (a.severity || "S9").localeCompare(b.severity || "S9") || queueOrder(a, b));
  return `
  <div class="toolbar">
    <button data-action="new-bug">+ Report a bug</button>
    <label><input type="checkbox" data-action="bugs-closed"${showClosed ? " checked" : ""}> show closed</label>
    <span class="muted">S1 crashes, blocks play or falls through the world · S2 wrong result or number · S3 cosmetic. A <em>bug</em> is behaviour that is wrong; a <em>defect</em> is a known shortcoming accepted for now.</span>
  </div>
  <table class="items wide">
    <tr><th>#</th><th>kind</th><th>P</th><th>title</th><th>status</th><th>sheet</th><th>files</th><th>opened</th></tr>
    ${list.map((i) => itemRow(i, `<td>${esc(i.sheet)}</td><td class="files">${i.files.slice(0, 2).map((f) => `<code>${esc(f.split("/").pop())}</code>`).join(" ")}</td><td class="muted">${esc(i.created)}</td>`)).join("")}
  </table>
  ${list.length ? "" : "<p class='muted'>No open bugs. Run the manual sheets in QA and see if that stays true.</p>"}`;
}

// --- Production --------------------------------------------------------------------------------------

export function production(ws: Workspace): string {
  const items = ws.items;
  return `
  <section class="card">
    <h2>The loop</h2>
    <p class="loop">${esc(ws.phases.loop)}</p>
    <p class="muted">Every feature serves that line or it waits outside. Cut list, in order: ${ws.phases.cut_list.map((c) => `<strong>${esc(c)}</strong>`).join(" → ")}.</p>
    <p class="muted small">Roadmap says: ${esc(ws.roadmap_phase_line.slice(0, 160))}…</p>
  </section>
  <div class="timeline">
    ${ws.phases.phases.map((p) => {
      const all = items.filter((i) => i.phase === p.id && i.kind !== "epic");
      const done = all.filter((i) => i.status === "done").length;
      const openYours = all.filter((i) => i.status === "yours").length;
      const openBugs = all.filter((i) => (i.kind === "bug" || i.kind === "defect") && i.status !== "done").length;
      return `<div class="phase phase-${esc(p.status)}">
        <div class="phase-head"><span>${esc(p.name)}</span> ${badge("ph-" + p.status, p.status)}</div>
        <div class="muted small">${p.started ? `started ${esc(p.started)}` : "not started"}${p.signed ? ` · signed ${esc(p.signed)}` : ""}</div>
        <div class="progress"><div style="width:${all.length ? Math.round((100 * done) / all.length) : 0}%"></div></div>
        <div class="muted small">${done}/${all.length} done · ${openYours} yours · ${openBugs} open bugs</div>
        <p class="gate small"><strong>Gate</strong> ${esc(p.gate)}</p>
        ${p.trap ? `<p class="trap small"><strong>Trap</strong> ${esc(p.trap)}</p>` : ""}
      </div>`;
    }).join("")}
  </div>
  <section class="card">
    <h2>Decisions <span class="muted">${ws.adrs.length} ADRs · a decision recorded here is not re-litigated in chat</span></h2>
    <table class="items">
      ${ws.adrs.map((a) => `<tr><td class="id">${esc(a.number)}</td><td>${esc(a.title)}</td><td>${badge("adr", a.status.split(" ")[0])}</td><td class="muted">${esc(a.date)}</td><td class="muted">phase ${esc(a.phase)}</td><td>${fileLink(a.path)}</td></tr>`).join("")}
    </table>
  </section>`;
}

// --- Item detail (read part; the form is in main.ts) ------------------------------------------------

export function itemHeader(ws: Workspace, it: Item): string {
  const parent = ws.items.find((p) => p.id === it.parent);
  const kids = ws.items.filter((k) => k.parent === it.id).sort((a, b) => cmpId(a.id, b.id));
  const ph = phaseOf(ws, it.phase);
  return `
    <div class="drawer-head">
      <div><span class="id big">${esc(it.id)}</span> ${badge(it.kind)} ${it.severity ? badge("sev", it.severity) : ""} ${badge("p", it.priority)} ${badge("st-" + it.status, it.status.toUpperCase())}</div>
      <div class="muted small">${esc(ph?.name ?? it.phase)}${parent ? ` · in ${itemLink(parent)}` : ""} · created ${esc(it.created)} · updated ${esc(it.updated)}${it.closed ? ` · closed ${esc(it.closed)}` : ""}</div>
    </div>
    ${it.done_when ? `<p class="gate"><strong>Done when</strong> ${esc(it.done_when)}</p>` : "<p class='warn'>No done-when. An item with no verifiable done-when is not ready to start.</p>"}
    <div class="body md">${md(it.body)}</div>
    ${kids.length ? `<h4>Children</h4><ul class="tree">${kids.map((k) => `<li class="leaf" data-item="${esc(k.id)}"><span class="id">${esc(k.id)}</span> ${badge("st-" + k.status, k.status.toUpperCase())} ${esc(k.title)}</li>`).join("")}</ul>` : ""}
    ${it.files.length ? `<h4>Files</h4><ul class="files">${it.files.map((f) => `<li>${fileLink(f)}</li>`).join("")}</ul>` : ""}
    ${it.tests.length ? `<h4>Tests</h4><ul class="tests">${it.tests.map((t) => `<li><code>${esc(t)}</code></li>`).join("")}</ul>` : ""}
    ${it.adrs.length ? `<h4>Decisions</h4><ul>${it.adrs.map((a) => { const adr = ws.adrs.find((x) => x.number === a); return `<li>${adr ? fileLink(adr.path) : esc(a)} ${adr ? esc(adr.title) : ""}</li>`; }).join("")}</ul>` : ""}
    <div id="item-commits" class="muted small"></div>`;
}
