#!/usr/bin/env node
//
// prove-pdf-tools.mjs — runs the search model that /tools/search-multiple-pdfs actually
// ships, against a table of cases and against real PDF bytes.
//
//   node tools/prove-pdf-tools.mjs            (run from site/)
//
// IT TESTS THE FILE THE PAGES ACTUALLY IMPORT — tools/pdf-text.mjs — not a copy of it and
// not a block scraped out of the HTML. The first draft of this prover did scrape the block,
// on the argument that one shipped artifact is easier to audit; that argument died the
// moment a second tool needed the same word-boundary rule, because the real risk is not
// "two files to read", it is two copies of a rule drifting apart. So the logic lives in one
// same-origin module, both pages import it, and this file imports the same one.
//
// The risk it guards against is not hypothetical: /tools/is-your-pdf-searchable shipped on
// 2026-09-02 carrying a comment claiming `tools/prove-pdf-checker.mjs` extracted and proved
// its model. That file has never existed, in any commit, from the day the page shipped to
// the day this one was written (2026-09-08). A prover named in a comment proves nothing.
//
// WHAT IT DOES NOT COVER, said out loud so the gap is not mistaken for coverage:
//   - No user-password PDF fixture. Producing one means implementing PDF encryption; the
//     password path is covered at the model level (describeFailure) and by the browser walk.
//   - No browser. Drag-and-drop, the folder picker, the worker, and the CSP itself are only
//     real in a browser; see handoff for the walk that covers them.

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = resolve(HERE, "search-multiple-pdfs.html");
const VENDOR = resolve(HERE, "..", "vendor", "pdfjs-6.3.289", "pdf.min.mjs");

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

// ---------------------------------------------------------------------------
// The module under test is the module the pages import. Not a copy of it.
// ---------------------------------------------------------------------------
const M = await import(pathToFileURL(resolve(HERE, "pdf-text.mjs")).href);

const TOOL_PAGES = ["search-multiple-pdfs.html", "extract-text-from-pdf.html"]
  .map((n) => resolve(HERE, n))
  .filter((p) => { try { readFileSync(p); return true; } catch { return false; } });

// ---------------------------------------------------------------------------
// Every tool page's inline module script must PARSE.
// ---------------------------------------------------------------------------
// A syntax error in a `<script type="module">` is silent: the browser logs it to a console
// nobody has open and the page renders perfectly, with every button dead. This is the
// cheapest possible check for the loudest possible failure.
console.log("page scripts parse");
{
  const dir = mkdtempSync(join(tmpdir(), "docfind-parse-"));
  for (const page of TOOL_PAGES) {
    const src = readFileSync(page, "utf8");
    const m = src.match(/<script type="module">([\s\S]*?)<\/script>/);
    const name = page.split("/").pop();
    if (!m) { ok(name + " has a module script", false, "no <script type=\"module\"> found"); continue; }
    const tmp = join(dir, name.replace(/\.html$/, "") + ".mjs");
    writeFileSync(tmp, m[1]);
    let err = null;
    try { execFileSync(process.execPath, ["--check", tmp], { stdio: ["ignore", "ignore", "pipe"] }); }
    catch (e) { err = String(e.stderr || e.message).split("\n").slice(0, 4).join(" ").trim(); }
    ok(name + " inline module parses", err === null, err);
  }
  // And each page must import the shared module rather than growing its own copy.
  for (const page of TOOL_PAGES) {
    const src = readFileSync(page, "utf8");
    const name = page.split("/").pop();
    if (!/pdfjsLib/.test(src)) continue;
    ok(name + " imports the shared module", src.includes('from "/tools/pdf-text.mjs"'));
    ok(name + " does not redefine the word-boundary rule", !src.includes("const WORD_CHAR"));
  }
}

