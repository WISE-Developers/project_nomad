#!/usr/bin/env bash
#
# The MCP port must be published to HOST LOOPBACK ONLY — never to 0.0.0.0.
#
# WHY IT MUST BE PUBLISHED AT ALL. MCP binds `127.0.0.1` INSIDE the container
# (`MCP_BIND_ADDRESS` in mcp/listener.ts) and compose published nothing for it, so the
# only way to reach it was `docker exec` on the box. The design doc claimed it was
# "reachable only through an SSH tunnel" — it was not reachable by a tunnel at all,
# because a tunnel terminates on the HOST and nothing bridged host loopback to container
# loopback. Publishing the port on the host's 127.0.0.1 is what makes
# `ssh -L 3002:127.0.0.1:3002` actually work.
#
# WHY THE BIND ADDRESS IS HARDCODED AND NOT AN ENV VAR. `nomad.ciffc.ca` is fronted by
# cloudflared whose ingress is whole-host with NO path filter — it names
# `http://localhost:53000` and catches everything else with a 404. So the only thing
# keeping MCP off the public internet is that its port is not the one cloudflared routes
# AND is not bound to 0.0.0.0. An operator who could widen that binding through `.env`
# could publish an authenticated-but-mutating surface (`execute-model`, `batch-execute`)
# to the internet with a single typo. The literal `127.0.0.1` in the compose file is not
# style — it is the control that cannot be edited by accident.
#
# The key guard is real (`x-nomad-mcp-key`, 32-char floor, timing-safe compare, lockout),
# so this is defence in depth rather than the only defence. Both layers stay.
#
# Deps: bash 3.x, grep only. Exit 0 = all pass, 1 = any failure.
set -u

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$TEST_DIR/../.." && pwd)"
COMPOSE="$REPO/docker-compose.yaml"

pass=0
fail=0
ok()  { pass=$((pass + 1)); echo "    ok   $1"; }
bad() { fail=$((fail + 1)); echo "  FAIL   $1"; [ $# -gt 1 ] && echo "         $2"; }

[ -f "$COMPOSE" ] || { echo "FAIL - no docker-compose.yaml at $COMPOSE"; exit 1; }

# ---------------------------------------------------------------------------
# CONTROL FIRST. If the ports block cannot be found at all, every verdict below
# is vacuous — a test that reads nothing passes everything.
# ---------------------------------------------------------------------------
app_port_line="$(grep -nE '^\s*-\s*"[^"]*:3001"' "$COMPOSE" || true)"
if [ -n "$app_port_line" ]; then
    ok "control: the ports block is readable (found the app's :3001 publish)"
else
    echo "  FAIL   control: no ':3001' publish found in docker-compose.yaml."
    echo "         The parser found nothing, so nothing below can be trusted."
    exit 1
fi

# ---------------------------------------------------------------------------
# 1. THE MCP PORT IS PUBLISHED.
# ---------------------------------------------------------------------------
mcp_line="$(grep -E '^\s*-\s*".*NOMAD_MCP_PORT.*"' "$COMPOSE" || true)"
if [ -n "$mcp_line" ]; then
    ok "the MCP port is published to the host"
else
    bad "the MCP port is published to the host" \
        "no ports entry mentions NOMAD_MCP_PORT — MCP would be reachable only by docker exec, and an SSH tunnel would reach nothing"
fi

# ---------------------------------------------------------------------------
# 2. IT IS BOUND TO LITERAL LOOPBACK.
# ---------------------------------------------------------------------------
if [ -n "$mcp_line" ]; then
    case "$mcp_line" in
        *'"127.0.0.1:'*)
            ok "the MCP port is bound to literal 127.0.0.1" ;;
        *'0.0.0.0'*)
            bad "the MCP port is bound to literal 127.0.0.1" \
                "it is bound to 0.0.0.0 — this publishes a mutating MCP surface on every interface" ;;
        *)
            bad "the MCP port is bound to literal 127.0.0.1" \
                "no host IP in the mapping; docker defaults to 0.0.0.0, which publishes it on every interface" ;;
    esac
fi

# ---------------------------------------------------------------------------
# 3. THE BIND ADDRESS IS NOT SUBSTITUTABLE.
#    `${SOMETHING}:${NOMAD_MCP_PORT}` would satisfy check 2 only by accident of
#    whatever the variable happens to hold, which is the failure this guards.
# ---------------------------------------------------------------------------
if [ -n "$mcp_line" ]; then
    host_part="$(echo "$mcp_line" | sed -E 's/^[^"]*"//; s/:.*//')"
    if [ "$host_part" = "127.0.0.1" ]; then
        ok "the bind address is a literal, not an env substitution"
    else
        bad "the bind address is a literal, not an env substitution" \
            "host part is '$host_part' — an operator could widen this to 0.0.0.0 from .env"
    fi
fi

# ---------------------------------------------------------------------------
# 4. THE APP PORT IS UNCHANGED. This file is the only thing standing between
#    cloudflared and the container; a change here is how the site goes down.
# ---------------------------------------------------------------------------
if echo "$app_port_line" | grep -q 'NOMAD_FRONTEND_HOST_PORT'; then
    ok "the app's own port publish still uses NOMAD_FRONTEND_HOST_PORT"
else
    bad "the app's own port publish still uses NOMAD_FRONTEND_HOST_PORT" \
        "$(echo "$app_port_line" | head -1)"
fi

echo
echo "mcp_port_loopback_only: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
