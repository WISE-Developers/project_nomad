#!/bin/bash
# Launches the Project Nomad installer.
#
# Default: routes to the menu-driven setup wizard (install_nomad_setup.sh).
# `--demo <tag>`: routes to the non-interactive SAN+Docker demo installer.
#   Pins Nomad to the given release tag and uses installer defaults for
#   everything else. Example: ./install.sh --demo v0.10.1
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ "$1" = "--demo" ]; then
    shift
    exec "$DIR/scripts/install-nomad-demo.sh" "$@"
fi
exec "$DIR/scripts/install_nomad_setup.sh" "$@"
