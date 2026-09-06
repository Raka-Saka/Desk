// QA, for the person who owns quality: suites to start with one button, what each last said,
// the manual sheets as a recordable run, the playtest that IS the phase gate, the test
// inventory, and the history with its evidence.
import type { QaRun, StepResult, Suite, SuiteRun, TestInfo, Workspace } from "./api";
import { badge, daysSince, esc, option } from "./util";

/** The playtest boxes come from desk.json `playtest_gate`; this is the fallback for a project that has none yet. */
export function gateQuestions(ws: Workspace): [string, string][] {
  return ws.config.playtest_gate?.length ? ws.config.playtest_gate : [["played", "They played it"], ["understood", "They understood what to do"], ["came_back", "They wanted to keep going"]];
}
function builds(ws: Workspace): string[] {
  return ws.config.builds?.length ? ws.config.builds : ["dev", "release"];
}

export interface QaState {
  tab: string; // suites | sheets | playtest | tests | history
  draft: QaRun;
  /** A suite run whose manual step the sheets/playtest form is completing. */
  target: { runId: string; stepIndex: number; sheets: string[] } | null;
  live: SuiteRun | null;
  tester: string;
  build: string;
  openRun: string | null;
}

export function isSuite(r: QaRun | SuiteRun): r is SuiteRun {
  return r.kind === "suite";
}

function stepLabel(s: StepResult["step"]): string {
  switch (s.type) {
    case "command": return `run ${s.name}`;
    case "automation": return `C++ tests ${s.filter}`;
    case "shot": return `shot ${s.switch}`;
    case "sheets": return `sheets ${(s.sheets ?? []).join(", ")}`;
    case "playtest": return "playtest";
    default: return s.type;
  }
}

function statusDot(st: string): string {
  const cls = st === "pass" ? "ok" : st === "fail" ? "bad" : st === "running" ? "run" : st === "pending" ? "pend" : "";
  return `<span class="dot ${cls}" title="${esc(st)}"></span>`;
}

function lastRunOf(ws: Workspace, suiteId: string): SuiteRun | undefined {
  return ws.qa_runs.find((r): r is SuiteRun => isSuite(r) && r.suite === suiteId);
}

// --- KPIs -------------------------------------------------------------------------------------------

function kpis(ws: Workspace): string {
  const suiteRuns = ws.qa_runs.filter(isSuite);
  const last = suiteRuns[0];
  const bugs = ws.items.filter((i) => (i.kind === "bug" || i.kind === "defect") && i.status !== "done");
  const s1 = bugs.filter((b) => b.severity === "S1").length, s2 = bugs.filter((b) => b.severity === "S2").length, s3 = bugs.filter((b) => b.severity === "S3").length;
  const tests = ws.tests;
  const passing = tests.filter((t) => t.last_result === "Success").length;
  const failing = tests.filter((t) => t.last_result && t.last_result !== "Success").length;
  const lastSheets = ws.qa_runs.find((r) => !isSuite(r) && r.kind === "sheets") as QaRun | undefined;
  const sheetAge = lastSheets ? daysSince(lastSheets.date) : null;
  const pending = suiteRuns.filter((r) => r.status === "pending").length;
  return `<div class="tiles kpi">
    <div class="tile ${last ? (last.status === "pass" ? "ok" : last.status === "fail" ? "bad" : "warn") : ""}"><div class="n">${last ? esc(last.status.toUpperCase()) : "—"}</div><div class="l">last suite${last ? ` · ${esc(last.suite_name)} · ${esc(last.date)}` : ""}</div></div>
    <div class="tile ${failing ? "bad" : passing ? "ok" : ""}"><div class="n">${passing}<span class="muted">/${tests.length}</span></div><div class="l">C++ tests passing at last run${failing ? ` · ${failing} failing` : ""}</div></div>
    <div class="tile ${s1 ? "bad" : s2 ? "warn" : ""}"><div class="n">${bugs.length}</div><div class="l">open bugs · S1 ${s1} · S2 ${s2} · S3 ${s3}</div></div>
    <div class="tile ${sheetAge === null || sheetAge > 7 ? "warn" : "ok"}"><div class="n">${sheetAge === null ? "never" : sheetAge === 0 ? "today" : `${sheetAge} d`}</div><div class="l">since the manual sheets were last run</div></div>
    <div class="tile ${pending ? "warn" : ""}"><div class="n">${pending}</div><div class="l">suite runs waiting on a person</div></div>
  </div>`;
}

