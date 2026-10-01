#!/usr/bin/env python3
"""Drift guard: compare categories.json with the six setOf(...) literals in the app's
SortableFile.kt. Usage: check_table.py SORTER_APP_CLONE_ROOT. Exits 1 on any mismatch."""
import json
import re
import sys
from pathlib import Path

NAMES = {"DOCUMENT": "Documents", "IMAGE": "Images", "VIDEO": "Videos",
         "APP": "Apps", "AUDIO": "Audio", "ARCHIVE": "Archives"}


def main(root):
    hits = list(Path(root).glob("app/src/main/java/**/model/SortableFile.kt"))
    if len(hits) != 1:
        sys.exit(f"check_table: expected one SortableFile.kt under {root}, found {len(hits)}")
    src = hits[0].read_text(encoding="utf-8")
    app = {NAMES[k]: set(re.findall(r'"([^"]*)"', body))
           for k, body in re.findall(r'val (\w+)_EXTENSIONS = setOf\(([^)]*)\)', src) if k in NAMES}
    table = json.loads((Path(__file__).parent / "categories.json").read_text(encoding="utf-8"))
    ours = {c["name"]: set(c["extensions"]) for c in table["categories"] if c["extensions"] is not None}
    if app != ours:
        for name in sorted(set(app) | set(ours)):
            if app.get(name) != ours.get(name):
                print(f"DRIFT {name}: app={sorted(app.get(name, []))} categories.json={sorted(ours.get(name, []))}")
        sys.exit(1)
    print(f"check_table: OK, {len(ours)} extension sets match SortableFile.kt")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
