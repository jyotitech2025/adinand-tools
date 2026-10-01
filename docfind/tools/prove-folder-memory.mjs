#!/usr/bin/env node
//
// prove-folder-memory.mjs — runs the remembered-folder logic that /tools/search-multiple-pdfs
// will ship, against a table of cases, a fake directory tree, and an in-memory store.
//
//   node tools/prove-folder-memory.mjs            (run from site/)
//
// IT TESTS THE FILE THE PAGE IMPORTS — tools/folder-memory.mjs — for the reason every prover
// on this site exists: /tools/is-your-pdf-searchable shipped on 2026-09-02 carrying a comment
// that named a prover, `tools/prove-pdf-checker.mjs`, which has never existed in any commit.
//
// THE HAZARD IT IS POINTED AT. WT2 is the first time this site stores anything. The page's old
// copy — "nothing is stored", "no library here to come back to", "close the tab and it is
// gone" — is replaced by a narrower promise: one pointer to one folder, opt-in, forgettable,
// and NEVER the files, their text, the OCR output or the query. That promise is not enforced
// by the sentence; it is enforced by one object literal in `save`, which a future `{ ...record }`
// would quietly invert while every "the three fields are there" test went on passing. So the
// check below asserts the stored object's keys are EXACTLY those three, against an input
// deliberately carrying the others.
//
// WHAT IT DOES NOT COVER, said out loud so the gap is not mistaken for coverage:
//   - The real IndexedDB ROUND-TRIP. Node has no IndexedDB, and a shimmed one would prove
//     something about the shim. `indexedDBAdapter` — the last export in the module, under its
//     BROWSER ONLY banner — is not executed by a single line of this file. Its open, its
//     upgrade and its transaction handling are proven by the WT2 browser walk and by nothing
//     else. What IS proven here is the bookkeeping above that banner: one record, replace
//     rather than append, forget really deletes, absent reads as null.
//   - `showDirectoryPicker` itself. It is Chromium-only and it does not exist in Node, so
//     nothing here calls it. walkDirectory is proven against a FAKE handle tree built in this
//     file; that the real API hands back entries of that shape is the walk's business.
//   - PERMISSION PROMPTS — `requestPermission`, a reader declining one, a handle whose
//     permission has lapsed since the last visit. All three are browser-only and all three are
//     in the walk. classifyFolderError is proven here over the error NAMES those paths throw;
//     that the browser really throws those names is not something Node can say.
//   - Whether a handle survives structured-clone into IndexedDB at all. It does not in a
//     private window, which is precisely the case supportsFolderMemory cannot detect — see its
//     comment. Only a browser can reach it.
//   - The page's COPY — the storage sentence, the Forget control, the Chrome-and-Edge
//     qualifier — is a claim-gate matter, not a prover matter: see check-answers.sh, rule
//     STORECAP.

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
const MODULE_PATH = resolve(HERE, "folder-memory.mjs");
let M = null;
try {
  M = await import(pathToFileURL(MODULE_PATH).href);
  ok("tools/folder-memory.mjs imports", true);
} catch (err) {
  console.log("  FAIL  tools/folder-memory.mjs did not import — " + ((err && err.message) || err));
  console.log("");
  console.log("RED: 1 of 1 checks failed");
  process.exit(1);
}
for (const name of ["DB_NAME", "STORE_NAME", "RECORD_KEY", "MAX_DEPTH", "supportsFolderMemory",
                    "describeMemory", "walkDirectory", "classifyFolderError", "folderErrorLine",
                    "makeStore", "indexedDBAdapter"]) {
  ok("it exports " + name, M[name] !== undefined, "undefined");
}

console.log("the names a reader can look up in DevTools");
eq("DB_NAME", M.DB_NAME, "docfind-tools");
eq("STORE_NAME", M.STORE_NAME, "folders");
eq("RECORD_KEY", M.RECORD_KEY, "last");
eq("MAX_DEPTH", M.MAX_DEPTH, 16);

// ---------------------------------------------------------------------------
// [2] supportsFolderMemory — a capability detect, and only that.
// ---------------------------------------------------------------------------
console.log("supportsFolderMemory");
eq("Chromium: a picker and a database",
   M.supportsFolderMemory({ showDirectoryPicker: () => {}, indexedDB: {} }), true);
eq("Safari and Firefox: no picker",
   M.supportsFolderMemory({ indexedDB: {} }), false);
eq("a picker that is not a function is not a picker",
   M.supportsFolderMemory({ showDirectoryPicker: true, indexedDB: {} }), false);
eq("a picker with no database to put the handle in",
   M.supportsFolderMemory({ showDirectoryPicker: () => {} }), false);
