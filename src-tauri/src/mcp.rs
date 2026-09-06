//! The MCP server: JSON-RPC 2.0 over stdio, one message per line (ADR-0025).
//!
//! Hand-written rather than a crate because the protocol surface a tool server needs is four
//! methods -- initialize, ping, tools/list, tools/call -- and every tool here is a thin call
//! into the modules the window already uses. There is no second path to the files.

use crate::items::{self, Item};
use crate::runner::{self, NoEvents};
use crate::sessions::{self, Closure, SessionRecord};
use crate::workspace::{self, git, qa_runs_dir, render_backlog};
use crate::{design, media, suites};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::process::Child;
use std::sync::{Arc, Mutex};

const PROTOCOL: &str = "2024-11-05";

pub struct Server {
    root: PathBuf,
    running: Arc<Mutex<HashMap<String, Child>>>,
    session: Option<SessionRecord>,
}

type ToolResult = Result<Value, String>;

fn s(v: &Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}
fn list(v: &Value, key: &str) -> Vec<String> {
    v.get(key).and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default()
}
fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

pub fn serve_stdio(root: PathBuf) {
    let mut server = Server { root, running: Arc::default(), session: None };
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                let _ = writeln!(out, "{}", json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": format!("parse error: {e}")}}));
                let _ = out.flush();
                continue;
            }
        };
        let id = msg.get("id").cloned();
        let method = s(&msg, "method");
        let params = msg.get("params").cloned().unwrap_or(Value::Null);
        let response = match server.handle(&method, &params) {
            Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
            Err((code, message)) => json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}),
        };
        if id.is_none() {
            continue; // a notification gets no reply
        }
        let _ = writeln!(out, "{}", response);
        let _ = out.flush();
    }
}

