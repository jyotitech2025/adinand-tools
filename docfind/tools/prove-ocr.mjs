#!/usr/bin/env node
//
// prove-ocr.mjs — runs the OCR model that /tools/search-multiple-pdfs will ship, against a
// table of cases and against a real PNG through the real tesseract engine, with every
// network primitive in the process replaced by a thrower.
//
//   node tools/prove-ocr.mjs            (run from site/)
//
// IT TESTS THE FILE THE PAGE IMPORTS — tools/ocr.mjs — and it ties that file's /vendor/
// paths to bytes: each vendored tesseract asset is sha256-compared against the copy npm
// installed, so "the prover ran it in Node" is a statement about the same bytes a browser
// will fetch. Without that comparison a Node run proves something about node_modules and
// nothing about the website.
//
// The hazard this exists for is specific and silent. tesseract.js's defaults point at a CDN
// for the worker, a CDN for the WebAssembly core and a CDN for the language model, and it
// falls back to them for any option left unset. In a browser the CSP turns that into a
// console error on a page whose whole claim is that nothing leaves your browser. Here, a
// preload (tools/no-network.cjs) makes it an exception instead — and check [8] proves the
// preload really reaches tesseract's worker thread rather than assuming it does.
//
// WHAT IT DOES NOT COVER, said out loud so the gap is not mistaken for coverage:
//   - pdf.js page RENDERING to a bitmap is browser-only: Node has no canvas, and adding the
//     native `canvas` package would be a build dependency that proves nothing about a
//     browser anyway. So the render → bitmap → OCR chain — the actual thing the page does
//     to a scan — is proven only by the WT1b browser walk. Here, only the files pdf.js needs
//     to decode a scanner's images are asserted to exist [6]. Concretely, ocr.mjs's last two
//     exports — renderPageToCanvas and releaseCanvas — are NOT exercised by this file at all;
//     everything else in that module is.
//   - SIMD vs relaxed-SIMD vs plain core SELECTION is browser-only. tesseract.js in Node
//     loads its core from node_modules and ignores corePath entirely; the browser worker
//     picks one of the three vendored cores by wasm-feature-detect. This file proves all
//     three are present and byte-correct, never which one a given browser takes.
//   - The CSP and site/_headers are only real in a browser. check-answers.sh reads them as
//     text; nothing here enforces them.
//   - The English-only, can-misread, no-handwriting COPY is a claim gate matter, not a
//     prover matter: see check-answers.sh rule TOOLCAP.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, "..");
const PRELOAD = resolve(HERE, "no-network.cjs");
const THIS_FILE = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------
// [0] Re-exec under the preload, if we are not already under it.
// ---------------------------------------------------------------------------
// `--require` is the only hook that reaches tesseract's worker: worker_threads inherit
// process.execArgv, so the preload runs inside the worker thread too. A `globalThis.fetch`
// replaced here in this module would cover the main thread and leave the one thread that
// actually fetches the language model wide open.
{
  const argv = process.execArgv;
  const isPreload = argv.some((arg, i) => {
    if (arg === "--require" || arg === "-r") return resolve(process.cwd(), argv[i + 1] || "") === PRELOAD;
    if (arg.startsWith("--require=")) return resolve(process.cwd(), arg.slice("--require=".length)) === PRELOAD;
    return false;
  });
  if (!isPreload) {
    try {
      execFileSync(process.execPath, ["--require", PRELOAD, THIS_FILE], { stdio: "inherit" });
      process.exit(0);
    } catch (err) {
      process.exit(typeof (err && err.status) === "number" ? err.status : 1);
    }
  }
}

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
  // Explicit: tesseract's worker_threads Worker is not always reachable to terminate (see
  // check [8]), and a live worker thread keeps Node's event loop alive forever.
  process.exit(0);
}

// ---------------------------------------------------------------------------
// [1] The dependency. Missing is a FAILURE, never a skip.
// ---------------------------------------------------------------------------
// A prover that quietly skips when its dependency is absent prints GREEN on a machine where
// it proved nothing at all — the same shape of decoration as a gate never seen to fail.
console.log("dependency");
const require_ = createRequire(import.meta.url);
let TS = null;
try {
  TS = await import("tesseract.js");
  ok("site/node_modules/tesseract.js imports", true);
} catch (err) {
  console.log("  FAIL  site/node_modules/tesseract.js is missing — run: (cd site && npm ci --ignore-scripts)");
  console.log("        (" + ((err && err.message) || err) + ")");
  console.log("");
  console.log("RED: 1 of 1 checks failed");
  process.exit(1);
}
const createWorker = TS.createWorker || (TS.default && TS.default.createWorker);
ok("tesseract.js exports createWorker", typeof createWorker === "function");

