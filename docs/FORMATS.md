# File formats

Everything the Desk reads and writes is a text file in the project. These are the shapes.

## Items — `docs/tracker/items/<id>.md`

A frontmatter block a machine reads, then a markdown body a person writes. The Rust writer and
`tracker/tracker.py` produce byte-identical files (LF line endings, this key order).

```
---
id: 3.16
title: "The ground does not build fast enough to arrive somewhere."
kind: bug
status: done
phase: 3
priority: P0
severity: S1
parent: E.7
sheet: MC-1
files: ["Source/Basin/Planet/BasinPlanet.cpp"]
tests: ["Basin.Gate.Walk"]
adrs: []
commits: ["a4353cf"]
tags: ["logic"]
done_when: "A character placed anywhere stands on ground that is already there."
created: 2026-09-04
updated: 2026-09-06
closed: 2026-09-06
---
Why it exists, the evidence when done, the log line for a bug. Markdown.
```

The frontmatter subset: `key: token` (a plain string), `key: "json string"`, `key: ["a", "b"]`
(a JSON list of strings), `key:` (empty). Nothing else; no nesting; no multi-line values.

| field | values |
|---|---|
| `kind` | `epic` `task` `bug` `defect` `question` `chore` `reference` |
| `status` | `now` `next` `later` `yours` `watch` `parked` `done` |
| `priority` | `P0` blocks the gate · `P1` this phase · `P2` later · `P3` someday |
| `severity` | `S1` `S2` `S3`, required for `bug` and `defect` |
| `phase` | an id from `phases.json` |
| `parent` | an epic's id |
| `sheet` | the manual sheet that found it, e.g. `MC-1` |
| `files` | repo-relative; must exist once the item is `done` |
| `tags` | compartments and anything else |
| `done_when` | required for `now` and `next`: a condition someone can check |

Ids: `<phase>.<n>` for phase items, `C.<n>` carried, `E.<n>` epics, `T.<n>` tooling. Never reused.

## Phases — `docs/tracker/phases.json`

```json
{
  "loop": "one line every feature must serve",
  "cut_list": ["first to cut", "second"],
  "phases": [
    { "id": "1", "name": "Phase 1 — ...", "gate": "a sentence a stranger could verify",
      "status": "open", "started": "2026-09-05", "signed": "", "trap": "" }
  ]
}
```

`status` is `done`, `open`, `not-open` or `rolling`. Exactly one phase is `open`.

## Backlog — `docs/backlog.md`

Rendered by `tracker.py render` from the items: the queue by priority, what needs the user's
eyes, then every phase's table. Never edited by hand; `tracker.py check` fails when it is stale.

## Suites — `docs/tracker/qa/suites.json`

```json
{ "suites": [ { "id": "smoke", "name": "Smoke", "description": "", "cadence": "every session",
  "steps": [
    { "type": "command", "name": "tracker-check" },
    { "type": "automation", "filter": "Basin.Survival" },
    { "type": "shot", "switch": "BasinEyeShot" },
    { "type": "sheets", "sheets": ["MC-1", "MC-2"], "note": "" },
    { "type": "playtest" }
  ] } ] }
```

`command` names a `desk.json` command; `automation` needs `filter_command`; `shot` needs `shots`;
`sheets` and `playtest` are manual and stay `pending` in the run until a person records them.

## Manual sheets — the `docs.sheets` file

Markdown. A sheet is `## MC-<n> — <title>`, an optional `*Fault it catches: ...*` line, and a
table whose first column is `<n>.<m>`: `| 1.1 | Do | Expect | Log to check |`. A row whose "Do"
is struck through (`~~...~~`) is treated as automated.

## Run records

Command run, `docs/tracker/runs/<stamp>_<name>.json`:

```json
{ "id": "20260906-155211_tracker-check", "name": "tracker-check", "started": "...", "finished": "...",
  "exit_code": 0, "commit": "9469d3c", "summary": ["[tracker] OK: 66 items"], "log_path": "...",
  "tests_passed": 0, "tests_total": 0 }
```

Suite run, `docs/tracker/qa/runs/<stamp>_suite-<id>.json`: `kind: "suite"`, `suite`,
`suite_name`, `date`, `started`, `finished`, `commit`, `status` (`running` `pass` `fail`
`pending`), `steps[{step, status, run_id, exit_code, summary, tests_passed, tests_total}]`,
`results` (sheet rows), `gate` (playtest boxes), `notes`, `tester`, `build`.

Sheets run or playtest, same folder: `kind: "sheets" | "playtest"`, `date`, `commit`, `build`,
`tester`, `results` (`{ "1.1": "PASS" }`), `gate` (`{ "played": true }`), `minutes`, `notes`.

## Media — `docs/media/media.json`

```json
{ "media": [ { "id": "m-20260906-135000-000", "file": "docs/media/phase-3/20260906-1350_x.png",
  "phase": "3", "item": "3.19", "run": "", "kind": "screenshot", "caption": "what it shows and proves",
  "date": "2026-09-06", "tags": ["crafting"], "bytes": 242270 } ] }
```

Kinds: `screenshot` `render` `video` `photo` `diagram`. Files live under `docs/media/phase-<n>/`.

## Library candidates — the `library.candidates` file

`{"candidates": [{slug, title, authors, year, venue, url, domain, why, recency, credentials, contradictions,
proposed_by, proposed_at, status, decision_note, decided_at}]}` with `status` one of `proposed`,
`accepted`, `rejected`. Written only by the desk. An accepted candidate is also appended to the
project's `sources.json` with the decision under `accepted`. See [LIBRARY.md](LIBRARY.md) for the
rest of the library's files, which belong to the project.

## Sessions — `docs/tracker/sessions/<stamp>_<agent>.json`

See MCP.md. `closures[].class` is `stamped`, `machine` or `user`.