impl Server {
    fn handle(&mut self, method: &str, params: &Value) -> Result<Value, (i32, String)> {
        match method {
            "initialize" => Ok(json!({
                "protocolVersion": PROTOCOL,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "basin-desk", "version": env!("CARGO_PKG_VERSION")},
                "instructions": "Basin Desk over MCP (ADR-0025). Start with desk_start_session(agent, purpose, compartment); read desk_status; close items with desk_close_item citing a run id when you have one; a YOURS item needs attested_by_user and the user's words; end with desk_end_session(summary). Every write goes through the same code the desk window uses and lands in the repo's files."
            })),
            "notifications/initialized" | "notifications/cancelled" => Ok(Value::Null),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({"tools": tool_list()})),
            "tools/call" => {
                let name = s(params, "name");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                match self.call(&name, &args) {
                    Ok(v) => {
                        let text = if v.is_string() { v.as_str().unwrap().to_string() } else { serde_json::to_string_pretty(&v).unwrap() };
                        Ok(json!({"content": [{"type": "text", "text": text}], "isError": false}))
                    }
                    Err(e) => Ok(json!({"content": [{"type": "text", "text": e}], "isError": true})),
                }
            }
            "resources/list" => Ok(json!({"resources": []})),
            "prompts/list" => Ok(json!({"prompts": []})),
            _ => Err((-32601, format!("unknown method {method}"))),
        }
    }

    fn save_session(&mut self) {
        if let Some(sess) = &self.session {
            let _ = sessions::save(&self.root, sess);
        }
    }

    fn call(&mut self, name: &str, a: &Value) -> ToolResult {
        match name {
            "desk_status" => self.status(),
            "desk_list_items" => self.list_items(a),
            "desk_get_item" => self.get_item(a),
            "desk_create_item" => self.create_item(a),
            "desk_update_item" => self.update_item(a),
            "desk_close_item" => self.close_item(a),
            "desk_report_bug" => self.report_bug(a),
            "desk_media_inbox" => Ok(serde_json::to_value(media::inbox(&self.root)).unwrap()),
            "desk_file_media" => self.file_media(a),
            "desk_run_command" => self.run_command(a),
            "desk_list_suites" => Ok(serde_json::to_value(suites::load(&self.root).suites).unwrap()),
            "desk_run_suite" => self.run_suite(a),
            "desk_get_run" => self.get_run(a),
            "desk_record_qa" => self.record_qa(a),
            "desk_design_report" => {
                let places: Vec<(f64, f64)> = a.get("places").and_then(|p| p.as_array()).map(|arr| arr.iter().filter_map(|p| Some((p.get(0)?.as_f64()?, p.get(1)?.as_f64()?))).collect()).unwrap_or_default();
                let draft = a.get("draft").and_then(|d| if d.is_null() { None } else { Some(serde_json::to_string(d).unwrap()) });
                design::report(&self.root, draft, &places)
            }
            "desk_save_recipes" => {
                let recipes = a.get("recipes").cloned().ok_or("recipes (array) is required")?;
                let problems = design::save_recipes(&self.root, recipes)?;
                Ok(json!({"saved": "docs/design/recipes.json", "problems": problems}))
            }
            "desk_start_session" => {
                let rec = sessions::start(&self.root, &s(a, "agent"), &s(a, "purpose"), &s(a, "compartment"))?;
                self.session = Some(rec.clone());
                Ok(serde_json::to_value(rec).unwrap())
            }
            "desk_end_session" => {
                let mut rec = self.session.take().ok_or("no session is open; call desk_start_session first")?;
                rec.ended = runner::now();
                rec.summary = s(a, "summary");
                rec.left_for_user.extend(list(a, "left_for_user"));
                sessions::save(&self.root, &rec)?;
                Ok(serde_json::to_value(rec).unwrap())
            }
            "desk_list_sessions" => {
                let n = a.get("limit").and_then(|x| x.as_u64()).unwrap_or(10) as usize;
                Ok(serde_json::to_value(sessions::list(&self.root).into_iter().take(n).collect::<Vec<_>>()).unwrap())
            }
            other => Err(format!("unknown tool {other}")),
        }
    }

    // ---- reading ----------------------------------------------------------------------------

    fn status(&self) -> ToolResult {
        let ws = workspace::load(&self.root)?;
        let phase = ws.phases["phases"].as_array().and_then(|p| p.iter().find(|x| x["status"] == "open")).cloned().unwrap_or(Value::Null);
        let mut queue: Vec<&Item> = ws.items.iter().filter(|i| matches!(i.status.as_str(), "now" | "next" | "later") && i.kind != "epic").collect();
        let rank = |st: &str| match st { "now" => 0, "next" => 1, _ => 2 };
        queue.sort_by(|a, b| a.priority.cmp(&b.priority).then(rank(&a.status).cmp(&rank(&b.status))).then(items::id_key(&a.id).cmp(&items::id_key(&b.id))));
        let brief = |i: &Item| json!({"id": i.id, "title": i.title, "kind": i.kind, "status": i.status, "priority": i.priority, "done_when": i.done_when, "tags": i.tags});
        let yours: Vec<Value> = ws.items.iter().filter(|i| i.status == "yours").map(brief).collect();
        let bugs = ws.items.iter().filter(|i| (i.kind == "bug" || i.kind == "defect") && i.status != "done").count();
        let last_check = ws.runs.iter().find(|r| r.name == "check" || r.name == "check-quick").map(|r| json!({"name": r.name, "started": r.started, "exit_code": r.exit_code, "commit": r.commit}));
        Ok(json!({
            "phase": phase,
            "head": ws.head, "branch": ws.branch, "dirty_files": ws.dirty.len(),
            "open_items": ws.items.iter().filter(|i| i.status != "done" && i.kind != "epic").count(),
            "queue": queue.iter().take(10).map(|i| brief(i)).collect::<Vec<_>>(),
            "needs_your_eyes": yours,
            "open_bugs": bugs,
            "last_check": last_check,
            "problems": ws.problems,
            "media_inbox": ws.inbox.len(),
            "session": self.session.as_ref().map(|s| json!({"id": s.id, "agent": s.agent, "compartment": s.compartment})),
        }))
    }

    fn list_items(&self, a: &Value) -> ToolResult {
        let all = items::load_all(&self.root)?;
        let (status, kind, phase, query, comp) = (s(a, "status"), s(a, "kind"), s(a, "phase"), s(a, "query").to_lowercase(), s(a, "compartment"));
        let out: Vec<Value> = all.iter().filter(|i| {
            (status.is_empty() || i.status == status) && (kind.is_empty() || i.kind == kind) && (phase.is_empty() || i.phase == phase)
                && (comp.is_empty() || i.tags.iter().any(|t| t == &comp))
                && (query.is_empty() || i.title.to_lowercase().contains(&query) || i.body.to_lowercase().contains(&query) || i.id.to_lowercase() == query)
        }).map(|i| json!({"id": i.id, "title": i.title, "kind": i.kind, "status": i.status, "phase": i.phase, "priority": i.priority, "severity": i.severity, "parent": i.parent, "tags": i.tags, "done_when": i.done_when})).collect();
        Ok(Value::Array(out))
    }

    fn get_item(&self, a: &Value) -> ToolResult {
        let id = s(a, "id");
        let all = items::load_all(&self.root)?;
        let it = all.into_iter().find(|i| i.id == id).ok_or_else(|| format!("no item {id}"))?;
        Ok(serde_json::to_value(it).unwrap())
    }

    // ---- writing ----------------------------------------------------------------------------

    fn write_item(&mut self, it: &Item, created: bool) -> Result<(), String> {
        items::save(&self.root, it)?;
        render_backlog(&self.root).map(|_| ()).unwrap_or(());
        if let Some(sess) = &mut self.session {
            sess.touch(&it.id);
            if created {
                sess.items_created.push(it.id.clone());
            }
        }
        self.save_session();
        Ok(())
    }

    fn next_id(&self, prefix: &str) -> Result<String, String> {
        let all = items::load_all(&self.root)?;
        let max = all.iter().filter_map(|i| i.id.strip_prefix(&format!("{prefix}."))).filter_map(|n| n.parse::<u64>().ok()).max().unwrap_or(0);
        Ok(format!("{prefix}.{}", max + 1))
    }

    fn create_item(&mut self, a: &Value) -> ToolResult {
        let phase = { let p = s(a, "phase"); if p.is_empty() { "3".to_string() } else { p } };
        let id = { let i = s(a, "id"); if i.is_empty() { self.next_id(&phase)? } else { i } };
        if items::load_all(&self.root)?.iter().any(|i| i.id == id) {
            return Err(format!("{id} already exists; use desk_update_item"));
        }
        let mut tags = list(a, "tags");
        if let Some(sess) = &self.session {
            if !sess.compartment.is_empty() && !tags.contains(&sess.compartment) {
                tags.push(sess.compartment.clone());
            }
        }
        let it = Item {
            id, title: s(a, "title"),
            kind: { let k = s(a, "kind"); if k.is_empty() { "task".into() } else { k } },
            status: { let k = s(a, "status"); if k.is_empty() { "next".into() } else { k } },
            phase,
            priority: { let k = s(a, "priority"); if k.is_empty() { "P2".into() } else { k } },
            severity: s(a, "severity"), parent: s(a, "parent"), sheet: s(a, "sheet"),
            files: list(a, "files"), tests: list(a, "tests"), adrs: list(a, "adrs"), commits: vec![], tags,
            done_when: s(a, "done_when"), created: today(), updated: today(), closed: String::new(),
            body: s(a, "body"),
        };
        self.write_item(&it, true)?;
        Ok(json!({"created": it.id, "file": format!("docs/tracker/items/{}.md", it.id)}))
    }

    fn update_item(&mut self, a: &Value) -> ToolResult {
        let id = s(a, "id");
        let mut it = items::load_all(&self.root)?.into_iter().find(|i| i.id == id).ok_or_else(|| format!("no item {id}"))?;
        let patch = a.get("patch").cloned().unwrap_or(json!({}));
        for (k, v) in patch.as_object().map(|m| m.iter().collect::<Vec<_>>()).unwrap_or_default() {
            let sv = v.as_str().map(str::to_string);
            match k.as_str() {
                "title" => it.title = sv.unwrap_or_default(),
                "kind" => it.kind = sv.unwrap_or_default(),
                "status" => {
                    let new = sv.unwrap_or_default();
                    if new == "done" { return Err("use desk_close_item to close, so the closure is classified".into()); }
                    it.status = new;
                }
                "phase" => it.phase = sv.unwrap_or_default(),
                "priority" => it.priority = sv.unwrap_or_default(),
                "severity" => it.severity = sv.unwrap_or_default(),
                "parent" => it.parent = sv.unwrap_or_default(),
                "sheet" => it.sheet = sv.unwrap_or_default(),
                "done_when" => it.done_when = sv.unwrap_or_default(),
                "body" => it.body = sv.unwrap_or_default(),
                "files" => it.files = list(&patch, "files"),
                "tests" => it.tests = list(&patch, "tests"),
                "adrs" => it.adrs = list(&patch, "adrs"),
                "tags" => it.tags = list(&patch, "tags"),
                other => return Err(format!("unknown field {other}")),
            }
        }
        let append = s(a, "append_body");
        if !append.is_empty() {
            if !it.body.trim().is_empty() { it.body.push_str("\n\n"); }
            it.body.push_str(&append);
        }
        it.updated = today();
        if it.status != "done" { it.closed.clear(); }
        self.write_item(&it, false)?;
        Ok(json!({"updated": it.id, "status": it.status}))
    }

    fn close_item(&mut self, a: &Value) -> ToolResult {
        let id = s(a, "id");
        let evidence = s(a, "evidence");
        if evidence.trim().is_empty() {
            return Err("evidence is required: the test count, the log line, the measurement. Built is not done.".into());
        }
        let mut it = items::load_all(&self.root)?.into_iter().find(|i| i.id == id).ok_or_else(|| format!("no item {id}"))?;
        let run_id = s(a, "run_id");
        let (run_exit, run_commit) = if run_id.is_empty() { (None, String::new()) } else {
            let ws_runs = workspace::load(&self.root)?.runs;
            match ws_runs.iter().find(|r| r.id == run_id) {
                Some(r) => (Some(r.exit_code), r.commit.clone()),
                None => match suites::load_run(&self.root, &run_id) {
                    Ok(sr) => (Some(if sr.status == "pass" { 0 } else { 1 }), sr.commit.clone()),
                    Err(_) => return Err(format!("no run {run_id} under docs/tracker/runs or qa/runs")),
                },
            }
        };
        let attested = a.get("attested_by_user").and_then(|x| x.as_bool()).unwrap_or(false);
        let attestation = s(a, "attestation");
        if attested && attestation.trim().is_empty() {
            return Err("attested_by_user needs the user's words in `attestation`".into());
        }
        let class = sessions::classify(&self.root, &it.status, run_exit, &run_commit, attested)?;
        let agent = self.session.as_ref().map(|x| x.agent.clone()).unwrap_or_else(|| "an agent".into());
        let stamp = match class.as_str() {
            "stamped" => format!("**Closed {} ({}), stamped:** run `{}` exit 0 at `{}`.", today(), agent, run_id, run_commit),
            "user" => format!("**Closed {} by the user** (recorded by {}): \"{}\"", today(), agent, attestation.trim()),
            _ => format!("**Closed {} ({}), no run cited.**", today(), agent),
        };
        let before = it.status.clone();
        it.status = "done".into();
        it.closed = today();
        it.updated = today();
        if !it.body.trim().is_empty() { it.body.push_str("\n\n"); }
        it.body.push_str(&stamp);
        it.body.push_str("\n\n");
        it.body.push_str(evidence.trim());
        if !run_id.is_empty() && !it.commits.contains(&run_commit) && !run_commit.is_empty() {
            it.commits.push(run_commit.clone());
        }
        self.write_item(&it, false)?;
        if let Some(sess) = &mut self.session {
            sess.closures.push(Closure { item: id.clone(), class: class.clone(), run_id: run_id.clone(), commit: run_commit.clone(), note: if attested { attestation.clone() } else { String::new() }, at: runner::now() });
        }
        self.save_session();
        Ok(json!({"closed": id, "class": class, "was": before, "run_id": run_id, "commit": run_commit}))
    }

    fn report_bug(&mut self, a: &Value) -> ToolResult {
        let log_line = s(a, "log_line");
        let expected = s(a, "expected");
        if log_line.trim().is_empty() || expected.trim().is_empty() {
            return Err("a bug needs log_line and expected: those two fields have repeatedly been decisive here".into());
        }
        let body = format!("**Log line:**\n\n```\n{}\n```\n\n**Expected instead:** {}\n\n{}", log_line.trim(), expected.trim(), s(a, "body"));
        let mut args = a.clone();
        args["kind"] = json!("bug");
        args["body"] = json!(body);
        if s(a, "severity").is_empty() { args["severity"] = json!("S2"); }
        if s(a, "status").is_empty() { args["status"] = json!("next"); }
        if s(a, "priority").is_empty() { args["priority"] = json!("P1"); }
        if s(a, "done_when").is_empty() { args["done_when"] = json!(format!("The log no longer shows the line above; instead: {}. The check or sheet row that would have caught it exists.", expected.trim())); }
        self.create_item(&args)
    }

    fn file_media(&mut self, a: &Value) -> ToolResult {
        let rec = media::MediaRecord {
            id: String::new(), file: String::new(), phase: s(a, "phase"), item: s(a, "item"), run: s(a, "run"),
            kind: s(a, "kind"), caption: s(a, "caption"), date: String::new(), tags: list(a, "tags"), bytes: 0,
        };
        if rec.phase.is_empty() { return Err("phase is required".into()); }
        let filed = media::file(&self.root, &s(a, "source"), rec)?;
        if let Some(sess) = &mut self.session {
            sess.media.push(filed.id.clone());
            if !filed.item.is_empty() { sess.touch(&filed.item.clone()); }
        }
        self.save_session();
        Ok(serde_json::to_value(filed).unwrap())
    }

    // ---- running ----------------------------------------------------------------------------

    fn run_command(&mut self, a: &Value) -> ToolResult {
        let name = s(a, "name");
        let spec = runner::resolve(&self.root, &name).ok_or_else(|| format!("unknown command {name}; see desk_status or the Development catalogue"))?;
        let run_id = format!("{}_{}", runner::stamp(), spec.name.replace([':', '.'], "-"));
        let rec = runner::run_blocking(&NoEvents, &self.running, &self.root, &spec, &run_id)?;
        if let Some(sess) = &mut self.session { sess.runs.push(rec.id.clone()); }
        self.save_session();
        Ok(serde_json::to_value(rec).unwrap())
    }

    fn run_suite(&mut self, a: &Value) -> ToolResult {
        let tester = { let t = s(a, "tester"); if t.is_empty() { self.session.as_ref().map(|x| x.agent.clone()).unwrap_or_default() } else { t } };
        let build = { let b = s(a, "build"); if b.is_empty() { "PIE".into() } else { b } };
        let id = suites::start(Arc::new(NoEvents), self.running.clone(), self.root.clone(), &s(a, "suite"), tester, build)?;
        if let Some(sess) = &mut self.session { sess.runs.push(id.clone()); }
        self.save_session();
        Ok(json!({"suite_run_id": id, "poll": "desk_get_run", "note": "automated steps run in the background; manual steps stay pending for a person"}))
    }

    fn get_run(&self, a: &Value) -> ToolResult {
        let id = s(a, "id");
        if let Ok(sr) = suites::load_run(&self.root, &id) {
            return Ok(serde_json::to_value(sr).unwrap());
        }
        let ws = workspace::load(&self.root)?;
        ws.runs.into_iter().find(|r| r.id == id).map(|r| serde_json::to_value(r).unwrap()).ok_or_else(|| format!("no run {id}"))
    }

    fn record_qa(&mut self, a: &Value) -> ToolResult {
        let suite_run = s(a, "suite_run_id");
        if !suite_run.is_empty() {
            let step = a.get("step_index").and_then(|x| x.as_u64()).ok_or("step_index is required with suite_run_id")? as usize;
            let run = suites::complete_manual(&self.root, &suite_run, step, a.clone())?;
            return Ok(serde_json::to_value(run).unwrap());
        }
        let kind = s(a, "kind");
        if kind != "sheets" && kind != "playtest" {
            return Err("kind must be sheets or playtest (or pass suite_run_id + step_index)".into());
        }
        let mut run = a.clone();
        let id = runner::stamp();
        run["id"] = json!(id);
        run["date"] = json!(today());
        if s(a, "commit").is_empty() { run["commit"] = json!(git(&self.root, &["rev-parse", "--short", "HEAD"]).unwrap_or_default().trim()); }
        let dir = qa_runs_dir(&self.root);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join(format!("{id}.json")), serde_json::to_string_pretty(&run).unwrap() + "\n").map_err(|e| e.to_string())?;
        if let Some(sess) = &mut self.session { sess.runs.push(id.clone()); }
        self.save_session();
        Ok(json!({"recorded": id}))
    }
}

