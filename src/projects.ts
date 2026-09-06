// Projects: the screen the desk opens on when it has no project, and the place to switch or
// create one. The only thing the desk keeps for itself is the list of folders it has opened.
import type { KnownProject } from "./api";
import { esc } from "./util";

export interface ProjectsState {
  known: KnownProject[];
  home: string | null;
  creating: { parent: string; folder: string; name: string } | null;
  busy: string;
  error: string;
}

export function projects(st: ProjectsState, current: string | null): string {
  const c = st.creating;
  return `
  <div class="projects">
    <h1>Projects</h1>
    <p class="muted">A project is any folder with a <code>desk.json</code>. Open one, or create one: the Desk writes <code>desk.json</code>, <code>docs/tracker</code>, <code>docs/media</code>, <code>.mcp.json</code> and a <code>desk.cmd</code>, then opens it.${st.home ? ` Desk home: <code>${esc(st.home)}</code>.` : " <span class='warn'>Desk home not found: set DESK_HOME to the Desk folder to enable Create.</span>"}</p>
    ${st.error ? `<p class="warn">${esc(st.error)}</p>` : ""}
    <div class="toolbar">
      <button class="primary" data-action="proj-new"${st.home ? "" : " disabled"}>+ New project…</button>
      <button data-action="proj-pick">Open folder…</button>
      ${st.busy ? `<span class="muted"><span class="spin"></span> ${esc(st.busy)}</span>` : ""}
    </div>
    ${c ? `<form id="proj-form" class="card item-form">
      <h2>New project</h2>
      <div class="grid2">
        <label>Name <input name="name" value="${esc(c.name)}" placeholder="the game's name" required></label>
        <label>Folder name <input name="folder" value="${esc(c.folder)}" placeholder="a plain folder name" required></label>
      </div>
      <label>Parent folder <span class="muted small">where the project folder is created</span>
        <div class="grid2"><input name="parent" value="${esc(c.parent)}" placeholder="H:\\games" required><button type="button" data-action="proj-parent">Choose…</button></div>
      </label>
      <div class="toolbar"><button type="submit" class="primary">Create and open</button><button type="button" data-action="proj-cancel">Cancel</button></div>
    </form>` : ""}
    <h2>Known projects</h2>
    <table class="items">
      ${st.known.map((k) => `<tr class="${current && k.path.toLowerCase() === current.toLowerCase() ? "sel" : ""}">
        <td><b>${esc(k.name)}</b>${current && k.path.toLowerCase() === current.toLowerCase() ? " <span class='muted small'>open now</span>" : ""}</td>
        <td><code>${esc(k.path)}</code>${k.exists ? "" : " <span class='warn small'>missing</span>"}</td>
        <td class="muted small">${esc(k.last_opened)}</td>
        <td>${k.exists ? `<button data-action="proj-open" data-path="${esc(k.path)}">Open</button>` : ""} <button class="small" data-action="proj-forget" data-path="${esc(k.path)}">forget</button></td>
      </tr>`).join("") || "<tr><td class='muted'>none yet</td></tr>"}
    </table>
    <p class="muted small">Opening a project starts a new desk window on it and closes this one. From a terminal: <code>DESK_ROOT=&lt;folder&gt; desk.exe</code>, or <code>desk.cmd</code> inside the project.</p>
  </div>`;
}
