// Library: what the project's numbers rest on. Sources with their PDFs and text, the claims that
// cite them (with the checks that hold or fail them), candidates waiting to be read, and search
// across the text cache. Read from the project's own files; the desk adds only candidates.json.
import type { LibCandidate, LibClaim, LibSource, Library, LibHit, Workspace } from "./api";
import { badge, esc, option } from "./util";
import { mediaUrl } from "./api";

export interface LibraryState {
  tab: string; // sources | claims | candidates | search
  domain: string;
  query: string;
  hits: LibHit[] | null;
  searching: boolean;
  open: string | null; // source slug
  proposing: boolean;
  onlyUnsourced: boolean;
  reader: ReaderState | null;
}

/** A source open in the reader: its text (from the text cache) or its PDF, with find-in-text. */
export interface ReaderState {
  slug: string;
  tab: "text" | "pdf";
  text: string | null; // null while loading
  q: string;
  hits: number[]; // character offsets of matches
  cur: number; // index into hits
}

export function library(ws: Workspace, st: LibraryState): string {
  const lib = ws.library;
  if (!lib.enabled) return `<section class="card"><h2>Library</h2><p class="muted">This project has no <code>library</code> block in desk.json. Point it at a sources.json, a papers folder, a text cache and a claims index to get shelves here (see the Desk's docs/LIBRARY.md).</p></section>`;
  const tabs: [string, string][] = [["sources", `Sources ${lib.sources.length}`], ["claims", `Claims ${lib.claims.length}`], ["candidates", `Candidates ${lib.candidates.filter((c) => c.status === "proposed").length}`], ["search", "Search"]];
  let body = "";
  switch (st.tab) {
    case "claims": body = claims(lib, st); break;
    case "candidates": body = candidates(lib, st); break;
    case "search": body = search(lib, st); break;
    default: body = sources(lib, st);
  }
  return `${kpis(lib)}
  <div class="toolbar">${tabs.map(([t, l]) => `<button class="tab${st.tab === t ? " active" : ""}" data-action="lib-tab" data-tab="${t}">${l}</button>`).join("")}</div>
  <section class="card">${body}</section>
  ${st.open ? detail(ws, lib, st.open) : ""}
  ${st.reader ? reader(ws, lib, st.reader) : ""}`;
}

// --- the reader ------------------------------------------------------------------------------------

/** Every match of q in text, case-insensitive, as character offsets. */
export function findAll(text: string, q: string): number[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const hay = text.toLowerCase();
  const out: number[] = [];
  let at = hay.indexOf(needle);
  while (at >= 0 && out.length < 2000) { out.push(at); at = hay.indexOf(needle, at + needle.length); }
  return out;
}

/** The ledger's citation bracket for a source: [Surname et al., *Venue* Year — quote]. */
export function citation(s: LibSource, quote: string): string {
  const surname = (a: string) => a.trim().split(/\s+/).pop() ?? a;
  const names = s.authors.filter((a) => !/^et al/i.test(a));
  const who = names.length === 0 ? s.title : names.length === 1 ? surname(names[0]) : names.length === 2 ? `${surname(names[0])} & ${surname(names[1])}` : `${surname(names[0])} et al.`;
  const venue = s.venue.split("(")[0].trim();
  return `[${who}, *${venue}* ${s.year} — ${quote.trim() || s.title}]`;
}

