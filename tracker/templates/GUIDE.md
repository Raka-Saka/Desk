# How {{project}} is managed

One person, one machine, one project. This is the whole method. It fits on a page because
anything that does not fit on a page will not be followed in year three.

## The three layers of scope

| Layer | What it is | Where it lives | Who changes it |
|---|---|---|---|
| **Macro** — a phase | Months of work and one gate: a sentence a stranger could verify. | the roadmap (prose), `docs/tracker/phases.json` (machine) | You, at a phase transition, by signature. |
| **Meso** — an epic | A capability the gate needs. | `docs/tracker/items/E.*.md` | Rarely. An epic exists so items have a parent. |
| **Micro** — an item | One session of work with a **done-when that can be checked**. | `docs/tracker/items/<id>.md` | Every session. An agent or you, through the files or the desk. |

Below micro there is nothing. A subtask is a commit.

**The rule:** an item with no verifiable done-when is not ready to start. Write the condition
first. "Feels right" is not a condition.

## Kinds

| Kind | Meaning | Needs |
|---|---|---|
| `task` | Build something toward the gate. | done-when |
| `bug` | Behaviour that is **wrong**. | severity, the log line, what was expected |
| `defect` | A known **shortcoming accepted for now**. | severity, and why it is not a bug |
| `question` | A choice only you can make. | your answer |
| `chore` | Housekeeping. | — |
| `epic` | A parent. | children |
| `reference` | Not work. | — |

Severity: **S1** crashes, blocks play, or breaks the world under the player · **S2** wrong
result · **S3** cosmetic.

## Status

`NOW` in progress (one, two at most) · `NEXT` agreed, not started · `LATER` real, not scheduled ·
`YOURS` needs you, not the machine · `WATCH` unexplained, instrumented · `PARKED` deliberately
not doing, with the reason · `DONE` **verified**, with the evidence in the body. Built is not done.

## Priority

`P0` blocks the phase gate · `P1` this phase · `P2` later · `P3` someday. When two things are
P0, one of them is not.

## Compartments

Tags on items and sessions: `assets`, `logic`, `research`, `docs`, `qa`, `tooling`, `design`,
`science`. Not new tools, not new files: a way to see who is doing what kind of work.

## The bug workflow

1. Find it (a sheet, a playtest, a check). 2. Report it with the **log line** and **what you
expected** — those two fields decide how fast it gets fixed. 3. Fix it; the commit names the id.
4. Verify it: the check that would have caught it, added; then `DONE` with the evidence.
5. A false finding is withdrawn, not deleted.

## Agents — the desk over MCP

`.mcp.json` registers the desk, so every Claude Code session in this repo has its tools.
`desk_start_session(agent, purpose, compartment)` → `desk_status` → work → `desk_close_item(id,
evidence, run_id?)` → `desk_end_session(summary, left_for_user)`. A closure is **classified**:
`stamped` cites a run with exit 0 at a commit; `machine` cites nothing; `user` is a `YOURS` item
closed with your words attested. An agent cannot close a `YOURS` item any other way. The record
is `docs/tracker/sessions/<stamp>_<agent>.json`.

## QA

Suites in `docs/tracker/qa/suites.json` run with one button. Manual sheets and playtests are
recorded runs. Media (`docs/media/`, by phase) is the evidence: file the screenshot against the
item or the run it proves or fails.

## Daily start

1. Open the desk (`desk.cmd`). Read the dashboard: the gate, the queue, what needs your eyes.
2. Do the one task at the top. Close it with evidence. Commit with the id in the message.
