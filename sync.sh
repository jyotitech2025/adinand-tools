#!/usr/bin/env bash
# Re-copy every mirrored tool file from the site repos. The site repos are the source of truth;
# this repository is a generated mirror (see MANIFEST.tsv for every path and its live URL).
#
# Usage:
#   ./sync.sh DOCFIND_IOS ADINAND_EMAIL_WEBSITE SUBSENSE_WEB [SORTER_APP]
# or set the same names as environment variables. Each path is the root of a clone of that repo,
# checked out on main. SUBSENSE_WEB is built (npm ci && npm run build) so the calculator can be
# taken from dist/ with its stylesheet inlined. If SORTER_APP is given, auto-file-sorter's
# categories.json is checked against the app's SortableFile.kt (no file is copied from it).
#
# After syncing: run ./check-live.sh, then update SOURCES.md with each clone's HEAD.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

DOCFIND_IOS="${1:-${DOCFIND_IOS:-}}"
ADINAND_EMAIL_WEBSITE="${2:-${ADINAND_EMAIL_WEBSITE:-}}"
SUBSENSE_WEB="${3:-${SUBSENSE_WEB:-}}"
SORTER_APP="${4:-${SORTER_APP:-}}"

for v in DOCFIND_IOS ADINAND_EMAIL_WEBSITE SUBSENSE_WEB; do
  [ -n "${!v}" ] && [ -d "${!v}/.git" ] || { echo "sync: $v must be the root of a git clone (got '${!v}')" >&2; exit 2; }
  b="$(git -C "${!v}" rev-parse --abbrev-ref HEAD)"
  [ "$b" = "main" ] || { echo "sync: $v is on branch '$b', not main" >&2; exit 2; }
done

echo "building subsense-web (npm ci && npm run build)"
( cd "$SUBSENSE_WEB" && npm ci --silent && npm run build >/dev/null )

root_for() {
  case "$1" in
    docfind-ios) echo "$DOCFIND_IOS" ;;
    adinand-email-website) echo "$ADINAND_EMAIL_WEBSITE" ;;
    subsense-web) echo "$SUBSENSE_WEB" ;;
    *) echo "sync: unknown source repo '$1'" >&2; exit 2 ;;
  esac
}

n=0
while IFS=$'\t' read -r repo_path source_repo source_path live_url kind; do
  case "$repo_path" in ''|'#'*) continue ;; esac
  src="$(root_for "$source_repo")/$source_path"
  [ -f "$src" ] || { echo "sync: missing $src" >&2; exit 1; }
  mkdir -p "$HERE/$(dirname "$repo_path")"
  case "$kind" in
    raw) cp "$src" "$HERE/$repo_path" ;;
    astro-inline-css) python3 "$HERE/scripts/inline_astro_css.py" "$src" "$SUBSENSE_WEB/dist" "$HERE/$repo_path" ;;
    *) echo "sync: unknown kind '$kind'" >&2; exit 2 ;;
  esac
  n=$((n + 1))
  echo "  $repo_path"
done < "$HERE/MANIFEST.tsv"
echo "sync: $n files copied"

if [ -n "$SORTER_APP" ]; then
  python3 "$HERE/auto-file-sorter/check_table.py" "$SORTER_APP"
fi

for v in DOCFIND_IOS ADINAND_EMAIL_WEBSITE SUBSENSE_WEB SORTER_APP; do
  [ -n "${!v}" ] && echo "$v HEAD $(git -C "${!v}" rev-parse HEAD)"
done
