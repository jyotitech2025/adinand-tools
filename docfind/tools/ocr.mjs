// ocr.mjs — the OCR logic behind /tools/search-multiple-pdfs, and every path it loads from.
//
// Shared and same-origin for the same reason pdf-text.mjs is: the page must never call
// tesseract directly, because tesseract.js's own defaults point at a CDN for the worker,
// a CDN for the WebAssembly core, and a CDN for the language model, and it falls back to
// them silently for any option left unset. Under this site's CSP those fetches are blocked
// and OCR fails with a console error nobody has open. So every path lives HERE, as a string
// literal, in one file that a gate can read — see check-answers.sh rule OCRPATHS.
//
// PROVEN, not asserted: `node tools/prove-ocr.mjs` imports THIS file — the one the page
// imports — recognises a fixture PNG through the vendored language model with every network
// primitive in the process replaced by a thrower, and checks that the bytes under vendor/
// are byte-identical to the ones npm installed.
//
// WHAT RUNS WHERE. The pure functions below (mapProgress, pagesNeedingOCR, mergeOCR,
// describeOCR, describeSkip, describeEngineLoad, ocrProgressLine, engineFailureLine,
// exportHeaderLine, pickScale) run in both: Node for the prover, the browser for the page.
// createOCRWorker/recognizeBitmap run in Node under the prover with an `overrides` object
// pointing langPath at the on-disk vendor directory, and in the browser with only an
// `errorHandler`, where the three /vendor/ paths below are what the browser fetches.
// The last two functions in this file — renderPageToCanvas and releaseCanvas — are the only
// BROWSER-ONLY ones: Node has no canvas, so they are proven by the WT1b browser walk and
// nothing else. They are at the bottom, under a comment saying so, so the boundary is a
// place in the file rather than a fact someone has to remember.

// Every tesseract.js path option this site sets, and it sets all of them. Each value is a
// string literal on its own line on purpose — a computed path is a path a gate cannot read.
export const TESSERACT = Object.freeze({
  workerPath: "/vendor/tesseract.js-7.0.0/worker.min.js",
  corePath: "/vendor/tesseract.js-core-7.0.0/",
  langPath: "/vendor/tessdata_fast-923915d/",
  lang: "eng"
});

// pdf.js needs these to decode the image formats scanners actually produce (JBIG2, JPX).
// Without the directory it throws "Ensure that the wasmUrl API parameter is provided" and a
// scanned page renders blank, which OCR then reads as "no text" — an honest-looking wrong
// answer. The page hands this to readPages() as `hooks.wasmUrl` on an OCR run and only then
// (2026-09-11, WT1b) — the text-only path never decodes an image and never requests them.
export const PDFJS_WASM = "/vendor/pdfjs-6.3.289/wasm/";

// What a reader's first OCR run actually costs them, in one number they can weigh before
// ticking the box: worker.min.js (111 KB) + exactly ONE WebAssembly core, chosen per browser
// by feature detection (≈3.9 MB) + the tessdata_fast English model (1.97 MB gzipped) ≈ 6.0 MB.
// Measured 2026-09-11 from the vendored bytes, and all of it comes from /vendor/ on this
// origin — never from a CDN. It is a constant rather than a sentence because the same figure
// is stated on the page in prose and in the progress line, and two hand-written copies of a
// measured number are two copies that drift.
export const ENGINE_DOWNLOAD_MB = 6;

// The full option object handed to createWorker. The five non-path keys are as load-bearing
// as the paths: workerBlobURL:true (the default) builds the worker from a blob: URL, which
// worker-src 'self' refuses; cacheMethod defaults to writing the language model into
// IndexedDB, which would make "this page stores nothing" false.
// `overrides` is spread LAST and exists for exactly one caller: prove-ocr.mjs, which points
// langPath at the vendor directory on disk and workerPath at tesseract's Node worker script
// (in Node the worker is a worker_threads entry file, not the browser's worker.min.js). The
// browser passes exactly one key, `errorHandler`, and it has to: tesseract.js 7 reports a
// failed load through errorHandler and NEVER SETTLES the createWorker promise (proven in
// prove-ocr.mjs check [8]), so a page that only awaits the promise hangs on the one failure
// it most needs to tell the reader about. createOCRWorker adds it; see below.
export function ocrWorkerOptions(logger, overrides) {
  return {
    workerPath: TESSERACT.workerPath,
    corePath: TESSERACT.corePath,
    langPath: TESSERACT.langPath,
    workerBlobURL: false,
    cacheMethod: "none",
    gzip: true,
    legacyCore: false,
    legacyLang: false,
    logger,
    ...(overrides || {})
  };
}

