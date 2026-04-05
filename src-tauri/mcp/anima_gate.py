#!/usr/bin/env python3
"""
anima_gate.py — MCP permission gate for Anima.

Stdio MCP server (NDJSON framing) used with --permission-prompt-tool.
When Claude needs permission, this server writes a gate request file
and polls for the user's response from the companion UI.

IPC files are session-scoped via ANIMA_SESSION env var:
  /tmp/anima_gate_{session_id}.json         — gate request
  /tmp/anima_gate_{session_id}_response.json — user response
"""

import json
import os
import sys
import time

SESSION_ID = os.environ.get('ANIMA_SESSION', 'default')
GATE_REQUEST  = f'/tmp/anima_gate_{SESSION_ID}.json'
GATE_RESPONSE = f'/tmp/anima_gate_{SESSION_ID}_response.json'
ALIVE_FILE    = '/tmp/pixel_terminal_alive'

TIMEOUT_S = 60
POLL_S    = 0.3
ALIVE_MAX_S = 15


def send(obj):
    raw = json.dumps(obj)
    sys.stdout.write(raw + '\n')
    sys.stdout.flush()


def is_terminal_alive():
    try:
        return (time.time() - os.path.getmtime(ALIVE_FILE)) < ALIVE_MAX_S
    except OSError:
        return False


def handle_permission(msg_id, arguments):
    """Handle a permission prompt from Claude."""
    tool_name = arguments.get('tool_name', 'unknown')
    tool_input = arguments.get('input', {})

    # Build human-readable message
    if tool_name == 'Bash':
        cmd = tool_input.get('command', '')
        display = f"Bash: {cmd[:120]}"
    elif tool_name in ('Write', 'Edit', 'MultiEdit'):
        fpath = tool_input.get('file_path', '')
        display = f"{tool_name}: {fpath}"
    else:
        display = f"{tool_name}"

    # If Anima UI isn't running, deny
    if not is_terminal_alive():
        send({
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "content": [{"type": "text", "text": json.dumps({
                    "behavior": "deny",
                    "message": "Anima UI not available for approval"
                })}]
            }
        })
        return

    # Clean up stale response file
    try:
        os.unlink(GATE_RESPONSE)
    except OSError:
        pass

    # Write gate request (atomic via tmp+rename)
    req_id = f"gate-{int(time.time() * 1000)}"
    req = {
        "id": req_id,
        "tool": tool_name,
        "msg": display,
        "expires": int(time.time()) + TIMEOUT_S,
        "ts": int(time.time()),
    }
    tmp_path = GATE_REQUEST + '.tmp'
    with open(tmp_path, 'w') as f:
        json.dump(req, f)
    os.rename(tmp_path, GATE_REQUEST)

    # Poll for user response
    deadline = time.time() + TIMEOUT_S
    while time.time() < deadline:
        time.sleep(POLL_S)
        try:
            with open(GATE_RESPONSE) as f:
                resp = json.load(f)
            if resp.get('id') == req_id:
                approved = resp.get('approved', False)
                try: os.unlink(GATE_RESPONSE)
                except OSError: pass
                try: os.unlink(GATE_REQUEST)
                except OSError: pass

                behavior = "allow" if approved else "deny"
                result = {"behavior": behavior}
                if approved:
                    result["updatedInput"] = tool_input
                else:
                    result["message"] = "User denied"

                send({
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "result": {
                        "content": [{"type": "text", "text": json.dumps(result)}]
                    }
                })
                return
        except (OSError, json.JSONDecodeError):
            pass

    # Timeout — deny
    try: os.unlink(GATE_REQUEST)
    except OSError: pass
    send({
        "jsonrpc": "2.0",
        "id": msg_id,
        "result": {
            "content": [{"type": "text", "text": json.dumps({
                "behavior": "deny",
                "message": f"Approval timeout after {TIMEOUT_S}s"
            })}]
        }
    })


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = msg.get('method', '')
        msg_id = msg.get('id')
        params = msg.get('params', {})

        if method == 'initialize':
            send({
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "anima-gate", "version": "1.0.0"}
                }
            })

        elif method == 'notifications/initialized':
            pass

        elif method == 'tools/list':
            send({
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "tools": [{
                        "name": "approve",
                        "description": "Handle permission prompts for tool approval",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "tool_name": {"type": "string"},
                                "input": {"type": "object"},
                                "tool_use_id": {"type": "string"}
                            }
                        }
                    }]
                }
            })

        elif method == 'tools/call':
            arguments = params.get('arguments', {})
            handle_permission(msg_id, arguments)

        else:
            if msg_id is not None:
                send({"jsonrpc": "2.0", "id": msg_id, "result": {}})


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.exit(0)
