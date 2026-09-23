# More than one seat

The desk has no server, no database and no state of its own. Every write it makes lands in the
project's own repository, as a file, through the same code the window and the MCP server share.
That is what makes a second seat possible at all — and it means the whole of "syncing the desk"
is git. There is nothing else to run, and nothing else to back up.

A *seat* here is one working copy: another person, another machine, or the same person on a
laptop. Several Claude sessions on one machine share a seat; they are covered near the end.

## What the desk keeps, and where

Everything below is committed. None of it is a build product.

| Path | Written by | Shape |
| --- | --- | --- |
| `docs/tracker/items/<id>.md` | items, closures | one file per item |
| `docs/tracker/phases.json` | rarely, by hand | one file |
| `docs/tracker/qa/suites.json` | suites | one file |
| `docs/tracker/runs/<stamp>_<name>.json` | every command run | one file per run |
| `docs/tracker/qa/runs/<stamp>_suite-<id>.json` | every suite run | one file per run |
| `docs/tracker/sessions/<stamp>_<agent>.json` | `desk_start_session` | one file per session |
| `docs/backlog.md` | `tracker render` | **generated** |
| `docs/media/media.json` | filing a picture | one file |
| `docs/media/frames.json` | the Viewfinder | one file |
| `docs/media/phase-<n>/*.png` | filing a picture | binaries |
| the `docs.sheets` file | manual sheets | one file |
| `desk.json` | by hand | one file |

The per-run and per-session records are not noise: a closure cites a run id as its evidence, so a
run record that only ever existed on one seat makes the item's evidence unreadable on every other
seat. Commit them.

## What merges, and what fights

**Items merge.** One item is one file, so two seats working on two items never touch the same
bytes. Two seats editing the *same* item conflict inside the frontmatter, usually on `updated` and
`status`; take the later `updated`, and keep both bodies — an item's body is a log, not a
statement, and losing half of it loses the evidence.

**The backlog always conflicts.** `docs/backlog.md` is rendered from the item files, so any two
seats that touched any items produce different bytes for it. Do not merge it by hand. Take either
side, then:

    python <desk>/tracker/tracker.py render

`tracker check` (and, in Basin, `Tools/check.py`) fails when the rendered backlog disagrees with
the items, which is exactly the check that catches a merge someone resolved by eye. Run it after
every merge, not only before a push.

**Run, suite-run and session records never collide.** They are named by timestamp and agent, so
two seats produce two filenames. They accumulate, and that is fine; they are small JSON.

**`media.json` and `frames.json` fight.** Both are one JSON file holding one list, appended to from
both ends. A conflict there is almost always additive: keep every entry from both sides, mind the
commas, and check that no two media ids are equal (`m-<stamp>-<n>` collides only if two seats filed
a picture in the same second, which is worth looking for rather than assuming).

## Item ids: the one real collision

`tracker new` refuses to overwrite an item file that already exists, but it can only see its own
working copy. Two seats that both create "the next item in phase 3" both write `3.41.md`, and git
reports an add/add conflict with two different items in it. Renaming one afterwards is not free —
the id is quoted in closures, run records, commit messages and other items' bodies.

Ids are free strings, so pick one of these before it happens:

- **One creator.** Items are created on one seat and pulled by the others. Simplest, and enough for
  two seats who talk.
- **A namespace per seat.** `3.41a`, `3.41b`, or a letter prefix per person. Ugly, unambiguous, and
  it never needs coordinating.
- **Pull, create, push.** Create items only against the latest `main` and push within the minute.
  Works until someone is on a plane.

## Machine paths

`desk.json` is committed, and it names programs that live at different places on different
machines. The desk already handles this: `Config::expand` reads each key of `env` **from the
process environment first, and only then from the file**. So

```jsonc
"env": { "UE_ROOT": "H:\\unrealengine\\5.0\\UE_5.8" }
```

means *"`${ue_root}` is whatever `UE_ROOT` says on this machine; if it says nothing, fall back to
the path that happened to be true for whoever committed this line."* Every seat sets the variable
in its own environment — user environment variables, a shell profile, or the launcher — and never
treats the committed value as authoritative.

The same mechanism serves any engine: a Unity project writes `"env": {"UNITY_EXE": "..."}` and uses
`${unity_exe}`. There is no built-in `${ue_root}`; it is only a lowercased `env` key, which is why
the desk needs no change to sit over a different toolchain.

Paths *inside* the repo (`tracker`, `docs.*`, `media_sources`, `tests.dir`) are repo-relative and
need nothing.

## Ports

`view.port` is a plain number in the committed `desk.json` and does not expand `${...}`. Two seats
on two machines are fine — each binds its own localhost. Two seats *on one machine*, or two engines
at once on one machine, collide on 30010, and the second one to launch simply never goes live.

Today the answer is that one Viewfinder runs at a time on a given machine. Making the port
environment-expandable is a small change to `config.rs` and is worth doing before a second person
shares a workstation.

## Binaries

Pictures are PNGs under `docs/media/phase-<n>/`. Put them in Git LFS before the first one lands,
not after:

    *.png filter=lfs diff=lfs merge=lfs -text

A repo that collected a few hundred screenshots into ordinary git objects carries them forever, in
every clone, and `git lfs prune` cannot reach back for what was never LFS.

## Several agents on one seat

Two Claude sessions in the same working copy are the common case, and they are not a merge problem
— they are a *last writer wins* problem, with no conflict marker to warn anybody.

- Open a session (`desk_start_session`) with a **compartment**: `assets`, `logic`, `research`,
  `docs`, `qa`, `tooling`, `design`, `science`. Two agents in two compartments rarely reach for the
  same file, and session records are separate files, so the sessions themselves never clash.
- Before claiming a change, or blaming a failing test, look at `git status` and the file's mtime. A
  dirty file you did not write belongs to the other session.
- Never `git checkout` a path you did not change in order to "clean up". That destroys work which
  was never committed and cannot be recovered. Undo through the tool that made the change.

## When the desk is a submodule

The desk is its own repository (`github.com/Raka-Saka/Desk`) and is usually pinned into a project at
`Tools/desk`. Two consequences for a second seat:

- A fresh clone has an empty `Tools/desk` until `git submodule update --init`. `desk.cmd` builds the
  desk on first run, which needs `pnpm` and the Rust toolchain; a seat that only reads and writes
  the tracker can use `tracker/tracker.py` alone, which needs nothing but Python.
- The project commits a *pointer* to a desk commit. When one seat updates the desk, the others see
  `M Tools/desk` and get the new desk only after `git submodule update`. Desk changes are committed
  in the Desk repo, and the pointer bump is its own commit in the project — never mixed with a
  commit that also changes the game.

## The rhythm

    git pull --recurse-submodules
    desk_start_session ...
    ... work, close items with a run id ...
    desk_end_session
    python <desk>/tracker/tracker.py render && python <desk>/tracker/tracker.py check
    git add -A && git commit && git push

Pull before the session so the queue you read is the real one. Push after it so the run ids your
closures cite exist for everyone else.
