// Basin Desk as an MCP server over stdio (ADR-0025). Same crate, same modules, same files as
// the window; a console binary, because stdio is the transport.
fn main() {
    let root = match desk_lib::workspace::find_root() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("desk-mcp: {e}");
            std::process::exit(2);
        }
    };
    desk_lib::mcp::serve_stdio(root);
}