eq("no window at all", M.supportsFolderMemory(null), false);
eq("undefined is not a window", M.supportsFolderMemory(undefined), false);
// The limit of the technique, pinned so nobody reads a `true` here as a promise that saving
// will work: an incognito window has both of these and still cannot store a handle.
eq("an incognito-shaped window passes this check — DataCloneError is the only thing that knows",
   M.supportsFolderMemory({ showDirectoryPicker: () => {}, indexedDB: {} }), true);

// ---------------------------------------------------------------------------
// [3] describeMemory — the "Last time" sentence.
// ---------------------------------------------------------------------------
// Every date below is built with the local-time Date constructor on purpose. The function
// compares LOCAL calendar days, so a fixture written as an epoch number or a Z-suffixed string
// would mean a different day in a different timezone and this file would pass in London and
// fail in Auckland. The expected strings are hand-built from the module's own MONTHS array
// rather than from toLocaleDateString — a prover that asserts against ICU output asserts about
// the Node build it happens to be running on, not about the sentence a reader sees.
console.log("describeMemory");
const NOW = new Date(2026, 8, 11, 14, 30, 0);        // 11 Sep 2026, local
eq("the same calendar day, even 14 hours earlier",
   M.describeMemory({ name: "Invoices", savedAt: new Date(2026, 8, 11, 0, 5, 0) }, NOW),
   "Invoices, remembered today");
eq("yesterday, even though it is only 31 minutes ago",
   M.describeMemory({ name: "Invoices", savedAt: new Date(2026, 8, 10, 23, 59, 0) }, new Date(2026, 8, 11, 0, 30, 0)),
   "Invoices, remembered yesterday");
eq("an older date names the day and the month",
   M.describeMemory({ name: "Invoices", savedAt: new Date(2026, 8, 3, 9, 0, 0) }, NOW),
   "Invoices, remembered on 3 Sep");
eq("the format is the spec's, exactly",
   M.describeMemory({ name: "Invoices", savedAt: new Date(2026, 8, 11, 9, 0, 0) }, new Date(2026, 8, 30, 9, 0, 0)),
   "Invoices, remembered on 11 Sep");
eq("across a year boundary, yesterday is still yesterday",
   M.describeMemory({ name: "Tax", savedAt: new Date(2025, 11, 31, 18, 0, 0) }, new Date(2026, 0, 1, 9, 0, 0)),
   "Tax, remembered yesterday");
eq("January is the first month in the array, not the zeroth day",
   M.describeMemory({ name: "Tax", savedAt: new Date(2026, 0, 5, 9, 0, 0) }, new Date(2026, 1, 5, 9, 0, 0)),
   "Tax, remembered on 5 Jan");
eq("December is the last",
   M.describeMemory({ name: "Tax", savedAt: new Date(2025, 11, 24, 9, 0, 0) }, new Date(2026, 0, 20, 9, 0, 0)),
   "Tax, remembered on 24 Dec");
eq("a timestamp works as well as a Date",
   M.describeMemory({ name: "Invoices", savedAt: new Date(2026, 8, 3, 9, 0, 0).getTime() }, NOW),
   "Invoices, remembered on 3 Sep");
eq("and so does a timestamp for today",
   M.describeMemory({ name: "Invoices", savedAt: new Date(2026, 8, 11, 1, 0, 0).getTime() }, NOW),
   "Invoices, remembered today");
eq("no record, no sentence", M.describeMemory(null, NOW), null);
eq("an undefined record is the same as none", M.describeMemory(undefined, NOW), null);
// A clock that moved backwards — NTP after a flat battery, or the hour the autumn gives back.
// Relative phrasing here produces "in -0 days" or "tomorrow", which reads as a broken page
// rather than a wrong clock, so the plain date is what must come out.
{
  const future = M.describeMemory({ name: "Invoices", savedAt: new Date(2026, 8, 12, 9, 0, 0) }, NOW);
  eq("a savedAt in the future falls back to the plain date", future, "Invoices, remembered on 12 Sep");
  ok("and never says today", !/today/.test(future), future);
  ok("nor yesterday, nor tomorrow", !/yesterday|tomorrow/.test(future), future);
  ok("and carries no minus sign", !future.includes("-"), future);
  eq("a whole year in the future is still just a date",
     M.describeMemory({ name: "Invoices", savedAt: new Date(2027, 3, 2, 9, 0, 0) }, NOW),
     "Invoices, remembered on 2 Apr");
}
// The folder name is the reader's, and this function returns TEXT the caller sets with
// textContent. Nothing here escapes it, nothing here needs to, and this case is the pin that
// says so out loud: the day someone renders this with innerHTML, the string they render is
// this one.
{
  const hostile = '<img src=x onerror="alert(1)">Q3 "final" & <b>old</b>';
  const line = M.describeMemory({ name: hostile, savedAt: new Date(2026, 8, 11, 9, 0, 0) }, NOW);
  eq("a folder name that would matter as HTML comes back verbatim, unescaped",
     line, hostile + ", remembered today");
  ok("the angle brackets are still angle brackets — this is text, and the caller uses textContent",
     line.includes("<img src=x"), line);
  ok("no entity encoding was invented", !line.includes("&lt;") && !line.includes("&amp;"), line);
}
eq("a record with no usable timestamp names the folder and claims no date",
   M.describeMemory({ name: "Invoices" }, NOW), "Invoices");
