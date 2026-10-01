#!/usr/bin/env bash
# For every mirrored tool file in MANIFEST.tsv, fetch its live URL and compare sha256 with the
# copy in this repository. Prints OK / DIFF / FETCH-ERROR per file; exits non-zero on any DIFF
# or fetch error. For the SubSense page (kind astro-inline-css) the live page and its live
# stylesheet are fetched and inlined the same way sync.sh does, then hashed.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

ok=0; bad=0
while IFS=$'\t' read -r repo_path source_repo source_path live_url kind; do
  case "$repo_path" in ''|'#'*) continue ;; esac
  got="$TMP/live"
  rm -f "$got"
  case "$kind" in
    # Accept: */* is pinned on purpose: for a browser-like request (Accept: text/html) Cloudflare
    # injects its Web Analytics beacon into the HTML at the edge, which is not part of the source.
    raw) curl -sSfL --max-time 60 -A "adinand-tools-check/1" -H "Accept: */*" -o "$got" "$live_url" 2>"$TMP/err" ;;
    astro-inline-css) python3 "$HERE/scripts/inline_astro_css.py" --url "$live_url" "$got" 2>"$TMP/err" ;;
    *) echo "unknown kind" >"$TMP/err"; false ;;
  esac
  if [ $? -ne 0 ] || [ ! -f "$got" ]; then
    echo "FETCH-ERROR  $repo_path  <- $live_url  ($(tr '\n' ' ' <"$TMP/err"))"
    bad=$((bad + 1)); continue
  fi
  want="$(shasum -a 256 "$HERE/$repo_path" 2>/dev/null | cut -d' ' -f1)"
  have="$(shasum -a 256 "$got" | cut -d' ' -f1)"
  if [ -n "$want" ] && [ "$want" = "$have" ]; then
    echo "OK    $repo_path"
    ok=$((ok + 1))
  else
    echo "DIFF  $repo_path  repo=${want:0:12} live=${have:0:12}  <- $live_url"
    bad=$((bad + 1))
  fi
done < "$HERE/MANIFEST.tsv"

echo "check-live: $ok OK, $bad not OK"
[ "$bad" -eq 0 ]