// ---------------------------------------------------------------------------
// The search page's OCR wiring, as text. check-answers.sh asserts the same three
// things from the gate's side; this asserts them from the prover's.
// ---------------------------------------------------------------------------
// Two gates rather than one on purpose: the claim gate runs on every push and can be edited
// by anyone touching a rule, while this runs with the logic it is about. The thing being
// protected is tesseract.js's silent CDN fallback — it reaches for jsdelivr for the worker
// and projectnaptha for the language model whenever an option is unset — so a page naming
// either host has broken the one promise every tool page makes, whatever else is true of it.
console.log("search page — OCR wiring");
{
  const src = readFileSync(PAGE, "utf8");
  ok("the page imports the OCR module rather than calling tesseract itself",
     src.includes('from "/tools/ocr.mjs"'));
  ok("the page loads the OCR engine from /vendor/",
     src.includes("/vendor/tesseract.js-7.0.0/tesseract.esm.min.js"));
  ok("the page names no CDN of tesseract's own", !/jsdelivr|projectnaptha/.test(src),
     (src.match(/jsdelivr|projectnaptha/) || [])[0]);
}

// ---------------------------------------------------------------------------
// parseQuery
// ---------------------------------------------------------------------------
console.log("parseQuery");
eq("splits on whitespace", M.parseQuery("invoice refund"), ["invoice", "refund"]);
eq("collapses runs of whitespace", M.parseQuery("  invoice \t\n refund "), ["invoice", "refund"]);
eq("strips typed punctuation", M.parseQuery('"refund," (invoice).'), ["refund", "invoice"]);
eq("keeps inner punctuation", M.parseQuery("re-open"), ["re-open"]);
eq("drops duplicates case-insensitively", M.parseQuery("Refund refund REFUND"), ["Refund"]);
eq("empty query is empty", M.parseQuery("   "), []);
eq("punctuation-only query is empty", M.parseQuery("--- ,,, ."), []);
eq("survives null", M.parseQuery(null), []);
eq("keeps non-Latin words", M.parseQuery("发票 счёт"), ["发票", "счёт"]);

// ---------------------------------------------------------------------------
// findMatches — the whole-word promise the page makes in writing
// ---------------------------------------------------------------------------
console.log("findMatches");
const first = (text, needles) => M.findMatches(text, needles).map((m) => [m.needle, m.start, m.end]);

eq("finds a plain word", first("the refund arrived", ["refund"]), [["refund", 4, 10]]);
ok("run does not find running", M.findMatches("the running total", ["run"]).length === 0);
ok("running does not find run", M.findMatches("the run total", ["running"]).length === 0);
ok("ignores capitals", M.findMatches("The Refund", ["refund"]).length === 1);
ok("matches at the very start", M.findMatches("refund now", ["refund"]).length === 1);
ok("matches at the very end", M.findMatches("a refund", ["refund"]).length === 1);
ok("punctuation is a boundary", M.findMatches("(refund).", ["refund"]).length === 1);
ok("a hyphen is a boundary", M.findMatches("pre-refund-post", ["refund"]).length === 1);
eq("finds every occurrence", M.findMatches("refund refund refund", ["refund"]).length, 3);
eq("several needles come back in document order",
   first("beta then alpha", ["alpha", "beta"]),
   [["beta", 0, 4], ["alpha", 10, 15]]);
ok("empty needle list finds nothing", M.findMatches("anything", []).length === 0);

// The bug that made WORD_CHAR Unicode-aware. With JavaScript's \b these fail.
console.log("findMatches — non-ASCII, the reason \\b was not used");
ok("accented word matches itself", M.findMatches("un café noir", ["café"]).length === 1);
ok("café does not match cafés", M.findMatches("deux cafés", ["café"]).length === 0);
ok("accent is a word character, not a boundary", M.findMatches("Ötzi walked", ["Ötzi"]).length === 1);
ok("Cyrillic matches", M.findMatches("это счёт", ["счёт"]).length === 1);
ok("Cyrillic respects word ends", M.findMatches("это счётчик", ["счёт"]).length === 0);
ok("Devanagari matches", M.findMatches("यह चालान है", ["चालान"]).length === 1);
// CJK has no spaces, so every neighbouring character is a word character and a
// whole-word rule cannot fire. Stated as a known limit, not papered over.
ok("CJK inside a run does not match (known limit)", M.findMatches("这是发票号码", ["发票"]).length === 0);
ok("CJK delimited by punctuation does match", M.findMatches("这是（发票）号码", ["发票"]).length === 1);

