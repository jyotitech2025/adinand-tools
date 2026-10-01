# Sources

This repository is a generated mirror. The tool files are copied by `sync.sh` from the repositories below, as listed in `MANIFEST.tsv`, and `check-live.sh` compares each one with the copy the live website serves.

All five repositories below are private. Every file in `MANIFEST.tsv` is already served publicly at the live URL listed beside it. Two things are not: `subsense/test/prove-feed-flood.mjs` (from matrix-marketing) and the `auto-file-sorter/` table (read from the app's code; the same extension lists are on https://adinandsorter.com).

| Repository | Branch | Commit | Commit date | What is taken |
|---|---|---|---|---|
| docfind-ios | main | `c6757ebcf59801347d453deedc3ebddcb7944926` | 2026-09-30 | `site/style.css`, `site/package.json`, `site/package-lock.json`, `site/tools/` (3 tool pages, 4 modules, 4 provers, `no-network.cjs`, `fixtures/ocr-refund.png`) |
| adinand-email-website | main | `8813e052c4365758ede8ff469aa4186d30cc118e` | 2026-09-30 | `styles.css`, `tools/` (4 tool pages) |
| subsense-web | main | `b444ed01eb80c264e2a37280610ce282881b0f5a` | 2026-09-30 | `dist/tools/feed-flood-calculator/index.html` after `npm ci && npm run build`, with its stylesheet inlined |
| NeatPDFAutoFileSorter (the Android app) | main | `e6655dbbf7a6bda3968781b77cb96c631d3b000b` | 2026-09-30 | nothing copied; `auto-file-sorter/categories.json` was read from `model/SortableFile.kt` and is checked against it by `check_table.py` |
| matrix-marketing | main | `eccc1b6d38ceeb8840eda1d683719887e9961f9f` (last commit to touch the file; read at HEAD `65b5248`) | 2026-09-02 | `apps/subsense/free-tool/prove-feed-flood.mjs` → `subsense/test/prove-feed-flood.mjs`, with its input path pointed at the standalone page and its label pattern widened for Astro's attributes |

Synced and checked against the live sites on 1 October 2026: `check-live.sh` 22 OK, 0 not OK.