eq("an unparseable timestamp is the same", M.describeMemory({ name: "Invoices", savedAt: "soon" }, NOW), "Invoices");
eq("with no `now` given it is compared against the real clock",
   M.describeMemory({ name: "Invoices", savedAt: Date.now() }), "Invoices, remembered today");

// ---------------------------------------------------------------------------
// [4] walkDirectory, over a fake handle tree.
// ---------------------------------------------------------------------------
// The fakes implement only what walkDirectory is allowed to touch: `kind`, `name`, an async
// `values()` on a directory and an async `getFile()` on a file. Anything the real API also
// offers and this code reaches for would show up here as a TypeError, which is the point — a
// fake that implements the whole interface cannot tell you which parts you depend on.
console.log("walkDirectory");
function fakeDir(name, entries) {
  return {
    kind: "directory",
    name,
    async *values() { for (const entry of entries) yield entry; }
  };
}
function fakeFile(name, opts) {
  const o = opts || {};
  return {
    kind: "file",
    name,
    async getFile() {
      // A file deleted between the listing and the read: the real API throws NotFoundError here.
      if (o.throws) throw Object.assign(new Error("gone"), { name: "NotFoundError" });
      return { name, size: o.size === undefined ? 1024 : o.size };
    }
  };
}
const isPdf = (file) => /\.pdf$/i.test(file.name);
async function collect(iterable) {
  const out = [];
  for await (const entry of iterable) out.push(entry);
  return out;
}
const paths = (rows) => rows.map((r) => r.path);