// tesseract's logger speaks in its own status strings and a 0..1 progress. The page shows
// three phases and nothing else; an unrecognised status returns null rather than rendering
// a phase name the reader has never heard of.
export function mapProgress(msg) {
  const status = msg && typeof msg.status === "string" ? msg.status : "";
  const fraction = Number(msg && msg.progress) || 0;
  if (status === "loading tesseract core") return { phase: "engine", fraction };
  if (status === "loading language traineddata") return { phase: "language", fraction };
  if (status === "recognizing text") return { phase: "page", fraction };
  return null;
}

// One worker, created through the caller's own createWorker so the prover and the page can
// each supply the build they loaded. `1` is OEM.LSTM_ONLY — the neural engine, and the only
// one whose core is vendored here (no legacy cores, see vendor/README.md).
// `onError` is merged BEFORE the caller's overrides, so prove-ocr.mjs — which supplies its
// own errorHandler to observe a blocked load — still wins.
export function createOCRWorker(createWorker, onProgress, overrides, onError) {
  const logger = (msg) => {
    const mapped = mapProgress(msg);
    if (mapped && onProgress) onProgress(mapped);
  };
  const extra = {
    ...(typeof onError === "function" ? { errorHandler: onError } : {}),
    ...(overrides || {})
  };
  return createWorker(TESSERACT.lang, 1, ocrWorkerOptions(logger, extra));
}

// The page never calls tesseract directly; it calls this. Keeps the shape of what comes
// back to two fields the rest of the code understands, and survives a worker that returns
// a result with neither.
export async function recognizeBitmap(worker, bitmap) {
  const result = await worker.recognize(bitmap);
  const data = (result && result.data) || {};
  return {
    text: data.text || "",
    confidence: Number(data.confidence) || 0
  };
}

// Which pages have no text layer worth searching. A page of whitespace is a blank page:
// pdf.js hands back "" or " \n" for an image-only page depending on the producer.
export function pagesNeedingOCR(pages) {
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    if (!String(pages[i] ?? "").trim()) out.push(i);
  }
  return out;
}

// The text layer and the OCR results, merged into one array the results box can render.
// `source` is carried per page because a hit found by OCR is labelled as such on screen —
// a reader must be able to tell which answers came from a model that can misread.
// Never mutates either input.
export function mergeOCR(pages, ocrResults) {
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    const original = String(pages[i] ?? "");
    if (original.trim()) {
      out.push({ text: original, source: "text", confidence: null });
      continue;
    }
    const result = ocrResults && typeof ocrResults.get === "function" ? ocrResults.get(i) : undefined;
    if (!result) {
      out.push({ text: "", source: "text", confidence: null });
      continue;
    }
    const text = String(result.text ?? "").trim() ? String(result.text).trim() : "";
    out.push({ text, source: "ocr", confidence: result.confidence });
  }
  return out;
}

// The sentence the results box shows when OCR ran. The second half is not optional politeness:
// the fast model misreads words on faint, skewed and low-resolution scans, so a reader who
// searched an OCR page and got nothing must be told that is not proof the word is absent.
export function describeOCR(run) {
  const ocrPages = Math.max(0, Number(run && run.ocrPages) || 0);
  const emptyOcrPages = Math.max(0, Number(run && run.emptyOcrPages) || 0);
  const parts = [];
  if (ocrPages > 0) {
    parts.push(
      ocrPages === 1
        ? "1 page was read by OCR. OCR can misread words on faint, skewed or low-resolution scans, so a miss on those pages is not proof the word is absent."
        : ocrPages + " pages were read by OCR. OCR can misread words on faint, skewed or low-resolution scans, so a miss on those pages is not proof the word is absent."
    );
  }
  if (emptyOcrPages > 0) {
    parts.push(
      emptyOcrPages === 1
        ? "OCR found no readable text on 1 page."
        : "OCR found no readable text on " + emptyOcrPages + " pages."
    );
  }
  return parts.join(" ");
}

// What the progress line says while the engine itself is being fetched. The size is in it
// because the reader is waiting on a 6 MB download they did not see coming, and "from this
// site" is in it because the one thing a reader of this page was promised is that nothing
// goes anywhere else — a long pause with a spinner is exactly when that doubt arrives.
// An unrecognised or absent phase returns "" rather than a guess: the caller then leaves
// whatever line it already had on screen.
export function describeEngineLoad(progress) {
  const phase = progress && progress.phase;
  if (phase === "engine") {
    return "Loading the OCR engine — about " + ENGINE_DOWNLOAD_MB
         + " MB, from this site, the first time it runs";
  }
  if (phase === "language") return "Loading the English OCR model";
  return "";
}

