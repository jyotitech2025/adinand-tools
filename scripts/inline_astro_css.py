#!/usr/bin/env python3
"""Turn one built Astro page into a standalone file by inlining its stylesheet.

Usage:
  inline_astro_css.py PAGE.html CSS_ROOT OUT.html   # CSS_ROOT = the build's dist/ folder
  inline_astro_css.py --url PAGE_URL OUT.html       # fetch the page and its CSS from the live site

The page must carry exactly one <link rel="stylesheet" href="/_astro/...css">. That tag is
replaced by <style>...</style> holding the stylesheet's bytes unchanged. Nothing else in the
page is touched, so the script block between MODEL:START and MODEL:END stays byte-identical.
"""
import re
import sys
import urllib.parse
import urllib.request

LINK = re.compile(rb'<link rel="stylesheet" href="(/_astro/[^"]+\.css)">')


def fetch(url):
    # Accept: */* matters. With no Accept header, Cloudflare's edge injects its Web Analytics
    # beacon <script> into the HTML (measured 1 October 2026 on subsenseapp.com), and the bytes
    # no longer match the built page. curl sends Accept: */* by default, as check-live.sh does.
    req = urllib.request.Request(url, headers={"User-Agent": "adinand-tools-check/1", "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def inline(page, load_css):
    links = LINK.findall(page)
    if len(links) != 1:
        sys.exit(f"expected exactly one /_astro stylesheet link, found {len(links)}")
    css = load_css(links[0].decode())
    if b"</style" in css.lower():
        sys.exit("stylesheet contains </style; refusing to inline")
    return LINK.sub(lambda _m: b"<style>" + css + b"</style>", page, count=1)


def main(argv):
    if len(argv) == 3 and argv[0] == "--url":
        url, out = argv[1], argv[2]
        page = fetch(url)
        result = inline(page, lambda p: fetch(urllib.parse.urljoin(url, p)))
    elif len(argv) == 3:
        page_path, css_root, out = argv
        page = open(page_path, "rb").read()
        result = inline(page, lambda p: open(css_root.rstrip("/") + p, "rb").read())
    else:
        sys.exit(__doc__)
    with open(out, "wb") as f:
        f.write(result)


if __name__ == "__main__":
    main(sys.argv[1:])
