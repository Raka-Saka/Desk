# The Desk over MCP

`desk-mcp.exe` is a Model Context Protocol server over stdio (JSON-RPC 2.0, one message per line).
It links the same library as the window, so every tool below writes exactly what the window would.
`.mcp.json` in a project registers it for Claude Code:

```json
{ "mcpServers": { "desk": { "command": "cmd", "args": ["/c", ".\\desk.cmd", "mcp"] } } }
```

The server finds the project by walking up to `desk.json` from its working directory;
`DESK_ROOT` overrides.

## The shape of a session

1. `desk_start_session` — who you are, why, which compartment.
2. `desk_status` — the open phase and its gate, the queue, what needs the user's eyes.
3. Work, through the tools below. Every write lands on the session record.
4. `desk_close_item` — with evidence, citing a run id when there is one.
5. `desk_end_session` — a summary and what was left for the user.

A closure is **classified from what it cites**:

| class | when |
|---|---|
| `stamped` | `run_id` names a run record with exit 0 at a commit |
| `machine` | no run cited |
| `user` | the item was `YOURS` and `attested_by_user` is true with the user's words in `attestation` |

An agent cannot close a `YOURS` item any other way, and `desk_update_item` refuses
`status: "done"` so that every closure goes through classification.

## Tools

Arguments are JSON objects; results are text (JSON pretty-printed) with `isError` on failure.

### Reading

| tool | arguments | returns |
|---|---|---|
| `desk_status` | — | phase, head, open items, the queue (top 10), needs_your_eyes, open bugs, last check, problems, media inbox count, open session |
| `desk_list_items` | `status?`, `kind?`, `phase?`, `query?`, `compartment?` | brief items |
| `desk_get_item` | `id` | the item in full, body included |
| `desk_media_inbox` | — | unfiled files from the media sources |
| `desk_list_suites` | — | the suites |
| `desk_get_run` | `id` | a suite run (step statuses) or a command run record |
| `desk_list_sessions` | `limit?` | recent session records |
| `desk_design_report` | `draft?` (`{recipes:[...]}`), `places?` (`[[lat,lon],...]`) | the project's projection report (needs `design` in desk.json) |
| `desk_library_sources` | — | the shelf: every source with what it settles, who cites it, where it is named, file presence (needs `library` in desk.json) |
| `desk_library_source` | `slug` | one source in full, the claims citing it, the first 3,000 characters of its text |
| `desk_library_claims` | `only_unsourced?`, `only_failing?`, `body?` | the claims index with principle, linked sources and checks |
| `desk_library_search` | `query`, `per_source?` | metadata and full-text hits with snippets |

### Writing

| tool | arguments | effect |
|---|---|---|
| `desk_create_item` | `title`, `done_when`, `id?`, `kind?`, `status?`, `phase?`, `priority?`, `severity?`, `parent?`, `body?`, `files?`, `tests?`, `adrs?`, `tags?` | writes `docs/tracker/items/<id>.md`, re-renders the backlog; the session's compartment is added as a tag |
| `desk_update_item` | `id`, `patch?` (fields), `append_body?` | patches; refuses `status: done` |
| `desk_close_item` | `id`, `evidence`, `run_id?`, `attested_by_user?`, `attestation?` | closes with a classified stamp appended to the body |
| `desk_report_bug` | `title`, `log_line`, `expected`, `severity?`, `sheet?`, `files?`, `phase?`, `body?` | a bug item with the two decisive fields in its body |
| `desk_file_media` | `source`, `phase`, `caption`, `item?`, `run?`, `kind?`, `tags?` | copies into `docs/media/phase-<n>/`, records it |
| `desk_record_qa` | `kind` (`sheets`/`playtest`), `results?`, `gate?`, `notes?`, `tester?`, `build?`, `minutes?` — or `suite_run_id` + `step_index` to complete a suite's manual step | a QA run record |
| `desk_save_recipes` | `recipes` (array) | writes the recipes file and returns the project check's verdict |
| `desk_library_propose` | `title`, `url`, `why`, `recency`, `credentials`, `contradictions`, `authors?`, `year?`, `venue?`, `domain?`, `slug?` | records a candidate source (all three checks required); adds "read and decide" to the session's left_for_user |
| `desk_library_decide` | `slug`, `accept`, `note?`, `attested_by_user?` | rejects, or accepts into sources.json and runs the fetch and render hooks; accept needs `attested_by_user` with the user's words in `note` |

### Running

| tool | arguments | effect |
|---|---|---|
| `desk_run_command` | `name` | runs one catalogue command to completion; returns its record (`exit_code`, `summary`, `tests_passed/total`, `log_path`) |
| `desk_run_suite` | `suite`, `tester?`, `build?` | starts a suite in the background; returns `suite_run_id`; poll with `desk_get_run` |

### Sessions

| tool | arguments |
|---|---|
| `desk_start_session` | `agent`, `purpose`, `compartment?` |
| `desk_end_session` | `summary`, `left_for_user?` |

Compartments: `assets`, `logic`, `research`, `docs`, `qa`, `tooling`, `design`, `science`.

## Records

- Command runs: `docs/tracker/runs/<stamp>_<name>.json`; full log in `Saved/Desk/runs/`.
- Suite, sheet and playtest runs: `docs/tracker/qa/runs/`.
- Sessions: `docs/tracker/sessions/<stamp>_<agent>.json` with `items_touched`, `items_created`,
  `runs`, `media`, `closures[{item, class, run_id, commit, note, at}]`, `left_for_user`.

## Protocol notes

`initialize` returns protocol `2024-11-05`, `capabilities.tools`, and `instructions` that say the
above in one paragraph. `tools/list` and `tools/call` are the only other methods used;
`resources/list` and `prompts/list` return empty lists. Notifications get no reply.