{
  const flat = fakeDir("Invoices", [fakeFile("b.pdf"), fakeFile("a.pdf"), fakeFile("c.pdf")]);
  const rows = await collect(M.walkDirectory(flat, isPdf));
  eq("a flat folder yields every PDF, sorted", paths(rows), ["a.pdf", "b.pdf", "c.pdf"]);
  eq("the path of a top-level file is just its name", rows[0].path, "a.pdf");
  eq("and the name is carried separately", rows[0].name, "a.pdf");
  ok("the File itself is handed through, not a copy of its name", rows[0].file.size === 1024, JSON.stringify(rows[0].file));
}
{
  const nested = fakeDir("Invoices", [
    fakeFile("top.pdf"),
    fakeDir("2025", [fakeFile("march.pdf"), fakeDir("q1", [fakeFile("deep.pdf")])]),
    fakeDir("2026", [fakeFile("january.pdf")])
  ]);
  eq("subfolders are walked, and the path is slash-joined relative to the chosen folder",
     paths(await collect(M.walkDirectory(nested, isPdf))),
     ["2025/march.pdf", "2025/q1/deep.pdf", "2026/january.pdf", "top.pdf"]);
}
{
  // <input webkitdirectory> — the control this replaces — includes subfolders. If the handle
  // path searched only the top level, the same folder would return a different set of files
  // depending on which button the reader pressed, and the tally would look right both times.
  const mixed = fakeDir("Invoices", [
    fakeFile("notes.txt"), fakeFile("scan.PDF"), fakeFile("sheet.csv"), fakeFile("a.pdf"),
    fakeFile("pdf"), fakeFile("report.pdf.bak")
  ]);
  eq("non-PDFs are filtered out by the caller's predicate, case-insensitively here",
     paths(await collect(M.walkDirectory(mixed, isPdf))), ["a.pdf", "scan.PDF"]);
}
{
  eq("an empty folder yields nothing",
     await collect(M.walkDirectory(fakeDir("Empty", []), isPdf)), []);
  eq("a folder of nothing but subfolders of nothing yields nothing",
     await collect(M.walkDirectory(fakeDir("Empty", [fakeDir("a", []), fakeDir("b", [fakeDir("c", [])])]), isPdf)), []);
}
{
  // THE ORDER CLAIM, and the only way to test it is to feed the same tree in two orders. The
  // File System Access API does not specify the order of values(), and filesystem order is not
  // stable across a rename or a copy — so without the sort, two searches of an UNCHANGED folder
  // could list their results differently, which reads as "something changed" to the one reader
  // this feature is for.
  const build = (order) => fakeDir("Invoices", order.map((n) =>
    n.endsWith("/") ? fakeDir(n.slice(0, -1), [fakeFile("inner.pdf"), fakeFile("also.pdf")]) : fakeFile(n)));
  const first = paths(await collect(M.walkDirectory(build(["b.pdf", "zed/", "a.pdf", "alpha/"]), isPdf)));
  const second = paths(await collect(M.walkDirectory(build(["alpha/", "a.pdf", "zed/", "b.pdf"]), isPdf)));
  eq("two walks of the same tree, entries returned in a different order each time, agree", first, second);
  eq("and the order is the sorted one, at every level",
     first, ["a.pdf", "alpha/also.pdf", "alpha/inner.pdf", "b.pdf", "zed/also.pdf", "zed/inner.pdf"]);
}
{
  const deep = fakeDir("root", [
    fakeFile("d0.pdf"),
    fakeDir("one", [fakeFile("d1.pdf"), fakeDir("two", [fakeFile("d2.pdf"), fakeDir("three", [fakeFile("d3.pdf")])])])
  ]);
  eq("depth 0 is the chosen folder itself", paths(await collect(M.walkDirectory(deep, isPdf, { maxDepth: 0 }))), ["d0.pdf"]);
  eq("depth 1 adds one level of subfolders",
     paths(await collect(M.walkDirectory(deep, isPdf, { maxDepth: 1 }))), ["d0.pdf", "one/d1.pdf"]);
  eq("depth 2 adds the next",
     paths(await collect(M.walkDirectory(deep, isPdf, { maxDepth: 2 }))), ["d0.pdf", "one/d1.pdf", "one/two/d2.pdf"]);
  eq("and the default reaches all of it",
     paths(await collect(M.walkDirectory(deep, isPdf))),
     ["d0.pdf", "one/d1.pdf", "one/two/d2.pdf", "one/two/three/d3.pdf"]);
  eq("an empty options object is the same as none",
     paths(await collect(M.walkDirectory(deep, isPdf, {}))),
     paths(await collect(M.walkDirectory(deep, isPdf))));
  // Too deep is SKIPPED, not thrown on: a reader who points this at their home directory gets
  // the files it could reach, not an error about a folder they have never opened.
  ok("a directory past the cap is skipped rather than throwing", true);
}
{
  // ONE BAD ENTRY MUST NOT END THE WALK. A directory handle is a snapshot of a live
  // filesystem: between the listing and the read a file can be deleted, locked, or sit on a
  // share that just dropped. Aborting there would report the folder as smaller than it is,
  // which is the exact failure this whole tool exists to prevent.
  const flaky = fakeDir("Invoices", [
    fakeFile("a-deleted.pdf", { throws: true }),
    fakeFile("b.pdf"),
    fakeFile("c-deleted.pdf", { throws: true }),
    fakeFile("d.pdf")
  ]);
  eq("a file that throws on read is skipped and the walk continues past it",
     paths(await collect(M.walkDirectory(flaky, isPdf))), ["b.pdf", "d.pdf"]);
  const allGone = fakeDir("Invoices", [fakeFile("a.pdf", { throws: true }), fakeFile("b.pdf", { throws: true })]);
  eq("a folder where every read fails yields nothing and still returns",
     await collect(M.walkDirectory(allGone, isPdf)), []);
  // The same hazard one level up: a directory that stops listing part-way keeps what it gave.
  const brokenListing = {
    kind: "directory",
    name: "Invoices",
    async *values() { yield fakeFile("a.pdf"); throw Object.assign(new Error("share dropped"), { name: "NotReadableError" }); }
  };
  eq("a directory that stops listing mid-iteration keeps what it did give",
     paths(await collect(M.walkDirectory(brokenListing, isPdf))), ["a.pdf"]);
}