// --- Suites ---------------------------------------------------------------------------------------------

function suiteCard(ws: Workspace, s: Suite, st: QaState): string {
  const live = st.live && st.live.suite === s.id && st.live.status === "running" ? st.live : null;
  const last = live ?? lastRunOf(ws, s.id);
  const running = !!st.live && st.live.status === "running";
  return `<div class="suite ${last ? "st-" + esc(last.status) : ""}">
    <div class="suite-head">
      <div><b>${esc(s.name)}</b> <span class="muted small">${esc(s.cadence)}</span></div>
      <button class="primary" data-action="suite-run" data-suite="${esc(s.id)}"${running ? " disabled" : ""}>▶ Run</button>
    </div>
    <p class="muted small">${esc(s.description)}</p>
    <ul class="steps">${(last ? last.steps : s.steps.map((step) => ({ step, status: "", run_id: "", exit_code: 0, summary: [], tests_passed: 0, tests_total: 0 }))).map((r, i) => `
      <li>${statusDot(r.status)} ${esc(stepLabel(r.step))}
        ${r.tests_total ? `<span class="muted small">${r.tests_passed}/${r.tests_total}</span>` : ""}
        ${r.status === "pending" && last && (r.step.type === "sheets" || r.step.type === "playtest") ? `<button class="small" data-action="suite-complete" data-run="${esc(last.id)}" data-step="${i}">do it now</button>` : ""}
        ${r.status === "fail" ? failNote(ws, r) : ""}
      </li>`).join("")}</ul>
    <div class="muted small">${last ? `last: ${esc(last.status)} · ${esc(last.started)} @ ${esc(last.commit)}${last.tester ? ` · ${esc(last.tester)}` : ""}` : "never run"}</div>
  </div>`;
}

// A failed step shows the lines that say what failed, not only the verdict, and links the
// run's own log. "FAIL: 1 of 5 layers" on its own sends the reader nowhere.
function failNote(ws: Workspace, r: StepResult): string {
  const telling = r.summary.filter((l) => /FAIL|Error|failed|exit/i.test(l) && !/^FAIL: \d+ of \d+ layers/.test(l.trim()));
  const lines = (telling.length ? telling : r.summary).slice(-4);
  const rec = r.run_id ? ws.runs.find((x) => x.id === r.run_id) : undefined;
  const log = rec?.log_path ? ` <a class="file" data-action="show-log" data-path="${esc(rec.log_path)}">open the run log</a>` : "";
  return `<div class="small fail-note">${lines.map((l) => `<div>${esc(l.trim())}</div>`).join("")}${r.exit_code ? `<span class="muted">exit ${r.exit_code}</span>` : ""}${log}</div>`;
}

function suitesTab(ws: Workspace, st: QaState): string {
  return `
  <div class="toolbar">
    <label>Tester <input data-qa-head="tester" value="${esc(st.tester)}" placeholder="who is running this" size="18"></label>
    <label>Build <select data-qa-head="build">${builds(ws).map((b) => option(b, b, st.build === b)).join("")}</select></label>
    <span class="muted small">A suite runs its automated steps in order and streams to Development → console. Manual steps wait in the run until you do them.</span>
  </div>
  <div class="suites">${ws.suites.map((s) => suiteCard(ws, s, st)).join("")}</div>
  <p class="muted small">Suites are defined in <code>docs/tracker/qa/suites.json</code>. Add one there when a new kind of check exists.</p>`;
}

