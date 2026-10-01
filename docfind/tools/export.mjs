// export.mjs — the three forms a result can leave /tools/search-multiple-pdfs in: the copied
// text, the CSV, and the name of the file it is saved as.
//
// WHY A MODULE AND NOT TWENTY LINES IN THE PAGE. Until this milestone `asText` and `asCsv` lived
// inline in a <script type="module"> in the page, which means no prover has ever read a single
// line of them — the same reason pdf-text.mjs, ocr.mjs and folder-memory.mjs exist, and the same
// 2026-09-08 lesson that produced them. The export is the ONE artefact of this page that outlives
// the tab: it is the thing a reader hands to a colleague, a solicitor, an accountant, who cannot
// see which boxes were ticked and has no way to ask. Every claim it carries has to be true of a
// run nobody is standing over, and a claim no gate reads is a claim nobody is keeping.
//
// PURE, ON PURPOSE. Nothing here touches the DOM, `window`, or the page's `lastRun`; every
// function is a function of the run object it is handed. That is what makes `node
// tools/prove-export.mjs` able to run the SHIPPED code rather than a copy of it — the Blob, the
// object URL and the `download` attribute stay in the page, because those are the parts Node
// cannot execute and therefore the parts a prover must not pretend to cover.
//
// THE ONE IMPORT, and what it costs. ocr.mjs has no top-level imports of its own — the ~6 MB
// tesseract engine is a lazy import inside ensureWorker() — so pulling two pure sentence-builders
// out of it adds nothing to page load. They are imported rather than copied because the export
// header is a CLAIM about OCR ("those matches are marked OCR"), and two copies of a claim drift.
import { exportHeaderLine, engineFailureLine } from "./ocr.mjs";

// The five column names, in order, as data rather than as a literal inside asCsv. A reader who
// opens the CSV sorts and filters by these; prove-export.mjs asserts the header row is exactly
// this list, so a renamed column cannot slip out under a spreadsheet formula that still refers
// to the old one.
export const CSV_COLUMNS = ["file", "page", "source", "word", "text around the match"];

// The literal that marks the provenance rows in column 1. In column 1 rather than appended at
// the bottom as a comment, because the first thing anybody does to a CSV is sort it — and a
// trailing block of sentences with an empty first column scatters into the middle of the data
// the moment they do. A repeated literal groups instead.
export const PROVENANCE_LABEL = "ABOUT THIS SEARCH";

// Every whitespace run — newlines, tabs, runs of spaces — to a single space, then trimmed.
//
// PDF TEXT EXTRACTION YIELDS EMBEDDED NEWLINES, and they are not decorative: a PDF stores text
// as positioned runs, so a sentence that wraps on the page comes back with a line break inside
// it. In the CSV a raw newline inside a quoted field is legal RFC-4180 and is still the most
// common way a CSV breaks, because plenty of readers (and every naive split-on-newline script)
// turn one row into three. In the text form it is worse than broken: the snippet lines are
// indented `  p.N  `, and a newline mid-snippet drops the rest of the sentence into column 0
// where it reads as a new file heading.
export function oneLine(s) {
  return String(s === undefined || s === null ? "" : s).replace(/\s+/g, " ").trim();
}

// Fields that would be read as a formula by a spreadsheet. `-` is in the list even though a
// negative number is a perfectly ordinary cell value: this column set contains no numeric
// column that a reader computes with (page numbers are integers with no sign), so nothing is
// lost by guarding it, and `-2+3+cmd|…` is the documented bypass for a guard that omits it.
// The leading tab and CR are belt and braces — oneLine has already removed both by the time
// the test runs — because the order of those two steps is exactly the kind of thing a later
// edit reverses, and then the guard is reading a string it no longer recognises.
const FORMULA_START = /^[=+\-@\t\r]/;

