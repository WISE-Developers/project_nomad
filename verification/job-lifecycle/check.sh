#!/usr/bin/env bash
# Model-checks JobLifecycle.tla: every rule, on every execution path, one TLC run each.
# Compares the results with expected.txt and exits non-zero on any difference.
#
#   verification/job-lifecycle/check.sh            # check, keep traces of each break in $OUT
#   OUT=/some/dir verification/job-lifecycle/check.sh
#
# Toolchain (downloaded once into $CACHE, checksums pinned below):
#   TLC  tla2tools.jar v1.7.4
#   Java $JAVA if set, else a working `java` on PATH, else Temurin JRE 21.0.5+11
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/project-nomad-tla"
OUT="${OUT:-$(mktemp -d "${TMPDIR:-/tmp}/job-lifecycle.XXXXXX")}"
mkdir -p "$CACHE" "$OUT"

TLA_URL="https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar"
TLA_SHA="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"

PATHS="run execute mcp"
COMPOSE_RULES="NoForeignKill UnsetNeverServes"
RULES="FinalJobStaysFinal FinishedRunHasFinalJob FinishedRunHasFinalModel RestartFailsRunningJobs RestartLeavesNoPendingJob RestartLeavesNoActiveModel JobAndModelAgreeOnSuccess JobAndModelAgreeOnCancel CancelledRunHasNoEngine AcceptedCancelEndsCancelled FailedCancelLeavesJobAlone KilledRunEndsCancelled RestartLeavesNoEngine"

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

fetch() { # url dest sha
  if [ -f "$2" ] && [ "$(sha256 "$2")" = "$3" ]; then return; fi
  echo "downloading $1" >&2
  curl -fsSL -o "$2.part" "$1"
  [ "$(sha256 "$2.part")" = "$3" ] || { echo "checksum mismatch for $1" >&2; rm -f "$2.part"; exit 2; }
  mv "$2.part" "$2"
}

find_java() {
  if [ -n "${JAVA:-}" ]; then echo "$JAVA"; return; fi
  if command -v java >/dev/null && java -version >/dev/null 2>&1; then echo java; return; fi
  local plat sha
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)  plat=aarch64_mac;   sha=12249a1c5386957c93fc372260c483ae921b1ec6248a5136725eabd0abc07f93 ;;
    Darwin-x86_64) plat=x64_mac;       sha=0e0dcb571f7bf7786c111fe066932066d9eab080c9f86d8178da3e564324ee81 ;;
    Linux-x86_64)  plat=x64_linux;     sha=553dda64b3b1c3c16f8afe402377ffebe64fb4a1721a46ed426a91fd18185e62 ;;
    Linux-aarch64) plat=aarch64_linux; sha=e4d02c33aeaf8e1148c1c505e129a709c5bc1889e855d4fb4f001b1780db42b4 ;;
    *) echo "no pinned JRE for $(uname -s)-$(uname -m); set JAVA to a Java 11+ binary" >&2; exit 2 ;;
  esac
  local dir="$CACHE/jre-21.0.5_11-$plat"
  if [ ! -d "$dir" ]; then
    fetch "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jre_${plat}_hotspot_21.0.5_11.tar.gz" "$CACHE/jre-$plat.tar.gz" "$sha"
    mkdir -p "$dir.part" && tar -xzf "$CACHE/jre-$plat.tar.gz" -C "$dir.part" --strip-components=1
    mv "$dir.part" "$dir"
  fi
  if [ -x "$dir/Contents/Home/bin/java" ]; then echo "$dir/Contents/Home/bin/java"; else echo "$dir/bin/java"; fi
}

fetch "$TLA_URL" "$CACHE/tla2tools.jar" "$TLA_SHA"
JAVA_BIN="$(find_java)"

check_one() { # path rule -> PASS | BREAK | ERROR
  local p="$1" r="$2" dir="$OUT/$1-$2"
  mkdir -p "$dir"
  cp "$HERE/JobLifecycle.tla" "$dir/"
  printf 'SPECIFICATION Spec\nCONSTANT Path = "%s"\nINVARIANT TypeOK\nINVARIANT %s\n' "$p" "$r" > "$dir/JobLifecycle.cfg"
  (cd "$dir" && "$JAVA_BIN" -XX:+UseParallelGC -Djava.io.tmpdir="$dir" -cp "$CACHE/tla2tools.jar" tlc2.TLC \
     -workers 1 -metadir "$dir/states" -config JobLifecycle.cfg JobLifecycle.tla > tlc.out 2>&1) || true
  rm -rf "$dir/states"
  if grep -q "Model checking completed. No error has been found" "$dir/tlc.out"; then echo PASS
  elif grep -q "Invariant $r is violated" "$dir/tlc.out"; then echo BREAK
  else echo ERROR; fi
}

actual="$OUT/actual.txt"; : > "$actual"
for p in $PATHS; do
  for r in $RULES; do
    printf '%-8s %-28s %s\n' "$p" "$r" "$(check_one "$p" "$r")" | tee -a "$actual"
  done
done

# ComposeProject.tla: two deployments on one Docker daemon (no Path constant).
check_compose() { # rule -> PASS | BREAK | ERROR
  local r="$1" dir="$OUT/compose-$1"
  mkdir -p "$dir"
  cp "$HERE/ComposeProject.tla" "$dir/"
  printf 'SPECIFICATION Spec\nINVARIANT %s\n' "$r" > "$dir/ComposeProject.cfg"
  (cd "$dir" && "$JAVA_BIN" -XX:+UseParallelGC -Djava.io.tmpdir="$dir" -cp "$CACHE/tla2tools.jar" tlc2.TLC \
     -workers 1 -metadir "$dir/states" -config ComposeProject.cfg ComposeProject.tla > tlc.out 2>&1) || true
  rm -rf "$dir/states"
  if grep -q "Model checking completed. No error has been found" "$dir/tlc.out"; then echo PASS
  elif grep -q "Invariant $r is violated" "$dir/tlc.out"; then echo BREAK
  else echo ERROR; fi
}
for r in $COMPOSE_RULES; do
  printf '%-8s %-28s %s\n' compose "$r" "$(check_compose "$r")" | tee -a "$actual"
done

if diff -u <(grep -v '^#' "$HERE/expected.txt" | sed '/^$/d' | tr -s ' ') <(tr -s ' ' < "$actual") > "$OUT/diff.txt"; then
  echo "OK: results match expected.txt. Traces: $OUT/<path>-<rule>/tlc.out"
else
  cat "$OUT/diff.txt"
  echo "DIFFERENT from expected.txt (- expected, + actual). Traces: $OUT/<path>-<rule>/tlc.out"
  exit 1
fi
