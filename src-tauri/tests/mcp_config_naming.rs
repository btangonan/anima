// P2.A naming contract test.
//
// The MCP tool flag MUST mechanically equal mcp__<server_key>__approve.
// If these drift, Claude invokes a nonexistent MCP server and the gate
// is never called — audit-log proof collapses silently. This test fails
// loudly if anyone renames one half of the pair without the other.

use pixel_terminal_lib::commands::mcp_config_writer::derive_names;

#[test]
fn naming_contract_holds() {
    let session_id = "0e1f2a3b-4c5d-6e7f-8091-a2b3c4d5e6f7";
    let (sid8, server_key, tool_flag) = derive_names(session_id).unwrap();
    assert_eq!(sid8, "0e1f2a3b");
    assert_eq!(server_key, "anima_0e1f2a3b");
    assert_eq!(tool_flag, "mcp__anima_0e1f2a3b__approve");
    assert_eq!(tool_flag, format!("mcp__{}__approve", server_key));
}

#[test]
fn naming_contract_rejects_short_ids() {
    assert!(derive_names("abc").is_err());
    assert!(derive_names("").is_err());
    assert!(derive_names("-------").is_err());
}

#[test]
fn naming_contract_strips_dashes() {
    let (sid8, server_key, tool_flag) =
        derive_names("abcdef01-2345-6789-abcd-ef0123456789").unwrap();
    assert_eq!(sid8, "abcdef01");
    assert_eq!(server_key, "anima_abcdef01");
    assert_eq!(tool_flag, "mcp__anima_abcdef01__approve");
}

#[test]
fn naming_contract_all_observed_server_ids_round_trip() {
    for sid in [
        "00000000-0000-0000-0000-000000000001",
        "ffffffff-ffff-ffff-ffff-ffffffffffff",
        "deadbeef-cafe-babe-feed-faceabad1dea",
    ] {
        let (_s8, k, f) = derive_names(sid).unwrap();
        assert_eq!(f, format!("mcp__{}__approve", k), "round-trip for {}", sid);
    }
}