// ---------------------------------------------------------------------------
// [5] classifyFolderError — five kinds, and nothing that can throw a second time.
// ---------------------------------------------------------------------------
console.log("classifyFolderError");
const asError = (name) => Object.assign(new Error(name + " happened"), { name });
eq("closing the picker", M.classifyFolderError(asError("AbortError")), "cancelled");
eq("declining the permission prompt", M.classifyFolderError(asError("NotAllowedError")), "denied");
eq("a folder that has been moved or deleted", M.classifyFolderError(asError("NotFoundError")), "missing");
eq("no user gesture, or an origin the browser refuses", M.classifyFolderError(asError("SecurityError")), "unsupported");
eq("a handle that will not structured-clone — the private-window case", M.classifyFolderError(asError("DataCloneError")), "unsupported");
eq("a database this browser will not open", M.classifyFolderError(asError("InvalidStateError")), "unsupported");
eq("a plain object carrying a name works too", M.classifyFolderError({ name: "AbortError" }), "cancelled");
eq("an unexpected DOMException name", M.classifyFolderError(asError("QuotaExceededError")), "unknown");
eq("an object with an unexpected name", M.classifyFolderError({ name: "Whatever" }), "unknown");
eq("an object with no name at all", M.classifyFolderError({}), "unknown");
eq("a bare Error", M.classifyFolderError(new Error("boom")), "unknown");
// Anything can be thrown in JavaScript, and none of it may throw a second error out of the
// error handler — the place where a page stops being able to tell the reader anything at all.
eq("null", M.classifyFolderError(null), "unknown");
eq("undefined", M.classifyFolderError(undefined), "unknown");
eq("no argument", M.classifyFolderError(), "unknown");
eq("a string", M.classifyFolderError("NotAllowedError"), "unknown");
eq("a number", M.classifyFolderError(0), "unknown");
eq("a name that is not a string", M.classifyFolderError({ name: 404 }), "unknown");

// ---------------------------------------------------------------------------
// [6] folderErrorLine — what the reader is actually told.
// ---------------------------------------------------------------------------
console.log("folderErrorLine");
eq("cancelled renders NOTHING — closing a picker is not an error and must not read as one",
   M.folderErrorLine("cancelled", "Invoices"), null);
eq("and that is true with no folder name either", M.folderErrorLine("cancelled"), null);
for (const kind of ["denied", "missing", "unsupported", "unknown"]) {
  const line = M.folderErrorLine(kind, "Invoices");
  ok(kind + " says something", typeof line === "string" && line.length > 0, JSON.stringify(line));
  ok(kind + " names the folder the reader chose", line.includes("Invoices"), line);
  // Not a rule of tone, a rule of fact: every one of these states is reached by a person doing
  // something reasonable, and a page that answers with "you denied" turns an ordinary choice
  // into a fault.
  ok(kind + " does not blame the reader", !/\byou (denied|refused|failed|forgot|did not)\b/i.test(line), line);
  ok(kind + " is a sentence, not a code", !/Error\b/.test(line), line);
  const unnamed = M.folderErrorLine(kind);
  ok(kind + " without a name still says something", typeof unnamed === "string" && unnamed.length > 0, JSON.stringify(unnamed));
  ok(kind + " without a name leaves no empty quotes", !unnamed.includes("“”") && !unnamed.includes('""'), unnamed);
}
ok("denied says permission was not given", /permission/i.test(M.folderErrorLine("denied", "Invoices")));
ok("denied offers both ways out", /choose the folder again/i.test(M.folderErrorLine("denied", "Invoices"))
   && /forget it/i.test(M.folderErrorLine("denied", "Invoices")));
ok("missing says it could not be found", /could not be found/i.test(M.folderErrorLine("missing", "Invoices")));
ok("missing names the three ordinary causes rather than guessing one",
   /moved, renamed or deleted/i.test(M.folderErrorLine("missing", "Invoices")));
ok("missing offers to forget it", /forget it/i.test(M.folderErrorLine("missing", "Invoices")));
ok("unsupported says it is the browser, not the reader",
   /this browser will not let this page remember/i.test(M.folderErrorLine("unsupported", "Invoices")));
ok("unsupported names the usual reason without asserting it",
   /private window is the usual reason/i.test(M.folderErrorLine("unsupported", "Invoices")));
ok("unsupported says the rest of the page still works",
   /everything else on this page still works/i.test(M.folderErrorLine("unsupported", "Invoices")));
ok("unknown invents no cause", /did not say why/i.test(M.folderErrorLine("unknown", "Invoices")));
ok("unknown is short", M.folderErrorLine("unknown", "Invoices").length < 160,
   String(M.folderErrorLine("unknown", "Invoices").length));
eq("an unrecognised kind falls to the unknown sentence rather than to nothing",
   M.folderErrorLine("something-else", "Invoices"), M.folderErrorLine("unknown", "Invoices"));