// One CSV field: flattened, guarded, and quoted. Exported so the prover can hit the rule
// directly rather than inferring it from an assembled row.
//
// ⚠️ THE GUARD IS THE POINT OF THIS FUNCTION, and it is not a style rule. The text in these
// fields comes out of a stranger's PDF, and the file name comes off the reader's disk — neither
// is a string this code wrote. A cell whose value begins `=` is a FORMULA, and
// `=cmd|'/c calc'!A1` in a cell is code execution on the machine of whoever opens the file.
// That is the whole threat model of CSV injection, and the export is precisely the artefact
// that travels to a machine the reader does not control. So the guard applies to EVERY field —
// the filename included, which is why prove-export.mjs runs the same table through the file
// column. A guard that covers only "the text ones" covers the column an attacker does not need.
//
// HOW HONEST THIS IS, said out loud: what the leading apostrophe guarantees MECHANICALLY is
// that no emitted field begins with a formula character — that is an assertion about bytes, and
// it is the assertion the prover makes. What the reader SEES differs by application, and there
// is no portable escape that is both invisible everywhere and inert everywhere; inert everywhere
// is the property worth having.
//
// MEASURED, not assumed — Numbers 14.x, macOS 15, 2026-09-11, by opening a deliberately hostile
// export and reading the PARSED CELL VALUES back out through AppleScript rather than looking at
// a screenshot. `@SUM(1+1).pdf` in the file column came back as the literal text `'@SUM(1+1).pdf`
// and NOT as `2`; `=cmd|'/c calc'!A1` came back as text and evaluated nothing. So the guard
// holds where it matters. The cost, and it is a real one a reader can see: **Numbers DISPLAYS
// the apostrophe** rather than consuming it as a text marker the way Excel does. That is the
// trade accepted here — a visible `'` in front of the handful of fields that begin with a
// formula character, in exchange for a file that cannot execute anything on a colleague's
// machine. It affects only fields whose FIRST character is `= + - @`, which in real documents is
// rare; handoff/bugs.md records it so it is not rediscovered as a bug.
// This paragraph exists because the sentence it replaced said Numbers "has changed its mind
// between versions" — a hedge standing in for a measurement that took one command to make.
//
// The order is fixed and the prover depends on it: stringify → oneLine → guard → quote. Guarding
// before flattening would miss `"\n=cmd…"`, whose formula character is not leading until oneLine
// has trimmed; quoting before guarding would test the `"` rather than the payload.
export function csvField(v) {
  const flat = oneLine(String(v === undefined || v === null ? "" : v));
  const guarded = FORMULA_START.test(flat) ? "'" + flat : flat;
  return '"' + guarded.replace(/"/g, '""') + '"';
}

const csvRow = (cells) => cells.map(csvField).join(",");

// The sentences that say what the search WAS, rather than what it found. Shared by both forms
// so they cannot drift: asText has carried them since the tool shipped, asCsv did not, and the
// CSV is the form that travels furthest.
//
// Order is the reader's order, not the code's: what was searched for, how much was searched,
// whether it finished, what the matching rules were, and last whatever went wrong.
// "Partial answer" rather than "cancelled": the reader knows they pressed Stop, the colleague
// they send this to does not, and what that person needs to know is that an absence here is not
// evidence. A constant because both forms print it and the prover greps for it.
const STOPPED_EARLY = "Stopped early — this is a partial answer.";

function provenanceSentences(r) {
  const lines = [];
  lines.push("Searched for: " + r.needles.join(", "));
  // ⚠️ TWO NUMBERS, AND THE ONE THAT GOES FIRST IS THE ONE THE RUN ACTUALLY READ. `searched` is
  // how many files the reader CHOSE; `filesRead` is how many the run got to before it ended. On a
  // run that finished they are the same number and this sentence is the one it has always been.
  // On a run the reader STOPPED they are not, and the old sentence reported the larger one: a walk
  // on 2026-09-12 chose 800 files, pressed Stop after 65, and the export said "Searched 800 PDF
  // file(s), 130 page(s)." above 65 files' worth of rows. 735 files were never opened and have no
  // row anywhere in this file — not a hit, not a skipped line, nothing — so the count was the only
  // thing in the export that mentioned them, and what it said about them was false.
  //
  // WHY THAT IS WORSE HERE THAN ON SCREEN. This sentence sits directly above rows a colleague
  // reads without being able to ask what happened. "Searched 800" next to 65 files of rows invites
  // precisely the inference STOPPED_EARLY exists to prevent — that the 735 absences are evidence
  // of absence. The two sentences are two halves of ONE claim about the same run and must not
  // drift: if this count ever goes back to reporting the chosen total, the line below it becomes a
  // qualifier on a number that already contradicts it.
  //
  // THE undefined FALLBACK IS BACKWARD COMPATIBILITY, not defensiveness. A run object from before
  // this field existed — an older caller, and the prover fixtures that pin today's bytes — has no
  // `filesRead` at all, and must still produce the exact single-number sentence rather than
  // "Searched undefined of 800". null is folded in with it because a field that is explicitly
  // blanked means the same thing as one that was never set: we do not know, so do not claim.
  const read = (r.filesRead === undefined || r.filesRead === null) ? r.searched : r.filesRead;
  lines.push(read === r.searched
    ? "Searched " + r.searched + " PDF file(s), " + r.pagesRead + " page(s)."
    : "Searched " + read + " of " + r.searched + " PDF file(s), " + r.pagesRead + " page(s).");
  // ONLY WHEN IT REALLY STOPPED. A sentence that is always present is a sentence nobody reads,
  // and this is the one that changes what the rows below it mean.
  if (r.stopped) lines.push(STOPPED_EARLY);
  lines.push(exportHeaderLine(r));
  if (r.engineFailed) lines.push(engineFailureLine(r.engineFailed));
  return lines;
}

// The copied/downloaded text form. A pure function of the run — the page's `lastRun` is passed
// in rather than reached for, which is the only difference from the version that lived inline.
//
// THE LINE ORDER IS PART OF THE ARTEFACT and is deliberately unchanged: header sentences, blank
// line, then one block per file, then the not-fully-searched list last. Someone has already
// pasted one of these into an email.
export function asText(run) {
  const r = run;
  if (!r) return "";
  const lines = provenanceSentences(r);
  lines.push("");
  for (const f of r.files) {
    lines.push(f.name);
    for (const hit of f.hits) {
      for (const s of hit.snippets) {
        // The [OCR] marker is the text form's whole honesty about a match it cannot fully
        // vouch for — the same promise exportHeaderLine's "those matches are marked OCR" makes
        // two lines above. oneLine is applied to the assembled snippet, not to its three parts
        // separately, so a break that falls between `before` and `hit` collapses too.
        lines.push("  p." + hit.page + (hit.source === "ocr" ? " [OCR]" : "")
                   + "  " + oneLine(s.before + s.hit + s.after));
      }
    }
    lines.push("");
  }
  // "No matches." rather than an empty gap: a text file containing only a header reads as a
  // broken export, and the difference between "found nothing" and "produced nothing" is the
  // difference this whole tool exists to make visible.
  if (!r.files.length) lines.push("No matches.", "");
  if (r.skipped.length) {
    lines.push("Not fully searched:");
    for (const s of r.skipped) lines.push("  " + s.name + " — " + s.why);
  }
  return lines.join("\n");
}

// The CSV BODY — no byte-order mark. The BOM belongs to the downloaded FILE, not to the CSV, so
// it is added by csvDownloadText below where a prover can see it; a `"﻿" + asCsv()` inline
// in the page was a property of the export that nothing could assert.
//
// CRLF, because RFC 4180 says CRLF and because Excel on Windows is the single most likely place
// this file is opened.
export function asCsv(run) {
  const r = run;
  if (!r) return "";
  // `source` is a column rather than a note, so a spreadsheet can filter the OCR rows out — a
  // match from a model that can misread is a different kind of fact from one read off a text
  // layer, and an export that flattens the two is an export that hides it. UNCONDITIONAL: the
  // column is present even on a run where OCR never ran, because a column that appears only
  // sometimes breaks every saved filter and every script pointed at this file, and its absence
  // would silently mean "text" to a reader who never saw the other shape.
  const rows = [csvRow(CSV_COLUMNS)];
  for (const f of r.files) {
    for (const hit of f.hits) {
      for (const s of hit.snippets) {
        rows.push(csvRow([f.name, hit.page, hit.source === "ocr" ? "ocr" : "text",
                          s.hit, s.before + s.hit + s.after]));
      }
    }
  }
  for (const s of r.skipped) {
    rows.push(csvRow([s.name, "", "", "", "NOT SEARCHED: " + s.why]));
  }

  // ⚠️ WHY THE PROVENANCE ROWS EXIST, and this was a real gap rather than a nicety. A run that
  // was STOPPED half way through exported as a bare table looks exactly like a complete one:
  // the columns are full, the rows are plausible, and nothing in them says the search ended
  // early — the skipped list does NOT cover it, because a file the run never reached is not a
  // file the run skipped, it is a file the run has no row for at all. asText has carried these
  // sentences since the tool shipped; the CSV was the form that lost them, and the CSV is the
  // form that gets attached to an email. The same argument covers the other four: the reader's
  // colleague cannot see the query box, the file count, the matching rules, or whether the OCR
  // engine failed to load, and every one of those changes what "no match for that word" means.
  for (const sentence of provenanceSentences(r)) {
    rows.push(csvRow([PROVENANCE_LABEL, "", "", "", sentence]));
  }
  return rows.join("\r\n");
}

// What actually gets written to disk: the CSV with a UTF-8 byte-order mark in front of it.
//
// THE BOM IS NOT DECORATION. Excel opens a .csv without one as the machine's legacy code page,
// so a filename or a snippet containing anything outside ASCII — an é, a €, the ellipsis this
// page's snippets are full of — arrives as mojibake, and the reader's first conclusion is that
// the tool mangled their document. It lives HERE, in a named function, rather than inline at
// the download site, so that "the downloaded file starts with a BOM" is a property a prover can
// assert about the same code the page runs.
export function csvDownloadText(run) {
  if (!run) return "";
  return "﻿" + asCsv(run);
}

const KINDS = { csv: "csv", txt: "txt" };
const two = (n) => (n < 10 ? "0" : "") + n;

// The name the browser offers in the save dialog. Dated, so a reader who exports the same
// folder twice in a week ends up with two files rather than one silently overwritten.
//
// LOCAL DATE, NOT toISOString(). `toISOString()` is UTC, and this page's readers are not: at
// 02:00 on the 12th in IST (UTC+5:30) the UTC date is still the 11th, so a reader exporting
// after midnight would be handed a file stamped with yesterday — and would find it filed under
// yesterday next week when they went looking. getFullYear/getMonth/getDate are the local
// calendar fields by definition, which is the whole reason they are used here instead of the
// one-liner. getMonth() is zero-based; the +1 is not a fencepost bug.
//
// AN UNKNOWN KIND THROWS. The alternative — falling back to .txt — produces a file with the
// wrong extension and no error, which is the failure this page spends its whole existence
// arguing against. There are exactly two callers and both are in this repo, so a throw is a
// bug found at the first click rather than a wrong file found next month.
export function exportFilename(kind, date) {
  const ext = KINDS[kind];
  if (!ext) throw new Error("exportFilename: unknown kind " + JSON.stringify(kind) + " — expected \"csv\" or \"txt\"");
  const d = date instanceof Date ? date : new Date();
  return "pdf-search-results-"
       + d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate())
       + "." + ext;
}
