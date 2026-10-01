# Adinand Auto File Sorter — the default sorting table

Adinand Auto File Sorter is an Android app that moves loose files into Downloads › Sorted Files, one sub-folder per category, deciding the category from the file extension alone. This folder publishes the app's **default** extension → category table and a small reference implementation of it.

| File | What it is |
|---|---|
| `categories.json` | the seven categories and the six extension lists, each with the line of the app's `SortableFile.kt` it was read from |
| `categorize.py` | `category_for(filename)`: the category a file name lands in, or `None` when the app would not sort it |
| `test_categorize.py` | tests: every category, upper/mixed case, dotfiles, extensionless names, double extensions |
| `check_table.py` | drift guard: compares `categories.json` with the app's source and exits non-zero on any difference |

## How the table works

- The extension is the text after the last `.` in the file name, lower-cased. `Report.PDF` is a Document; `archive.tar.gz` has the extension `gz`, which is in no list, so it goes to Others.
- Documents `pdf doc docx ppt pptx xls xlsx txt` · Images `jpg jpeg png webp gif` · Videos `mp4 mkv avi webm` · Apps `apk xapk apkm` · Audio `mp3 wav aac m4a` · Archives `zip rar 7z` · any other extension → Others.

## What this is not

This is the default table only. It does not move, copy or delete anything, and custom rules you add in the app are not modelled here.

The table decides *where* a file goes; the app's scanner decides *whether* a file is picked up at all, and it skips more than the table shows (read from the app's `DirectoryScan.kt`, 1 October 2026):

- files with no extension (`DirectoryScan.kt:153-154`);
- dotfiles, names starting with `.` (`:189-191`);
- zero-byte files (`:96`);
- downloads still in progress — `.crdownload`, `.part`, `.partial`, `.tmp`, `.temp`, `.download`, `.filepart`, `.opdownload`, `.aria2`, `.!ut`, `.crswap` (`:33-36`, `:187`);
- files modified in the last 30 seconds (`:42`, `:196`);
- names with no letter or digit in them (`:164-167`);
- anything inside a sub-folder: the scan reads only the folder's own files, never its sub-folders (`:76-100`).

`categorize.py` returns `None` for the first two (no extension, dotfile), because those depend only on the name. The others depend on the file on disk and are not modelled.

## Run it

    python3 categorize.py Report.PDF archive.tar.gz README .nomedia
    python3 -m unittest -v test_categorize
    python3 check_table.py /path/to/a/clone/of/the/app   # maintainers only; the app's code is not public

## Source

Read from the app's `model/SortableFile.kt` (lines 8–62) and `repository/DirectoryScan.kt` at the commit recorded in `../SOURCES.md`, 1 October 2026. Website: https://adinandsorter.com
