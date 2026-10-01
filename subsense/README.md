# SubSense — free YouTube subscription tool

One browser tool from the makers of SubSense, an app for iPhone and Android that sorts the YouTube channels you follow into categories and shows which ones have gone quiet or flood your feed. Live at https://www.subsenseapp.com/tools/.

| Tool | Live page | File |
|---|---|---|
| Feed flood calculator | https://www.subsenseapp.com/tools/feed-flood-calculator/ | `feed-flood-calculator.html` |

## No libraries, no network calls

The calculator is one HTML file: its stylesheet and script are inline, it loads no libraries and sends nothing anywhere. Open the file in a browser.

Where the two thresholds come from: "dormant" (no upload in 60 days) and "high-volume" (21 or more uploads a week) are the rules SubSense applies inside the app; the live page explains them under "Where the two thresholds come from": https://www.subsenseapp.com/tools/feed-flood-calculator/

## Tests

    node test/prove-feed-flood.mjs

The test slices the model out of `feed-flood-calculator.html` (the block between `MODEL:START` and `MODEL:END`) and checks it, so it tests the code the page runs.

## Source

Mirrored from https://www.subsenseapp.com/tools/feed-flood-calculator/ on 1 October 2026. The website is built with Astro; this file is the built page with its one stylesheet inlined and is otherwise byte-for-byte the live page. The website is the source of truth; if the two differ, the website wins. SubSense app: https://www.subsenseapp.com
