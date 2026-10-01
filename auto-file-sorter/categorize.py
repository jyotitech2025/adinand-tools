#!/usr/bin/env python3
"""Reference implementation of Adinand Auto File Sorter's default category table.

This is the default table only. It does not move, copy or delete anything, and it does not
reproduce the app's scanner (see README.md for what the scanner skips).

    >>> category_for("Report.PDF")
    'Documents'
    >>> category_for("backup.tar.gz")
    'Others'
    >>> category_for("README") is None
    True
"""
import json
import sys
from pathlib import Path
from typing import Optional

_TABLE = json.loads((Path(__file__).parent / "categories.json").read_text(encoding="utf-8"))
_BY_EXTENSION = {
    ext: c["name"]
    for c in _TABLE["categories"]
    if c["extensions"] is not None
    for ext in c["extensions"]
}
OTHERS = "Others"


def extension_of(filename: str) -> str:
    """The text after the last '.', lower-cased; '' when there is no '.' (Kotlin substringAfterLast)."""
    head, dot, tail = filename.rpartition(".")
    return tail.lower() if dot else ""


def category_for(filename: str) -> Optional[str]:
    """The category a file name lands in, or None when the app would not sort it at all.

    None for a name with no extension ('README', 'notes.') and for a dotfile ('.nomedia'),
    matching the app's scanner. Every other name gets one of the seven categories; an unknown
    extension, including the last part of a double extension like 'a.tar.gz', is Others.
    """
    if filename.startswith("."):
        return None
    ext = extension_of(filename)
    if not ext:
        return None
    return _BY_EXTENSION.get(ext, OTHERS)


if __name__ == "__main__":
    for name in sys.argv[1:]:
        print(f"{name}\t{category_for(name)}")