// ---------------------------------------------------------------------------
// [7] makeStore — the bookkeeping, against an in-memory adapter.
// ---------------------------------------------------------------------------
// The adapter is the injection seam and the whole reason any of this is provable in Node. A
// Map here, IndexedDB in the browser; what is asserted below is the part that carries the
// claims, and it is the same code either way.
console.log("makeStore");
function memoryAdapter() {
  const map = new Map();
  return {
    map,
    async get(key) { return map.get(key); },
    async put(key, value) { map.set(key, value); },
    async del(key) { map.delete(key); }
  };
}
const HANDLE = { kind: "directory", name: "Invoices", __handle: true };
{
  const adapter = memoryAdapter();
  const store = M.makeStore(adapter);
  eq("nothing remembered yet reads as null, never undefined", await store.load(), null);
  ok("and it is null, not undefined", (await store.load()) === null, String(await store.load()));

  const at = new Date(2026, 8, 11, 9, 0, 0).getTime();
  await store.save({ handle: HANDLE, name: "Invoices", savedAt: at });
  const loaded = await store.load();
  ok("the handle comes back as the same object, not a copy", loaded.handle === HANDLE);
  eq("the name round-trips", loaded.name, "Invoices");
  eq("and so does the timestamp", loaded.savedAt, at);
  eq("exactly one key is in the store", [...adapter.map.keys()], [M.RECORD_KEY]);

  // Replace, not append. There is no code path that grows a history of the reader's folders
  // behind a checkbox they ticked once, and the fixed key is what makes that a fact rather
  // than a policy.
  await store.save({ handle: HANDLE, name: "Tax 2026", savedAt: at + 1000 });
  eq("a second save still leaves exactly one key", [...adapter.map.keys()], [M.RECORD_KEY]);
  eq("and the store holds exactly one record", adapter.map.size, 1);
  eq("the newer record won", (await store.load()).name, "Tax 2026");

  await store.forget();
  eq("forget really deletes — the store is empty", adapter.map.size, 0);
  eq("and load says so", await store.load(), null);
  await store.forget();
  eq("forgetting twice is not an error", adapter.map.size, 0);
}
{
  // ⚠️ THE CHECK THIS FILE EXISTS FOR. The page's promise is that the files, their text, the
  // OCR output and the query are never stored. That promise is enforced by one object literal
  // in `save`; `{ ...record }` would be shorter, would keep every "the three fields are there"
  // assertion green, and would persist whatever else the page's run state was carrying — and
  // it grows every milestone. So the assertion is on the KEYS, and the input is stuffed.
  const adapter = memoryAdapter();
  const store = M.makeStore(adapter);
  await store.save({
    handle: HANDLE,
    name: "Invoices",
    savedAt: 1757548800000,
    files: [{ name: "secret.pdf" }, { name: "payslip.pdf" }],
    query: "settlement amount",
    ocrText: "PAID IN FULL 12 March",
    results: [{ page: 4 }],
    lastRun: { hits: 12 }
  });
  const stored = adapter.map.get(M.RECORD_KEY);
  eq("the stored record's keys are exactly the three that were promised",
     Object.keys(stored).sort(), ["handle", "name", "savedAt"]);
  for (const leaked of ["files", "query", "ocrText", "results", "lastRun"]) {
    ok("nothing named " + leaked + " reached the store", !(leaked in stored), JSON.stringify(Object.keys(stored)));
  }
  const serialised = JSON.stringify(stored);
  ok("and no file name is anywhere in the stored bytes", !serialised.includes("payslip"), serialised);
  ok("nor the reader's query", !serialised.includes("settlement"), serialised);
  ok("nor any OCR text", !serialised.includes("PAID IN FULL"), serialised);
  eq("load does not hand the extras back either",
     Object.keys(await store.load()).sort(), ["handle", "name", "savedAt"]);
}
{
  const adapter = memoryAdapter();
  const store = M.makeStore(adapter);
  const before = Date.now();
  const stored = await store.save({ handle: HANDLE, name: "Invoices" });
  ok("a save with no savedAt is stamped now, so the key is never missing",
     typeof stored.savedAt === "number" && stored.savedAt >= before, String(stored.savedAt));
  eq("and it is still exactly three keys", Object.keys(stored).sort(), ["handle", "name", "savedAt"]);
}
{
  // A half-formed record is treated as absent rather than returned. A stored object with no
  // handle cannot be re-opened and one with no name cannot be described, so "Last time:
  // undefined" beside a dead button is the only thing the page could render from it.
  const adapter = memoryAdapter();
  const store = M.makeStore(adapter);
  adapter.map.set(M.RECORD_KEY, { name: "Invoices", savedAt: 1757548800000 });
  eq("a record with no handle loads as null", await store.load(), null);
  adapter.map.set(M.RECORD_KEY, { handle: HANDLE, savedAt: 1757548800000 });
  eq("a record with no name loads as null", await store.load(), null);
  adapter.map.set(M.RECORD_KEY, {});
  eq("an empty record loads as null", await store.load(), null);
  adapter.map.set(M.RECORD_KEY, null);
  eq("a null record loads as null", await store.load(), null);
  adapter.map.set(M.RECORD_KEY, { handle: HANDLE, name: "Invoices" });
  eq("a record with a handle and a name but no date is NOT half-formed — it loads",
     (await store.load()).name, "Invoices");
}
{
  // The store reads and writes one key and no other. Anything else in the database is somebody
  // else's, and Forget must not be a reason to touch it.
  const adapter = memoryAdapter();
  const store = M.makeStore(adapter);
  adapter.map.set("something-else", { not: "ours" });
  await store.save({ handle: HANDLE, name: "Invoices", savedAt: 1 });
  eq("save writes only RECORD_KEY", [...adapter.map.keys()].sort(), ["last", "something-else"]);
  await store.forget();
  eq("forget deletes only RECORD_KEY", [...adapter.map.keys()], ["something-else"]);
}