function reader(ws: Workspace, lib: Library, r: ReaderState): string {
  const s = lib.sources.find((x) => x.slug === r.slug);
  if (!s) return "";
  const n = r.hits.length;
  let body = "";
  if (r.tab === "pdf") {
    body = s.pdf ? `<iframe class="reader-pdf" src="${mediaUrl(ws.root, s.pdf)}" title="${esc(s.title)}"></iframe>` : `<p class="muted">No PDF on disk for this source.</p>`;
  } else if (r.text === null) {
    body = `<p class="muted">Loading the text…</p>`;
  } else if (!s.text) {
    body = `<p class="muted">No text cache for this source; open the PDF tab, or run the project's text extraction.</p>`;
  } else {
    body = `<div class="reader-text">${renderText(r.text, r.q, r.hits, r.cur)}</div>`;
  }
  const hitList = n ? `<ol class="reader-hits">${r.hits.slice(0, 200).map((at, i) => `<li class="${i === r.cur ? "cur" : ""}" data-action="reader-goto" data-i="${i}">${esc(snippet(r.text ?? "", at, r.q.length))}</li>`).join("")}</ol>${n > 200 ? `<p class="muted small">first 200 of ${n}</p>` : ""}` : (r.q.trim().length >= 2 && r.text !== null ? `<p class="muted small">nothing found</p>` : "");
  return `<div class="reader">
    <div class="reader-head">
      <div class="reader-title"><b>${esc(s.title)}</b><div class="muted small">${esc(s.authors.join(", "))} · ${esc(String(s.year ?? ""))}${s.venue ? ` · ${esc(s.venue)}` : ""}</div></div>
      <div class="toolbar">
        <button class="tab${r.tab === "text" ? " active" : ""}" data-action="reader-tab" data-tab="text">Text</button>
        <button class="tab${r.tab === "pdf" ? " active" : ""}" data-action="reader-tab" data-tab="pdf">PDF</button>
        <input data-reader-q value="${esc(r.q)}" placeholder="find in this paper (Enter)" size="28">
        <button data-action="reader-find">Find</button>
        <span class="small muted">${n ? `${r.cur + 1} / ${n}` : ""}</span>
        <button class="small" data-action="reader-prev"${n ? "" : " disabled"}>↑</button>
        <button class="small" data-action="reader-next"${n ? "" : " disabled"}>↓</button>
        <button data-action="reader-shelf" title="the same words across every paper on the shelf">Search the shelf</button>
        <button data-action="reader-cite" title="copy the ledger's citation bracket; a selection in the text becomes the quote">Copy citation</button>
        <button data-action="reader-close" class="right">✕</button>
      </div>
    </div>
    <div class="reader-body">
      <aside class="reader-side">
        ${s.settles ? `<h4>Settles</h4><p class="small">${esc(s.settles)}</p>` : ""}
        ${s.supplies.length ? `<h4>Supplies</h4><ul class="small">${s.supplies.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        <h4>Matches ${n ? `(${n})` : ""}</h4>
        ${hitList || `<p class="muted small">Type a word above. Matches list here; click one to jump.</p>`}
      </aside>
      <main class="reader-main">${body}</main>
    </div>
  </div>`;
}

function snippet(text: string, at: number, len: number): string {
  const a = Math.max(0, at - 50), b = Math.min(text.length, at + len + 70);
  return (a > 0 ? "…" : "") + text.slice(a, b).replace(/\s+/g, " ") + (b < text.length ? "…" : "");
}

/** Paragraphs with the matches marked; the current one carries an id for scrolling. */
function renderText(text: string, q: string, hits: number[], cur: number): string {
  const len = q.trim().length;
  const marks = new Set(hits);
  let out = "";
  let i = 0;
  const paras = text.split(/\n\s*\n/);
  for (const p of paras) {
    let html = "";
    let j = 0;
    const start = text.indexOf(p, i);
    const base = start >= 0 ? start : i;
    if (len >= 2 && hits.length) {
      for (const at of hits) {
        if (at < base || at >= base + p.length) continue;
        const rel = at - base;
        html += esc(p.slice(j, rel)) + `<mark${hits[cur] === at ? ' id="reader-cur" class="cur"' : ""}>${esc(p.slice(rel, rel + len))}</mark>`;
        j = rel + len;
      }
    }
    html += esc(p.slice(j));
    out += `<p>${html.replace(/\n/g, " ")}</p>`;
    i = base + p.length;
    void marks;
  }
  return out;
}

function kpis(lib: Library): string {
  const withPdf = lib.sources.filter((s) => s.pdf).length;
  const unsourced = lib.claims.filter((c) => c.section === "Settled" && !c.cites_source).length;
  const failing = lib.claims.filter((c) => c.checks.some((k) => !k.ok)).length;
  const pending = lib.candidates.filter((c) => c.status === "proposed").length;
  return `<div class="tiles kpi">
    <div class="tile"><div class="n">${lib.sources.length}</div><div class="l">sources on ${lib.shelves.length} shel${lib.shelves.length === 1 ? "f" : "ves"} · ${withPdf} with the PDF</div></div>
    <div class="tile ${unsourced ? "warn" : "ok"}"><div class="n">${unsourced}</div><div class="l">Settled claims citing nothing</div></div>
    <div class="tile ${failing ? "bad" : "ok"}"><div class="n">${failing}</div><div class="l">claims with a failing check</div></div>
    <div class="tile ${pending ? "warn" : ""}"><div class="n">${pending}</div><div class="l">candidates waiting to be read</div></div>
    <div class="tile"><div class="n">${lib.contradictions.length}</div><div class="l">contradictions recorded</div></div>
  </div>`;
}

function sources(lib: Library, st: LibraryState): string {
  const list = lib.sources.filter((s) => st.domain === "all" || s.domain === st.domain);
  return `<div class="toolbar">
    <label>Domain <select data-action="lib-domain"><option value="all">all</option>${lib.domains.map((d) => option(d, d, st.domain === d)).join("")}</select></label>
    <span class="muted small">Click a source for what it settles, the claims that cite it, the items that read it, and the PDF.</span>
  </div>
  <table class="items wide">
    <tr><th>source</th><th>domain</th><th>year</th><th>settles</th><th>claims</th><th>named in</th><th>items</th><th>files</th></tr>
    ${list.map((s) => `<tr data-action="lib-open" data-slug="${esc(s.slug)}">
      <td><b>${esc(s.title)}</b><div class="muted small">${esc(s.authors.join(", "))}${s.venue ? ` · ${esc(s.venue)}` : ""}${s.origin !== "project" ? ` · ${badge("tag", "shared")}` : ""}</div></td>
      <td>${badge("tag", s.domain || "—")}</td><td>${esc(String(s.year ?? ""))}</td>
      <td class="small">${esc(s.settles)}</td>
      <td class="small">${s.claims.length ? `${s.claims.length}` : "<span class='muted'>—</span>"}</td>
      <td class="small">${s.cited_in.length ? `${s.cited_in.length} file${s.cited_in.length > 1 ? "s" : ""}` : "<span class='warn'>nowhere</span>"}</td>
      <td class="small">${s.items.map((i) => `<span class="id">${esc(i)}</span>`).join(" ") || "<span class='muted'>—</span>"}</td>
      <td>${s.text || s.pdf ? `<button class="small" data-action="lib-read" data-slug="${esc(s.slug)}" title="read it here">📖</button> ` : ""}${s.pdf ? badge("st-done", "pdf") : badge("st-later", "no pdf")}${s.text ? badge("st-done", "text") : ""}${s.canonical ? badge("adr", "canonical") : ""}</td>
    </tr>`).join("")}
  </table>`;
}

function claims(lib: Library, st: LibraryState): string {
  const list = lib.claims.filter((c) => !st.onlyUnsourced || (c.section === "Settled" && !c.cites_source));
  return `<div class="toolbar">
    <label><input type="checkbox" data-action="lib-unsourced"${st.onlyUnsourced ? " checked" : ""}> only Settled claims that cite nothing</label>
    <span class="muted small">A claim is what a ledger asserts; its principle is why; its checks are what the project verified (section, card, delivered). "Explain" is the row: claim → principle → source → check.</span>
  </div>
  <table class="items wide">
    <tr><th>body</th><th>section</th><th>claim</th><th>principle</th><th>sources</th><th>checks</th><th>where</th></tr>
    ${list.map((c) => `<tr>
      <td>${esc(c.body)}</td><td>${badge(c.section === "Settled" ? "st-done" : c.section.startsWith("Spec") ? "st-yours" : "tag", c.section)}</td>
      <td>${esc(c.claim)}</td><td class="small muted">${esc(c.principle)}</td>
      <td class="small">${c.sources.map((s) => `<a class="item-link" data-action="lib-open" data-slug="${esc(s)}">${esc(s.split("_").slice(1).join("_") || s)}</a>`).join("<br>") || (c.cites_source ? "<span class='muted'>cited in prose</span>" : "<span class='warn'>none</span>")}</td>
      <td class="small">${c.checks.length ? c.checks.map((k) => `<span class="dot ${k.ok ? "ok" : "bad"}"></span> ${esc(k.kind)}${k.note ? ` <span class="muted">${esc(k.note)}</span>` : ""}`).join("<br>") : "<span class='muted'>—</span>"}</td>
      <td><a class="file" data-open="${esc(c.file)}">${esc(c.file.split("/").pop() ?? "")}:${c.line}</a></td>
    </tr>`).join("")}
  </table>`;
}

function candidates(lib: Library, st: LibraryState): string {
  const list = [...lib.candidates].sort((a, b) => (a.status === "proposed" ? -1 : 1) - (b.status === "proposed" ? -1 : 1));
  return `<div class="toolbar">
    <button data-action="lib-propose">+ Propose a source</button>
    <span class="muted small">The research action: an agent (or you) proposes with recency, credentials and a contradictions pass written out; a source gets onto the shelf by being read and <b>accepted here</b>. Accepting appends it to sources.json and runs the project's fetch and render hooks.</span>
  </div>
  ${st.proposing ? proposeForm(lib) : ""}
  ${list.length ? `<table class="items wide">
    <tr><th>candidate</th><th>why</th><th>recency</th><th>credentials</th><th>contradictions</th><th>by</th><th></th></tr>
    ${list.map((c) => `<tr class="${c.status !== "proposed" ? "row-done" : ""}">
      <td><b>${esc(c.title)}</b><div class="muted small">${esc(c.authors.join(", "))} · ${esc(String(c.year ?? ""))}${c.venue ? ` · ${esc(c.venue)}` : ""} · <a class="file" data-open-url="${esc(c.url)}">link</a></div></td>
      <td class="small">${esc(c.why)}</td><td class="small">${esc(c.recency)}</td><td class="small">${esc(c.credentials)}</td><td class="small">${esc(c.contradictions)}</td>
      <td class="small muted">${esc(c.proposed_by)}<br>${esc(c.proposed_at.slice(0, 10))}</td>
      <td>${c.status === "proposed" ? `<button class="primary small" data-action="lib-decide" data-slug="${esc(c.slug)}" data-accept="1">Accept</button> <button class="small" data-action="lib-decide" data-slug="${esc(c.slug)}" data-accept="0">Reject</button>` : `${badge(c.status === "accepted" ? "st-done" : "st-parked", c.status)}<div class="muted small">${esc(c.decision_note)}</div>`}</td>
    </tr>`).join("")}
  </table>` : "<p class='muted'>No candidates. Ask an agent to research a theme, or propose one yourself.</p>"}`;
}

function proposeForm(lib: Library): string {
  return `<form id="lib-propose-form" class="item-form card">
    <h3>Propose a source</h3>
    <div class="grid2">
      <label>Title <input name="title" required></label>
      <label>URL <input name="url" required placeholder="https://…"></label>
    </div>
    <div class="grid3">
      <label>Authors <span class="muted small">comma separated</span><input name="authors"></label>
      <label>Year <input name="year" type="number"></label>
      <label>Domain <input name="domain" list="lib-domains"><datalist id="lib-domains">${lib.domains.map((d) => `<option value="${esc(d)}">`).join("")}</datalist></label>
    </div>
    <label>Venue <input name="venue"></label>
    <label>Why <span class="muted small">what it would settle or supply</span><textarea name="why" rows="2" required></textarea></label>
    <label>Recency <span class="muted small">what has been published since; is this still the reference</span><textarea name="recency" rows="2" required></textarea></label>
    <label>Credentials <span class="muted small">affiliation, prior work in the field, the venue — what was verified and how</span><textarea name="credentials" rows="2" required></textarea></label>
    <label>Contradictions <span class="muted small">which shelf papers it agrees or disagrees with, and where</span><textarea name="contradictions" rows="2" required></textarea></label>
    <div class="toolbar"><button type="submit" class="primary">Propose</button><button type="button" data-action="lib-propose-cancel">Cancel</button></div>
  </form>`;
}

function search(lib: Library, st: LibraryState): string {
  return `<div class="toolbar">
    <input data-lib="query" value="${esc(st.query)}" placeholder="a word or phrase: crater, permeability, Titan…" size="40">
    <button class="primary" data-action="lib-search">Search</button>
    ${st.searching ? "<span class='spin'></span>" : ""}
    <span class="muted small">Titles, authors, what a source settles, and the full text of every PDF in the text cache (${lib.sources.filter((s) => s.text).length} of ${lib.sources.length}).</span>
  </div>
  ${st.hits === null ? "" : st.hits.length ? `<table class="items wide">${st.hits.map((h) => `<tr><td><a class="item-link" data-action="lib-open" data-slug="${esc(h.slug)}">${esc(h.title)}</a><div class="muted small">${esc(h.where_)}</div></td><td class="small">${esc(h.snippet)}</td></tr>`).join("")}</table>` : "<p class='muted'>Nothing found.</p>"}`;
}

function detail(ws: Workspace, lib: Library, slug: string): string {
  const s = lib.sources.find((x) => x.slug === slug);
  if (!s) return "";
  const cited = s.claims.map((i) => lib.claims[i]).filter(Boolean);
  const items = s.items.map((id) => ws.items.find((i) => i.id === id)).filter(Boolean);
  return `<div class="drawer-back" data-action="lib-close"></div>
  <aside class="drawer">
    <div class="drawer-tools">
      ${s.text || s.pdf ? `<button class="primary" data-action="lib-read" data-slug="${esc(s.slug)}">📖 Read</button>` : `<span class="muted small">no PDF or text on disk</span>`}
      ${s.pdf ? `<button data-action="open-abs" data-path="${esc(s.pdf)}" title="in the system viewer">PDF outside</button>` : ""}
      <a class="file" data-open-url="${esc(s.url)}">source URL</a>
      <button data-action="lib-close" class="right">✕</button>
    </div>
    <h2>${esc(s.title)}</h2>
    <div class="muted">${esc(s.authors.join(", "))} · ${esc(String(s.year ?? ""))}${s.venue ? ` · ${esc(s.venue)}` : ""}</div>
    <div>${badge("tag", s.domain || "—")} ${s.canonical ? badge("adr", "canonical") : ""} ${s.origin !== "project" ? badge("tag", "shared: " + s.origin) : ""} <code class="small">${esc(s.slug)}</code></div>
    ${s.licence ? `<p class="warn small">${esc(s.licence)}</p>` : ""}
    ${s.settles ? `<h4>Settles</h4><p>${esc(s.settles)}</p>` : ""}
    ${s.supplies.length ? `<h4>Supplies</h4><ul>${s.supplies.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${s.target ? `<h4>Read by</h4><p class="small">${esc(s.target)}</p>` : ""}
    <h4>Claims citing it (${cited.length})</h4>
    ${cited.length ? `<table class="items">${cited.map((c) => `<tr><td>${esc(c.body)}</td><td>${badge("tag", c.section)}</td><td class="small">${esc(c.claim)}</td><td>${c.checks.map((k) => `<span class="dot ${k.ok ? "ok" : "bad"}" title="${esc(k.kind + " " + k.note)}"></span>`).join("")}</td><td><a class="file" data-open="${esc(c.file)}">${esc(c.file.split("/").pop() ?? "")}:${c.line}</a></td></tr>`).join("")}</table>` : "<p class='muted small'>No ledger paragraph names this author and year. Basin's ledgers cite gate checks; the papers are named in ADRs, baker code and the bibliography, listed below.</p>"}
    <h4>Named in (${s.cited_in.length})</h4>
    ${s.cited_in.length ? `<ul class="small">${s.cited_in.map((f) => `<li><a class="file" data-open="${esc(f)}">${esc(f)}</a></li>`).join("")}</ul>` : "<p class='warn small'>No doc or tool names this source. Either it is read under another name, or nothing rests on it yet.</p>"}
    <h4>Items that read it (${items.length})</h4>
    ${items.length ? `<ul class="tree">${items.map((i) => `<li class="leaf" data-item="${esc(i!.id)}"><span class="id">${esc(i!.id)}</span> ${esc(i!.title)}</li>`).join("")}</ul>` : "<p class='muted small'>none by name</p>"}
    ${Object.keys(s.extra).length ? `<h4>More</h4><pre class="small">${esc(JSON.stringify(s.extra, null, 2))}</pre>` : ""}
  </aside>`;
}

export type { LibCandidate, LibClaim, LibSource };
