// Preview mode: the page without its host. In a plain browser (or a design tool's preview such
// as v0) there is no Tauri bridge, so the desk renders a snapshot -- public/snapshot.json, written
// by `desk-snapshot` -- read-only. Every write or run says so instead of throwing "undefined".
import type { LibHit, Workspace } from "./api";

export const HAS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let snapshot: Promise<Workspace> | null = null;

function load(): Promise<Workspace> {
  if (!snapshot) {
    snapshot = fetch("snapshot.json").then(async (r) => {
      if (!r.ok) throw new Error(`PREVIEW: no snapshot.json (${r.status}). Run desk-snapshot to write one.`);
      return (await r.json()) as Workspace;
    });
  }
  return snapshot;
}

export const READ_ONLY = "Preview mode: this is a snapshot without the desk's host. Nothing can be run or saved here; open the desk itself for that.";

export async function previewInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const ws = await load();
  switch (cmd) {
    case "load_workspace": return ws as unknown as T;
    case "startup_view": return "" as unknown as T;
    case "commands": return ws.commands as unknown as T;
    case "tree_stamp": return (ws as unknown as { stamp?: string }).stamp as unknown as T;
    case "projects_recent": case "media_inbox": case "commits_for": return [] as unknown as T;
    case "projects_home": return null as unknown as T;
    case "read_text": return `*(preview: ${String(args?.rel ?? "")} is not in the snapshot)*` as unknown as T;
    case "read_log": return "" as unknown as T;
    case "library_search": {
      const q = String(args?.query ?? "").toLowerCase();
      const hits: LibHit[] = [];
      for (const s of ws.library.sources) {
        const meta = `${s.title} | ${s.authors.join(", ")} | ${s.settles} | ${s.supplies.join(" / ")}`;
        if (q.length > 1 && meta.toLowerCase().includes(q)) hits.push({ slug: s.slug, title: s.title, where_: "metadata (preview: no text cache)", snippet: meta.slice(0, 220) });
      }
      return hits as unknown as T;
    }
    default: throw new Error(READ_ONLY);
  }
}
