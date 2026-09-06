// Typed wrappers over the Rust commands. Shapes mirror src-tauri/src/{items,workspace,runner}.rs.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface Item {
  id: string;
  title: string;
  kind: string;
  status: string;
  phase: string;
  priority: string;
  severity: string;
  parent: string;
  sheet: string;
  files: string[];
  tests: string[];
  adrs: string[];
  commits: string[];
  tags: string[];
  done_when: string;
  created: string;
  updated: string;
  closed: string;
  body: string;
}

export interface Phase {
  id: string;
  name: string;
  gate: string;
  status: string;
  started: string;
  signed: string;
  trap: string;
}

export interface Adr { number: string; title: string; status: string; date: string; phase: string; path: string }
export interface Commit { hash: string; date: string; subject: string }
export interface SheetRow { id: string; do_: string; expect: string; log: string; automated: boolean }
export interface Sheet { id: string; title: string; fault: string; rows: SheetRow[] }
export interface RunRecord { id: string; name: string; started: string; finished: string; exit_code: number; commit: string; summary: string[]; log_path: string; tests_passed: number; tests_total: number }
export interface MediaRecord { id: string; file: string; phase: string; item: string; run: string; kind: string; caption: string; date: string; tags: string[]; bytes: number }
export interface InboxFile { path: string; name: string; bytes: number; modified: string; source: string }
export interface Step { type: string; name?: string; filter?: string; switch?: string; sheets?: string[]; note?: string }
export interface Suite { id: string; name: string; description: string; cadence: string; steps: Step[] }
export interface StepResult { step: Step; status: string; run_id: string; exit_code: number; summary: string[]; tests_passed: number; tests_total: number }
export interface SuiteRun { id: string; kind: "suite"; suite: string; suite_name: string; date: string; started: string; finished: string; commit: string; steps: StepResult[]; status: string; results: Record<string, string>; gate: Record<string, boolean>; notes: string; tester: string; build: string }
export interface TestInfo { name: string; system: string; file: string; last_result: string; last_seen: string }
export interface Recipe { id: string; name: string; inputs: Record<string, number>; output: string; count: number; station: string; note: string }
export interface Projection { recipe: string; place: string; reachable: boolean; gather_seconds: number | null; breakdown: string[]; hunger_minutes_forgone: number; value: Record<string, unknown>; flags: string[]; summary: string }
export interface DesignPlace { name: string; rock: string; temperature_k: number; biomass: number; water_depth_m: number; lat_deg: number | null; lon_deg: number | null; warmth_per_s: number; oxygen_per_s: number; warmth_bar_minutes: number | null; forage_per_gather: number; harvest_c0: number; projections: Projection[] }
export interface DesignReport { bake: string; recipes: Recipe[]; places: DesignPlace[]; resources?: string[]; stations?: string[] }
export interface SessionClosure { item: string; class: string; run_id: string; commit: string; note: string; at: string }
export interface SessionRecord { id: string; agent: string; purpose: string; compartment: string; started: string; ended: string; summary: string; commit_at_start: string; items_touched: string[]; items_created: string[]; runs: string[]; media: string[]; closures: SessionClosure[]; left_for_user: string[] }
export interface CodeArea { label: string; files: number; lines: number }
export interface CodeStats { areas: CodeArea[]; automation_tests: number; items_files_missing: string[] }
export interface DeskConfig { project?: string; docs?: { sheets?: string; roadmap?: string; guide?: string }; playtest_gate?: [string, string][]; builds?: string[]; design?: { recipes: string; push_suite?: string } }
export interface CommandSpec { name: string; label: string; description: string; group: string; program: string; args: string[]; minutes: number }

export interface QaRun {
  id?: string;
  kind: "sheets" | "playtest";
  date: string;
  commit: string;
  build: string;
  tester: string;
  results: Record<string, string>;
  gate?: Record<string, boolean>;
  minutes?: number;
  notes: string;
}

export interface Workspace {
  root: string;
  items: Item[];
  phases: { loop: string; cut_list: string[]; phases: Phase[] };
  adrs: Adr[];
  commits: Commit[];
  dirty: string[];
  head: string;
  branch: string;
  sheets: Sheet[];
  qa_runs: (QaRun | SuiteRun)[];
  runs: RunRecord[];
  media: MediaRecord[];
  inbox: InboxFile[];
  suites: Suite[];
  tests: TestInfo[];
  recipes: Recipe[];
  stamp: string;
  sessions: SessionRecord[];
  config: DeskConfig;
  commands: CommandSpec[];
  stats: CodeStats;
  roadmap_phase_line: string;
  problems: string[];
}

export const KINDS = ["epic", "task", "bug", "defect", "question", "chore", "reference"];
export const STATUSES = ["now", "next", "later", "yours", "watch", "parked", "done"];
export const PRIORITIES = ["P0", "P1", "P2", "P3"];
export const SEVERITIES = ["", "S1", "S2", "S3"];