// --- Sheets & playtest ------------------------------------------------------------------------------------

function runHeader(ws: Workspace, d: QaRun): string {
  return `<div class="run-head">
    <label>Date <input data-qa="date" value="${esc(d.date)}"></label>
    <label>Commit <input data-qa="commit" value="${esc(d.commit || ws.head)}" size="8"></label>
    <label>Build <select data-qa="build">${builds(ws).map((b) => option(b, b, d.build === b)).join("")}</select></label>
    <label>Tester <input data-qa="tester" value="${esc(d.tester)}" placeholder="you, or the stranger's initials"></label>
  </div>`;
}

function targetBanner(st: QaState): string {
  if (!st.target) return "";
  return `<div class="target">Completing step ${st.target.stepIndex + 1} of suite run <code>${esc(st.target.runId)}</code>. <button class="small" data-action="qa-untarget">detach</button></div>`;
}

function sheetsTab(ws: Workspace, st: QaState): string {
  const d = st.draft;
  const only = st.target?.sheets ?? [];
  const sheets = only.length ? ws.sheets.filter((s) => only.includes(s.id)) : ws.sheets;
  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  for (const v of Object.values(d.results)) if (v in counts) counts[v as keyof typeof counts]++;
  return `<h2>Manual sheets <span class="muted">docs/testing/manual-checks.md · press Play, work down, record</span></h2>
  ${targetBanner(st)}
  ${runHeader(ws, d)}
  ${sheets.map((s) => `<div class="sheet">
      <h3>${esc(s.id)} — ${esc(s.title)} <button class="small" data-action="sheet-all" data-sheet="${esc(s.id)}">all PASS</button></h3>
      ${s.fault ? `<div class="muted small">Fault it catches: ${esc(s.fault)}</div>` : ""}
      <table class="sheet-rows">
        ${s.rows.map((r) => {
          const v = d.results[r.id] ?? "";
          return `<tr class="${r.automated ? "automated" : ""} res-${v}">
            <td class="id">${esc(r.id)}</td><td>${esc(r.do_)}</td><td class="muted">${esc(r.expect)}</td><td class="muted small">${esc(r.log)}</td>
            <td class="res">${r.automated ? "<span class='muted small'>automated</span>" : ["PASS", "FAIL", "SKIP"].map((x) => `<button class="res-btn ${v === x ? "on " + x : ""}" data-action="sheet-res" data-row="${esc(r.id)}" data-val="${x}">${x[0]}</button>`).join("")}</td>
          </tr>`;
        }).join("")}
      </table>
    </div>`).join("")}
  <label>Notes <textarea data-qa="notes" rows="3" placeholder="What you saw. On a FAIL, paste the log line the sheet names.">${esc(d.notes)}</textarea></label>
  <div class="toolbar">
    <button class="primary" data-action="qa-save">${st.target ? "Record into suite run" : "Record run"}</button>
    <span class="muted">${counts.PASS} pass · ${counts.FAIL} fail · ${counts.SKIP} skip. A FAIL becomes a bug: Bugs → Report, with the sheet named.</span>
  </div>`;
}

function playtestTab(ws: Workspace, st: QaState): string {
  const d = st.draft;
  const g = d.gate ?? {};
  const open = ws.phases.phases.find((p) => p.status === "open");
  return `<h2>Playtest <span class="muted">the open phase's gate, as a form</span></h2>
  ${targetBanner(st)}
  <p class="gate">${esc(open?.gate ?? "No open phase in phases.json.")}</p>
  ${runHeader(ws, d)}
  <label>Minutes played <input data-qa="minutes" type="number" value="${d.minutes ?? 30}" size="4"></label>
  <ul class="gate-list">${gateQuestions(ws).map(([k, q]) => `<li><label><input type="checkbox" data-gate="${k}"${g[k] ? " checked" : ""}> ${esc(q)}</label></li>`).join("")}</ul>
  <label>What they said, verbatim, and what you saw <textarea data-qa="notes" rows="8" placeholder="Their words outweigh your opinion. Where did they get stuck? What did they never find? What did they say when they died?">${esc(d.notes)}</textarea></label>
  <div class="toolbar"><button class="primary" data-action="qa-save">${st.target ? "Record into suite run" : "Record playtest"}</button></div>`;
}

