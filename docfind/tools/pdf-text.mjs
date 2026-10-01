// pdf-text.mjs — the text logic behind every tool on this site.
//
// Shared on purpose. /tools/search-multiple-pdfs and /tools/extract-text-from-pdf both need
// the same PDF-text-item joining and the same idea of what a word is; two copies of a
// word-boundary rule is two copies that drift, and the one that drifts is the one nobody
// re-read. It is served from this origin like every other asset here — no CDN, nothing
// off-origin, see ../vendor/README.md.
//
// PROVEN, not asserted: `node tools/prove-pdf-tools.mjs` imports THIS file — the one the
// pages import — and runs it over a table of cases plus real PDF bytes through the vendored
// pdf.js. That matters more than it sounds: /tools/is-your-pdf-searchable shipped on
// 2026-09-02 carrying a comment that named a prover, `tools/prove-pdf-checker.mjs`, which
// has never existed in any commit. A prover named in a comment proves nothing.

// What counts as part of a word. Deliberately Unicode-aware: `\b` in JavaScript
// is defined over [A-Za-z0-9_], so with it "café" contains a word boundary in
// the middle and half of Europe's text matches wrongly.
const WORD_CHAR = /[\p{L}\p{N}_]/u;

export function isWordChar(ch) {
  return ch !== undefined && WORD_CHAR.test(ch);
}

// Case-folding that preserves string indices. `toLowerCase()` is not
// length-preserving for every code point ("İ" folds to two units), and an
// index computed in the folded string is then wrong in the original. Folding
// character by character and keeping the original wherever the length changes
// gives a haystack whose offsets are the real ones.
export function foldPreservingIndices(text) {
  let out = "";
  for (const ch of text) {
    const low = ch.toLowerCase();
    out += low.length === ch.length ? low : ch;
  }
  return out;
}

