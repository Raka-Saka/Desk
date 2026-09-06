r"""The tracker: one file per work item, and the backlog rendered from them.

    python tracker.py init --project "Name"   # give a project a desk: desk.json, docs/tracker, docs/media
    python tracker.py render                  # regenerate docs/backlog.md from docs/tracker/items
    python tracker.py check                   # exit 1 if items are malformed or backlog.md is stale
    python tracker.py list                    # print every item, one line each
    python tracker.py new --id 3.19 --title "..." --kind task --status next --phase 3 --priority P1

This is the Desk's tracker (github.com/Raka-Saka/Desk). The project root is the folder holding
`desk.json`; DESK_ROOT or BASIN_ROOT override the search, which otherwise walks up from the
working directory and then from this file.

Why this exists: a hand-written backlog grows into a set of prose tables in which a finished item
carries its whole evidence paragraph, and the list stops being a queue. Items live in
`docs/tracker/items/<id>.md` -- a frontmatter block a machine reads and a markdown body a person
writes -- and `backlog.md` is RENDERED from them. Two homes for the same fact, and a check that
they agree.

The desk app reads and writes the same files. It calls this script to render and to check, so
there is exactly one renderer.

Frontmatter subset, read identically by this file and by the desk's `src-tauri/src/frontmatter.rs`:

    key: raw token            -> string, as written (ids, dates, enums)
    key: "json string"        -> string, JSON-decoded (anything with punctuation)
    key: ["a", "b"]           -> list of strings, JSON-decoded
    key:                      -> empty string

Nothing else. No nesting, no multi-line values. The body after the closing `---` is markdown.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass, field, asdict
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATES = HERE / "templates"
MARKER = "desk.json"


def find_root() -> Path:
    for var in ("DESK_ROOT", "BASIN_ROOT"):
        v = os.environ.get(var)
        if v and (Path(v) / MARKER).exists():
            return Path(v).resolve()
    for start in (Path.cwd(), HERE):
        for p in [start, *start.parents]:
            if (p / MARKER).exists():
                return p
    # Not yet initialised: assume the working directory, so `init` can create the marker there.
    return Path.cwd().resolve()


PROJECT = find_root()
TRACKER = PROJECT / "docs" / "tracker"
ITEMS = TRACKER / "items"
PHASES = TRACKER / "phases.json"
BACKLOG = PROJECT / "docs" / "backlog.md"

KINDS = ("epic", "task", "bug", "defect", "question", "chore", "reference")
STATUSES = ("now", "next", "later", "yours", "watch", "parked", "done")
PRIORITIES = ("P0", "P1", "P2", "P3")
SEVERITIES = ("", "S1", "S2", "S3")

STATUS_LABEL = {
    "now": "NOW", "next": "NEXT", "later": "LATER", "yours": "YOURS",
    "watch": "WATCH", "parked": "PARKED", "done": "DONE",
}

LIST_FIELDS = ("files", "tests", "adrs", "commits", "tags")
SCALAR_FIELDS = ("id", "title", "kind", "status", "phase", "priority", "severity", "parent",
                 "sheet", "done_when", "created", "updated", "closed")
ORDER = ("id", "title", "kind", "status", "phase", "priority", "severity", "parent", "sheet",
         "files", "tests", "adrs", "commits", "tags", "done_when", "created", "updated", "closed")


@dataclass
class Item:
    id: str
    title: str
    kind: str = "task"
    status: str = "later"
    phase: str = "1"
    priority: str = "P2"
    severity: str = ""
    parent: str = ""
    sheet: str = ""
    files: list[str] = field(default_factory=list)
    tests: list[str] = field(default_factory=list)
    adrs: list[str] = field(default_factory=list)
    commits: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    done_when: str = ""
    created: str = ""
    updated: str = ""
    closed: str = ""
    body: str = ""

    @property
    def path(self) -> Path:
        return ITEMS / f"{self.id}.md"


# --- frontmatter ---------------------------------------------------------------------------

_SIMPLE = re.compile(r"^[A-Za-z0-9_.\-]+$")


def _encode(value) -> str:
    if isinstance(value, list):
        # Same separators as serde_json, so the Rust writer produces identical bytes.
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    value = "" if value is None else str(value)
    if value == "":
        return ""
    if _SIMPLE.match(value):
        return value
    return json.dumps(value, ensure_ascii=False)


def _decode(raw: str):
    raw = raw.strip()
    if raw == "":
        return ""
    if raw[0] in '["':
        return json.loads(raw)
    return raw


def parse(text: str) -> tuple[dict, str]:
    """Split a file into (frontmatter dict, body). Raises ValueError on a malformed block."""
    if not text.startswith("---"):
        raise ValueError("no frontmatter: file must start with ---")
    lines = text.split("\n")
    fm: dict = {}
    i = 1
    while i < len(lines):
        line = lines[i]
        if line.strip() == "---":
            break
        if line.strip() == "" or line.lstrip().startswith("#"):
            i += 1
            continue
        if ":" not in line:
            raise ValueError(f"line {i + 1}: expected key: value, got {line!r}")
        key, _, raw = line.partition(":")
        fm[key.strip()] = _decode(raw)
        i += 1
    else:
        raise ValueError("frontmatter never closed with ---")
    body = "\n".join(lines[i + 1:])
    return fm, body.lstrip("\n")


def render_item(item: Item) -> str:
    data = asdict(item)
    out = ["---"]
    for key in ORDER:
        out.append(f"{key}: {_encode(data[key])}")
    out.append("---")
    body = item.body.rstrip("\n")
    return "\n".join(out) + "\n" + (body + "\n" if body else "")


def load_item(path: Path) -> Item:
    fm, body = parse(path.read_text(encoding="utf-8"))
    kwargs = {}
    for key in SCALAR_FIELDS:
        v = fm.get(key, "")
        if not isinstance(v, str):
            raise ValueError(f"{path.name}: {key} must be a string")
        kwargs[key] = v
    for key in LIST_FIELDS:
        v = fm.get(key, [])
        if isinstance(v, str):
            v = [v] if v else []
        if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
            raise ValueError(f"{path.name}: {key} must be a list of strings")
        kwargs[key] = v
    item = Item(body=body, **kwargs)
    if item.id != path.stem:
        raise ValueError(f"{path.name}: id {item.id!r} does not match file name")
    return item


def save_item(item: Item) -> Path:
    ITEMS.mkdir(parents=True, exist_ok=True)
    # LF on every platform: the Rust side writes LF, and a CRLF/LF difference would make every
    # touch from the other side a whole-file diff.
    item.path.write_text(render_item(item), encoding="utf-8", newline="\n")
    return item.path


def load_all() -> list[Item]:
    items = [load_item(p) for p in sorted(ITEMS.glob("*.md"))]
    return sorted(items, key=sort_key)


def _id_parts(id_: str):
    parts = id_.split(".")
    key = []
    for p in parts:
        key.append((0, int(p)) if p.isdigit() else (1, p))
    return key


def sort_key(item: Item):
    return _id_parts(item.id)


def load_phases() -> dict:
    return json.loads(PHASES.read_text(encoding="utf-8"))


# --- validation ------------------------------------------------------------------------------

def validate(items: list[Item], phases: dict) -> list[str]:
    problems = []
    ids = {i.id for i in items}
    phase_ids = {p["id"] for p in phases["phases"]}
    for it in items:
        where = f"items/{it.id}.md"
        if not it.title.strip():
            problems.append(f"{where}: empty title")
        if it.kind not in KINDS:
            problems.append(f"{where}: kind {it.kind!r} not in {KINDS}")
        if it.status not in STATUSES:
            problems.append(f"{where}: status {it.status!r} not in {STATUSES}")
        if it.priority not in PRIORITIES:
            problems.append(f"{where}: priority {it.priority!r} not in {PRIORITIES}")
        if it.severity not in SEVERITIES:
            problems.append(f"{where}: severity {it.severity!r} not in {SEVERITIES}")
        if it.phase not in phase_ids:
            problems.append(f"{where}: phase {it.phase!r} not in phases.json")
        if it.parent and it.parent not in ids:
            problems.append(f"{where}: parent {it.parent!r} is not an item")
        if it.kind in ("bug", "defect") and not it.severity:
            problems.append(f"{where}: a {it.kind} needs a severity")
        if it.status in ("now", "next") and not it.done_when.strip():
            problems.append(f"{where}: status {it.status} with no done_when -- write the condition first")
        if it.status == "done" and not it.closed:
            problems.append(f"{where}: done but no closed date")
        # An open item may name the files it WILL create; a done item's files are its evidence.
        if it.status == "done":
            for f in it.files:
                if not (PROJECT / f).exists():
                    problems.append(f"{where}: file {f} does not exist")
        for d in (it.created, it.updated, it.closed):
            if d and not re.match(r"^\d{4}-\d{2}-\d{2}$", d):
                problems.append(f"{where}: bad date {d!r}")
    return problems


# --- backlog rendering ------------------------------------------------------------------------

def _md_escape_cell(s: str) -> str:
    return s.replace("|", "\\|").replace("\n", " ")


def render_backlog(items: list[Item], phases: dict) -> str:
    out = []
    out.append("# Backlog")
    out.append("")
    out.append("<!-- GENERATED by the Desk's tracker (tracker.py render). Do not edit: edit docs/tracker/items/<id>.md")
    out.append("     (or use the desk) and re-run the render. The project's check fails if this file is stale. -->")
    out.append("")
    out.append("The layer between the roadmap (phases and their gates) and the decisions (ADRs).")
    out.append("One ordered list. Nothing gets lost. Each row is `docs/tracker/items/<id>.md`; the body of")
    out.append("that file carries the evidence and the reasoning.")
    out.append("")
    out.append("Status: `NOW` in progress · `NEXT` agreed, not started · `LATER` real but not scheduled ·")
    out.append("`YOURS` needs the user, not the machine · `WATCH` unexplained, instrumented · `PARKED`")
    out.append("deliberately not doing, with a reason · `DONE` verified, evidence in the item.")
    out.append("Priority: `P0` blocks the phase gate · `P1` this phase · `P2` later · `P3` someday.")
    out.append("")
    open_items = [i for i in items if i.status != "done"]
    out.append("## Do next")
    out.append("")
    out.append("Open items the machine can do, by priority; epics are not listed, their children are. `YOURS`")
    out.append("items are listed under their phase.")
    out.append("")
    queue = sorted((i for i in open_items if i.status in ("now", "next", "later") and i.kind != "epic"),
                   key=lambda i: (i.priority, {"now": 0, "next": 1, "later": 2}[i.status], sort_key(i)))
    if queue:
        out.append("| # | P | Status | Item | Done when |")
        out.append("|---|---|---|---|---|")
        for i in queue[:12]:
            out.append(f"| {i.id} | {i.priority} | {STATUS_LABEL[i.status]} | **{_md_escape_cell(i.title)}** | {_md_escape_cell(i.done_when)} |")
    else:
        out.append("_Nothing queued._")
    out.append("")
    yours = [i for i in open_items if i.status == "yours"]
    out.append("## Needs your eyes")
    out.append("")
    if yours:
        for i in yours:
            out.append(f"- **{i.id}** {i.title} — {i.done_when}")
    else:
        out.append("_Nothing waiting on you._")
    out.append("")
    for ph in phases["phases"]:
        rows = [i for i in items if i.phase == ph["id"]]
        if not rows:
            continue
        done = sum(1 for i in rows if i.status == "done")
        out.append(f"## {ph['name']}  ·  {done}/{len(rows)} done  ·  {ph['status']}")
        out.append("")
        out.append(f"Gate: *{ph['gate']}*")
        out.append("")
        out.append("| # | Kind | P | Item | Status | Done when |")
        out.append("|---|---|---|---|---|---|")
        for i in rows:
            title = f"~~**{_md_escape_cell(i.title)}**~~" if i.status == "done" else f"**{_md_escape_cell(i.title)}**"
            sev = f" {i.severity}" if i.severity else ""
            out.append(f"| {i.id} | {i.kind}{sev} | {i.priority} | {title} | {STATUS_LABEL[i.status]} | {_md_escape_cell(i.done_when)} |")
        out.append("")
    return "\n".join(out).rstrip("\n") + "\n"


# --- commands ---------------------------------------------------------------------------------

def cmd_render(_args) -> int:
    items, phases = load_all(), load_phases()
    problems = validate(items, phases)
    for p in problems:
        print("  problem:", p)
    BACKLOG.parent.mkdir(parents=True, exist_ok=True)
    BACKLOG.write_text(render_backlog(items, phases), encoding="utf-8", newline="\n")
    print(f"rendered {BACKLOG.relative_to(PROJECT)} from {len(items)} items"
          + (f", {len(problems)} problems" if problems else ""))
    return 1 if problems else 0


def cmd_check(_args) -> int:
    try:
        items, phases = load_all(), load_phases()
    except Exception as e:  # malformed file: say which
        print(f"[tracker] FAIL: {e}")
        return 1
    problems = validate(items, phases)
    expected = render_backlog(items, phases)
    actual = BACKLOG.read_text(encoding="utf-8") if BACKLOG.exists() else ""
    if actual != expected:
        problems.append("docs/backlog.md is stale -- run: tracker.py render")
    for p in problems:
        print("  problem:", p)
    n_open = sum(1 for i in items if i.status != "done")
    print(f"[tracker] {'FAIL' if problems else 'OK'}: {len(items)} items, {n_open} open, {len(problems)} problems")
    return 1 if problems else 0


def cmd_list(_args) -> int:
    for i in load_all():
        print(f"{i.id:>6}  {STATUS_LABEL[i.status]:<6} {i.priority} {i.kind:<9} {i.title}")
    return 0


def cmd_new(args) -> int:
    today = date.today().isoformat()
    item = Item(id=args.id, title=args.title, kind=args.kind, status=args.status, phase=args.phase,
                priority=args.priority, done_when=args.done_when or "", created=today, updated=today,
                body=args.body or "")
    if item.path.exists():
        print(f"refusing: {item.path} exists")
        return 1
    save_item(item)
    print(f"wrote {item.path.relative_to(PROJECT)}")
    return cmd_render(args)


def cmd_init(args) -> int:
    """Give a project a desk: desk.json, docs/tracker (phases, guide, suites), docs/media."""
    root = Path(args.dir).resolve() if args.dir else Path.cwd().resolve()
    marker = root / MARKER
    if marker.exists() and not args.force:
        print(f"{marker} exists; nothing done (use --force to overwrite the config only)")
        return 1
    project = args.project or root.name
    written = []

    def put(rel: str, text: str, overwrite: bool = False) -> None:
        p = root / rel
        if p.exists() and not overwrite:
            return
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8", newline="\n")
        written.append(rel)

    cfg = json.loads((TEMPLATES / "desk.json").read_text(encoding="utf-8"))
    cfg["project"] = project
    cfg["tracker"] = args.tracker or os.path.relpath(HERE / "tracker.py", root).replace("\\", "/")
    put(MARKER, json.dumps(cfg, indent=2) + "\n", overwrite=args.force)
    phases = json.loads((TEMPLATES / "phases.json").read_text(encoding="utf-8"))
    phases["phases"][0]["started"] = date.today().isoformat()
    put("docs/tracker/phases.json", json.dumps(phases, indent=2) + "\n")
    put("docs/tracker/GUIDE.md", (TEMPLATES / "GUIDE.md").read_text(encoding="utf-8").replace("{{project}}", project))
    put("docs/tracker/qa/suites.json", (TEMPLATES / "suites.json").read_text(encoding="utf-8"))
    put("docs/media/media.json", '{\n  "media": []\n}\n')
    for d in ("docs/tracker/items", "docs/tracker/qa/runs", "docs/tracker/runs", "docs/tracker/sessions", "docs/media"):
        (root / d).mkdir(parents=True, exist_ok=True)
    put(".mcp.json", (TEMPLATES / "mcp.json").read_text(encoding="utf-8"))
    put("desk.cmd", (TEMPLATES / "desk.cmd").read_text(encoding="utf-8").replace("{{desk}}", os.path.relpath(HERE.parent, root).replace("/", "\\")))
    # A first item, so the dashboard has a queue on day one.
    global PROJECT, TRACKER, ITEMS, PHASES, BACKLOG
    PROJECT, TRACKER = root, root / "docs" / "tracker"
    ITEMS, PHASES, BACKLOG = TRACKER / "items", TRACKER / "phases.json", root / "docs" / "backlog.md"
    if not any(ITEMS.glob("*.md")):
        save_item(Item(id="1.1", title="Write the one-line loop and the first gate", kind="task", status="next", phase="1",
                       priority="P0", done_when="phases.json names the first gate as a sentence a stranger could verify, and the roadmap (or this item) says what the loop is.",
                       created=date.today().isoformat(), updated=date.today().isoformat(), tags=["docs"],
                       body="The desk's first item, written by `tracker.py init`. Replace it with the real first step."))
        written.append("docs/tracker/items/1.1.md")
    cmd_render(args)
    for w in written:
        print("  wrote", w)
    print(f"{project} has a desk. Next: `desk.cmd` to open it, or register {root / '.mcp.json'} with Claude Code.")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("render").set_defaults(fn=cmd_render)
    sub.add_parser("check").set_defaults(fn=cmd_check)
    sub.add_parser("list").set_defaults(fn=cmd_list)
    n = sub.add_parser("new")
    n.add_argument("--id", required=True)
    n.add_argument("--title", required=True)
    n.add_argument("--kind", default="task", choices=KINDS)
    n.add_argument("--status", default="later", choices=STATUSES)
    n.add_argument("--phase", default="1")
    n.add_argument("--priority", default="P2", choices=PRIORITIES)
    n.add_argument("--done-when", dest="done_when", default="")
    n.add_argument("--body", default="")
    n.set_defaults(fn=cmd_new)
    i = sub.add_parser("init")
    i.add_argument("--project", default="")
    i.add_argument("--dir", default="")
    i.add_argument("--tracker", default="", help="repo-relative path to this script from the project (default: computed)")
    i.add_argument("--force", action="store_true")
    i.set_defaults(fn=cmd_init)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
