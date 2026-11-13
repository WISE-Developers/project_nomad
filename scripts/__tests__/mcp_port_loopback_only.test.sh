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
# PUBLISHING IS NECESSARY AND NOT SUFFICIENT, measured on the demo at v0.59.0 after this
# guard was already green. Docker forwards a published port to the container's BRIDGE
# address, never to the container's loopback, so with the listener on container loopback
# the publish was inert and docker-proxy accepted the tunnel's bytes then closed (491
# written, 0 read): `172.18.0.2:3002` CLOSED against `172.18.0.2:3001` OPEN as the
# positive control. The container must therefore bind 0.0.0.0, which section 5 asserts.
#
# TWO DIFFERENT ADDRESSES, AND ONLY ONE OF THEM IS AN ENV VAR. The HOST side of the
# publish stays a literal (section 3). The address the listener binds INSIDE the
# container is `NOMAD_MCP_BIND_ADDRESS`, allowlisted in `mcp/listener.ts` to loopback or
# 0.0.0.0 and nothing else. Conflating the two is the mistake this paragraph exists to
# prevent: 0.0.0.0 inside a container whose publish is pinned to host loopback reaches
# no further than the host, while 0.0.0.0 on the HOST side reaches the internet.
#
# WHY THE HOST BIND ADDRESS IS HARDCODED AND NOT AN ENV VAR. `nomad.ciffc.ca` is fronted by
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

# ---------------------------------------------------------------------------
# 5. THE CONTAINER MUST BIND 0.0.0.0, AND THAT IS ONLY SAFE BECAUSE OF SECTION 3.
#    A loopback bind inside the container makes the publish above inert: docker
#    forwards the published port to the bridge address, where nothing would listen.
#    The two assertions are COUPLED on purpose — widening the host publish while the
#    container binds every interface is the combination that reaches the internet.
# ---------------------------------------------------------------------------
bind_env="$(grep -E '^[[:space:]]*-[[:space:]]*NOMAD_MCP_BIND_ADDRESS=' "$COMPOSE" || true)"

if [ -z "$bind_env" ]; then
    bad "compose sets NOMAD_MCP_BIND_ADDRESS for the container" \
        "not set — the listener defaults to container loopback and the publish above is inert"
else
    bind_value="$(echo "$bind_env" | sed -e 's/.*NOMAD_MCP_BIND_ADDRESS=//' -e 's/[[:space:]]*$//')"
    if [ "$bind_value" = "0.0.0.0" ]; then
        ok "the container binds 0.0.0.0, so the published port actually reaches the listener"
    else
        bad "the container binds 0.0.0.0, so the published port actually reaches the listener" \
            "value is '$bind_value'; loopback here makes the publish inert"
    fi

    # THE COUPLING. Only meaningful when the container binds every interface.
    if [ "$bind_value" = "0.0.0.0" ]; then
        if [ "${host_part:-}" = "127.0.0.1" ]; then
            ok "container binds 0.0.0.0 AND the host publish is literal loopback"
        else
            bad "container binds 0.0.0.0 AND the host publish is literal loopback" \
                "host part '${host_part:-<unset>}' with an all-interfaces container bind is internet exposure"
        fi
    fi
fi

echo
echo "mcp_port_loopback_only: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