// A query is whitespace-separated words. Punctuation a reader is likely to type
// around a word (quotes, commas, a trailing full stop) is trimmed, so pasting
// "refund," from a document still searches for "refund".
export function parseQuery(raw) {
  const seen = new Set();
  const out = [];
  for (const piece of String(raw || "").split(/\s+/)) {
    const word = piece.replace(/^[^\p{L}\p{N}_]+|[^\p{L}\p{N}_]+$/gu, "");
    if (!word) continue;
    const key = foldPreservingIndices(word);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}

// Whole-word, case-insensitive, no stemming — the same honesty the app sells:
// "running" does not find "run". Returns every occurrence with its offset.
export function findMatches(text, needles) {
  const hay = foldPreservingIndices(text);
  const found = [];
  for (const needle of needles) {
    const pin = foldPreservingIndices(needle);
    if (!pin) continue;
    let from = 0;
    for (;;) {
      const at = hay.indexOf(pin, from);
      if (at === -1) break;
      from = at + pin.length;
      if (isWordChar(hay[at - 1])) continue;
      if (isWordChar(hay[at + pin.length])) continue;
      found.push({ needle, start: at, end: at + pin.length });
    }
  }
  found.sort((a, b) => a.start - b.start);
  return found;
}

// The text around a match, with the run of whitespace PDFs are full of collapsed
// to single spaces. Returns the three pieces rather than HTML, so the caller
// decides how to mark it and no string ever gets built by concatenating markup.
export function buildSnippet(text, match, radius) {
  const pad = radius === undefined ? 90 : radius;
  let from = Math.max(0, match.start - pad);
  let to = Math.min(text.length, match.end + pad);
  // Do not start or end mid-word if a space is close by.
  while (from > 0 && isWordChar(text[from - 1]) && match.start - from < pad + 25) from--;
  while (to < text.length && isWordChar(text[to]) && to - match.end < pad + 25) to++;
  const tidy = (s) => s.replace(/\s+/gu, " ");
  return {
    before: (from > 0 ? "…" : "") + tidy(text.slice(from, match.start)),
    hit: tidy(text.slice(match.start, match.end)),
    after: tidy(text.slice(match.end, to)) + (to < text.length ? "…" : "")
  };
}

// Several matches on one page collapse to at most `cap` snippets, keeping the
// first of each distinct word before repeating any of them. A page that says
// "invoice" forty times should not push every other page off the screen.
export function chooseMatches(matches, cap) {
  const limit = cap === undefined ? 3 : cap;
  const firsts = [];
  const seen = new Set();
  for (const m of matches) {
    if (seen.has(m.needle)) continue;
    seen.add(m.needle);
    firsts.push(m);
  }
  const rest = matches.filter((m) => !firsts.includes(m));
  return firsts.concat(rest).slice(0, limit);
}

// pdf.js hands back text as positioned items. Joining them with nothing glues
// words together; joining them all with spaces breaks words that were split
// across two items mid-word. `hasEOL` is the only line information available,
// so it is what the line breaks are built from.
export function joinTextItems(items) {
  let out = "";
  for (const item of items) {
    if (typeof item.str !== "string") continue;
    out += item.str;
    if (item.hasEOL) out += "\n";
    else if (item.str && !item.str.endsWith(" ")) out += " ";
  }
  return out;
}

// One row per skipped file, in the app's own vocabulary: name the file and the
// reason, never fold it silently into a zero-result search.
export function describeFailure(err) {
  const name = (err && (err.name || err.constructor && err.constructor.name)) || "";
  const msg = String((err && err.message) || "");
  if (name === "PasswordException" || /password/i.test(msg)) {
    return "needs a password to open — a file with only an owner password would have opened normally";
  }
  if (name === "InvalidPDFException" || /invalid|corrupt/i.test(msg)) {
    return "not a readable PDF — the file is damaged, or is not a PDF at all";
  }
  if (name === "MissingPDFException") return "the file could not be read from disk";
  return "could not be read (" + (msg || name || "unknown reason") + ")";
}

// Reading a file with pdf.js. Kept here with the rest so both tools open documents the same
// way — same cmap paths, same refusal to evaluate anything the document carries.
export const VENDOR = "/vendor/pdfjs-6.3.289/";

// `hooks` is optional and exists for exactly one caller: the OCR path on
// /tools/search-multiple-pdfs. It is a fourth argument rather than a branch inside this
// function because the text-only path must stay byte-identical — the two other tools and
// the OCR-off run of the search page all call this with three arguments and must get
// today's behaviour, which is why `wasmUrl` is only added to the options object when it is
// actually given (passing `wasmUrl: undefined` is not the same object pdf.js saw before,
// and "identical to today" is a claim the prover pins).
//   wasmUrl     — pdf.js's image-decoder directory. Needed only when a page will be
//                 RENDERED: getTextContent() never touches an image stream, rendering a
//                 scan decodes every one of them (see ../vendor/README.md).
//   onBlankPage — called for a page whose text layer is blank, BEFORE page.cleanup(), so
//                 the hook still has a live page proxy to render. Its return value is
//                 ignored on purpose: the caller keeps its own OCR results and merges them
//                 with mergeOCR(), so this function's return type never changes and the
//                 text layer stays the single thing it reports.
//   onPageError — a throw from the hook must not cost the reader the rest of the file. One
//                 unrenderable page is one page, not a skipped document.
export async function readPages(pdfjsLib, file, shouldStop, hooks) {
  const buf = await file.arrayBuffer();
  const options = {
    data: new Uint8Array(buf),
    cMapUrl: VENDOR + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: VENDOR + "standard_fonts/",
    // No 'unsafe-eval' in these pages' CSP, and a tool handling a stranger's document has
    // no business evaluating anything the document carries.
    isEvalSupported: false
  };
  if (hooks && hooks.wasmUrl) options.wasmUrl = hooks.wasmUrl;
  const task = pdfjsLib.getDocument(options);
  const doc = await task.promise;
  const pages = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      if (shouldStop && shouldStop()) break;
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const text = joinTextItems(content.items);
      pages.push(text);
      if (!text.trim() && hooks && typeof hooks.onBlankPage === "function") {
        try {
          await hooks.onBlankPage(page, n - 1, doc.numPages);
        } catch (err) {
          if (typeof hooks.onPageError === "function") hooks.onPageError(err, n - 1);
        }
      }
      page.cleanup();
    }
  } finally {
    // The LOADING TASK owns the worker, not the document proxy. pdf.js 6 has no
    // PDFDocumentProxy.destroy(); calling it throws a TypeError out of this finally block
    // and aborts the run on the first file. Caught by the prover before either page was
    // ever published — which is the entire argument for having one.
    await task.destroy();
  }
  return pages;
}
