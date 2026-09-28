#!/usr/bin/env bash
#
# Lint ratchet — fail CI when the lint count GROWS. (refs #386)
#
# WHY THIS EXISTS
#
# `npm run lint` had never run in this repo: ESLint 9 needs flat config and
# none existed, and the workspace scripts used `src/**/*.ts`, which the SHELL
# expands without globstar — so even once it ran it covered 6 of 275 files.
# Both are fixed. Nothing in CI ran lint either, so all of it could regress
# freely the moment it was fixed.
#
# The obvious answer — a blocking lint job — is wrong while a backlog exists.
# It would fail on every branch from day one, CI would sit permanently red, and
# people would learn to ignore it. That is the same "a check that looks like
# coverage and isn't" failure that produced this situation in the first place.
#
# So the baseline below is a CEILING, not a target. CI fails when the count
# grows. As findings are cleared the number comes DOWN and never goes up. When
# it reaches zero, delete this script and make the lint job plain and blocking.
#
# Usage:
#   scripts/lint-ratchet.sh              # count, compare, report
#   scripts/lint-ratchet.sh --update     # print the line to write into the
#                                        # baseline file (does not write it —
#                                        # lowering the ceiling is a deliberate,
#                                        # reviewable commit, not a side effect)
set -euo pipefail

RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; GREEN='\033[0;32m'; NC='\033[0m'
print_error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
print_warning() { echo -e "${YELLOW}[WARN]${NC} $*"; }
print_info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
print_success() { echo -e "${GREEN}[OK]${NC} $*"; }

read_baseline() {
    # First bare integer in $1. A missing file or a file without a number is an
    # ERROR, never a silent 0 — a ratchet comparing against nothing passes
    # forever, which is worse than having no ratchet at all.
    local file="$1" value

    if [ ! -f "$file" ]; then
        print_error "No lint baseline at $file."
        print_error "Refusing to run: a ratchet with no ceiling passes forever."
        return 1
    fi

    value="$(grep -oE '^[0-9]+' "$file" | head -1 || true)"

    if [ -z "$value" ]; then
        print_error "No number found in $file."
        print_error "Refusing to guess: the baseline is the whole check."
        return 1
    fi

    echo "$value"
}

ratchet_verdict() {
    # $1 current count, $2 baseline ceiling. 0 = proceed, 1 = fail the build.
    local current="$1" baseline="$2"

    case "$current" in ''|*[!0-9]*)
        print_error "Current lint count '$current' is not a number."
        return 1 ;;
    esac
    case "$baseline" in ''|*[!0-9]*)
        print_error "Baseline '$baseline' is not a number."
        return 1 ;;
    esac

    if [ "$current" -gt "$baseline" ]; then
        print_error "Lint findings went UP: $current, ceiling is $baseline (+$((current - baseline)))."
        print_error "Fix the new findings, or — if they are deliberate — add a scoped"
        print_error "eslint-disable-next-line WITH a comment saying why it is safe."
        print_error "Do not raise the baseline. It only ever comes down."
        return 1
    fi

    if [ "$current" -lt "$baseline" ]; then
        print_success "Lint findings are DOWN: $current, ceiling was $baseline."
        print_warning "Please LOWER the baseline to $current in the same commit —"
        print_warning "a ratchet nobody lowers quietly stops ratcheting."
        return 0
    fi

    print_success "Lint findings unchanged at $current."
    return 0
}

count_findings() {
    # Total problems (errors + warnings) across both workspaces. Counts from
    # eslint's JSON rather than scraping its human output, which changes shape
    # between versions.
    local root="$1" total=0 w json n
    for w in backend frontend; do
        json="$(cd "$root/$w" && npx --no-install eslint src -f json 2>/dev/null || true)"
        [ -n "$json" ] || { print_error "eslint produced no output in $w"; return 1; }
        n="$(printf '%s' "$json" | node -e '
            let d="";
            process.stdin.on("data", c => d += c).on("end", () => {
              try {
                const r = JSON.parse(d);
                console.log(r.reduce((a, f) => a + f.messages.length, 0));
              } catch { console.log("NaN"); }
            });
        ')"
        case "$n" in ''|*[!0-9]*) print_error "Could not count findings in $w"; return 1 ;; esac
        total=$((total + n))
    done
    echo "$total"
}

main() {
    local root baseline_file current baseline
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    baseline_file="$root/.lint-baseline"

    baseline="$(read_baseline "$baseline_file")" || exit 1
    print_info "Baseline ceiling: $baseline"

    current="$(count_findings "$root")" || exit 1
    print_info "Current findings: $current"

    if [ "${1:-}" = "--update" ]; then
        echo
        print_info "Write this into $baseline_file:"
        echo "$current"
        exit 0
    fi

    ratchet_verdict "$current" "$baseline" || exit 1
}

# Only run main when executed, so the test harness can source the functions.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi
