# Linking a project to the Desk

The Desk never stores anything about a project inside itself. A project is linked by one file at
its root, `desk.json`, and by the folders the Desk reads and writes under `docs/`. Everything
below is what that file can say.

## Give a project a desk

    python <Desk>/tracker/tracker.py init --project "Name" --dir <project root>

Writes, and never overwrites what exists:

| File | What it is |
|---|---|
| `desk.json` | the adapter (below) and the root marker |
| `docs/tracker/phases.json` | the phases and their gates; exactly one is `open` |
| `docs/tracker/GUIDE.md` | the method, one page |
| `docs/tracker/qa/suites.json` | the QA suites the desk can run |
| `docs/tracker/items/1.1.md` | a first item, so the queue is not empty |
| `docs/media/media.json` | the media index |
| `.mcp.json` | registers the desk's MCP server for Claude Code |
| `desk.cmd` | launcher: `desk`, `desk build`, `desk shortcut`, `desk mcp` |

Then `desk.cmd` opens the desk (building it the first time), or the desk's own **Projects** screen
does the same from a folder picker. `--force` rewrites `desk.json` only.

## desk.json

`${root}` expands to the project folder. `${<KEY>}` expands to the environment variable `KEY`,
or to `env.KEY` below when the variable is unset. Relative paths are relative to the root.

```jsonc
{
  "project": "Name",                       // the brand in the window and the MCP server name
  "python": "python",                      // the interpreter the desk uses for the tracker
  "tracker": "Tools/desk/tracker/tracker.py", // path to the Desk's tracker (relative or absolute)
  "env": { "UE_ROOT": "H:\\UE_5.8" },     // fallbacks for ${...} expansion

  "docs": {
    "sheets": "docs/testing/manual-checks.md",  // manual QA sheets, see FORMATS.md; optional
    "roadmap": "docs/roadmap.md",               // its first "**Phase " line is shown; optional
    "guide": "docs/tracker/GUIDE.md"            // rendered in the Guide view
  },

  "code": [                                // what the Development view counts
    { "label": "C++", "dir": "Source", "ext": ["cpp", "h"], "skip": ["ThirdParty"] }
  ],

  "tests": {                               // the automation inventory (QA -> Tests)
    "dir": "Source/Basin/Tests",           // files scanned for "<prefix>..." test names
    "prefix": "Basin.",
    "logs": ["Saved/Logs/check_automation.log"],   // where last results are read from
    "result_pattern": "Test Completed. Result={"   // the line shape that carries a result
  },

  "media_sources": [                       // the media inbox: unfiled files come from here
    { "label": "game", "path": "Saved/Screenshots", "depth": 2 },
    { "label": "renders", "path": "Tools/out", "depth": 2, "prefix": "viewer_" }
  ],

  "playtest_gate": [                       // the boxes on the playtest form
    ["played", "They played it without help"]
  ],
  "builds": ["PIE", "packaged"],           // the Build dropdown on QA records

  "commands": [                            // what the desk can run and record
    { "name": "check", "label": "Check", "group": "checks", "minutes": 3,
      "description": "everything automated", "program": "python", "args": ["Tools/check.py"] }
  ],
  "filter_command": {                      // optional: `automation:<filter>` in suites and QA -> Tests
    "label": "tests · ${filter}", "group": "tests", "minutes": 3,
    "program": "${ue_root}/Engine/Binaries/Win64/UnrealEditor-Cmd.exe",
    "args": ["${root}/Game.uproject", "-ExecCmds=Automation RunTests ${filter};Quit", "-unattended", "-nullrhi"]
  },
  "shots": {                               // optional: `shot:<Switch>` runs the game to photograph itself
    "program": "${ue_root}/Engine/Binaries/Win64/UnrealEditor-Cmd.exe",
    "args": ["${root}/Game.uproject", "-game", "-windowed", "-${switch}"],
    "minutes": 2,
    "list": [["EyeShot", "Eye level at the spawn"]]
  },
  "design": {                              // optional: the Design view and desk_design_report
    "recipes": "docs/design/recipes.json",
    "report": ["python", "Tools/design/sim.py", "report", "--json"],   // must accept --recipes <file> and --place lat,lon
    "check": ["python", "Tools/science/system_map.py", "--check"],    // lines containing check_filter are the verdict
    "check_filter": "recipes:",
    "push_suite": "recipes"
  },
  "library": {                             // optional: the Library view and desk_library_* (see LIBRARY.md)
    "sources": "docs/science/sources.json",
    "papers": "docs/science/papers",
    "text": "docs/science/.textcache",
    "claims": "docs/claims.json",
    "contradictions": "docs/science/contradictions.md",
    "candidates": "docs/science/candidates.json",
    "fetch": ["python", "Tools/science/fetch_papers.py"],
    "render": ["python", "Tools/science/render_bibliography.py"],
    "shared": []                           // other shelves: folders with sources.json, papers/, text/
  },
  "view": {                                // optional: the Viewfinder (see VIEW.md)
    "program": "${ue_root}/Engine/Binaries/Win64/UnrealEditor-Cmd.exe",
    "args": ["${root}/Basin.uproject", "-game", "-windowed", "-EnablePlugins=RemoteControl", "-RCWebControlEnable", "..."],
    "port": 30010,
    "view_command": "Basin.ViewAt {lat} {lon} {yaw} {pitch} {height} {hour}",
    "shoot_command": "HighResShot {w}x{h}",
    "screenshots": "Saved/Screenshots",
    "frames": "docs/media/frames.json",
    "bake": "Tools/baker/out/Home/1",
    "face_map": "T_Home_H_{face}.png"
  }
}
```

Command groups the desk understands: `checks`, `tests`, `build`, `tools`, `shots`. The QA view
lists `checks` and `tests`; the Media view lists `shots`. `name` is what suites and the MCP tool
`desk_run_command` refer to.

## What the desk expects of the project

- **A git repository.** Commits, the working tree and the head commit are read with `git`.
- **`docs/tracker/items/*.md`** in the item format (FORMATS.md). The tracker renders
  `docs/backlog.md` from them; the project's own check should run `tracker.py check` so a stale
  backlog fails somewhere.
- **Nothing else.** Every other feature is optional and switches on when its block exists.

## Two projects, one desk

Each project has its own `desk.json`, `docs/tracker` and `docs/media`. The Desk's **Projects**
screen remembers the folders it has opened (`%APPDATA%\Desk\projects.json`, the only file the
Desk keeps for itself) and can create a new project by running `init` for you. `DESK_ROOT` opens
a specific project from the command line.
