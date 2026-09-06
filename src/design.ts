// Design: edit a recipe, see what it costs and buys at real places on Home, push it to the game.
// The desk holds nothing here: the recipes are docs/design/recipes.json, the numbers come from
// Tools/design/sim.py, and "push" is the `recipes` QA suite (import, tests, scene check).
import type { DesignReport, Recipe, Workspace } from "./api";
import { badge, esc, option } from "./util";

export interface DesignState {
  draft: Recipe[] | null;       // edited copy of recipes.json, null = as on disk
  selected: string;             // recipe id
  report: DesignReport | null;
  loading: boolean;
  problems: string[] | null;    // system_map's verdict on the last save
  places: [number, number][];   // extra lat/lon places
  dirty: boolean;
}

// The project's own vocabulary comes with the report; these only fill a draft before the first report lands.
let RESOURCES: string[] = [];
let STATIONS: string[] = ["none"];
let RAW: string[] = [];   // resources a recipe may not output: the world's raw materials

export function recipesOf(ws: Workspace, st: DesignState): Recipe[] {
  return st.draft ?? ws.recipes;
}

export function design(ws: Workspace, st: DesignState): string {
  const rep = st.report as (DesignReport & { raw?: string[] }) | null;
  if (rep?.resources?.length) RESOURCES = rep.resources;
  if (rep?.stations?.length) STATIONS = rep.stations;
  if (rep?.raw) RAW = rep.raw;
  const recipes = recipesOf(ws, st);
  const sel = recipes.find((r) => r.id === st.selected) ?? recipes[0];
  return `
  <div class="toolbar">
    <span class="muted">Recipes are <code>${esc(ws.config.design?.recipes ?? "")}</code>. Edit here, read the projection, save, then push: the <b>${esc(ws.config.design?.push_suite ?? "recipes")}</b> suite takes them to the project.</span>
  </div>
  <div class="cols design">
    <section class="card">
      <h2>Recipes ${st.dirty ? badge("st-now", "unsaved") : ""}</h2>
      <ul class="recipe-list">
        ${recipes.map((r) => `<li class="${sel && r.id === sel.id ? "sel" : ""}" data-action="design-select" data-id="${esc(r.id)}"><span class="id">${esc(r.id)}</span> ${esc(r.name)} <span class="muted small">${Object.entries(r.inputs).map(([k, v]) => `${v} ${k}`).join(" + ")} → ${r.count} ${esc(r.output)}${r.station === "fire" ? " @ fire" : ""}</span></li>`).join("")}
      </ul>
      <div class="toolbar"><button data-action="design-add">+ New recipe</button></div>
      ${sel ? editor(sel) : ""}
      <div class="toolbar">
        <button class="primary" data-action="design-save"${st.dirty ? "" : " disabled"}>Save recipes.json</button>
        <button data-action="design-revert"${st.dirty ? "" : " disabled"}>Revert</button>
        <button data-action="suite-run" data-suite="${esc(ws.config.design?.push_suite ?? "recipes")}">▶ Push to the project</button>
      </div>
      ${st.problems ? (st.problems.length ? `<ul class="warn-list">${st.problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : `<p class="ok-text small">system_map: every input is something the world produces; no output is a rock.</p>`) : ""}
    </section>
    <section class="card">
      <h2>Projection ${st.loading ? "<span class='spin'></span>" : ""} <span class="muted">${st.report ? esc(st.report.bake.replace(/\\/g, "/").split("/").slice(-3).join("/")) : ""}</span></h2>
      <div class="toolbar">
        <label>Add a place <input data-design="lat" size="6" placeholder="lat"> <input data-design="lon" size="6" placeholder="lon"> <button data-action="design-place">sample</button></label>
        <span class="muted small">Places are decoded from the bake: the spawn, the best farmland, and any latitude and longitude you add. Numbers are the C++'s, mirrored and cross-checked.</span>
      </div>
      ${st.report ? st.report.places.map((p) => placeCard(p, sel?.id)).join("") : "<p class='muted'>No projection yet.</p>"}
    </section>
  </div>`;
}

function editor(r: Recipe): string {
  const rows = Object.entries(r.inputs);
  return `<form id="recipe-form" class="item-form" data-id="${esc(r.id)}">
    <div class="grid2">
      <label>Id <input name="id" value="${esc(r.id)}"></label>
      <label>Name <input name="name" value="${esc(r.name)}"></label>
    </div>
    <label>Inputs <span class="muted small">resource and count; blank a count to drop a row</span></label>
    <div class="ingredients">
      ${[...rows, ["", 0] as [string, number]].map(([res, n], i) => `<div class="grid2 ing">
        <select name="in_res_${i}"><option value="">—</option>${RESOURCES.map((x) => option(x, x, x === res)).join("")}</select>
        <input name="in_n_${i}" type="number" min="1" value="${n || ""}" placeholder="count">
      </div>`).join("")}
    </div>
    <div class="grid3">
      <label>Output <select name="output">${RESOURCES.filter((x) => !RAW.includes(x)).map((x) => option(x, x, x === r.output)).join("")}</select></label>
      <label>Count <input name="count" type="number" min="1" value="${r.count}"></label>
      <label>Station <select name="station">${STATIONS.map((x) => option(x, x === "none" ? "hands" : x, x === r.station)).join("")}</select></label>
    </div>
    <label>Note <span class="muted small">the designer's reason; shown in the asset, never gameplay</span><textarea name="note" rows="3">${esc(r.note)}</textarea></label>
    <div class="toolbar"><button type="submit">Apply to draft</button><button type="button" class="danger" data-action="design-delete" data-id="${esc(r.id)}">Delete recipe</button></div>
  </form>`;
}

function placeCard(p: DesignReport["places"][number], focus?: string): string {
  const drains = p.warmth_bar_minutes === null ? "warmth costs nothing here" : `warmth bar lasts ${p.warmth_bar_minutes.toFixed(0)} min`;
  return `<div class="place">
    <h3>${esc(p.name)} <span class="muted small">${esc(p.rock)} · ${p.temperature_k.toFixed(1)} K mean · ${p.biomass.toFixed(0)} gDM/m²/yr · water ${p.water_depth_m.toFixed(0)} m down${p.lat_deg !== null ? ` · lat ${p.lat_deg.toFixed(1)} lon ${p.lon_deg?.toFixed(1)}` : ""}</span></h3>
    <div class="muted small">${drains} · ${p.forage_per_gather} forage a gathering · a plot gives ${p.harvest_c0}</div>
    <table class="items proj">
      ${p.projections.map((q) => `<tr class="${q.recipe === focus ? "sel" : ""} ${q.reachable ? "" : "row-unreach"}">
        <td class="id">${esc(q.recipe)}</td>
        <td>${q.reachable ? `${q.gather_seconds!.toFixed(1)} s` : "<span class='bad-text'>unreachable</span>"}</td>
        <td class="small">${q.hunger_minutes_forgone ? `−${q.hunger_minutes_forgone.toFixed(1)} min hunger` : ""}</td>
        <td class="small">${valueText(q.value)}</td>
        <td>${q.flags.map((f) => badge(f === "unreachable_here" || f === "useless_here" ? "bug" : "tag", f.replace(/_/g, " "))).join("")}</td>
      </tr>
      <tr class="breakdown ${q.recipe === focus ? "" : "hidden-row"}"><td></td><td colspan="4" class="muted small">${q.breakdown.map(esc).join(" · ")}</td></tr>`).join("")}
    </table>
  </div>`;
}

function valueText(v: Record<string, unknown>): string {
  if ("net_fire_seconds" in v) return `+${Number(v.net_fire_seconds).toFixed(0)} s fire over raw · ${Number(v.warmth_minutes_bought).toFixed(1)} min warmth`;
  if ("rock_per_minute_with_pick" in v) return `${Number(v.rock_per_minute_bare).toFixed(0)} → ${Number(v.rock_per_minute_with_pick).toFixed(0)} rock/min · repays in ${v.swings_to_repay} swings`;
  if ("enables" in v) return `enables ${(v.enables as string[]).join(", ") || "nothing yet"}`;
  return esc(String(v.note ?? ""));
}