export const STATUS_HELP: Record<string, string> = {
  now: "in progress",
  next: "agreed, not started",
  later: "real, not scheduled",
  yours: "needs you, not the machine",
  watch: "unexplained, instrumented",
  parked: "deliberately not doing",
  done: "verified, evidence attached",
};

export interface KnownProject { path: string; name: string; last_opened: string; exists: boolean }

export const api = {
  load: () => invoke<Workspace>("load_workspace"),
  projectsRecent: () => invoke<KnownProject[]>("projects_recent"),
  projectsForget: (path: string) => invoke<void>("projects_forget", { path }),
  projectsHome: () => invoke<string | null>("projects_home"),
  projectsPickFolder: () => invoke<string | null>("projects_pick_folder"),
  projectsCreate: (parent: string, folder: string, name: string) => invoke<string>("projects_create", { parent, folder, name }),
  projectsOpen: (path: string) => invoke<void>("projects_open", { path }),
  saveItem: (item: Item) => invoke<Item>("save_item", { item }),
  nextId: (prefix: string) => invoke<string>("next_id", { prefix }),
  readText: (rel: string) => invoke<string>("read_text", { rel }),
  saveQaRun: (run: QaRun) => invoke<string>("save_qa_run", { run }),
  commitsFor: (paths: string[]) => invoke<Commit[]>("commits_for", { paths }),
  commands: () => invoke<CommandSpec[]>("commands"),
  run: (name: string) => invoke<string>("run_command", { name }),
  cancel: (runId: string) => invoke<boolean>("cancel_run", { runId }),
  readLog: (path: string) => invoke<string>("read_log", { path }),
  open: (rel: string, line?: number) => invoke<void>("open_path", { rel, line: line ?? null }),
  renderBacklog: () => invoke<string>("render_backlog"),
  mediaInbox: () => invoke<InboxFile[]>("media_inbox"),
  fileMedia: (source: string, record: MediaRecord) => invoke<MediaRecord>("file_media", { source, record }),
  updateMedia: (record: MediaRecord) => invoke<MediaRecord>("update_media", { record }),
  removeMedia: (id: string, deleteFile: boolean) => invoke<void>("remove_media", { id, deleteFile }),
  pickFiles: () => invoke<string[]>("pick_files"),
  runSuite: (suite: string, tester: string, build: string) => invoke<string>("run_suite", { suite, tester, build }),
  completeSuiteStep: (suiteRunId: string, stepIndex: number, payload: unknown) => invoke<SuiteRun>("complete_suite_step", { suiteRunId, stepIndex, payload }),
  suiteRun: (id: string) => invoke<SuiteRun>("suite_run", { id }),
  designReport: (draft: string | null, places: [number, number][]) => invoke<DesignReport>("design_report", { draft, places }),
  saveRecipes: (recipes: Recipe[]) => invoke<string[]>("save_recipes", { recipes }),
  checkRecipes: () => invoke<string[]>("check_recipes"),
  treeStamp: () => invoke<string>("tree_stamp"),
  onSuite: (cb: (e: { suite_run_id: string; run: SuiteRun }) => void): Promise<UnlistenFn> =>
    listen<{ suite_run_id: string; run: SuiteRun }>("suite-step", (ev) => cb(ev.payload)),
  onSuiteDone: (cb: (e: { suite_run_id: string; run: SuiteRun }) => void): Promise<UnlistenFn> =>
    listen<{ suite_run_id: string; run: SuiteRun }>("suite-done", (ev) => cb(ev.payload)),
  onLine: (cb: (e: { run_id: string; line: string }) => void): Promise<UnlistenFn> =>
    listen<{ run_id: string; line: string }>("run-line", (ev) => cb(ev.payload)),
  onDone: (cb: (e: { run_id: string; record: RunRecord }) => void): Promise<UnlistenFn> =>
    listen<{ run_id: string; record: RunRecord }>("run-done", (ev) => cb(ev.payload)),
};

export function blankItem(phase = "3"): Item {
  return {
    id: "", title: "", kind: "task", status: "later", phase, priority: "P2", severity: "", parent: "",
    sheet: "", files: [], tests: [], adrs: [], commits: [], tags: [], done_when: "", created: "", updated: "",
    closed: "", body: "",
  };
}

/** URL a <img>/<video> can load for a repo-relative or absolute path. */
export function mediaUrl(root: string, file: string): string {
  const isAbsolute = /^[A-Za-z]:[\\/]/.test(file);
  const abs = isAbsolute ? file : root + "\\" + file.split("/").join("\\");
  return convertFileSrc(abs);
}

export function blankMedia(phase: string): MediaRecord {
  return { id: "", file: "", phase, item: "", run: "", kind: "", caption: "", date: "", tags: [], bytes: 0 };
}