// The progress line itself. Two jobs in one sentence: which file of how many (the line the
// page has always shown), and — only while OCR is running — which page of that file, because
// OCR is the one phase slow enough that a per-file line looks like a hang. Both counts are
// 0-based in the code and 1-based on screen, which is the only place that conversion happens.
export function ocrProgressLine(fileIndex, fileTotal, name, pageIndex, pageTotal) {
  const line = "Reading " + (Number(fileIndex) + 1) + " of " + fileTotal + " — " + name;
  if (pageIndex === null || pageIndex === undefined) return line;
  return line + " · OCR page " + (Number(pageIndex) + 1) + " of " + pageTotal;
}

// The skipped list's reason for one file, or null when the file needs no row at all. This is
// the sentence the whole tool turns on: a scan that silently reports "no matches" is the most
// misleading answer a search can give, so every page that was not really searched is named
// here. With OCR off the reason also says how to fix it, in the exact words of the checkbox —
// a reader should never have to guess which control the sentence means.
export function describeSkip(info) {
  const i = info || {};
  const totalPages = Math.max(0, Number(i.totalPages) || 0);
  const blankPages = Math.max(0, Number(i.blankPages) || 0);
  const emptyOcrPages = Math.max(0, Number(i.emptyOcrPages) || 0);
  const ocrReadPages = Math.max(0, Number(i.ocrReadPages) || 0);
  const rest = totalPages > blankPages ? " (the rest of the file was searched)" : "";

  if (!i.ocrOn) {
    if (totalPages > 0 && blankPages === totalPages) {
      return "no text layer on any page — it looks like a scan. Tick 'Also read scanned pages with OCR' to read it";
    }
    if (blankPages > 0 && blankPages < totalPages) {
      return blankPages + (blankPages === 1 ? " page has" : " pages have")
           + " no text layer and " + (blankPages === 1 ? "was" : "were")
           + " not searched — tick 'Also read scanned pages with OCR' to read "
           + (blankPages === 1 ? "it" : "them")
           + (i.hadHits ? " (the rest of the file was)" : "");
    }
    return null;
  }

  // OCR was asked for and the engine never loaded: the pages are unread, and saying so is
  // the difference between a gap the reader can see and a zero-result search they trust.
  if (i.engineFailed && blankPages > 0) {
    return blankPages + (blankPages === 1 ? " scanned page was" : " scanned pages were")
         + " not read — the OCR engine could not be loaded" + rest;
  }
  // A blank page OCR never returned for was not read at all, and with the engine working the
  // only way that happens is Stop. ORDER IS THE CLAIM HERE, twice over:
  //  - AFTER engineFailed, because an engine that never loaded explains EVERY unread page, and
  //    "stopped before OCR reached them" would be a false account of the same pages.
  //  - BEFORE the emptyOcrPages branches, because "OCR found no readable text" describes pages
  //    OCR actually looked at; an unread page is the stronger and more misleading gap, so it is
  //    the one the single reason string spends itself on. `ocrReadPages` counts every page OCR
  //    returned for, empty results included — those are the emptyOcrPages branches' business and
  //    must not be double-counted as unread.
  const unread = Math.max(0, blankPages - ocrReadPages);
  if (unread > 0) {
    return unread + (unread === 1 ? " scanned page was" : " scanned pages were")
         + " not read — the search was stopped before OCR reached "
         + (unread === 1 ? "it" : "them") + rest;
  }
  if (totalPages > 0 && emptyOcrPages === totalPages) {
    return emptyOcrPages === 1
      ? "OCR found no readable text on its only page"
      : "OCR found no readable text on any of its " + totalPages + " pages";
  }
  if (emptyOcrPages > 0 && emptyOcrPages < totalPages) {
    return "OCR found no readable text on " + emptyOcrPages + " of its pages"
         + " (the rest of the file was searched)";
  }
  return null;
}

// Shown once, above the results, when the engine could not be loaded at all. It has to say
// both halves: what was lost (the scanned pages) and what was not (everything with a text
// layer), because a reader who sees an error at the top of a result box otherwise has no way
// to know whether the answer below it means anything.
export function engineFailureLine(reason) {
  return "The OCR engine could not be loaded in this browser"
       + (reason ? " (" + reason + ")" : "")
       + ". Scanned pages were not read; everything with a text layer was searched as usual.";
}

