# Desk

The game-dev desk over a repo's own files: a tracker of items rendered to a backlog, a board, a
scope tree, bugs, QA suites and manual sheets, media by phase, an optional design view, and an
MCP server so every Claude Code session works through the same operations. Tauri 2 (Rust +
WebView2), vanilla TypeScript, no server, no browser, no state of its own.

It grew inside [Basin](https://github.com/Raka-Saka/rezo) and was split out so a second project
can have the same discipline. Everything project-specific is one file in the project:
`desk.json`.

## Give a project a desk

    python <desk>/tracker/tracker.py init --project "Name" --dir <project root>

This writes `desk.json`, `docs/tracker/` (phases, guide, suites), `docs/media/`, `.mcp.json`
and a `desk.cmd` launcher, then renders the first backlog. Edit `desk.json` to name the
project's commands, test runner, screenshot switches and media sources.

## Run

    desk.cmd            # from the project root; builds the desk the first time
    desk.cmd mcp        # the MCP server over stdio (what .mcp.json launches)
    desk.cmd shortcut   # Desktop and Start Menu shortcuts

By hand, from this folder: `pnpm install`, then `cargo tauri build --no-bundle` →
`src-tauri/target/release/desk.exe` and `desk-mcp.exe`. The desk finds the project by walking
up to `desk.json` from the working directory or the executable; `DESK_ROOT` overrides.

## Layout

    src/            the window (TypeScript)
    src-tauri/      the crate: items, media, runner, suites, sessions, mcp, config
    tracker/        tracker.py (render, check, list, new, init) and the init templates

## Verify

    cargo test --manifest-path src-tauri/Cargo.toml   # frontmatter/item round-trips against the live tree
    pnpm exec tsc --noEmit

The Rust item writer and `tracker/tracker.py` produce byte-identical files; a test proves it
against whatever project the desk is sitting in.

## What it writes, and where

| Written by the desk | To |
|---|---|
| an item | `docs/tracker/items/<id>.md`, then `docs/backlog.md` re-rendered |
| a sheet run, a playtest, a suite run | `docs/tracker/qa/runs/` |
| a command run | `docs/tracker/runs/` (summary) and `Saved/Desk/runs/` (full log) |
| a filed screenshot or video | `docs/media/phase-<n>/` and `docs/media/media.json` |
| a session | `docs/tracker/sessions/` |

Decisions that shaped it live in Basin's ADRs 0024 (recipes are data the desk edits) and 0025
(the desk speaks MCP; one writer; classified closures).