// --- Tests ------------------------------------------------------------------------------------------------

function testsTab(ws: Workspace): string {
  const bySystem = new Map<string, TestInfo[]>();
  for (const t of ws.tests) bySystem.set(t.system, [...(bySystem.get(t.system) ?? []), t]);
  return `<h2>C++ automation inventory <span class="muted">${ws.tests.length} tests in Source/Basin/Tests · last result from the newest log that ran them</span></h2>
  <div class="toolbar"><button data-action="run" data-name="automation">Run all</button>${[...bySystem.keys()].sort().map((s) => `<button data-action="run" data-name="automation:Basin.${esc(s)}">Run Basin.${esc(s)}</button>`).join("")}</div>
  ${[...bySystem.entries()].sort().map(([sys, list]) => `<h3>Basin.${esc(sys)} <span class="muted">${list.filter((t) => t.last_result === "Success").length}/${list.length} passing</span></h3>
    <table class="items">${list.map((t) => `<tr><td>${statusDot(t.last_result === "Success" ? "pass" : t.last_result ? "fail" : "")}</td><td><code>${esc(t.name)}</code></td><td class="muted small">${esc(t.last_result || "no result yet")}${t.last_seen ? ` · ${esc(t.last_seen)}` : ""}</td><td><a class="file" data-open="${esc(t.file)}">${esc(t.file.split("/").pop())}</a></td></tr>`).join("")}</table>`).join("")}`;
}

// --- History -----------------------------------------------------------------------------------------------

function historyTab(ws: Workspace, st: QaState): string {
  if (!ws.qa_runs.length) return "<h2>History</h2><p class='muted'>No QA runs recorded yet.</p>";
  const open = st.openRun ? ws.qa_runs.find((r) => r.id === st.openRun) : null;
  return `<h2>History <span class="muted">docs/tracker/qa/runs · click a row</span></h2>
  <table class="items">
    <tr><th>date</th><th>kind</th><th>result</th><th>build</th><th>commit</th><th>tester</th><th>summary</th><th>media</th></tr>
    ${ws.qa_runs.map((r) => {
      const media = ws.media.filter((m) => m.run === r.id).length;
      let result = "", summary = "";
      if (isSuite(r)) { result = r.status; summary = `${r.suite_name}: ${r.steps.filter((s) => s.status === "pass").length}/${r.steps.length} steps pass`; }
      else if (r.kind === "playtest") { result = Object.values(r.gate ?? {}).every(Boolean) && Object.keys(r.gate ?? {}).length ? "pass" : "fail"; summary = `${Object.values(r.gate ?? {}).filter(Boolean).length}/${gateQuestions(ws).length} gate boxes · ${r.minutes ?? "?"} min`; }
      else { const res = Object.values(r.results ?? {}); const f = res.filter((x) => x === "FAIL").length; result = f ? "fail" : "pass"; summary = `${res.filter((x) => x === "PASS").length} pass · ${f} fail · ${res.filter((x) => x === "SKIP").length} skip`; }
      return `<tr data-action="qa-open" data-run="${esc(r.id ?? "")}" class="${st.openRun === r.id ? "sel" : ""}"><td class="id">${esc(r.date)}</td><td>${esc(r.kind)}</td><td>${statusDot(result)} ${esc(result)}</td><td>${esc(r.build ?? "")}</td><td><code>${esc(r.commit ?? "")}</code></td><td>${esc(r.tester ?? "")}</td><td class="small">${esc(summary)}</td><td>${media ? `${media} file${media > 1 ? "s" : ""}` : ""}</td></tr>`;
    }).join("")}
  </table>
  ${open ? runDetail(ws, open) : ""}`;
}