console.log("findMatches — index integrity under case folding");
{
  // "İ" (U+0130) lowercases to two UTF-16 units. If the haystack were folded with a
  // plain toLowerCase() every offset after it would be wrong, and the snippet would
  // be cut in the wrong place.
  const text = "İstanbul office refund";
  const hits = M.findMatches(text, ["refund"]);
  eq("offset survives a length-changing fold", hits.length && text.slice(hits[0].start, hits[0].end), "refund");
  eq("folding preserves length", M.foldPreservingIndices(text).length, text.length);
}

// ---------------------------------------------------------------------------
// buildSnippet
// ---------------------------------------------------------------------------
console.log("buildSnippet");
{
  const text = "Some words before the refund and some words after.";
  const m = M.findMatches(text, ["refund"])[0];
  const s = M.buildSnippet(text, m, 10);
  eq("the hit is the matched text", s.hit, "refund");
  ok("before ends where the hit starts", text.includes(s.before.replace(/^…/, "").trim()));
  ok("marks that text was cut at the start", s.before.startsWith("…"));
  ok("marks that text was cut at the end", s.after.endsWith("…"));
}
{
  const text = "line one\n\n   line   two   refund   line three";
  const m = M.findMatches(text, ["refund"])[0];
  const s = M.buildSnippet(text, m, 40);
  ok("collapses the whitespace PDFs are full of", !/\s\s/.test(s.before + s.hit + s.after));
}
{
  const text = "refund at the very start of a document that continues for a while afterwards";
  const s = M.buildSnippet(text, M.findMatches(text, ["refund"])[0], 20);
  ok("no leading ellipsis when the match is at the start", !s.before.startsWith("…"));
}
{
  const text = "a document that ends on the word refund";
  const s = M.buildSnippet(text, M.findMatches(text, ["refund"])[0], 20);
  ok("no trailing ellipsis when the match is at the end", !s.after.endsWith("…"));
}

// ---------------------------------------------------------------------------
// chooseMatches
// ---------------------------------------------------------------------------
console.log("chooseMatches");
{
  const text = "alpha alpha alpha alpha beta";
  const all = M.findMatches(text, ["alpha", "beta"]);
  const kept = M.chooseMatches(all, 3);
  eq("caps the number kept", kept.length, 3);
  ok("a word mentioned once still gets a slot before repeats",
     kept.some((m) => m.needle === "beta"));
}

// ---------------------------------------------------------------------------
// joinTextItems
// ---------------------------------------------------------------------------
console.log("joinTextItems");
eq("separates items that are not already spaced",
   M.joinTextItems([{ str: "one" }, { str: "two" }]).trim(), "one two");
eq("does not double a space that is already there",
   M.joinTextItems([{ str: "one " }, { str: "two" }]).trim(), "one two");
ok("hasEOL becomes a line break",
   M.joinTextItems([{ str: "one", hasEOL: true }, { str: "two" }]).includes("\n"));
eq("ignores items with no string", M.joinTextItems([{ str: "one" }, {}, { str: "two" }]).trim(), "one two");
{
  // The reason this matters: a word split across two items must still be findable.
  const joined = M.joinTextItems([{ str: "re" }, { str: "fund" }]);
  ok("a word split across items is a known limit, and it is THIS one",
     M.findMatches(joined, ["refund"]).length === 0);
}

// ---------------------------------------------------------------------------
// describeFailure — the file-level honesty, in the app's own vocabulary
// ---------------------------------------------------------------------------
console.log("describeFailure");
{
  const pw = M.describeFailure({ name: "PasswordException", message: "No password given" });
  ok("names the password case", /password/i.test(pw));
  ok("does NOT claim every encrypted file is refused — the 2026-09-02 defect", /owner password/i.test(pw));
  ok("classifies a broken file", /not a readable PDF/.test(M.describeFailure({ name: "InvalidPDFException", message: "bad header" })));
  ok("never returns an empty reason", M.describeFailure({}).length > 0);
  ok("never returns an empty reason for null", M.describeFailure(null).length > 0);
}