// ---------------------------------------------------------------------------
// [8] The module names no off-origin URL. Pinned as text.
// ---------------------------------------------------------------------------
// check-answers.sh reads this module under NETWORK for the same reason, and this is the belt
// to that brace: every tool page on this site claims the reader's files never leave their
// browser, and a module that is served to the browser is as much a part of that claim as the
// page. A scheme-bearing URL here would be the one line nobody re-reads — including in a
// comment, because a comment is where a "temporary" fallback URL gets parked before it is
// wired up.
console.log("no off-origin URL anywhere in the module");
{
  const src = readFileSync(MODULE_PATH, "utf8");
  ok("the module source was read at all", src.length > 0, String(src.length));
  ok("no https:// anywhere in it, code or comment", !src.includes("https://"), "found one");
  ok("no http:// either", !src.includes("http://"), "found one");
  ok("it imports nothing at all — its whole network behaviour is readable in one file",
     !/^\s*import\s/m.test(src), "an import statement appeared");
}

// ---------------------------------------------------------------------------
// [9] A READ MUST NOT CREATE THE DATABASE — the WT2 walk's defect, made provable
// ---------------------------------------------------------------------------
// This was a real one, found in a browser on 2026-09-11 and invisible to everything else:
// merely LOADING the page left a `docfind-tools` database behind, because initMemory() calls
// load() to ask whether a folder was remembered and indexedDB.open() creates unconditionally.
// The honest answer "nothing is remembered" cost the reader a database, on a page whose copy
// and whose privacy policy both say the tools store nothing unless the box is ticked.
//
// The top of this file says the real IndexedDB round-trip is browser-only and it still is.
// But the POLICY — does a read create, does a write create, does a delete create — is not:
// indexedDBAdapter takes the factory as an argument, so a fake factory can be asked what the
// adapter did to it. That is the difference between "we fixed it" and "it cannot come back".
console.log("a read never leaves a database behind");
{
  // The smallest IDBFactory that can answer the question. `exists` is the database; `open`
  // fires onupgradeneeded exactly when it had to create one, like the real thing.
  function fakeFactory() {
    const f = {
      exists: false,
      opened: 0,
      deleted: 0,
      open(name, version) {
        f.opened++;
        const hadToCreate = !f.exists;
        f.exists = true;
        const db = {
          objectStoreNames: { contains: () => false },
          createObjectStore: () => ({}),
          close: () => { f.closed = true; },
          transaction: () => {
            const tx = {};
            const store = { get: () => req, put: () => req, delete: () => req };
            const req = {};
            queueMicrotask(() => { if (req.onsuccess) req.onsuccess(); if (tx.oncomplete) tx.oncomplete(); });
            tx.objectStore = () => store;
            return tx;
          }
        };
        const request = { result: db };
        queueMicrotask(() => {
          if (hadToCreate && request.onupgradeneeded) request.onupgradeneeded();
          if (request.onsuccess) request.onsuccess();
        });
        return request;
      },
      deleteDatabase() {
        f.deleted++;
        f.exists = false;
        const request = {};
        queueMicrotask(() => { if (request.onsuccess) request.onsuccess(); });
        return request;
      }
    };
    return f;
  }

  // (a) get() against a browser that has never seen this site.
  const f1 = fakeFactory();
  const a1 = M.indexedDBAdapter(f1);
  const got = await a1.get(M.RECORD_KEY);
  ok("a get on a fresh browser answers absent", got === undefined, String(got));
  ok("...and deletes the database its own open() created", f1.deleted === 1, "deleted " + f1.deleted);
  ok("...leaving no database behind", f1.exists === false, "the database is still there");

  // (b) del() must not create one either — there is nothing to delete from a database that
  //     never existed, and creating one in order to delete from it is the same bug wearing
  //     a different verb.
  const f2 = fakeFactory();
  await M.indexedDBAdapter(f2).del(M.RECORD_KEY);
  ok("a delete on a fresh browser leaves no database behind", f2.exists === false);
  ok("...having undone the open it had to make", f2.deleted === 1, "deleted " + f2.deleted);

  // (c) put() is the ONE operation allowed to create, because that is the reader ticking the
  //     box. If this ever goes green while (a) does, the adapter has stopped storing anything.
  const f3 = fakeFactory();
  await M.indexedDBAdapter(f3).put(M.RECORD_KEY, { handle: {}, name: "Invoices", savedAt: 1 });
  ok("a put DOES create the database — this is the opt-in", f3.exists === true);
  ok("...and does not then delete it", f3.deleted === 0, "deleted " + f3.deleted);

  // (d) the sequence a real reader produces: load on every visit, tick once, load again.
  const f4 = fakeFactory();
  const a4 = M.indexedDBAdapter(f4);
  await a4.get(M.RECORD_KEY); await a4.get(M.RECORD_KEY); await a4.get(M.RECORD_KEY);
  ok("three page loads with no opt-in leave nothing", f4.exists === false, "a database survived");
  await a4.put(M.RECORD_KEY, { handle: {}, name: "Invoices", savedAt: 1 });
  ok("the opt-in creates it", f4.exists === true);
  await a4.get(M.RECORD_KEY);
  ok("and a later read does NOT destroy what was stored", f4.exists === true, "the read deleted the reader's record");

  // (e) FORGET MUST LEAVE NO DATABASE. Deleting the row alone left `docfind-tools` present in
  //     the browser under a page that had just said "This page is not storing anything now" —
  //     a sentence a reader can check in DevTools and find false. Found in the WT2 walk.
  const f5 = fakeFactory();
  const s5 = M.makeStore(M.indexedDBAdapter(f5));
  await s5.save({ handle: {}, name: "Invoices", savedAt: 1 });
  ok("saving created the database", f5.exists === true);
  await s5.forget();
  ok("forget leaves NO database behind, not merely an empty one", f5.exists === false,
     "the database survived the forget");
  ok("...and load afterwards still answers absent", (await s5.load()) === null);
  ok("...without recreating it", f5.exists === false, "load recreated the database");
}