fn tool(name: &str, description: &str, props: Value, required: &[&str]) -> Value {
    json!({"name": name, "description": description, "inputSchema": {"type": "object", "properties": props, "required": required}})
}

fn tool_list() -> Vec<Value> {
    let str_ = |d: &str| json!({"type": "string", "description": d});
    let strs = |d: &str| json!({"type": "array", "items": {"type": "string"}, "description": d});
    vec![
        tool("desk_status", "Where the game is: the open phase and its gate, the machine's queue by priority, what needs the user's eyes, open bugs, the last check, problems, and the open session.", json!({}), &[]),
        tool("desk_list_items", "List tracker items with optional filters.", json!({"status": str_("now|next|later|yours|watch|parked|done"), "kind": str_("epic|task|bug|defect|question|chore|reference"), "phase": str_("0-6 or C"), "query": str_("substring of title/body, or an exact id"), "compartment": str_("a tag: assets|logic|research|docs|qa|tooling|design|science")}), &[]),
        tool("desk_get_item", "One item in full, body included.", json!({"id": str_("item id, e.g. 3.19")}), &["id"]),
        tool("desk_create_item", "Create an item (docs/tracker/items/<id>.md) and re-render the backlog. id is assigned from the phase when omitted. The open session's compartment is added as a tag.", json!({"id": str_("optional"), "title": str_(""), "kind": str_("default task"), "status": str_("default next"), "phase": str_("default 3"), "priority": str_("P0..P3, default P2"), "severity": str_("S1..S3 for bugs/defects"), "parent": str_("epic id"), "done_when": str_("a condition someone can check"), "body": str_("markdown"), "files": strs(""), "tests": strs(""), "adrs": strs(""), "tags": strs("compartments and more")}), &["title", "done_when"]),
        tool("desk_update_item", "Patch fields of an item and/or append to its body. Refuses status=done: use desk_close_item.", json!({"id": str_(""), "patch": {"type": "object", "description": "fields to set: title, kind, status, phase, priority, severity, parent, sheet, done_when, body, files, tests, adrs, tags"}, "append_body": str_("markdown appended to the body")}), &["id"]),
        tool("desk_close_item", "Close an item with evidence. Classified: stamped (run_id cites a run with exit 0 at a commit), user (a YOURS item, attested_by_user with the user's words), or machine.", json!({"id": str_(""), "evidence": str_("the test count, the log line, the measurement"), "run_id": str_("a docs/tracker/runs or qa/runs id"), "attested_by_user": {"type": "boolean"}, "attestation": str_("the user's own words, when attested")}), &["id", "evidence"]),
        tool("desk_report_bug", "File a bug with the two fields that decide how fast it gets fixed: the log line and what was expected.", json!({"title": str_(""), "severity": str_("S1 crash/blocks play, S2 wrong result, S3 cosmetic; default S2"), "sheet": str_("MC-1..MC-9 if a sheet found it"), "log_line": str_(""), "expected": str_(""), "files": strs(""), "phase": str_(""), "body": str_("more, markdown")}), &["title", "log_line", "expected"]),
        tool("desk_media_inbox", "Unfiled screenshots and video from the game, the phone and the bake viewer.", json!({}), &[]),
        tool("desk_file_media", "Copy a file into docs/media/phase-<n>/ and record it with phase, item, run, kind, caption, tags.", json!({"source": str_("absolute path, or repo-relative"), "phase": str_(""), "item": str_(""), "run": str_("a QA run id this is evidence for"), "kind": str_("screenshot|render|video|photo|diagram"), "caption": str_("what it shows and what it proves or fails"), "tags": strs("")}), &["source", "phase", "caption"]),
        tool("desk_run_command", "Run one catalogue command to completion and return its record: check, check-quick, baker, automation, automation:<filter>, verify-planet, tracker-check, render, gate, import-recipes, build-editor, shot:<Basin*Shot>.", json!({"name": str_("")}), &["name"]),
        tool("desk_list_suites", "The QA suites (docs/tracker/qa/suites.json).", json!({}), &[]),
        tool("desk_run_suite", "Start a suite in the background; poll with desk_get_run. Manual steps stay pending for a person.", json!({"suite": str_("smoke|automated|survival|recipes|evidence|sheets|gate-3"), "tester": str_(""), "build": str_("PIE|standalone -game|packaged Win64|Android APK")}), &["suite"]),
        tool("desk_get_run", "A run record: a suite run (with step statuses) or a command run.", json!({"id": str_("")}), &["id"]),
        tool("desk_record_qa", "Record a manual sheets run or a playtest, or complete a pending manual step of a suite run.", json!({"kind": str_("sheets|playtest"), "results": {"type": "object", "description": "sheet row id -> PASS|FAIL|SKIP"}, "gate": {"type": "object", "description": "playtest boxes -> true|false"}, "notes": str_(""), "tester": str_(""), "build": str_(""), "minutes": {"type": "number"}, "suite_run_id": str_("to complete a suite's manual step"), "step_index": {"type": "integer"}}), &[]),
        tool("desk_design_report", "The recipe simulator's projection at the spawn, the best farmland and any extra places, for the recipes on disk or a draft.", json!({"draft": {"type": "object", "description": "{recipes: [...]} to project instead of docs/design/recipes.json"}, "places": {"type": "array", "items": {"type": "array", "items": {"type": "number"}}, "description": "[[lat, lon], ...]"}}), &[]),
        tool("desk_save_recipes", "Write docs/design/recipes.json (the one home) and return system_map's problems, if any. Push to the game with desk_run_suite recipes.", json!({"recipes": {"type": "array", "description": "the full recipes array"}}), &["recipes"]),
        tool("desk_start_session", "Open a session record (docs/tracker/sessions). Do this first.", json!({"agent": str_("who: e.g. 'Claude Fable 5.1 / crafting'"), "purpose": str_("one sentence"), "compartment": str_("assets|logic|research|docs|qa|tooling|design|science")}), &["agent", "purpose"]),
        tool("desk_end_session", "Close the session with a summary and what was left for the user.", json!({"summary": str_(""), "left_for_user": strs("things only the user can do")}), &["summary"]),
        tool("desk_list_sessions", "Recent session records, newest first.", json!({"limit": {"type": "integer"}}), &[]),
    ]
}