// The header of the copied text and the CSV — the line that travels with a result after it
// leaves this page. It carries the OCR caveat for the same reason the results box does: an
// exported answer is the one a reader hands to somebody else, who cannot see which box was
// ticked. The "marked OCR" half is a promise about the rows below it; asText and asCsv keep it.
export function exportHeaderLine(run) {
  const ocrPages = Math.max(0, Number(run && run.ocrPages) || 0);
  if (ocrPages > 0) {
    return "Whole-word matching, capitals ignored. "
         + (ocrPages === 1 ? "1 page" : ocrPages + " pages")
         + " read by OCR — English printed text, OCR can misread; those matches are marked OCR.";
  }
  // THE THIRD CASE, and it is not pedantry: OCR on over a set that happens to hold no scanned
  // page ends with ocrPages === 0, and the sentence below would then tell the reader's colleague
  // "OCR off" about a run whose box was ticked. Nothing was mis-searched — there was nothing to
  // OCR — but an exported header is read by someone who cannot see the checkbox, and this file's
  // whole job is that the export says what actually happened. Three states, three sentences.
  if (run && run.ocrOn) {
    return "Whole-word matching, capitals ignored. OCR was on, and no scanned pages were found to read.";
  }
  return "Whole-word matching, capitals ignored. OCR off: scanned pages were not searched.";
}

// How big to render a PDF page before handing it to OCR. A PDF viewport is in points, 72 to
// the inch, so scale = dpi / 72. Target ≈200 dpi is the conventional sweet spot for printed
// text: below ~150 the fast model starts dropping small type, above ~300 the bitmap grows
// quadratically for no accuracy. The maxSide cap bounds the image tesseract has to hold in
// memory on a poster-sized page, and the floor of 1 keeps a huge page from being rendered
// SMALLER than its own points. The real number is validated on the fixture in the WT1b
// browser walk — this function only has to be predictable, not correct about any one scan.
export function pickScale(viewport, opts) {
  const options = opts || {};
  const dpi = options.dpi === undefined ? 200 : options.dpi;
  const maxSide = options.maxSide === undefined ? 4000 : options.maxSide;
  const width = Number(viewport && viewport.width) || 0;
  const height = Number(viewport && viewport.height) || 0;
  const longest = Math.max(width, height);
  let scale = dpi / 72;
  if (longest > 0 && longest * scale > maxSide) scale = maxSide / longest;
  if (scale < 1) scale = 1;
  return Math.round(scale * 1000) / 1000;
}

// BROWSER ONLY, and proven only by the WT1b browser walk: Node has no canvas, and adding the
// native `canvas` package would be a build dependency that proves nothing about a browser.
// Everything above this line runs in both and is covered by prove-ocr.mjs.
//
// Two details that are not obvious and both cost real accuracy. (1) The canvas is sized from
// the SCALED viewport and rounded up — a fractional canvas width silently crops the right
// edge of the page, i.e. the last word on every line. (2) The canvas is filled WHITE first,
// because pdf.js paints nothing where a page has no paint and a fresh canvas is transparent
// black; tesseract reads those pixels as ink and a scan with wide margins comes back as a
// black page with no text on it.
export async function renderPageToCanvas(page, canvas, opts) {
  const scale = pickScale(page.getViewport({ scale: 1 }), opts);
  const viewport = page.getViewport({ scale });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // intent: "print" — and this is NOT about printing. It is which pump pdf.js drives the
  // render with. For the default "display" intent pdf.js continues each chunk from
  // window.requestAnimationFrame; Chrome does not fire rAF in a background tab, so a render
  // started there never finishes and never fails. Measured on a hidden tab, 2026-09-11:
  // display intent hung past 20 s on a 612x792 page with no image at all, print intent
  // rendered the real 1701x2201 scan in 5 ms. That matters here more than almost anywhere,
  // because OCR over a folder of scans is minutes long and nobody watches it — the reader
  // switches tabs, and with the rAF pump the progress line simply stops, which reads as a
  // freeze and invites a reload that throws the whole run away.
  // The intent also drops display-only annotation layers (popups, form highlights) and keeps
  // the printed appearance, which for reading a page's words is the more faithful bitmap.
  // PINNED AS TEXT in prove-ocr.mjs: rendering is browser-only, so no test can catch the
  // removal of this option — only the walk could, and only if someone thought to hide the tab.
  await page.render({ canvasContext: ctx, viewport, intent: "print" }).promise;
  return { width: canvas.width, height: canvas.height, scale };
}

// Dropping the reference is not enough: a 200 dpi A4 bitmap is ~24 MB of RGBA held by the
// canvas backing store, and on a folder of scans the collector reliably loses that race.
// Setting either dimension to 0 frees it now. Browser only, like the function above.
export function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}