// ---------------------------------------------------------------------------
// [10] AN UNREADABLE CHOSEN FOLDER MUST BE HEARD, NOT SWALLOWED
// ---------------------------------------------------------------------------
// The WT2 walk's third defect. A remembered folder was deleted, the reader pressed "Search it
// again", and the page answered with NOTHING — no files, no error, no explanation — because
// the tolerance written for a flaky sub-directory ("keep what it did give us") also covered
// the chosen folder itself, turning "your folder is gone" into "your folder is empty".
// Same shape as WT1b's render failure counted as an unread page: a tolerance written for one
// scale, applied at another.
console.log("an unreadable chosen folder throws; a flaky one does not");
{
  const boom = (name) => Object.assign(new Error("gone"), { name });
  const deadRoot = { kind: "directory", name: "Doomed",
    async *values() { throw boom("NotFoundError"); } };

  let threw = null;
  try { for await (const _ of M.walkDirectory(deadRoot, () => true)) { /* nothing */ } }
  catch (err) { threw = err; }
  ok("a chosen folder that lists nothing at all throws", threw !== null, "it stayed silent");
  ok("...with the error the caller needs to classify it",
     threw && M.classifyFolderError(threw) === "missing", threw && M.classifyFolderError(threw));
  ok("...which becomes a sentence naming the folder",
     (M.folderErrorLine("missing", "Doomed") || "").includes("Doomed"),
     String(M.folderErrorLine("missing", "Doomed")));

  // The other half, and the reason the rethrow is narrow: a root that produced real entries
  // before failing keeps them. Throwing here would discard files the reader can see exist.
  const flakyRoot = { kind: "directory", name: "Half",
    async *values() {
      yield { kind: "file", name: "a.pdf", getFile: async () => ({ name: "a.pdf", size: 1 }) };
      throw boom("NotReadableError");
    } };
  const got = [];
  let threw2 = null;
  try { for await (const e of M.walkDirectory(flakyRoot, () => true)) got.push(e.path); }
  catch (err) { threw2 = err; }
  ok("a chosen folder that gave SOME entries keeps them", got.length === 1, JSON.stringify(got));
  ok("...and does not throw them away to report an error", threw2 === null, String(threw2));

  // An empty folder is not an error — it is an answer, and a different sentence on the page.
  const emptyRoot = { kind: "directory", name: "Empty", async *values() { /* nothing */ } };
  const none = [];
  let threw3 = null;
  try { for await (const e of M.walkDirectory(emptyRoot, () => true)) none.push(e); }
  catch (err) { threw3 = err; }
  ok("a genuinely empty folder yields nothing and does NOT throw",
     none.length === 0 && threw3 === null, String(threw3));
}

done();