// ---------------------------------------------------------------------------
// End-to-end: real PDF bytes, through the vendored pdf.js, into the model.
// ---------------------------------------------------------------------------
console.log("end-to-end (vendored pdf.js " + "6.3.289" + ")");

function buildPdf(contentStream, withFont) {
  const objs = [];
  objs[1] = "<</Type/Catalog/Pages 2 0 R>>";
  objs[2] = "<</Type/Pages/Kids[3 0 R]/Count 1>>";
  objs[3] = "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<<"
          + (withFont ? "/Font<</F1 5 0 R>>" : "") + ">>/Contents 4 0 R>>";
  objs[4] = "<</Length " + Buffer.byteLength(contentStream, "latin1") + ">>\nstream\n" + contentStream + "\nendstream";
  if (withFont) objs[5] = "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>";

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(pdf, "latin1");
    pdf += i + " 0 obj\n" + objs[i] + "\nendobj\n";
  }
  const xrefAt = Buffer.byteLength(pdf, "latin1");
  pdf += "xref\n0 " + objs.length + "\n0000000000 65535 f \n";
  for (let i = 1; i < objs.length; i++) {
    pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += "trailer\n<</Size " + objs.length + "/Root 1 0 R>>\nstartxref\n" + xrefAt + "\n%%EOF\n";
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

const WORKER = resolve(HERE, "..", "vendor", "pdfjs-6.3.289", "pdf.worker.min.mjs");

let pdfjs = null;
try {
  pdfjs = await import(pathToFileURL(VENDOR).href);
  // Node's pdf.js otherwise looks for an unminified `pdf.worker.mjs` beside the library
  // and dies with "Setting up fake worker failed". The browser is told the same path in
  // the page; keeping both explicit is what stops a vendor upgrade from breaking one
  // and not the other.
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(WORKER).href;
} catch (err) {
  failures++;
  console.log("  FAIL  the vendored pdf.js would not load in Node: " + err.message);
  console.log("        This is the library the flagship tool depends on. Not a skip — a failure.");
}

if (pdfjs) {
  // Every end-to-end assertion runs inside this, so a throw becomes a named failure
  // instead of Node printing a megabyte of minified library at the terminal.
  const guard = async (what, fn) => {
    try { await fn(); }
    catch (err) { failures++; console.log("  FAIL  " + what + " threw: " + (err && err.message)); }
  };

  const read = async (bytes) => {
    const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
    const doc = await task.promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      pages.push(M.joinTextItems((await page.getTextContent()).items));
      page.cleanup();
    }
    await task.destroy();
    return pages;
  };

  // The teardown path itself, asserted. PDFDocumentProxy has no destroy() in pdf.js 6 and
  // the page called it; every search would have thrown on its first file.
  await guard("teardown uses the API that exists", async () => {
    const task = pdfjs.getDocument({ data: buildPdf("BT /F1 12 Tf 72 720 Td (x) Tj ET", true), isEvalSupported: false });
    const doc = await task.promise;
    ok("the document proxy has no destroy()", typeof doc.destroy !== "function");
    ok("the loading task does", typeof task.destroy === "function");
    ok("and the page proxy has cleanup()", typeof (await doc.getPage(1)).cleanup === "function");
    await task.destroy();
  });

  await guard("text-layer PDF", async () => {
    const bytes = buildPdf("BT /F1 12 Tf 72 720 Td (Invoice number 42 for a refund) Tj ET", true);
    const pages = await read(bytes);
    eq("a text-layer PDF yields one page", pages.length, 1);
    ok("its words come back", /refund/i.test(pages[0]), JSON.stringify(pages[0]));
    eq("and the model finds them in it", M.findMatches(pages[0], ["refund"]).length, 1);
    ok("whole-word still holds on real extracted text", M.findMatches(pages[0], ["refun"]).length === 0);
  });

  await guard("image-only page", async () => {
    // A page that draws a filled rectangle and no text at all — what a scan looks
    // like to a text extractor, minus the megabyte of image data.
    const bytes = buildPdf("0 0 0 rg 100 100 200 200 re f", false);
    const pages = await read(bytes);
    eq("an image-only page yields a page", pages.length, 1);
    ok("with no text in it", pages[0].trim() === "", JSON.stringify(pages[0]));
    ok("which is what the tool reports as a scan, not as zero matches",
       M.findMatches(pages[0], ["refund"]).length === 0);
  });

  // -------------------------------------------------------------------------
  // readPages: the OCR-off path, pinned byte-for-byte, and the hooks that grew it.
  // -------------------------------------------------------------------------
  // WT1b added a fourth argument to readPages for the OCR path. The whole risk of that edit
  // is the OTHER callers: /tools/extract-text-from-pdf, and an OCR-off run of the search
  // page, must get exactly what they got before. So the three-argument call is pinned to the
  // exact arrays it returns today (measured, then written down — not predicted), and the
  // options object it hands pdf.js must not grow a `wasmUrl: undefined` either.
  const fileOf = (bytes) => ({ arrayBuffer: async () => bytes });
  const TEXT_PDF = () => buildPdf("BT /F1 12 Tf 72 720 Td (Invoice number 42 for a refund) Tj ET", true);
  const IMAGE_PDF = () => buildPdf("0 0 0 rg 100 100 200 200 re f", false);

  await guard("readPages with no hooks is unchanged", async () => {
    const text = await M.readPages(pdfjs, fileOf(TEXT_PDF()), () => false);
    eq("a text-layer file is one page", text.length, 1);
    eq("and it is the same string as ever", text, ["Invoice number 42 for a refund "]);
    eq("which the model finds 'refund' in", M.findMatches(text[0], ["refund"]).length, 1);

    const image = await M.readPages(pdfjs, fileOf(IMAGE_PDF()), () => false);
    eq("an image-only file is one page", image.length, 1);
    eq("and it is blank — which is what makes it a page OCR has to be asked about", image, [""]);

    // The options object itself, through a stub that only records it. `wasmUrl: undefined` is
    // not the same object pdf.js has been given since the page shipped, and "identical to
    // today" is the claim this pin exists for.
    const seen = [];
    const stub = { getDocument(options) {
      seen.push(options);
      return { promise: Promise.resolve({ numPages: 0 }), destroy: async () => {} };
    } };
    await M.readPages(stub, fileOf(new Uint8Array([0])), () => false);
    ok("no wasmUrl key at all when no hooks are given", !("wasmUrl" in seen[0]),
       JSON.stringify(Object.keys(seen[0])));
    await M.readPages(stub, fileOf(new Uint8Array([0])), () => false, { wasmUrl: "/vendor/pdfjs-6.3.289/wasm/" });
    eq("and the hook's value when one is", seen[1].wasmUrl, "/vendor/pdfjs-6.3.289/wasm/");
  });

  await guard("readPages hooks fire on blank pages only", async () => {
    const calls = [];
    const pages = await M.readPages(pdfjs, fileOf(IMAGE_PDF()), () => false, {
      wasmUrl: "/vendor/pdfjs-6.3.289/wasm/",
      onBlankPage: (page, idx, total) => { calls.push({ hasRender: typeof page.render === "function", idx, total }); }
    });
    eq("the blank page is reported exactly once", calls.length, 1);
    eq("with its 0-based index and the file's page count", [calls[0] && calls[0].idx, calls[0] && calls[0].total], [0, 1]);
    // The hook is called BEFORE page.cleanup() for this reason: rendering needs a live page.
    ok("and with a page proxy that can still be rendered", calls[0] && calls[0].hasRender);
    eq("the return value is still the text layer, not the hook's", pages, [""]);

    const none = [];
    await M.readPages(pdfjs, fileOf(TEXT_PDF()), () => false, { onBlankPage: (p, i) => none.push(i) });
    eq("a file with a text layer never asks about OCR", none, []);
  });

  await guard("a throwing hook costs one page, never the file", async () => {
    const errs = [];
    const pages = await M.readPages(pdfjs, fileOf(IMAGE_PDF()), () => false, {
      onBlankPage: () => { throw new Error("render exploded"); },
      onPageError: (err, idx) => errs.push([String(err && err.message), idx])
    });
    eq("the file still comes back", pages, [""]);
    eq("and the failure is reported once, with the page it was on", errs, [["render exploded", 0]]);

    // No onPageError at all: the throw must still be swallowed rather than aborting the run.
    const quiet = await M.readPages(pdfjs, fileOf(IMAGE_PDF()), () => false, {
      onBlankPage: () => { throw new Error("render exploded"); }
    });
    eq("with no error hook the file still comes back", quiet, [""]);
  });

  await guard("non-PDF input", async () => {
    const bytes = new Uint8Array(Buffer.from("this is not a PDF at all", "latin1"));
    let threw = null;
    try { await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise; }
    catch (err) { threw = err; }
    ok("a non-PDF throws rather than returning nothing", threw !== null);
    ok("and is classified as unreadable, by name",
       threw && /not a readable PDF/.test(M.describeFailure(threw)), threw && M.describeFailure(threw));
  });
}


