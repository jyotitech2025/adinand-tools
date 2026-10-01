#!/usr/bin/env node
//
// prove-export.mjs — runs the export logic that /tools/search-multiple-pdfs ships, against a
// table of run objects, hostile field values and a 5,000-row load.
//
//   node tools/prove-export.mjs            (run from site/)
//
// IT TESTS THE FILE THE PAGE IMPORTS — tools/export.mjs — for the reason every prover on this
// site exists: /tools/is-your-pdf-searchable shipped on 2026-09-02 carrying a comment that named
// a prover, `tools/prove-pdf-checker.mjs`, which has never existed in any commit. It needs no npm
// dependency, because every function under test is pure.
//
// THE HAZARD IT IS POINTED AT. Until WT3 `asText` and `asCsv` lived inline in the page's
// <script type="module">, which means no gate on this site had ever read a line of them. The
// export is the ONE artefact of this page that outlives the tab: it is what a reader hands to a
// colleague, a solicitor or an accountant, who cannot see which boxes were ticked and has no way
// to ask. Two things follow, and they are the two halves of this file:
//
//   (1) EVERY CLAIM THE EXPORT CARRIES MUST BE TRUE OF A RUN NOBODY IS STANDING OVER. A run that
//       was stopped half-way exported as a bare table looks exactly like a complete one — the
//       columns are full, the rows are plausible, and the skipped list does NOT cover it, because
//       a file the run never reached has no row at all. So the provenance sentences are asserted
//       present when they are true and ABSENT when they are not; a sentence that is always there
//       is a sentence nobody reads.
//   (2) THE FIELDS ARE STRANGERS' BYTES. The snippet text comes out of somebody else's PDF and
//       the filename comes off the reader's disk. A cell beginning `=` is a FORMULA, and
//       `=cmd|'/c calc'!A1` in a cell is code execution on the machine of whoever opens the file.
//       The guard is asserted over `= + - @` and a leading tab, in the text column, the word
//       column AND the file column — a guard that covers only "the text ones" covers the column
//       an attacker does not need.
//
// WHAT IT DOES NOT COVER, said out loud so the gap is not mistaken for coverage:
//   - HOW A SPREADSHEET RENDERS THE APOSTROPHE GUARD. What is proven below is mechanical and is
//     an assertion about BYTES: no emitted field begins with a formula character. Whether the
//     leading `'` is consumed as a text marker (Excel) or displayed as a character in the cell
//     is a property of an application Node cannot run. MEASURED in the WT3 walk (Numbers 14.x,
//     macOS 15, 2026-09-11) by reading the parsed cell values back through AppleScript: nothing
//     evaluated — `@SUM(1+1).pdf` came back as text, not as `2` — and Numbers DISPLAYS the
//     apostrophe rather than hiding it. Inert everywhere is the property provable here and it is
//     the one worth having; see export.mjs's csvField comment and handoff/bugs.md for the trade.
//   - THE DOWNLOAD PATH. `new Blob([...])`, `URL.createObjectURL`, the synthetic `<a download>`
//     click and `revokeObjectURL` all live in the PAGE, not in the module, and not one of them
//     is executed by this file. Node has no Blob URL and no download. That the browser writes
//     the bytes csvDownloadText returns, under the name exportFilename returns, is the walk's
//     business. What is proven here is the bytes and the name.
//   - THE CLIPBOARD. `navigator.clipboard.writeText` is browser-only, needs a permission and a
//     user gesture, and is refused outright in some configurations — which is why the page has a
//     fallback sentence for it. asText is proven here; that the clipboard accepted it is not.
//   - ARIA-LIVE. That `#copy-said` is announced after a download is a fact about a screen reader
//     and an assistive-technology tree, not about a string. The attribute is pinned by the page's
//     own markup and checked by eye in the walk.
//   - THE PAGE'S COPY — what search-multiple-pdfs.md and llms.txt say the export contains — is a
//     claim-gate matter, not a prover matter: see check-answers.sh, rule TOOLCAP.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const started = Date.now();
let failures = 0;
let checks = 0;
function ok(what, cond, detail) {
  checks++;
  if (cond) return;
  failures++;
  console.log("  FAIL  " + what + (detail === undefined ? "" : "  →  " + detail));
}
function eq(what, got, want) {
  ok(what, JSON.stringify(got) === JSON.stringify(want), "got " + JSON.stringify(got) + ", wanted " + JSON.stringify(want));
}
function done() {
  console.log("");
  if (failures) {
    console.log("RED: " + failures + " of " + checks + " checks failed");
    process.exit(1);
  }
  console.log("GREEN: " + checks + " checks passed in " + (Date.now() - started) + " ms");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// [1] The module. Missing is a FAILURE, never a skip.
// ---------------------------------------------------------------------------
// A prover that quietly skips when its subject is absent prints GREEN on a machine where it
// proved nothing at all — the same shape of decoration as a gate never seen to fail.
console.log("the module the page imports");
const MODULE_PATH = resolve(HERE, "export.mjs");
let M = null;
try {
  M = await import(pathToFileURL(MODULE_PATH).href);
  ok("tools/export.mjs imports", true);
} catch (err) {
  console.log("  FAIL  tools/export.mjs did not import — " + ((err && err.message) || err));
  console.log("");
  console.log("RED: 1 of 1 checks failed");
  process.exit(1);
}
for (const name of ["oneLine", "csvField", "asText", "asCsv", "csvDownloadText",
                    "exportFilename", "CSV_COLUMNS", "PROVENANCE_LABEL"]) {
  ok("it exports " + name, M[name] !== undefined, "undefined");
}

const BOM = "﻿";
const LABEL = M.PROVENANCE_LABEL;

// A run builder, so every case below differs from the default in exactly the way it is named.
// Defaults are the ordinary case: a text-layer search that finished, OCR off, nothing skipped.
function run(over) {
  return Object.assign({
    needles: ["invoice"],
    files: [],
    skipped: [],
    matchCount: 0,
    pagesRead: 10,
    pagesWithoutText: 0,
    searched: 2,
    stopped: false,
    ocrOn: false,
    ocrPages: 0,
    emptyOcrPages: 0,
    engineFailed: null
  }, over || {});
}
const hit = (page, source, snippets) => ({ page, total: snippets.length, source, snippets });
const snip = (before, h, after) => ({ before, hit: h, after });

const rowsOf = (csv) => csv.split("\r\n");

// Column splitter for fully-quoted rows only — which is every row this module emits, and the
// row-shape check below asserts that. A general CSV parser here would be a second
// implementation of the thing under test, and would hide exactly the bug it was meant to find.
//
// IT REPORTS RATHER THAN THROWS, and that is not tidiness. The first run of this file against a
// deliberately broken module — rows joined with "\n" instead of CRLF — went red by CRASHING
// here on the very first row, which meant the summary said nothing about what was wrong and
// every check after it never ran. A prover that dies is red for a reason nobody can read. So a
// row that will not parse becomes one named failing check and five empty fields, and the run
// carries on to tell you everything else that is broken at the same time.
function cells(row) {
  try {
    return parseQuotedRow(row);
  } catch (err) {
    ok("a row parses as fully-quoted CSV fields: " + JSON.stringify(String(row).slice(0, 60)),
       false, err.message);
    return ["", "", "", "", ""];
  }
}
function parseQuotedRow(row) {
  const out = [];
  let i = 0;
  while (i < row.length) {
    if (row[i] !== '"') throw new Error("unquoted field at " + i + " in " + JSON.stringify(row));
    i++;
    let v = "";
    for (;;) {
      if (i >= row.length) throw new Error("unterminated field in " + JSON.stringify(row));
      if (row[i] === '"') {
        if (row[i + 1] === '"') { v += '"'; i += 2; continue; }
        i++; break;
      }
      v += row[i]; i++;
    }
    out.push(v);
    if (i < row.length) {
      if (row[i] !== ",") throw new Error("expected a comma at " + i + " in " + JSON.stringify(row));
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// [2] oneLine — the flattener both forms depend on.
// ---------------------------------------------------------------------------
console.log("oneLine");
eq("a newline becomes one space", M.oneLine("a\nb"), "a b");
eq("a CRLF becomes one space", M.oneLine("a\r\nb"), "a b");
eq("a tab becomes one space", M.oneLine("a\tb"), "a b");
eq("a run of mixed whitespace becomes ONE space", M.oneLine("a \n\t  \r\n b"), "a b");
eq("leading and trailing whitespace is trimmed", M.oneLine("\n  hello  \t"), "hello");
eq("a single space is left alone", M.oneLine("a b"), "a b");
eq("an ordinary sentence is untouched", M.oneLine("Invoice 2026 total"), "Invoice 2026 total");
eq("the empty string stays empty", M.oneLine(""), "");
eq("null is the empty string, not \"null\"", M.oneLine(null), "");
eq("undefined likewise", M.oneLine(undefined), "");
eq("no argument likewise", M.oneLine(), "");
eq("a number survives as its digits", M.oneLine(7), "7");
eq("zero is \"0\", not the empty string", M.oneLine(0), "0");
// Non-breaking space is whitespace to \s in JavaScript, and PDF text is full of it. Pinned
// because collapsing it is a visible change to the reader's text and must be deliberate.
eq("a non-breaking space collapses like any other", M.oneLine("a b"), "a b");
eq("an ellipsis is not whitespace and survives", M.oneLine("…tail"), "…tail");

// ---------------------------------------------------------------------------
// [3] csvField — quoting, and the guard that is the reason this function is exported.
// ---------------------------------------------------------------------------
console.log("csvField");
eq("an ordinary value is quoted", M.csvField("hello"), '"hello"');
eq("the empty string is still a quoted field, not nothing", M.csvField(""), '""');
eq("null is an empty quoted field", M.csvField(null), '""');
eq("undefined likewise", M.csvField(undefined), '""');
eq("a number is quoted like everything else", M.csvField(12), '"12"');
eq("an inner quote is DOUBLED", M.csvField('say "hi"'), '"say ""hi"""');
eq("two inner quotes are both doubled", M.csvField('""'), '""""""');
eq("a comma does not escape the field", M.csvField("a,b"), '"a,b"');
eq("a newline is flattened before it is quoted", M.csvField("a\nb"), '"a b"');
eq("a CRLF likewise — no bare CR can survive into a row", M.csvField("a\r\nb"), '"a b"');

console.log("the formula guard");
// ⚠️ The whole threat model, as a table. Each of these is a cell that a spreadsheet would
// EVALUATE rather than display, and the payload is a stranger's document or a filename off the
// reader's disk. `-` is included even though a negative number is an ordinary value: this
// column set has no numeric column anyone computes with, and `-2+3+cmd|…` is the documented
// bypass for a guard that omits it.
const HOSTILE = [
  ["=",  "=cmd|'/c calc'!A1"],
  ["+",  "+cmd|'/c calc'!A1"],
  ["-",  "-2+3+cmd|'/c calc'!A1"],
  ["@",  "@SUM(1+1)*cmd|'/c calc'!A1"],
  ["\t", "\t=1+1"]
];
for (const [what, payload] of HOSTILE) {
  const field = M.csvField(payload);
  const value = cells(field)[0];
  ok("a field beginning with " + JSON.stringify(what) + " does not begin with it any more",
     value[0] !== what, JSON.stringify(value));
  ok("...and it is not a formula character at all",
     !"=+-@".includes(value[0]), JSON.stringify(value));
  ok("...it begins with an apostrophe", value[0] === "'", JSON.stringify(value));
  ok("...and the payload itself is still there, not silently dropped",
     value.includes("cmd|") || value.includes("=1+1"), JSON.stringify(value));
}
// The other half of the guard, and the half that says it is a guard rather than a mangler: a
// benign value must come through untouched. A guard that prefixes everything is data corruption
// wearing a security argument.
for (const benign of ["Invoice 2026", "hello", "2026-09-11", "a,b", "  spaced  ", "£40", "…tail",
                      "total: -5 (see note)", "x = y"]) {
  const value = cells(M.csvField(benign))[0];
  ok("a benign field is NOT prefixed: " + JSON.stringify(benign), value[0] !== "'", JSON.stringify(value));
}
eq("...and a benign field is otherwise unchanged apart from flattening",
   cells(M.csvField("Invoice 2026"))[0], "Invoice 2026");
// The order of the steps, pinned. Guarding before flattening would miss this one: the formula
// character is not leading until oneLine has trimmed the newline in front of it.
eq("a payload behind a newline is still guarded AFTER flattening",
   cells(M.csvField("\n=1+1"))[0], "'=1+1");
eq("a payload behind spaces likewise", cells(M.csvField("   =1+1"))[0], "'=1+1");

// ---------------------------------------------------------------------------
// [4] asCsv — the schema, and the quoting seen through a whole document.
// ---------------------------------------------------------------------------
console.log("asCsv — line terminators");
{
  // RFC 4180 says CRLF, and Excel on Windows — the single most likely place this file is opened
  // — is the reason to obey it. Asserted BEFORE anything below splits a row, because rowsOf()
  // splits on CRLF: a module that joined with "\n" would make every row-shaped check below fail
  // at once, and this is the line that says why.
  const csv = M.asCsv(run({ matchCount: 1,
    files: [{ name: "a.pdf", hits: [hit(1, "text", [snip("", "invoice", " here")])] }] }));
  ok("rows are joined with CRLF", csv.includes("\r\n"), "no CRLF found");
  ok("there is no bare LF outside a CRLF", !/(^|[^\r])\n/.test(csv), "a bare newline is in the body");
  ok("there is no bare CR either", !/\r(?!\n)/.test(csv), "a lone carriage return is in the body");
  eq("...so the row count is what splitting on CRLF says it is", csv.split("\r\n").length, 1 + 1 + 3);
}

console.log("asCsv — schema and quoting");
const TEXT_RUN = run({
  needles: ["invoice", "total"],
  matchCount: 3,
  files: [{ name: "2026/march.pdf", hits: [
    hit(4, "text", [snip("the ", "invoice", " for March"), snip("a second ", "invoice", " here")]),
    hit(9, "text", [snip("grand ", "total", " due")])
  ] }]
});
{
  const csv = M.asCsv(TEXT_RUN);
  const rows = rowsOf(csv);
  eq("the header row is exactly the five column names", cells(rows[0]), M.CSV_COLUMNS);
  eq("...and that list is the one the module publishes",
     M.CSV_COLUMNS, ["file", "page", "source", "word", "text around the match"]);
  // header + 3 snippets + 0 skipped + 3 provenance. THREE, not five: this run neither stopped
  // nor failed, and those two sentences are emitted only when they are true — which is the
  // property section [5] exists to pin, restated here as a count so a sentence that started
  // appearing unconditionally would fail here first.
  eq("row count = header + snippets + skipped + provenance", rows.length, 1 + 3 + 0 + 3);
  for (const r of rows) {
    ok("every field in every row is quoted: " + r.slice(0, 40), /^".*"$/.test(r) && cells(r).length === 5,
       JSON.stringify(r));
  }
  const first = cells(rows[1]);
  eq("the file column carries the display path", first[0], "2026/march.pdf");
  eq("the page column is the page number", first[1], "4");
  eq("the source column reads text on a text-layer hit", first[2], "text");
  eq("the word column is the matched word", first[3], "invoice");
  eq("the text column is before+hit+after", first[4], "the invoice for March");
}
{
  // THE SOURCE COLUMN IS UNCONDITIONAL. A column that appears only when OCR ran breaks every
  // saved filter and every script pointed at this file, and its absence would silently mean
  // "text" to a reader who had only ever seen the other shape.
  const ocrRun = run({
    matchCount: 2, ocrOn: true, ocrPages: 3,
    files: [{ name: "scan.pdf", hits: [
      hit(1, "ocr", [snip("the ", "invoice", " total")]),
      hit(2, "text", [snip("another ", "invoice", "")])
    ] }]
  });
  const rows = rowsOf(M.asCsv(ocrRun));
  eq("an OCR hit reads ocr", cells(rows[1])[2], "ocr");
  eq("a text hit in the same file still reads text", cells(rows[2])[2], "text");
  eq("the header is unchanged by OCR being on", cells(rows[0]), M.CSV_COLUMNS);

  // OCR ON, NO SCANNED PAGE FOUND. ocrPages is 0 and the source column must still say text —
  // this is the run where a "only show the column when OCR ran" shortcut would look correct.
  const ocrNoPages = run({
    matchCount: 1, ocrOn: true, ocrPages: 0,
    files: [{ name: "a.pdf", hits: [hit(1, "text", [snip("", "invoice", " here")])] }]
  });
  const noPagesRows = rowsOf(M.asCsv(ocrNoPages));
  eq("with OCR on and zero OCR pages the header is still the five names",
     cells(noPagesRows[0]), M.CSV_COLUMNS);
  eq("...and the source column reads text", cells(noPagesRows[1])[2], "text");
}
{
  // A comma, a quote and a newline in one snippet — the three things that break a naive CSV.
  // The row COUNT is the check that catches the newline: a raw \n inside a field would split
  // this into two rows and every per-row assertion would go on passing.
  const nasty = run({
    matchCount: 1,
    files: [{ name: 'odd, "name".pdf', hits: [
      hit(1, "text", [snip('line one,\n"quoted"\n', "invoice", ",\ttail")])
    ] }]
  });
  const rows = rowsOf(M.asCsv(nasty));
  eq("a snippet containing a newline is ONE row, not three", rows.length, 1 + 1 + 0 + 3);
  const c = cells(rows[1]);
  eq("the comma stayed inside its field", c[0], 'odd, "name".pdf');
  eq("the quotes round-trip after doubling", c[4], 'line one, "quoted" invoice, tail');
  ok("no bare newline survived anywhere in the field", !c[4].includes("\n") && !c[4].includes("\r"), JSON.stringify(c[4]));
}
{
  // Hostile values in every untrusted column, through the whole document rather than through
  // csvField alone — the filename included, because the filename comes off disk.
  for (const [what, payload] of HOSTILE) {
    const evil = run({
      matchCount: 1,
      files: [{ name: payload, hits: [hit(1, "text", [snip("", payload, " tail")])] }],
      skipped: [{ name: payload, why: payload }]
    });
    const rows = rowsOf(M.asCsv(evil));
    for (const idx of [1, 2]) {
      for (const [col, value] of cells(rows[idx]).entries()) {
        if (!value) continue;
        ok("row " + idx + " col " + col + ": no field begins with " + JSON.stringify(what),
           value[0] !== what && !"=+-@".includes(value[0]), JSON.stringify(value));
      }
    }
    eq("the FILE column is guarded too — it is a name off the reader's disk",
       cells(rows[1])[0][0], "'");
    eq("...and so is the WORD column", cells(rows[1])[3][0], "'");
    eq("...and the skipped row's file column, which is the same untrusted name",
       cells(rows[2])[0][0], "'");
    // The skipped row's REASON needs no apostrophe and must not have one: "NOT SEARCHED: " is
    // written by this code and is already in front of whatever the page said. Asserted rather
    // than assumed, because the day that prefix moves or goes away, this column becomes a
    // stranger's string in column 5 with nothing in front of it.
    eq("...while the reason column is prefixed by our own words and needs no guard",
       cells(rows[2])[4].slice(0, 14), "NOT SEARCHED: ");
  }
}

console.log("asCsv — the BOM");
{
  const csv = M.asCsv(TEXT_RUN);
  ok("asCsv does NOT start with a byte-order mark — the BOM belongs to the file",
     csv[0] !== BOM, JSON.stringify(csv.slice(0, 3)));
  eq("...it starts with the header's first quote", csv[0], '"');

  const file = M.csvDownloadText(TEXT_RUN);
  eq("csvDownloadText starts with the BOM", file[0], BOM);
  eq("...and the rest of it is exactly asCsv", file.slice(1), csv);
  eq("...with exactly one BOM, not one per row", file.split(BOM).length - 1, 1);
}

// ---------------------------------------------------------------------------
// [5] Provenance — the sentences that say what the search WAS.
// ---------------------------------------------------------------------------
// The reason this section exists, in one sentence: a stopped-early run exported as a bare table
// looks complete, and the skipped rows do not say otherwise, because a file the run never
// reached has no row at all.
console.log("asCsv — provenance rows");
{
  const rows = rowsOf(M.asCsv(TEXT_RUN));
  const prov = rows.map(cells).filter((c) => c[0] === LABEL);
  eq("three provenance rows on an ordinary finished run", prov.length, 3);
  for (const c of prov) {
    eq("the label is in column 1 so a sort groups them", c[0], LABEL);
    eq("...columns 2-4 are empty", [c[1], c[2], c[3]], ["", "", ""]);
    ok("...and the sentence is in column 5", c[4].length > 0, JSON.stringify(c));
  }
  // Indexed through a guard for the same reason cells() reports instead of throwing: a module
  // that emitted NO provenance rows would make prov[0] undefined and kill the run here, hiding
  // every later section behind a stack trace about the check that was meant to catch it.
  const sentence = (i) => (prov[i] || ["", "", "", "", ""])[4];
  eq("the query is named", sentence(0), "Searched for: invoice, total");
  eq("the scale is named", sentence(1), "Searched 2 PDF file(s), 10 page(s).");
  ok("the matching rules are named", /Whole-word matching/.test(sentence(2)), sentence(2));
  ok("...and with OCR off it says so", /OCR off/.test(sentence(2)), sentence(2));
  ok("nothing claims the run stopped", !prov.some((c) => /Stopped early/.test(c[4])), JSON.stringify(prov));
  ok("nothing claims the engine failed", !prov.some((c) => /OCR engine could not be loaded/.test(c[4])),
     JSON.stringify(prov));
  // The provenance rows come AFTER the data, so a reader opening the file sees their results
  // first and a script that reads row 2 onward is not handed a sentence where a filename goes.
  ok("the provenance block is at the END of the file",
     rows.slice(-3).every((r) => cells(r)[0] === LABEL), "provenance is not the last block");
}
{
  const stoppedRows = rowsOf(M.asCsv(run({ stopped: true }))).map(cells).filter((c) => c[0] === LABEL);
  eq("a stopped run has one provenance row more than a finished one", stoppedRows.length, 4);
  ok("...and one of them says it stopped early",
     stoppedRows.some((c) => /Stopped early — this is a partial answer\./.test(c[4])), JSON.stringify(stoppedRows));
  const finishedRows = rowsOf(M.asCsv(run({ stopped: false }))).map(cells).filter((c) => c[0] === LABEL);
  ok("a finished run says NOTHING about stopping — the sentence has to mean something",
     !finishedRows.some((c) => /Stopped early/.test(c[4])), JSON.stringify(finishedRows));
}
// ---------------------------------------------------------------------------
// [5a] The SCALE sentence — how many files the run READ, not how many were chosen.
// ---------------------------------------------------------------------------
// ⚠️ WHAT WENT WRONG, measured in a browser walk on 2026-09-12 rather than reasoned about: the page
// built its run object with `searched: chosen.length`, which is how many files the reader PICKED,
// and the loop that reads them breaks the moment Stop is pressed. 800 files chosen, Stop after 65,
// and this sentence said "Searched 800 PDF file(s), 130 page(s)." directly above 65 files' worth of
// rows. The other 735 have no row anywhere in the export — not a hit, not a NOT SEARCHED line — so
// the count was the only thing in the file that referred to them at all, and it referred to them as
// searched.
//
// WHY IT IS ASSERTED IN BOTH FORMS AND BOTH DIRECTIONS. The stopped-early line and this count are
// two halves of one claim, and the half that is a NUMBER is the half a reader believes: a qualifier
// underneath a figure that already says 800 reads as fussiness, not as a correction. So the "N of
// M" form is pinned where it must appear, and the old string is asserted to appear NOWHERE — a
// module that emitted both (a corrected sentence plus a stale one further down, the shape of every
// drift on this site) passes a positive check and fails that one.
//
// AND THE SINGLE-NUMBER FORM IS PINNED TOO, which is the regression half of this section: a run
// that finished must render exactly the bytes it rendered before this field existed. Somebody has
// pasted one of these into an email, and the fixtures above depend on it.
console.log("the scale sentence — files read vs files chosen");
{
  // The sentence, out of either form, found by shape rather than by index: "Searched for: …" also
  // begins with the word, and matching on position would pass for the wrong reason the day a line
  // is inserted above it.
  const scaleOfText = (r) => M.asText(r).split("\n").find((l) => /^Searched \d/.test(l));
  const scaleOfCsv = (r) => rowsOf(M.asCsv(r)).map(cells).filter((c) => c[0] === LABEL)
    .map((c) => c[4]).find((s) => /^Searched \d/.test(s));

  // (1) A COMPLETE RUN, NO `filesRead` FIELD AT ALL — an older caller, or any of the fixtures in
  // this file. It must produce today's exact sentence and never the word "of": the fallback exists
  // so that a missing field means "we do not know, so do not claim", not "Searched undefined of 2".
  const noField = run({ searched: 2, pagesRead: 10 });
  ok("a run object with no filesRead has none", noField.filesRead === undefined, JSON.stringify(noField.filesRead));
  eq("...and the text form says it the way it always has",
     scaleOfText(noField), "Searched 2 PDF file(s), 10 page(s).");
  eq("...and so does the CSV", scaleOfCsv(noField), "Searched 2 PDF file(s), 10 page(s).");
  ok("...with no \"of\" anywhere in the text form's scale sentence",
     !/ of /.test(String(scaleOfText(noField))), String(scaleOfText(noField)));
  // null is folded in with undefined deliberately — an explicitly blanked field means the same
  // thing as one that was never set.
  eq("filesRead: null behaves as absent, not as zero",
     scaleOfCsv(run({ filesRead: null, searched: 2, pagesRead: 10 })),
     "Searched 2 PDF file(s), 10 page(s).");

  // (2) A COMPLETE RUN THAT DOES CARRY THE FIELD. filesRead === searched is what every finished run
  // from the page now looks like, and it must be byte-identical to (1) — the two-number form is for
  // a gap, and a run with no gap must not grow a second number just because the field arrived.
  const complete = run({ filesRead: 2, searched: 2, pagesRead: 10 });
  eq("filesRead === searched renders the single-number sentence in the text form",
     scaleOfText(complete), "Searched 2 PDF file(s), 10 page(s).");
  eq("...and in the CSV", scaleOfCsv(complete), "Searched 2 PDF file(s), 10 page(s).");
  eq("...identical to the same run with the field absent", scaleOfText(complete), scaleOfText(noField));
  eq("...in the CSV too", scaleOfCsv(complete), scaleOfCsv(noField));

  // (3) THE WALK'S OWN NUMBERS. 800 chosen, 65 read, 130 pages, Stop pressed.
  const stopped65 = run({ filesRead: 65, searched: 800, pagesRead: 130, stopped: true });
  eq("a stopped run names both numbers, read first, in the text form",
     scaleOfText(stopped65), "Searched 65 of 800 PDF file(s), 130 page(s).");
  eq("...and in the CSV, which is the form that gets attached to an email",
     scaleOfCsv(stopped65), "Searched 65 of 800 PDF file(s), 130 page(s).");
  // The negative half, over the WHOLE artefact rather than over the one sentence: the old string
  // must be gone, not merely accompanied by a better one.
  ok("the old over-reporting sentence appears NOWHERE in the text form",
     !M.asText(stopped65).includes("Searched 800 PDF file(s)"), M.asText(stopped65).slice(0, 200));
  ok("...nor anywhere in the CSV",
     !M.asCsv(stopped65).includes("Searched 800 PDF file(s)"), M.asCsv(stopped65).slice(0, 200));
  ok("...and the partial-answer line is still there beside it, the other half of the same claim",
     M.asText(stopped65).includes("Stopped early — this is a partial answer."), M.asText(stopped65));
  // A gap with no Stop behind it still gets reported. This is not a shape the page produces today
  // — the loop only ends early on cancel — but the number means "what was read" on its own terms,
  // and a future reason to stop reading files (a time budget, a fatal OCR failure) must not need
  // this module edited to stay honest.
  eq("a gap is reported on its own evidence, not only when stopped is true",
     scaleOfCsv(run({ filesRead: 65, searched: 800, pagesRead: 130, stopped: false })),
     "Searched 65 of 800 PDF file(s), 130 page(s).");

  // (4) THE STOPPED ZERO-MATCH RUN — no files, no hits, nothing skipped, and the one case where
  // this sentence is the entire content of the export. A bare "Searched 800 PDF file(s)" above "No
  // matches." is an assertion of absence over 770 files nobody opened, which is the exact
  // inference this whole tool exists to prevent. Both halves of the claim are required here.
  const emptyStopped = run({ matchCount: 0, files: [], skipped: [],
                             filesRead: 30, searched: 800, pagesRead: 45, stopped: true });
  const emptyText = M.asText(emptyStopped);
  eq("a zero-match stopped run still names what it read", scaleOfText(emptyStopped),
     "Searched 30 of 800 PDF file(s), 45 page(s).");
  ok("...and says it stopped early", emptyText.includes("Stopped early — this is a partial answer."), emptyText);
  ok("...and still says No matches., because an empty export reads as a broken one",
     emptyText.includes("No matches."), emptyText);
  ok("...and claims nothing about the 770 files it never opened",
     !emptyText.includes("Searched 800 PDF file(s)"), emptyText);
  const emptyProv = rowsOf(M.asCsv(emptyStopped)).map(cells).filter((c) => c[0] === LABEL);
  eq("the CSV of that run carries the same two sentences", [
    emptyProv.some((c) => c[4] === "Searched 30 of 800 PDF file(s), 45 page(s)."),
    emptyProv.some((c) => /Stopped early — this is a partial answer\./.test(c[4]))
  ], [true, true]);
  ok("...and not the over-reporting one", !M.asCsv(emptyStopped).includes("Searched 800 PDF file(s)"),
     M.asCsv(emptyStopped).slice(0, 300));

  // (5) STOPPED BEFORE A SINGLE FILE WAS OPENED. filesRead is 0, which is falsy — the case a
  // `filesRead || searched` fallback would silently turn back into the bug, reporting all 800 as
  // searched on the run where not one file was read. Nothing here may throw either: this is
  // reachable by pressing Stop while the first progress line is still painting.
  const readNone = run({ matchCount: 0, files: [], skipped: [],
                         filesRead: 0, searched: 800, pagesRead: 0, stopped: true });
  let threw = null;
  try { M.asText(readNone); M.asCsv(readNone); M.csvDownloadText(readNone); }
  catch (err) { threw = err; }
  ok("filesRead: 0 does not throw in any of the three forms", threw === null, threw && threw.message);
  eq("...and zero is reported as zero, not swallowed by a falsy fallback",
     scaleOfText(readNone), "Searched 0 of 800 PDF file(s), 0 page(s).");
  eq("...in the CSV as well", scaleOfCsv(readNone), "Searched 0 of 800 PDF file(s), 0 page(s).");
  ok("...and the 800 is not claimed as read anywhere",
     !M.asCsv(readNone).includes("Searched 800 PDF file(s)"), M.asCsv(readNone).slice(0, 300));
}

{
  const failedRows = rowsOf(M.asCsv(run({ ocrOn: true, engineFailed: "network refused" })))
    .map(cells).filter((c) => c[0] === LABEL);
  ok("an engine failure reaches the CSV",
     failedRows.some((c) => /OCR engine could not be loaded/.test(c[4])), JSON.stringify(failedRows));
  ok("...naming the reason the page was given",
     failedRows.some((c) => c[4].includes("network refused")), JSON.stringify(failedRows));
  ok("...and saying what WAS searched, so the rows below still mean something",
     failedRows.some((c) => /everything with a text layer was searched/i.test(c[4])), JSON.stringify(failedRows));
  const okRows = rowsOf(M.asCsv(run({ ocrOn: true, engineFailed: null })))
    .map(cells).filter((c) => c[0] === LABEL);
  ok("a run whose engine loaded says nothing about a failure",
     !okRows.some((c) => /could not be loaded/.test(c[4])), JSON.stringify(okRows));
}
{
  // exportHeaderLine's THREE states all have to reach the CSV. The third — OCR on over a set
  // that held no scanned page — is the one a two-state header gets wrong, and it would tell the
  // reader's colleague "OCR off" about a run whose box was ticked.
  const line = (r) => rowsOf(M.asCsv(r)).map(cells).filter((c) => c[0] === LABEL)
    .map((c) => c[4]).find((s) => /Whole-word matching/.test(s));
  ok("OCR pages read: the header says how many and that they are marked",
     /2 pages read by OCR/.test(line(run({ ocrOn: true, ocrPages: 2 })))
     && /marked OCR/.test(line(run({ ocrOn: true, ocrPages: 2 }))), String(line(run({ ocrOn: true, ocrPages: 2 }))));
  ok("OCR on with nothing to read: it says that, and does NOT say OCR off",
     /OCR was on, and no scanned pages were found to read/.test(line(run({ ocrOn: true, ocrPages: 0 })))
     && !/OCR off/.test(line(run({ ocrOn: true, ocrPages: 0 }))), String(line(run({ ocrOn: true, ocrPages: 0 }))));
  ok("OCR off: it says scanned pages were not searched",
     /OCR off: scanned pages were not searched/.test(line(run({ ocrOn: false, ocrPages: 0 }))),
     String(line(run({ ocrOn: false, ocrPages: 0 }))));
}

// ---------------------------------------------------------------------------
// [6] Skipped files — the gap you can see.
// ---------------------------------------------------------------------------
// "A gap you can see beats a gap you cannot" is the page's own sentence, and it is worth more in
// an export than on screen: the person holding the file cannot ask what was not read.
console.log("skipped files survive both forms");
{
  const skippedRun = run({
    matchCount: 1,
    files: [{ name: "a.pdf", hits: [hit(1, "text", [snip("", "invoice", " here")])] }],
    skipped: [{ name: "scan.pdf", why: "every page is a scan and OCR was off" },
              { name: "locked.pdf", why: "needs a password to open" }]
  });
  const rows = rowsOf(M.asCsv(skippedRun));
  eq("row count = header + 1 snippet + 2 skipped + 3 provenance", rows.length, 1 + 1 + 2 + 3);
  const s1 = cells(rows[2]);
  eq("the skipped file's name is in column 1", s1[0], "scan.pdf");
  eq("...page, source and word are empty", [s1[1], s1[2], s1[3]], ["", "", ""]);
  eq("...and the reason is in column 5, prefixed so a sort finds them",
     s1[4], "NOT SEARCHED: every page is a scan and OCR was off");
  eq("the second skipped file is there too", cells(rows[3])[4], "NOT SEARCHED: needs a password to open");

  const text = M.asText(skippedRun);
  ok("the text form heads the block", text.includes("Not fully searched:"), text);
  ok("...names the file", text.includes("scan.pdf"), text);
  ok("...and carries the reason", text.includes("every page is a scan and OCR was off"), text);
  ok("...for the second file as well", text.includes("locked.pdf — needs a password to open"), text);
}

// ---------------------------------------------------------------------------
// [7] asText — the form a person reads.
// ---------------------------------------------------------------------------
console.log("asText");
{
  const text = M.asText(TEXT_RUN);
  const lines = text.split("\n");
  eq("line 1 names the query", lines[0], "Searched for: invoice, total");
  eq("line 2 names the scale", lines[1], "Searched 2 PDF file(s), 10 page(s).");
  ok("line 3 is the matching-rules header", /Whole-word matching/.test(lines[2]), lines[2]);
  eq("line 4 is blank, separating the header from the results", lines[3], "");
  eq("then the file name, at column 0", lines[4], "2026/march.pdf");
  eq("then an indented p.N line", lines[5], "  p.4  the invoice for March");
  ok("a text-layer hit carries NO [OCR] marker", !text.includes("[OCR]"), text);
}
{
  const stopped = M.asText(run({ stopped: true }));
  ok("a stopped run says so, on its own line, third",
     stopped.split("\n")[2] === "Stopped early — this is a partial answer.", JSON.stringify(stopped.split("\n").slice(0, 4)));
  ok("a finished run does not", !M.asText(run({})).includes("Stopped early"), M.asText(run({})));
}
{
  // The [OCR] marker is the text form's whole honesty about a match it cannot fully vouch for,
  // and it must appear on the OCR hits and ONLY on them — a marker on every line says nothing.
  const mixed = run({
    matchCount: 2, ocrOn: true, ocrPages: 1,
    files: [{ name: "mixed.pdf", hits: [
      hit(1, "ocr", [snip("scanned ", "invoice", " line")]),
      hit(2, "text", [snip("typed ", "invoice", " line")])
    ] }]
  });
  const lines = M.asText(mixed).split("\n");
  const ocrLine = lines.find((l) => l.includes("scanned"));
  const textLine = lines.find((l) => l.includes("typed"));
  eq("the OCR hit is marked", ocrLine, "  p.1 [OCR]  scanned invoice line");
  eq("the text hit is not", textLine, "  p.2  typed invoice line");
  eq("exactly one line carries the marker", lines.filter((l) => l.includes("[OCR]")).length, 1);
}
{
  // The snippets this page produces are full of ellipses — buildSnippet puts one at each
  // truncated end — so the character has to survive both forms untouched. It is not whitespace
  // and oneLine must not treat it as any.
  const ell = run({
    matchCount: 1,
    files: [{ name: "a.pdf", hits: [hit(3, "text", [snip("…the ", "invoice", " was…")])] }]
  });
  ok("the text form round-trips an ellipsis intact", M.asText(ell).includes("…the invoice was…"), M.asText(ell));
  eq("and so does the CSV", cells(rowsOf(M.asCsv(ell))[1])[4], "…the invoice was…");
}
{
  // A newline inside a snippet destroys the indentation of the text form: the tail of the
  // sentence lands in column 0, where it reads as a new file heading.
  const broken = run({
    matchCount: 1,
    files: [{ name: "a.pdf", hits: [hit(5, "text", [snip("first\nline ", "invoice", " second\nline")])] }]
  });
  const lines = M.asText(broken).split("\n");
  // Matched on the p.N prefix rather than on the needle: "Searched for: invoice" is a line
  // containing the needle too, and counting it would have made this assertion pass for the
  // wrong reason.
  eq("a snippet with newlines is ONE line", lines.filter((l) => l.startsWith("  p.5")).length, 1);
  eq("...and the whole snippet is on it", lines.find((l) => l.startsWith("  p.5")),
     "  p.5  first line invoice second line");
  for (const l of lines) {
    ok("no result line begins with a bare word where an indent belongs: " + JSON.stringify(l),
       l === "" || l.startsWith("  ") || !l.startsWith(" "), JSON.stringify(l));
  }
}
{
  const none = M.asText(run({ matchCount: 0, files: [], skipped: [] }));
  ok("no files at all still says No matches.", none.includes("No matches."), none);
  ok("...and is not empty", none.length > 0, JSON.stringify(none));
  ok("...and still names the query, so the reader knows what found nothing",
     none.includes("Searched for: invoice"), none);
  ok("...and still names the scale", none.includes("Searched 2 PDF file(s), 10 page(s)."), none);
  ok("...and still says what the matching rules were", /Whole-word matching/.test(none), none);
  ok("...and claims no skipped block it does not have", !none.includes("Not fully searched:"), none);
  // The same run through the CSV: no data rows, but the provenance is still there, so a zero-row
  // table is never handed over with nothing saying what it was a search FOR.
  const rows = rowsOf(M.asCsv(run({ matchCount: 0, files: [], skipped: [] })));
  eq("the CSV of an empty result is header + provenance only", rows.length, 1 + 3);
  ok("...and the provenance is present", cells(rows[1])[0] === LABEL, rows[1]);
}
{
  const withFiles = M.asText(TEXT_RUN);
  ok("a run WITH matches does not say No matches.", !withFiles.includes("No matches."), withFiles);
}

// ---------------------------------------------------------------------------
// [8] Empty input — nothing here may throw.
// ---------------------------------------------------------------------------
// These are reachable from the page: the buttons are hidden until a run exists, but `lastRun` is
// null on first load and a handler that throws leaves the reader with a dead button and no line
// of explanation anywhere.
console.log("no run at all");
eq("asText(null) is the empty string", M.asText(null), "");
eq("asCsv(null) likewise", M.asCsv(null), "");
eq("csvDownloadText(null) likewise — and NOT a lone BOM", M.csvDownloadText(null), "");
eq("asText(undefined)", M.asText(undefined), "");
eq("asCsv(undefined)", M.asCsv(undefined), "");
eq("csvDownloadText(undefined)", M.csvDownloadText(undefined), "");
eq("asText() with no argument", M.asText(), "");
eq("asCsv() with no argument", M.asCsv(), "");
eq("csvDownloadText() with no argument", M.csvDownloadText(), "");

// ---------------------------------------------------------------------------
// [9] exportFilename — a LOCAL date, not a UTC one.
// ---------------------------------------------------------------------------
console.log("exportFilename");
eq("csv", M.exportFilename("csv", new Date(2026, 8, 11, 2, 0)), "pdf-search-results-2026-09-11.csv");
eq("txt", M.exportFilename("txt", new Date(2026, 8, 11, 2, 0)), "pdf-search-results-2026-09-11.txt");
eq("a single-digit month and day are zero-padded",
   M.exportFilename("csv", new Date(2026, 0, 5, 12, 0)), "pdf-search-results-2026-01-05.csv");
eq("December is 12, not 11 — getMonth is zero-based",
   M.exportFilename("csv", new Date(2026, 11, 31, 12, 0)), "pdf-search-results-2026-12-31.csv");
eq("the last day of a leap February",
   M.exportFilename("txt", new Date(2028, 1, 29, 12, 0)), "pdf-search-results-2028-02-29.txt");
{
  // ⚠️ THE LOCAL-VS-UTC CASE, PROVEN RATHER THAN ARGUED. This Date is constructed with the LOCAL
  // constructor, so its local calendar day is whatever the local fields say — and the assertion
  // is that the filename follows THOSE, not toISOString(). East of UTC, 00:30 local on the 11th
  // is still the 10th in UTC, so a reader in IST exporting after midnight would be handed a file
  // stamped yesterday and would go looking for it under yesterday next week. West of UTC the
  // error runs the other way, late in the evening. The check is written so it is meaningful in
  // whichever direction the machine running it happens to sit: it only asserts when the two
  // dates really do differ, and it says so when they do not.
  const probes = [new Date(2026, 8, 11, 0, 30), new Date(2026, 8, 11, 23, 30),
                  new Date(2026, 0, 1, 0, 1), new Date(2026, 11, 31, 23, 59)];
  let sawDivergence = false;
  for (const d of probes) {
    const local = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")
                + "-" + String(d.getDate()).padStart(2, "0");
    const utc = d.toISOString().slice(0, 10);
    eq("the filename follows the LOCAL calendar day (" + d.toString().slice(0, 24) + ")",
       M.exportFilename("csv", d), "pdf-search-results-" + local + ".csv");
    if (local !== utc) {
      sawDivergence = true;
      ok("...and it is NOT the UTC day, which here is " + utc,
         !M.exportFilename("csv", d).includes(utc), M.exportFilename("csv", d));
    }
  }
  // Not an assertion about the code — an assertion about this RUN, so a green on a UTC machine
  // is not mistaken for evidence about the case that only a shifted machine can show.
  console.log("  note: local/UTC dates " + (sawDivergence
    ? "diverged on at least one probe — the UTC case was exercised on this machine"
    : "never diverged here (TZ=" + (process.env.TZ || "system") + ", probably UTC) — "
      + "re-run with TZ=Asia/Kolkata to exercise it"));
}
{
  // The synthetic case, which is exercised on EVERY machine including a UTC one: a fixed instant
  // read through an explicitly shifted timezone. It cannot use exportFilename (that reads the
  // ambient zone), so it pins the rule the function implements — local fields, not the ISO
  // string — against a Date whose two answers are known to differ.
  const instant = new Date(Date.UTC(2026, 8, 10, 20, 30));      // 10 Sep 20:30 UTC
  const ist = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric",
    month: "2-digit", day: "2-digit" }).format(instant);        // = 2026-09-11, the NEXT day
  eq("the fixture really does straddle midnight in IST", ist, "2026-09-11");
  eq("...while UTC still calls it the 10th", instant.toISOString().slice(0, 10), "2026-09-10");
  ok("...so toISOString() and the local day are genuinely different answers, which is the bug"
     + " exportFilename exists to avoid", ist !== instant.toISOString().slice(0, 10));
}
console.log("exportFilename — an unknown kind");
for (const bad of ["pdf", "CSV", "", null, undefined, "txt ", 0]) {
  let threw = null;
  try { M.exportFilename(bad, new Date(2026, 8, 11)); } catch (err) { threw = err; }
  ok("kind " + JSON.stringify(bad) + " throws rather than naming a file wrongly", threw !== null, "it returned a name");
  ok("...and the message names the two kinds that work",
     threw && /csv/.test(threw.message) && /txt/.test(threw.message), threw && threw.message);
}
eq("with no date it uses the real clock and still produces the shape",
   /^pdf-search-results-\d{4}-\d{2}-\d{2}\.csv$/.test(M.exportFilename("csv")), true);

// ---------------------------------------------------------------------------
// [10] Performance, as a NAMED NUMBER.
// ---------------------------------------------------------------------------
// A budget with a clock in it is only honest where the clock means something: this is local,
// pure CPU, no I/O and no rented shared runner, which is the one place the global CI rule says a
// wall-clock assertion belongs. 5,000 snippet rows is a folder of a few hundred documents with
// a common word in it — well past what a reader will ever export — and 100 ms is two orders of
// magnitude of headroom over the measured time, so it fails for a real reason (a quadratic
// string concatenation, a regex rebuilt per field) rather than for machine load.
console.log("5,000 rows");
{
  const files = [];
  for (let f = 0; f < 50; f++) {
    const hits = [];
    for (let p = 0; p < 100; p++) {
      hits.push(hit(p + 1, p % 7 === 0 ? "ocr" : "text",
        [snip("…some text before the ", "invoice", " and a fair amount of text after it, with a\ncomma, a \"quote\" and an =formula …")]));
    }
    files.push({ name: "folder/deep/file-" + f + ".pdf", hits });
  }
  const big = run({ matchCount: 5000, files, searched: 50, pagesRead: 5000 });
  const t0 = Date.now();
  const csv = M.asCsv(big);
  const ms = Date.now() - t0;
  eq("5,000 snippets produce 5,000 data rows", rowsOf(csv).length, 1 + 5000 + 0 + 3);
  ok("asCsv over 5,000 rows completes in under 100 ms — measured " + ms + " ms", ms < 100, ms + " ms");
  console.log("  measured: asCsv over 5,000 rows in " + ms + " ms");
  // The guard still holds at scale, and the last data row is as quoted as the first — a check
  // against anything that special-cases the head of the file.
  const last = cells(rowsOf(csv)[5000]);
  eq("the last data row still has five fields", last.length, 5);
  ok("...and its text field still starts with the ellipsis, not a formula character",
     last[4].startsWith("…"), JSON.stringify(last[4].slice(0, 20)));
  const t1 = Date.now();
  const text = M.asText(big);
  const textMs = Date.now() - t1;
  ok("asText over the same run completes in under 100 ms — measured " + textMs + " ms", textMs < 100, textMs + " ms");
  console.log("  measured: asText over 5,000 rows in " + textMs + " ms");
  ok("...and produced something the size of the run", text.length > 100000, String(text.length));
}

// ---------------------------------------------------------------------------
// [11] The module names no off-origin URL. Pinned as text.
// ---------------------------------------------------------------------------
// Same belt-and-braces as prove-folder-memory.mjs [8], and check-answers.sh reads this file too
// under NETWORK. Every tool page on this site claims the reader's files never leave their
// browser, and a module served to the browser is as much a part of that claim as the page —
// including in a comment, because a comment is where a "temporary" fallback URL gets parked.
console.log("no off-origin URL anywhere in the module");
{
  const src = readFileSync(MODULE_PATH, "utf8");
  ok("the module source was read at all", src.length > 0, String(src.length));
  ok("no https:// anywhere in it, code or comment", !src.includes("https://"), "found one");
  ok("no http:// either", !src.includes("http://"), "found one");
  // ONE import, and it is the sibling module. A second one is not forbidden by anything but
  // this line, and the reason it matters is page weight: ocr.mjs keeps its ~6 MB engine behind
  // a lazy import, so importing two pure functions from it costs page load nothing. An import
  // of something that is not local, or is not lazy behind its own banner, would.
  const imports = src.match(/^\s*import\s[^\n]*$/gm) || [];
  eq("exactly one import statement", imports.length, 1);
  ok("...and it is ./ocr.mjs, relative and same-origin", /from\s+"\.\/ocr\.mjs"/.test(imports[0]), imports[0]);
}

done();
