#!/usr/bin/env bash
#
# @nomad/frontend is a LIBRARY. react and react-dom are externalised by
# vite.lib.config.ts — "consumers must provide these" — so declaring them as
# `dependencies` ships a second React into every consumer's tree. A consumer on
# a different React major then gets npm nesting a private copy, two Reacts
# loading, and "Invalid hook call" from any component using a hook.
#
# That is not hypothetical: it is what blocked EasyMap 3's React 18 -> 19
# upgrade (EM3 #927), and it was found as a runtime error in a browser rather
# than by anything in CI.
#
# This guard exists because the fix is ONE `npm install react` away from being
# silently undone by someone doing something otherwise reasonable.
#
# Bash 3.2 compatible (macOS default). No associative arrays, no mapfile.

set -u

PKG="$(cd "$(dirname "$0")/../.." && pwd)/package.json"
status=0

fail() {
  echo "FAIL: $1"
  status=1
}

for mod in react react-dom; do
  in_deps=$(node -p "JSON.stringify((require('$PKG').dependencies||{})['$mod']||null)")
  in_peer=$(node -p "JSON.stringify((require('$PKG').peerDependencies||{})['$mod']||null)")
  in_dev=$(node -p "JSON.stringify((require('$PKG').devDependencies||{})['$mod']||null)")

  if [ "$in_deps" != "null" ]; then
    fail "$mod is in dependencies ($in_deps). It is externalised by the library build, so shipping it makes consumers install a second React. Move it to peerDependencies."
  fi

  if [ "$in_peer" = "null" ]; then
    fail "$mod is not in peerDependencies. Consumers have no way to know which React this library needs."
  fi

  # Declared but not installed in development is the other way to break this:
  # the suite and the build need a real React to run against.
  if [ "$in_dev" = "null" ]; then
    fail "$mod is not in devDependencies. A peer dependency is not installed for us, so the tests and the library build would have no React."
  fi
done

if [ $status -eq 0 ]; then
  echo "ok: react and react-dom are peer dependencies, declared for development, absent from dependencies"
fi
exit $status