// ---------------------------------------------------------------------------
// The OTHER tool: /tools/is-your-pdf-searchable, whose model has no module to
// import because it predates one. Extracted from the page and run here.
// ---------------------------------------------------------------------------
// This page shipped 2026-09-02 with a comment promising `tools/prove-pdf-checker.mjs`
// extracted and proved this exact block. No such file has ever existed. The page has
// carried one live wrong answer already; it should not also be the only tool on the
// site with no test at all.
console.log("is-your-pdf-searchable (model extracted from the page)");
{
  const page = resolve(HERE, "is-your-pdf-searchable.html");
  const src = readFileSync(page, "utf8");
  const a = src.indexOf("/* MODEL:START */"), b = src.indexOf("/* MODEL:END */");
  if (a === -1 || b === -1) {
    ok("the page still carries its MODEL markers", false, "markers missing — the prover and the page have drifted");
  } else {
    const dir2 = mkdtempSync(join(tmpdir(), "docfind-checker-"));
    const modPath = join(dir2, "checker.mjs");
    writeFileSync(modPath, src.slice(a + 17, b) + "\nexport { analyzePdf, VERDICTS, NEXT, countPages, hasImage };\n");
    const C = await import(pathToFileURL(modPath).href);

    const verdict = async (bytes) => (await C.analyzePdf(bytes, { budgetMs: 4000 })).kind;

    eq("a text-layer PDF is not called a scan",
       await verdict(buildPdf("BT /F1 12 Tf 72 720 Td (Invoice number 42 for a refund) Tj ET", true)) === "scan", false);
    eq("a file with no PDF header is not-pdf",
       await verdict(new Uint8Array(Buffer.from("hello, not a pdf", "latin1"))), "not-pdf");
    {
      const k = await verdict(buildPdf("0 0 0 rg 100 100 200 200 re f", false));
      ok("a page with no text is reported as a scan or as no-text, never as searchable",
         k === "scan" || k === "no-text" || k === "undetermined", k);
    }

    // The 2026-09-02 defect, pinned as a case rather than as a paragraph. The wording
    // that shipped was "DocFind declines these"; anything of that shape is the bug.
    const enc = C.VERDICTS.encrypted;
    ok("the encrypted verdict names the owner-password case", /owner.password/i.test(enc.line), enc.line);
    ok("the encrypted verdict does not say DocFind declines encrypted files",
       !/declines these|does not open password/i.test(enc.line + " " + C.NEXT.encrypted), enc.line);
    ok("the encrypted verdict does not claim to know which kind it is",
       /cannot tell|may still/i.test(enc.name + " " + enc.line), enc.name);

    // Every verdict the classifier can return must have copy to show for it. A kind with
    // no VERDICTS entry renders as a blank result box, which reads as "nothing wrong".
    for (const kind of ["text", "text-thin", "mixed", "scan", "no-text", "encrypted",
                        "not-pdf", "undetermined", "unsupported"]) {
      ok("verdict copy exists for '" + kind + "'", !!C.VERDICTS[kind] && !!C.NEXT[kind]);
    }
  }
}

// ---------------------------------------------------------------------------
console.log("");
if (failures) {
  console.log("RED: " + failures + " of " + checks + " checks failed");
  process.exit(1);
}
console.log("GREEN: " + checks + " checks passed (tools/pdf-text.mjs, the module both tool pages import)");