const M = await import(pathToFileURL(resolve(HERE, "ocr.mjs")).href);
const { findMatches } = await import(pathToFileURL(resolve(HERE, "pdf-text.mjs")).href);

// ---------------------------------------------------------------------------
// [2] Version pins: the path strings and the installed packages must agree.
// ---------------------------------------------------------------------------
console.log("version pins");
const pkgVersion = (name) => JSON.parse(readFileSync(resolve(SITE, "node_modules", name, "package.json"), "utf8")).version;
const jsVersion = pkgVersion("tesseract.js");
const coreVersion = pkgVersion("tesseract.js-core");
eq("node_modules/tesseract.js version", jsVersion, "7.0.0");
eq("node_modules/tesseract.js-core version", coreVersion, "7.0.0");
{
  const inWorkerPath = (M.TESSERACT.workerPath.match(/\/vendor\/tesseract\.js-([0-9][^/]*)\//) || [])[1];
  const inCorePath = (M.TESSERACT.corePath.match(/\/vendor\/tesseract\.js-core-([0-9][^/]*)\//) || [])[1];
  eq("TESSERACT.workerPath names the installed tesseract.js version", inWorkerPath, jsVersion);
  eq("TESSERACT.corePath names the installed tesseract.js-core version", inCorePath, coreVersion);
}

// ---------------------------------------------------------------------------
// [3] Byte equality: the vendored copies ARE the installed copies.
// ---------------------------------------------------------------------------
// This is what ties a Node run to the bytes the browser fetches. Everything below runs the
// engine out of node_modules; only these hashes make that evidence about site/vendor/.
console.log("vendored bytes == installed bytes");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
function sameBytes(label, a, b) {
  if (!existsSync(a)) return ok(label, false, "missing " + a);
  if (!existsSync(b)) return ok(label, false, "missing " + b);
  ok(label, sha(a) === sha(b), sha(a) + " vs " + sha(b));
}
for (const f of ["worker.min.js", "tesseract.esm.min.js"]) {
  sameBytes("vendor/tesseract.js-7.0.0/" + f,
            resolve(SITE, "vendor", "tesseract.js-7.0.0", f),
            resolve(SITE, "node_modules", "tesseract.js", "dist", f));
}
for (const f of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"]) {
  sameBytes("vendor/tesseract.js-core-7.0.0/" + f,
            resolve(SITE, "vendor", "tesseract.js-core-7.0.0", f),
            resolve(SITE, "node_modules", "tesseract.js-core", f));
}

// ---------------------------------------------------------------------------
// [4] Every path the page will load from is same-origin and really on disk.
// ---------------------------------------------------------------------------
console.log("asset paths");
const sitePath = (webPath) => resolve(SITE, webPath.replace(/^\//, ""));
const PATHS = [
  ["TESSERACT.workerPath", M.TESSERACT.workerPath, "file"],
  ["TESSERACT.corePath", M.TESSERACT.corePath, "dir"],
  ["TESSERACT.langPath", M.TESSERACT.langPath, "dir"],
  ["PDFJS_WASM", M.PDFJS_WASM, "dir"]
];
for (const [name, value, kind] of PATHS) {
  ok(name + " is same-origin (starts with /vendor/)", value.startsWith("/vendor/"), value);
  ok(name + " has no // in it", !value.includes("//"), value);
  const onDisk = sitePath(value);
  const there = existsSync(onDisk);
  ok(name + " exists on disk", there, onDisk);
  if (there) {
    ok(name + " is a " + kind, kind === "dir" ? statSync(onDisk).isDirectory() : statSync(onDisk).isFile(), onDisk);
  }
}
ok("the English model is where langPath says it is",
   existsSync(join(sitePath(M.TESSERACT.langPath), "eng.traineddata.gz")));
eq("lang is English only", M.TESSERACT.lang, "eng");

console.log("worker options");
{
  const logger = () => {};
  const o = M.ocrWorkerOptions(logger);
  ok("workerBlobURL is false — a blob: worker violates worker-src 'self'", o.workerBlobURL === false, String(o.workerBlobURL));
  ok("cacheMethod is none — the default writes the language model to IndexedDB", o.cacheMethod === "none", String(o.cacheMethod));
  ok("gzip is true — the vendored model is .gz", o.gzip === true, String(o.gzip));
  ok("legacyCore is false", o.legacyCore === false, String(o.legacyCore));
  ok("legacyLang is false", o.legacyLang === false, String(o.legacyLang));
  eq("workerPath comes from TESSERACT", o.workerPath, M.TESSERACT.workerPath);
  eq("corePath comes from TESSERACT", o.corePath, M.TESSERACT.corePath);
  eq("langPath comes from TESSERACT", o.langPath, M.TESSERACT.langPath);
  ok("the logger is the one passed in", o.logger === logger);

  // The prover is the only caller that passes overrides. It must not be able to change
  // anything but the key it names.
  const over = M.ocrWorkerOptions(logger, { langPath: "/somewhere/else/" });
  eq("an override changes langPath", over.langPath, "/somewhere/else/");
  const strip = (x) => { const c = { ...x }; delete c.logger; delete c.langPath; return c; };
  eq("and changes nothing else", strip(over), strip(o));
  ok("and leaves the logger alone", over.logger === logger);
}

// ---------------------------------------------------------------------------
// [5] pdf.js: the image-decoding wasm set, and the sandbox that must NOT be there.
// ---------------------------------------------------------------------------
// Without wasm/ pdf.js throws "Ensure that the wasmUrl API parameter is provided" on a
// JBIG2 or JPX image — the encodings scanners actually produce — and the page renders
// blank, which OCR reads as "no text". quickjs-eval is the opposite risk: it is pdf.js's
// JavaScript-in-PDF sandbox, and a tool handling a stranger's document has no business
// running code the document carries.
console.log("pdf.js wasm set");
for (const f of ["jbig2.wasm", "openjpeg.wasm", "qcms_bg.wasm", "jbig2_nowasm_fallback.js", "openjpeg_nowasm_fallback.js"]) {
  ok("vendor/pdfjs-6.3.289/wasm/" + f + " exists", existsSync(join(sitePath(M.PDFJS_WASM), f)));
}
{
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/^quickjs-eval/.test(entry.name) || /^pdf\.sandbox/.test(entry.name)) offenders.push(full);
    }
  };
  walk(resolve(SITE, "vendor"));
  eq("no PDF JavaScript sandbox is vendored anywhere under vendor/", offenders, []);
}

// ---------------------------------------------------------------------------
// [6] The pure model, over a case table.
// ---------------------------------------------------------------------------
console.log("pagesNeedingOCR");
eq("a blank page among text pages", M.pagesNeedingOCR(["text here", "", "more text"]), [1]);
eq("a mixed file", M.pagesNeedingOCR(["a", "   ", "b", ""]), [1, 3]);
eq("an all-scan file", M.pagesNeedingOCR(["", "  ", "\n\t "]), [0, 1, 2]);
eq("a file with no pages", M.pagesNeedingOCR([]), []);
eq("a file with nothing but text", M.pagesNeedingOCR(["a", "b"]), []);
eq("null and undefined pages count as blank", M.pagesNeedingOCR([null, undefined, "x"]), [0, 1]);

console.log("mergeOCR");
{
  const pages = ["invoice text", "", "  "];
  const results = new Map([[1, { text: "refund approved", confidence: 88 }],
                           [2, { text: "   \n ", confidence: 4 }]]);
  const merged = M.mergeOCR(pages, results);
  eq("one entry per page", merged.length, 3);
  eq("a page with text keeps its text", merged[0], { text: "invoice text", source: "text", confidence: null });
  eq("a blank page takes the OCR text, trimmed", merged[1], { text: "refund approved", source: "ocr", confidence: 88 });
  eq("whitespace-only OCR text becomes empty, still sourced ocr", merged[2], { text: "", source: "ocr", confidence: 4 });
  eq("the input pages were not mutated", pages, ["invoice text", "", "  "]);
  eq("the input results were not mutated", results.size, 2);
}
{
  const merged = M.mergeOCR(["", "x"], new Map());
  eq("a blank page with no OCR result stays blank and sourced text", merged[0], { text: "", source: "text", confidence: null });
  eq("and its neighbour is untouched", merged[1], { text: "x", source: "text", confidence: null });
}
{
  // OCR is only ever run on blank pages, but a stale result for a page that DOES have text
  // must never overwrite the text layer — the text layer is the trustworthy one.
  const merged = M.mergeOCR(["real text"], new Map([[0, { text: "misread texd", confidence: 51 }]]));
  eq("a result for a page that has text is ignored", merged[0], { text: "real text", source: "text", confidence: null });
}
{
  const merged = M.mergeOCR(["", ""], new Map([[0, { text: "faint scan", confidence: 12.5 }],
                                                [1, { text: "clear scan", confidence: 96 }]]));
  eq("a low confidence is carried through untouched", merged[0].confidence, 12.5);
  eq("and so is a high one", merged[1].confidence, 96);
}
eq("no pages, no rows", M.mergeOCR([], new Map()), []);

console.log("describeOCR");
eq("nothing to say when OCR did not run", M.describeOCR({ ocrPages: 0, emptyOcrPages: 0 }), "");
eq("one page",
   M.describeOCR({ ocrPages: 1, emptyOcrPages: 0 }),
   "1 page was read by OCR. OCR can misread words on faint, skewed or low-resolution scans, so a miss on those pages is not proof the word is absent.");
eq("several pages",
   M.describeOCR({ ocrPages: 7, emptyOcrPages: 0 }),
   "7 pages were read by OCR. OCR can misread words on faint, skewed or low-resolution scans, so a miss on those pages is not proof the word is absent.");
eq("one page OCR could not read",
   M.describeOCR({ ocrPages: 0, emptyOcrPages: 1 }),
   "OCR found no readable text on 1 page.");
eq("several pages OCR could not read",
   M.describeOCR({ ocrPages: 0, emptyOcrPages: 4 }),
   "OCR found no readable text on 4 pages.");
eq("both sentences, in that order, separated by one space",
   M.describeOCR({ ocrPages: 2, emptyOcrPages: 3 }),
   "2 pages were read by OCR. OCR can misread words on faint, skewed or low-resolution scans, so a miss on those pages is not proof the word is absent. OCR found no readable text on 3 pages.");
ok("the sentence always warns that OCR can misread",
   M.describeOCR({ ocrPages: 5, emptyOcrPages: 0 }).includes("can misread"));

// The reader-facing strings. They are here and not in the page for the reason the whole
// module exists: every one of them is a CLAIM — how big the download is, which pages were
// not searched, whether a match came from OCR — and a claim that lives inline in the HTML is
// a claim no gate and no prover ever reads. The singular/plural boundaries are each pinned
// because "1 pages" is the kind of thing that survives a browser walk.
console.log("describeEngineLoad");
eq("the engine phase names the download size",
   M.describeEngineLoad({ phase: "engine", fraction: 0 }),
   "Loading the OCR engine — about 6 MB, from this site, the first time it runs");
ok("and the size in it is the measured constant, not a second hand-written number",
   M.describeEngineLoad({ phase: "engine", fraction: 0 }).includes(String(M.ENGINE_DOWNLOAD_MB) + " MB"),
   M.describeEngineLoad({ phase: "engine", fraction: 0 }));
ok("the engine phase says the download comes from this site",
   M.describeEngineLoad({ phase: "engine", fraction: 0.5 }).includes("from this site"));
eq("the language phase names English",
   M.describeEngineLoad({ phase: "language", fraction: 0.2 }), "Loading the English OCR model");
eq("the page phase has nothing to say here", M.describeEngineLoad({ phase: "page", fraction: 0.5 }), "");
eq("no progress at all says nothing", M.describeEngineLoad(null), "");
eq("an unmapped phase says nothing", M.describeEngineLoad({ phase: "whatever" }), "");

console.log("ocrProgressLine");
eq("with a page, both counts are 1-based on screen",
   M.ocrProgressLine(2, 12, "invoice.pdf", 3, 9),
   "Reading 3 of 12 — invoice.pdf · OCR page 4 of 9");
eq("without a page index it is today's line, exactly",
   M.ocrProgressLine(2, 12, "invoice.pdf"),
   "Reading 3 of 12 — invoice.pdf");
eq("an explicit null page index is the same as none",
   M.ocrProgressLine(0, 1, "a.pdf", null, 5), "Reading 1 of 1 — a.pdf");
eq("page 0 of 1 is shown as page 1 of 1, not dropped",
   M.ocrProgressLine(0, 1, "a.pdf", 0, 1), "Reading 1 of 1 — a.pdf · OCR page 1 of 1");

console.log("describeSkip — OCR off");
eq("an all-scan file names the checkbox that would read it",
   M.describeSkip({ totalPages: 4, blankPages: 4, ocrOn: false }),
   "no text layer on any page — it looks like a scan. Tick 'Also read scanned pages with OCR' to read it");
eq("one blank page among text pages, singular throughout",
   M.describeSkip({ totalPages: 9, blankPages: 1, ocrOn: false }),
   "1 page has no text layer and was not searched — tick 'Also read scanned pages with OCR' to read it");
eq("three blank pages, plural throughout",
   M.describeSkip({ totalPages: 9, blankPages: 3, ocrOn: false }),
   "3 pages have no text layer and were not searched — tick 'Also read scanned pages with OCR' to read them");
eq("and the rest of the file is credited when it had hits",
   M.describeSkip({ totalPages: 9, blankPages: 3, ocrOn: false, hadHits: true }),
   "3 pages have no text layer and were not searched — tick 'Also read scanned pages with OCR' to read them (the rest of the file was)");
eq("a file with no blank pages needs no row", M.describeSkip({ totalPages: 9, blankPages: 0, ocrOn: false }), null);
eq("a file with no pages at all needs no row", M.describeSkip({ totalPages: 0, blankPages: 0, ocrOn: false }), null);

console.log("describeSkip — OCR on");
eq("a file whose scanned page the engine never loaded for",
   M.describeSkip({ totalPages: 1, blankPages: 1, ocrOn: true, engineFailed: "NetworkError" }),
   "1 scanned page was not read — the OCR engine could not be loaded");
eq("four of them, and the text-layer pages credited",
   M.describeSkip({ totalPages: 10, blankPages: 4, ocrOn: true, engineFailed: "NetworkError" }),
   "4 scanned pages were not read — the OCR engine could not be loaded (the rest of the file was searched)");
eq("an engine failure on a file with no blank pages is not a row",
   M.describeSkip({ totalPages: 10, blankPages: 0, ocrOn: true, engineFailed: "NetworkError" }), null);
eq("a one-page scan OCR could not read",
   M.describeSkip({ totalPages: 1, blankPages: 1, ocrOn: true, emptyOcrPages: 1, ocrReadPages: 1 }),
   "OCR found no readable text on its only page");
eq("an all-scan file OCR could read nothing in",
   M.describeSkip({ totalPages: 5, blankPages: 5, ocrOn: true, emptyOcrPages: 5, ocrReadPages: 5 }),
   "OCR found no readable text on any of its 5 pages");
eq("some pages empty, the rest searched",
   M.describeSkip({ totalPages: 8, blankPages: 3, ocrOn: true, emptyOcrPages: 2, ocrReadPages: 3 }),
   "OCR found no readable text on 2 of its pages (the rest of the file was searched)");
// ocrReadPages: 3 is what makes this case mean what its name says. WITHOUT that field the
// identical input is the STOPPED case — three blank pages, none of them reported back — and a
// file whose scans were never read would get no row at all.
eq("OCR on and every scanned page read needs no row",
   M.describeSkip({ totalPages: 8, blankPages: 3, ocrOn: true, emptyOcrPages: 0, ocrReadPages: 3 }), null);
eq("OCR on, nothing blank, nothing to say",
   M.describeSkip({ totalPages: 8, blankPages: 0, ocrOn: true, emptyOcrPages: 0 }), null);
eq("no info at all is not a row", M.describeSkip(), null);

console.log("describeSkip — stopped before OCR reached every page");
// The gap this page's skipped box exists for: "no matches" must never quietly mean "never
// read". A stopped run's un-OCR'd scans are never-read pages, and the run-level "Stopped early"
// line says the answer is partial without saying WHICH file lost pages.
eq("one page left unread, singular, nothing else in the file",
   M.describeSkip({ totalPages: 1, blankPages: 1, ocrOn: true, ocrReadPages: 0 }),
   "1 scanned page was not read — the search was stopped before OCR reached it");
eq("one page left unread, with text-layer pages to credit",
   M.describeSkip({ totalPages: 3, blankPages: 1, ocrOn: true, ocrReadPages: 0 }),
   "1 scanned page was not read — the search was stopped before OCR reached it (the rest of the file was searched)");
eq("three of four scans left unread, plural",
   M.describeSkip({ totalPages: 4, blankPages: 4, ocrOn: true, ocrReadPages: 1 }),
   "3 scanned pages were not read — the search was stopped before OCR reached them");
eq("and with the rest of the file credited",
   M.describeSkip({ totalPages: 10, blankPages: 4, ocrOn: true, ocrReadPages: 1 }),
   "3 scanned pages were not read — the search was stopped before OCR reached them (the rest of the file was searched)");
// PRECEDENCE, pinned because it is a choice and not an accident: unread beats empty-OCR. An
// unread page is the stronger gap — OCR never looked at it — so the one reason string spends
// itself there. Pages OCR returned nothing for are counted in ocrReadPages and so are NOT
// double-counted as unread.
eq("unread wins over empty-OCR when both happened",
   M.describeSkip({ totalPages: 10, blankPages: 5, ocrOn: true, ocrReadPages: 2, emptyOcrPages: 1 }),
   "3 scanned pages were not read — the search was stopped before OCR reached them (the rest of the file was searched)");
eq("and empty-OCR is back the moment nothing is unread",
   M.describeSkip({ totalPages: 10, blankPages: 5, ocrOn: true, ocrReadPages: 5, emptyOcrPages: 1 }),
   "OCR found no readable text on 1 of its pages (the rest of the file was searched)");
// And the other precedence: an engine that never loaded explains every unread page, so
// "stopped before OCR reached them" would be a false account of the same pages.
eq("a failed engine still wins over unread",
   M.describeSkip({ totalPages: 6, blankPages: 4, ocrOn: true, ocrReadPages: 0, engineFailed: "boom" }),
   "4 scanned pages were not read — the OCR engine could not be loaded (the rest of the file was searched)");
eq("an absent ocrReadPages does not crash, and reads as nothing having been OCR'd",
   M.describeSkip({ totalPages: 2, blankPages: 2, ocrOn: true }),
   "2 scanned pages were not read — the search was stopped before OCR reached them");
eq("an undefined one is the same as an absent one",
   M.describeSkip({ totalPages: 2, blankPages: 2, ocrOn: true, ocrReadPages: undefined }),
   M.describeSkip({ totalPages: 2, blankPages: 2, ocrOn: true }));
// OCR off returns before any of this, so a missing ocrReadPages cannot invent unread pages on
// the path that every other tool and every OCR-off run takes.
eq("OCR off with no ocrReadPages is still the tick-the-box sentence",
   M.describeSkip({ totalPages: 4, blankPages: 4, ocrOn: false }),
   "no text layer on any page — it looks like a scan. Tick 'Also read scanned pages with OCR' to read it");
eq("OCR off with nothing blank is still no row",
   M.describeSkip({ totalPages: 4, blankPages: 0, ocrOn: false }), null);
// The engine-failure reason takes precedence over the empty-OCR wording: the pages were
// never handed to OCR at all, so "OCR found no readable text" would be a false description
// of what happened.
eq("a failed engine is reported as a failed engine, not as empty OCR",
   M.describeSkip({ totalPages: 2, blankPages: 2, ocrOn: true, emptyOcrPages: 2, engineFailed: "boom" }),
   "2 scanned pages were not read — the OCR engine could not be loaded");

console.log("engineFailureLine");
eq("with a reason",
   M.engineFailureLine("NetworkError"),
   "The OCR engine could not be loaded in this browser (NetworkError). Scanned pages were not read; everything with a text layer was searched as usual.");
eq("with no reason",
   M.engineFailureLine(null),
   "The OCR engine could not be loaded in this browser. Scanned pages were not read; everything with a text layer was searched as usual.");
eq("an empty reason is no reason", M.engineFailureLine(""), M.engineFailureLine(null));
ok("it always says what WAS searched, not only what was not",
   M.engineFailureLine("x").includes("text layer was searched as usual"));

console.log("exportHeaderLine");
eq("one OCR page, and the OCR caveat travels with the export",
   M.exportHeaderLine({ ocrOn: true, ocrPages: 1 }),
   "Whole-word matching, capitals ignored. 1 page read by OCR — English printed text, OCR can misread; those matches are marked OCR.");
eq("several OCR pages",
   M.exportHeaderLine({ ocrOn: true, ocrPages: 6 }),
   "Whole-word matching, capitals ignored. 6 pages read by OCR — English printed text, OCR can misread; those matches are marked OCR.");
eq("OCR off says so",
   M.exportHeaderLine({ ocrOn: false, ocrPages: 0 }),
   "Whole-word matching, capitals ignored. OCR off: scanned pages were not searched.");
// Three states, three sentences. The middle one exists because an exported header is read by
// someone who cannot see the checkbox: "OCR off" on a run whose box was ticked is a false
// statement about what the reader asked for, even though nothing was mis-searched.
eq("OCR on but no scanned page met says exactly that, and never 'OCR off'",
   M.exportHeaderLine({ ocrOn: true, ocrPages: 0 }),
   "Whole-word matching, capitals ignored. OCR was on, and no scanned pages were found to read.");
ok("and that line does not contain the words 'OCR off'",
   !/OCR off/.test(M.exportHeaderLine({ ocrOn: true, ocrPages: 0 })));
eq("a truly-off run is the only one that says OCR off",
   M.exportHeaderLine({ ocrOn: false, ocrPages: 0 }),
   "Whole-word matching, capitals ignored. OCR off: scanned pages were not searched.");
eq("a missing run is not an exception", M.exportHeaderLine(), M.exportHeaderLine({ ocrPages: 0 }));

console.log("createOCRWorker wires errorHandler only when it is given");
{
  // tesseract.js 7 never settles the createWorker promise on a failed load (check [8]), so
  // the page's only way to hear about it is this option. A fake createWorker records what it
  // was handed: the wiring is the claim, not the engine.
  const calls = [];
  const fake = (lang, oem, options) => { calls.push({ lang, oem, options }); return Promise.resolve({ fake: true }); };

  await M.createOCRWorker(fake, () => {});
  ok("with no onError there is no errorHandler key at all",
     !("errorHandler" in calls[0].options), JSON.stringify(Object.keys(calls[0].options)));
  eq("the language is still English", calls[0].lang, "eng");
  eq("and the OEM is still LSTM_ONLY", calls[0].oem, 1);

  const onError = () => {};
  await M.createOCRWorker(fake, () => {}, undefined, onError);
  ok("with onError it is passed through as errorHandler", calls[1].options.errorHandler === onError);
  eq("and nothing else moved", calls[1].options.langPath, M.TESSERACT.langPath);

  // The prover supplies its own errorHandler; an override must still win over the page's.
  const mine = () => {};
  await M.createOCRWorker(fake, () => {}, { errorHandler: mine }, onError);
  ok("an explicit override beats the onError argument", calls[2].options.errorHandler === mine);

  ok("a non-function onError is ignored rather than passed on",
     !("errorHandler" in (await (async () => { await M.createOCRWorker(fake, () => {}, undefined, "nope"); return calls[3].options; })())));
}

// ---------------------------------------------------------------------------
// The one render option that cannot be tested, only pinned.
// ---------------------------------------------------------------------------
// renderPageToCanvas is browser-only, so nothing in this file can execute it. But the
// `intent: "print"` in it is load-bearing and looks like a copy-paste mistake to anyone
// reading it cold — it is the difference between a render that finishes in a background tab
// and one that never finishes at all, because pdf.js drives the default "display" intent
// from requestAnimationFrame and Chrome does not fire rAF in a hidden tab. Measured on a
// hidden tab 2026-09-11: display hung past 20 s on a blank 612x792 page, print rendered a
// 1701x2201 scan in 5 ms. A reader who starts a folder of scans and switches tabs is the
// normal case, not the edge case, so this is pinned as text rather than left to a walk that
// would only catch it if someone remembered to hide the tab.
// ⚠️ The first version of this check matched `intent: "print"` anywhere inside the function
// and was DECORATION: the comment above the call explains the option by name, so deleting the
// option from the code left the comment behind and the check went on passing. It was caught by
// doing the thing this repo keeps writing down — mutate the file and watch the gate go red —
// and it failed to go red. So both assertions below match the ARGUMENTS OF THE render CALL and
// nothing else, and both have now been seen to fire against a file with the option removed.
console.log("render intent (text-pinned — browser-only code)");
{
  const src = readFileSync(resolve(HERE, "ocr.mjs"), "utf8");
  const call = (src.match(/page\.render\(\{[^}]*\}/) || [""])[0];
  ok("there is a page.render call to pin at all", call.length > 0, JSON.stringify(call));
  ok("renderPageToCanvas asks pdf.js for the print intent",
     /intent:\s*"print"/.test(call),
     "the rAF pump is back, and OCR will hang forever in a background tab: " + JSON.stringify(call));
  ok("and the canvas is filled white before that call",
     /fillStyle\s*=\s*"#fff"/.test(src.slice(src.indexOf("export async function renderPageToCanvas"),
                                             src.indexOf("page.render("))),
     "a transparent canvas reads as black ink to tesseract");
}

console.log("pickScale");
eq("US Letter at the 200 dpi target", M.pickScale({ width: 612, height: 792 }), 2.778);
eq("landscape Letter gets the same scale", M.pickScale({ width: 792, height: 612 }), 2.778);
eq("a poster-sized page is capped, and never goes below 1", M.pickScale({ width: 5000, height: 5000 }), 1);
eq("a tiny page is not blown past the target", M.pickScale({ width: 100, height: 100 }), 2.778);
eq("the cap is honoured when it lands above 1", M.pickScale({ width: 1000, height: 2000 }), 2);
eq("dpi is an option, not a constant", M.pickScale({ width: 612, height: 792 }, { dpi: 144 }), 2);

console.log("mapProgress");
eq("core loading is the engine phase", M.mapProgress({ status: "loading tesseract core", progress: 0.5 }), { phase: "engine", fraction: 0.5 });
eq("traineddata loading is the language phase", M.mapProgress({ status: "loading language traineddata", progress: 1 }), { phase: "language", fraction: 1 });
eq("recognition is the page phase", M.mapProgress({ status: "recognizing text", progress: 0.25 }), { phase: "page", fraction: 0.25 });
eq("an unknown status is not shown to the reader", M.mapProgress({ status: "initializing api", progress: 0 }), null);
eq("a message with no status at all", M.mapProgress({}), null);
eq("a missing progress reads as zero", M.mapProgress({ status: "recognizing text" }), { phase: "page", fraction: 0 });

// ---------------------------------------------------------------------------
// [7] The real engine, on a real PNG, with no network.
// ---------------------------------------------------------------------------
// In Node tesseract loads its core from node_modules and ignores corePath, and it reads a
// local langPath directory with fs — so pointing langPath at site/vendor/ is what makes this
// a test of the VENDORED English model. workerPath has to be overridden too: in Node the
// worker is a worker_threads entry script, not the browser's worker.min.js.
console.log("offline recognition (the vendored English model, fetch disabled)");
const NODE_WORKER = require_.resolve("tesseract.js/src/worker-script/node/index.js");
const LOCAL_LANG = resolve(SITE, "vendor", "tessdata_fast-923915d");
{
  const seen = [];
  const worker = await M.createOCRWorker(createWorker, (p) => seen.push(p),
                                         { workerPath: NODE_WORKER, langPath: LOCAL_LANG });
  const out = await M.recognizeBitmap(worker, resolve(HERE, "fixtures", "ocr-refund.png"));
  eq("the fixture's first keyword is found, whole-word", findMatches(out.text, ["refund"]).length, 1);
  eq("and its second", findMatches(out.text, ["thirty"]).length, 1);
  ok("confidence is not a shrug", out.confidence >= 60, String(out.confidence));

  const finished = (phase) => seen.some((p) => p.phase === phase && p.fraction === 1);
  ok("the reader was told the engine loaded", finished("engine"), JSON.stringify(seen.slice(0, 3)));
  ok("the reader was told the language loaded", finished("language"));
  await worker.terminate();
}

// ---------------------------------------------------------------------------
// [8] Prove the block actually reaches tesseract's worker thread.
// ---------------------------------------------------------------------------
// Everything in [7] would look identical if the preload had silently failed to load, and
// this prover would still print GREEN while proving nothing about the network. So: ask for
// an off-origin language path on purpose and require the thrower's own words back.
//
// tesseract.js 7.0.0 reports a failure in the loadLanguage job through `errorHandler` and
// never settles the createWorker promise (createWorker.js:210-222, 239-243), so the
// observable outcome is raced against that handler rather than awaited directly. The
// 20 s timer is a loud failure, not a hang — a gate that hangs is a gate that gets killed.
console.log("the no-network preload reaches the worker thread");
{
  let timer = null;
  let created = null;
  const blocked = new Promise((_, reject) => {
    const options = M.ocrWorkerOptions(() => {}, {
      workerPath: NODE_WORKER,
      langPath: "https://example.invalid/tessdata",
      errorHandler: (e) => reject(new Error(String((e && e.message) || e)))
    });
    created = createWorker("eng", 1, options);
    created.then((w) => { created = w; }, () => {});
  });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("TIMEOUT: 20 s with no answer either way")), 20000);
  });

  let message = null;
  let resolved = false;
  try {
    await Promise.race([created, blocked, timeout]);
    resolved = true;
  } catch (err) {
    message = String((err && err.message) || err);
  }
  clearTimeout(timer);

  ok("an off-origin language path does not quietly succeed", !resolved);
  ok("it fails with the preload's own words, from inside the worker thread",
     message !== null && message.includes("no-network: blocked"), message);

  // If createWorker ever resolves (it does not today), the worker is ours to terminate. If
  // it never does, there is no handle — which is why done() exits explicitly.
  if (created && typeof created.terminate === "function") { try { await created.terminate(); } catch { /* already gone */ } }
}

done();
