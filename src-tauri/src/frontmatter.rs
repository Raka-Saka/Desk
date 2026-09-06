//! The frontmatter subset shared with `Tools/tracker/tracker.py`. Read that file's docstring
//! for the contract; the two parsers must agree, and `tests` below pin the shape.
//!
//!   key: raw token     -> string as written
//!   key: "json string" -> JSON-decoded string
//!   key: ["a", "b"]    -> JSON-decoded list of strings
//!   key:               -> ""

use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub enum Field {
    Str(String),
    List(Vec<String>),
}

pub fn parse(text: &str) -> Result<(BTreeMap<String, Field>, String), String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let normalized = text.replace("\r\n", "\n");
    let text = normalized.as_str();
    if !text.starts_with("---") {
        return Err("no frontmatter: file must start with ---".into());
    }
    let lines: Vec<&str> = text.split('\n').collect();
    let mut fm = BTreeMap::new();
    let mut i = 1;
    let mut closed = false;
    while i < lines.len() {
        let line = lines[i].trim_end_matches('\r');
        if line.trim() == "---" {
            closed = true;
            break;
        }
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            i += 1;
            continue;
        }
        let Some((key, raw)) = line.split_once(':') else {
            return Err(format!("line {}: expected key: value, got {:?}", i + 1, line));
        };
        fm.insert(key.trim().to_string(), decode(raw)?);
        i += 1;
    }
    if !closed {
        return Err("frontmatter never closed with ---".into());
    }
    let body = lines[i + 1..].join("\n");
    Ok((fm, body.trim_start_matches('\n').to_string()))
}

fn decode(raw: &str) -> Result<Field, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(Field::Str(String::new()));
    }
    match raw.chars().next() {
        Some('[') => {
            let v: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
            let list = v
                .as_array()
                .ok_or("expected a JSON array")?
                .iter()
                .map(|x| x.as_str().map(str::to_string).ok_or("list items must be strings".to_string()))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Field::List(list))
        }
        Some('"') => {
            let v: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
            Ok(Field::Str(v.as_str().ok_or("expected a JSON string")?.to_string()))
        }
        _ => Ok(Field::Str(raw.to_string())),
    }
}

fn is_simple(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

pub fn encode_str(s: &str) -> String {
    if s.is_empty() {
        String::new()
    } else if is_simple(s) {
        s.to_string()
    } else {
        serde_json::to_string(s).unwrap()
    }
}

pub fn encode_list(l: &[String]) -> String {
    serde_json::to_string(l).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_the_shared_subset() {
        let text = "---\nid: 3.16\ntitle: \"The ground: does not build\"\nfiles: [\"a.cpp\", \"b.h\"]\nclosed: \n---\nBody **here**.\n";
        let (fm, body) = parse(text).unwrap();
        assert_eq!(fm["id"], Field::Str("3.16".into()));
        assert_eq!(fm["title"], Field::Str("The ground: does not build".into()));
        assert_eq!(fm["files"], Field::List(vec!["a.cpp".into(), "b.h".into()]));
        assert_eq!(fm["closed"], Field::Str(String::new()));
        assert_eq!(body, "Body **here**.\n");
        assert_eq!(encode_str("3.16"), "3.16");
        assert_eq!(encode_str("The ground: does not build"), "\"The ground: does not build\"");
        assert_eq!(encode_list(&["a.cpp".to_string()]), "[\"a.cpp\"]");
    }

    #[test]
    fn rejects_unclosed_blocks() {
        assert!(parse("---\nid: 1\n").is_err());
        assert!(parse("id: 1\n---\n").is_err());
    }
}