function runDetail(ws: Workspace, r: QaRun | SuiteRun): string {
  const media = ws.media.filter((m) => m.run === r.id);
  let body = "";
  if (isSuite(r)) {
    body = `<ul class="steps">${r.steps.map((s, i) => `<li>${statusDot(s.status)} ${esc(stepLabel(s.step))} ${s.tests_total ? `<span class="muted small">${s.tests_passed}/${s.tests_total}</span>` : ""} ${s.summary.length ? `<span class="muted small">— ${esc(s.summary.slice(-1)[0])}</span>` : ""} ${s.status === "pending" && (s.step.type === "sheets" || s.step.type === "playtest") ? `<button class="small" data-action="suite-complete" data-run="${esc(r.id)}" data-step="${i}">do it now</button>` : ""}</li>`).join("")}</ul>`;
    const fails = Object.entries(r.results).filter(([, v]) => v === "FAIL");
    if (fails.length) body += `<p class="warn">Sheet rows failed: ${fails.map(([k]) => esc(k)).join(", ")}</p>`;
  } else if (r.kind === "playtest") {
    body = `<ul class="gate-list">${gateQuestions(ws).map(([k, q]) => `<li>${statusDot((r.gate ?? {})[k] ? "pass" : "fail")} ${esc(q)}</li>`).join("")}</ul>`;
  } else {
    const fails = Object.entries(r.results ?? {}).filter(([, v]) => v === "FAIL");
    body = fails.length ? `<p class="warn">Failed rows: ${fails.map(([k]) => esc(k)).join(", ")}</p>` : `<p class="ok-text">Every recorded row passed.</p>`;
  }
  return `<section class="card run-detail">
    <h2>${esc(r.kind)} run · ${esc(r.date)} <span class="muted">${esc(r.id ?? "")}</span></h2>
    ${body}
    ${r.notes ? `<h4>Notes</h4><p class="notes">${esc(r.notes)}</p>` : ""}
    <h4>Evidence</h4>
    ${media.length ? `<div class="media-grid small">${media.map((m) => `<div class="media-card" data-action="media-open" data-id="${esc(m.id)}"><img class="thumb" src="" data-src="${esc(m.file)}" alt=""><div class="media-meta"><div class="media-caption">${esc(m.caption || m.file.split("/").pop())}</div></div></div>`).join("")}</div>` : "<p class='muted small'>No media filed against this run. Media → Inbox → File…, and pick this run.</p>"}
    <div class="toolbar"><button data-action="qa-attach" data-run="${esc(r.id ?? "")}">Attach media from inbox</button></div>
  </section>`;
}

// --- Page -----------------------------------------------------------------------------------------------------

export function qa(ws: Workspace, st: QaState): string {
  const tabs: [string, string][] = [["suites", "Suites"], ["sheets", "Manual sheets"], ["playtest", "Playtest"], ["tests", "Tests"], ["history", "History"]];
  let body = "";
  switch (st.tab) {
    case "suites": body = suitesTab(ws, st); break;
    case "sheets": body = sheetsTab(ws, st); break;
    case "playtest": body = playtestTab(ws, st); break;
    case "tests": body = testsTab(ws); break;
    default: body = historyTab(ws, st);
  }
  return `${kpis(ws)}
  <div class="toolbar">${tabs.map(([t, l]) => `<button class="tab${st.tab === t ? " active" : ""}" data-action="qa-tab" data-tab="${t}">${l}</button>`).join("")}</div>
  <section class="card">${body}</section>`;
}

export { badge as _badge };
