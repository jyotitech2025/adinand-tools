// folder-memory.mjs — the logic behind the one thing /tools/search-multiple-pdfs may ever
// remember: a pointer to a folder the reader chose, kept only if they ticked the box.
//
// WHY A MODULE AND NOT TEN LINES IN THE PAGE. Until WT2 this site stored nothing at all, and
// said so in three different registers on eight surfaces. The moment one record exists, every
// one of those sentences becomes a claim about THIS FILE — what it writes, what it refuses to
// write, and whether Forget really deletes. A claim that lives inline in a <script> is a claim
// no prover reads (the 2026-09-08 lesson, and the reason pdf-text.mjs and ocr.mjs exist), so
// the bookkeeping lives here and `node tools/prove-folder-memory.mjs` runs it.
//
// THE CLAIM THIS FILE CARRIES, in one sentence: a saved record is exactly
// { handle, name, savedAt } — never the file list, never the extracted text, never the OCR
// output, never the query. `save` constructs that object field by field for that reason; see
// the comment on makeStore, which is the only place in this file where a spread would have
// been shorter and would have quietly made the page's central promise false.
//
// NOTHING IS IMPORTED HERE, ON PURPOSE. The page's promise is that nothing leaves the reader's
// browser; a dependency-free module is a module whose whole network behaviour is readable in
// one file. prove-folder-memory.mjs pins that as text: the source must contain no scheme-
// bearing URL at all. check-answers.sh reads this file too, under NETWORK.
//
// WHAT RUNS WHERE. Everything above the BROWSER ONLY banner near the bottom is pure and runs
// in both: Node for the prover, the browser for the page. `indexedDBAdapter` is the only
// browser-only export — Node has no IndexedDB — and it sits under that banner so the boundary
// is a place in the file rather than a fact someone has to remember.

// The database, the store and the key. Bare string literals on their own lines on purpose: a
// reader who wants to check that Forget really emptied the browser types these into DevTools →
// Application → IndexedDB, and a computed name is a name nobody can look up.
//
// RECORD_KEY is why there is exactly one remembered folder BY CONSTRUCTION rather than by
// policy. Every write goes to this one key, so a second save overwrites the first; there is no
// code path that appends, and therefore no code path that grows a history of the reader's
// folders behind a checkbox they ticked once. "One record" enforced by a loop over a list is a
// promise; one record enforced by a constant key is a fact.
export const DB_NAME = "docfind-tools";
export const STORE_NAME = "folders";
export const RECORD_KEY = "last";

// How many directory levels below the chosen folder the walk will enter. 16 is not a guess
// about how people organise invoices — it is a bound on a tree this code did not create and
// cannot see the shape of. The File System Access API hands back whatever the filesystem says,
// including trees deep enough (or self-referential enough, through links the browser resolves)
// that an unbounded walk is an unkillable loop in a tab with no cancel button. A bounded walk
// that misses a file at depth 17 is a visible, explainable gap; a hung tab is not.
export const MAX_DEPTH = 16;

// Whether this browser can remember a folder at all. showDirectoryPicker is Chromium-only —
// Safari and Firefox have neither the picker nor storable handles — so the page asks this
// before it renders the checkbox, rather than offering a control that cannot work.
//
// SAID HONESTLY, BECAUSE IT IS THE LIMIT OF THE TECHNIQUE: this is a CAPABILITY detect, and a
// capability detect CANNOT tell you whether a handle will actually survive structured-clone
// into IndexedDB. A Chrome incognito window has showDirectoryPicker, has indexedDB, passes
// this check — and then throws at save time, because a handle from a private session is not
// serialisable. That case is classifyFolderError's job (DataCloneError → "unsupported"), and
// it is reached only by trying. So the page must be written to survive a save that fails after
// this function said yes; there is no detect that would have spared it.
export function supportsFolderMemory(win) {
  if (!win) return false;
  return typeof win.showDirectoryPicker === "function" && !!win.indexedDB;
}

// Month names as data, and this is not stylistic. `toLocaleDateString` asks ICU, and ICU is a
// property of the machine: a Node built with `--with-intl=small-icu` formats in English no
// matter the locale, a full-icu build follows LANG, and the browser follows the reader's OS.
// A prover that asserted against that output would be asserting about the machine it ran on
// rather than about the sentence a reader sees, which is the same shape of mistake as a gate
// that greps its own comment. Built by hand from getDate()/getMonth(), the sentence is the
// same everywhere, and the prover's expected strings mean something.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A LOCAL calendar day as an integer, so "today" means the reader's today. Taking the local
// y/m/d and re-stamping them through Date.UTC removes the hours entirely, which is what makes
// the subtraction below immune to DST: an ordinary `(a - b) / 86400000` on two timestamps is
// 23 or 25 hours apart twice a year, and a folder saved at 23:30 the previous evening would
// then read as "today" on one of those mornings.
function localDayNumber(date) {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(Number(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

// The "Last time" sentence, or null when there is nothing remembered.
//
// `record.name` IS A FOLDER NAME THE READER CHOSE, i.e. a string this code did not write and
// cannot vouch for. This function returns TEXT and the caller sets it with `textContent` — not
// innerHTML, not a template concatenated into markup. A folder called `<img onerror=…>` is a
// perfectly legal folder name on every platform this page runs on, and the only reason it is
// harmless here is that nobody ever parses this string as HTML. The prover pins a name full of
// angle brackets and quotes for exactly that reason.
export function describeMemory(record, now) {
  if (!record) return null;
  const name = String(record.name === undefined || record.name === null ? "" : record.name);
  const saved = toDate(record.savedAt);
  // A record with no usable timestamp: name the folder and make no claim about when. A wrong
  // date is worse than an absent one — the whole sentence exists to help a reader recognise
  // the folder, and "remembered on NaN undefined" helps nobody. (The spec for this milestone
  // did not name this case; makeStore always writes a savedAt, so it can only arrive from a
  // record written by some older build.)
  if (!saved) return name;

  const days = localDayNumber(toDate(now) || new Date()) - localDayNumber(saved);
  if (days === 0) return name + ", remembered today";
  if (days === 1) return name + ", remembered yesterday";
  // EVERYTHING ELSE FALLS TO THE DATE, INCLUDING A NEGATIVE DIFFERENCE. A savedAt in the
  // future is not hypothetical: the clock moves backwards when a machine syncs NTP after a
  // flat battery, and it moves backwards by an hour every autumn. Relative phrasing there
  // produces "in -0 days" or "tomorrow", which reads as a bug in the page rather than as a
  // wrong clock, so the plain date — which is at worst merely surprising — is what ships.
  return name + ", remembered on " + saved.getDate() + " " + MONTHS[saved.getMonth()];
}

// Code-unit order, not localeCompare. Same argument as MONTHS above: localeCompare's answer
// depends on the ICU the browser or the Node build carries, so two readers could see the same
// folder listed in two different orders and the prover could not pin either. A stable order
// that is occasionally unintuitive beats an order that is correct on the machine that tested it.
function byName(a, b) {
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

// Every PDF under the chosen folder, in a stable order, as { name, path, file } — `path`
// being the slash-joined path relative to the folder the reader picked.
//
// IT RECURSES BECAUSE THE CONTROL IT REPLACES DOES. The page's existing picker is
// <input webkitdirectory>, which hands over a folder's subfolders too. If the handle path
// searched only the top level, the same folder would return a different set of files
// depending on which button the reader pressed — and the tally would be right in both cases,
// so nothing on screen would say which one had quietly searched less.
//
// SORTED AT EVERY LEVEL BEFORE DESCENDING. The File System Access API does not specify the
// order of `values()`, and directory order in the underlying filesystem is not stable across
// a rename, a copy or a machine. Without this sort, two searches of an UNCHANGED folder could
// list their results in different orders, which reads as "something changed" to the one reader
// who is comparing two runs — the reader this whole feature is for.
//
// `isPdf` is the caller's predicate and is applied to the File, not to the entry: the page
// already owns one definition of what counts as a PDF and two copies of that rule would drift.
export async function* walkDirectory(handle, isPdf, opts) {
  const options = opts || {};
  const maxDepth = options.maxDepth === undefined ? MAX_DEPTH : options.maxDepth;
  yield* walkLevel(handle, "", 0, maxDepth, isPdf);
}

// depth 0 is the chosen folder itself, so maxDepth 0 means "this folder only" and maxDepth 1
// means "this folder and one level of subfolders".
async function* walkLevel(dir, prefix, depth, maxDepth, isPdf) {
  if (depth > maxDepth) return;

  // Collected into an array first because it has to be sorted, and sorted because of the
  // paragraph above. The try/catch keeps whatever was collected before a mid-iteration
  // failure: a folder the walk got halfway through is still half an answer, and dropping it
  // entirely would silently shrink the search.
  //
  // BUT THE ROOT IS NOT A SUB-FOLDER, AND CONFLATING THEM HID A WHOLE FAILURE. When the
  // chosen folder itself cannot be listed — moved, renamed, deleted, permission withdrawn —
  // this catch turned "your folder is gone" into "your folder has no PDFs in it": the reader
  // pressed "Search it again" and the page answered with nothing at all. No files, no error,
  // no explanation. Found in the WT2 browser walk, 2026-09-11, by deleting a remembered
  // folder and pressing the button. Same shape as WT1b's "a page that failed to render was
  // counted as unread" — a tolerance written for one scale applied at another.
  //
  // So: depth 0 rethrows and the caller turns it into a sentence; deeper levels keep the
  // tolerant behaviour, because there a partial answer really is better than none.
  const entries = [];
  try {
    for await (const entry of dir.values()) entries.push(entry);
  } catch (err) {
    // ...and only when the root gave up NOTHING. A root that listed some entries and then
    // raced (a folder being written to while it is walked) still has a real partial answer,
    // and throwing it away to report an error would lose files the reader can see are there.
    // Nothing collected means nothing was readable, which is the case that must be spoken.
    if (depth === 0 && entries.length === 0) throw err;
    /* otherwise: a directory that stopped listing part-way — keep what it did give us */
  }
  entries.sort(byName);

  for (const entry of entries) {
    const path = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.kind === "directory") {
      // Too deep is SKIPPED, not thrown: a reader who points the tool at their home directory
      // should get the files it could reach, not an error dialog about a folder they have
      // never opened. walkLevel returns immediately on the depth test above.
      yield* walkLevel(entry, path, depth + 1, maxDepth, isPdf);
      continue;
    }
    if (entry.kind !== "file") continue;

    // ONE BAD ENTRY MUST NOT END THE WALK. A directory handle is a snapshot of a live
    // filesystem: between listing a name and reading it, the file can be deleted, moved,
    // locked by another process, or sit on a network share that just dropped. Letting that
    // throw out of the generator would abandon every file after it in the folder and report
    // the result as if the folder were smaller — the exact failure this tool exists to stop.
    let file = null;
    try {
      file = await entry.getFile();
    } catch {
      continue;
    }
    if (!file || !isPdf(file)) continue;
    yield { name: entry.name, path, file };
  }
}

// What went wrong, in the five words the page knows how to react to. The DOMException `name`
// is the only part of a File System Access rejection that is stable — the `message` is written
// by the browser vendor and differs between Chrome and Edge builds, so nothing here reads it.
//
// "cancelled" IS NOT AN ERROR AND THE CALLER MUST RENDER NOTHING FOR IT. Closing the picker is
// how a reader says "not now"; answering that with a red line on the page tells them they did
// something wrong when they did the most ordinary thing available. That is why it has its own
// kind instead of falling into "unknown", and why folderErrorLine returns null for it.
export function classifyFolderError(err) {
  const name = err && typeof err === "object" && typeof err.name === "string" ? err.name : "";
  if (name === "AbortError") return "cancelled";
  if (name === "NotAllowedError") return "denied";
  if (name === "NotFoundError") return "missing";
  // SecurityError: the call was not in a user gesture, or the browser refuses the origin.
  // DataCloneError: the handle would not survive structured-clone — a private window, and the
  // case supportsFolderMemory explicitly cannot detect.
  // InvalidStateError: the store or the database is in a state this browser will not open.
  // All three mean the same thing to a reader: not here, not in this window.
  if (name === "SecurityError" || name === "DataCloneError" || name === "InvalidStateError") return "unsupported";
  // Anything at all can be thrown in JavaScript, including a string, null, or a value from a
  // library that never heard of DOMException. None of them may throw a second error out of the
  // error handler, which is a thing this function is the last line against.
  return "unknown";
}

// A folder name belongs to the reader, so it is quoted rather than run into the sentence —
// and "that folder" is the fallback, never a blank pair of quotes.
function folderLabel(name) {
  const text = name === undefined || name === null ? "" : String(name);
  return text ? "“" + text + "”" : "that folder";
}

// The sentence shown when remembering or re-opening a folder did not work.
//
// NONE OF THESE BLAME THE READER, and that is a rule rather than a tone. Every one of these
// states is reached by a person doing something reasonable — declining a prompt, tidying a
// folder, opening a private window — and a page that answers with "you denied permission"
// turns an ordinary choice into a fault. Each line says what happened, and every line that
// can offer a way forward offers both of them: choose again, or forget it.
export function folderErrorLine(kind, name) {
  const label = folderLabel(name);
  if (kind === "cancelled") return null;
  if (kind === "denied") {
    return "Permission to read " + label + " was not given, so it was not searched."
         + " You can choose the folder again, or forget it.";
  }
  if (kind === "missing") {
    return label + " could not be found — it may have been moved, renamed or deleted."
         + " You can choose a folder again, or forget it.";
  }
  if (kind === "unsupported") {
    return "This browser will not let this page remember " + label
         + " — a private window is the usual reason."
         + " Everything else on this page still works.";
  }
  // No invented cause. "The browser did not say why" is the literal truth of an unrecognised
  // DOMException name, and a guessed reason is worse than an admitted gap: a reader who is
  // told the wrong thing goes and fixes the wrong thing.
  return label + " could not be opened, and the browser did not say why."
       + " You can choose a folder again, or forget it.";
}

// The bookkeeping, over an adapter the caller supplies. `adapter` is { get, put, del } and it
// is the whole reason any of this is testable: in the browser it is indexedDBAdapter below, in
// the prover it is a Map. What is proven in Node is therefore the part that carries the claims
// — one record, replace-never-append, forget-really-deletes, absent-means-null — rather than
// whichever storage engine happens to be underneath.
//
// ⚠️ THE FIELD LIST IN `save` IS THE PAGE'S CENTRAL PROMISE, WRITTEN OUT LONGHAND.
// `{ ...record }` would be shorter, would pass every test that checks the three fields are
// present, and would silently persist whatever else the caller's object happened to be
// carrying — the file list, the reader's query, the OCR text — because the object `save` is
// handed is the page's own run state and it grows every milestone. The page tells the reader
// "the files, their text and your searches are never stored"; a spread is how that sentence
// becomes false without anyone editing it. So the three fields are named, and the prover
// asserts the STORED object's keys are exactly those three against an input deliberately
// stuffed with the others.
export function makeStore(adapter) {
  return {
    async save(record) {
      const stored = {
        handle: record.handle,
        name: record.name,
        // savedAt is defaulted rather than required so the key is always present: a record
        // with the field missing would read as "no date" forever after, and describeMemory
        // would drop the half of the sentence that lets a reader recognise the folder.
        savedAt: record.savedAt === undefined ? Date.now() : record.savedAt
      };
      await adapter.put(RECORD_KEY, stored);
      return stored;
    },

    // null, never undefined, and never a half-formed record. A stored object without a
    // `handle` cannot be re-opened and one without a `name` cannot be described, so either
    // way there is nothing the page could offer the reader — and "Last time: undefined" with
    // a dead Search-it-again button is a worse answer than no line at all. Rebuilt field by
    // field for the same reason save is: a record written by an older build must not hand the
    // page fields this one never promised to keep.
    async load() {
      const value = await adapter.get(RECORD_KEY);
      if (!value || !value.handle || !value.name) return null;
      return { handle: value.handle, name: value.name, savedAt: value.savedAt };
    },

    // Forget deletes. Not a tombstone, not a flag — the record is gone, so that a reader who
    // opens DevTools → Application → IndexedDB after clicking it sees an empty store, which is
    // the only form of this promise they can check for themselves.
    // FORGETTING REMOVES THE DATABASE, NOT JUST THE ROW. Deleting the record alone left a
    // `docfind-tools` database sitting in the browser under a page that had just printed
    // "This page is not storing anything now" — technically empty, visibly present, and the
    // first thing a reader who checks DevTools would see. "Forget it" has to mean what the
    // word means. Found in the WT2 browser walk, 2026-09-11.
    //
    // The record is deleted FIRST and the drop is best-effort second, because deleteDatabase
    // is blocked while another tab holds the database open — and under that race the thing
    // that must be true is that the reader's folder pointer is gone, not that the container is.
    async forget() {
      await adapter.del(RECORD_KEY);
      if (typeof adapter.drop === "function") await adapter.drop();
    }
  };
}

// ---------------------------------------------------------------------------
// BROWSER ONLY below this line, and proven only by the WT2 browser walk.
// ---------------------------------------------------------------------------
// Node has no IndexedDB, and a shimmed one would prove something about the shim. Everything
// above runs in both and is covered by prove-folder-memory.mjs; the bookkeeping this adapter
// carries out — one key, replace, delete — is proven there against an in-memory adapter, so
// what remains unproven here is exactly the IndexedDB plumbing: the open, the upgrade, the
// transaction. That is what the walk checks, by ticking the box, reloading, and then looking
// at the store with the page's own database name.
//
// Two details that are not obvious and both bite. (1) The store is created with NO keyPath, so
// values are stored out-of-line under an explicit key — a FileSystemDirectoryHandle is an
// opaque host object and cannot carry an id field. (2) `store.put` on a handle that will not
// structured-clone throws DataCloneError SYNCHRONOUSLY, from inside the executor below, which
// is why the promise rejects rather than hanging — that is the incognito case, and
// classifyFolderError turns it into "unsupported".
export function indexedDBAdapter(idbFactory) {
  // A READ MUST NOT CREATE THE DATABASE. indexedDB.open() creates, always — so the first
  // version of this adapter left a `docfind-tools` database in the browser of every reader who
  // merely LOADED the page, because initMemory() calls load() to find out whether anything was
  // remembered and the honest answer "nothing" cost them a database. The page and the privacy
  // policy both say the tools store nothing unless you tick the box; this is what makes that
  // true rather than nearly true. Found in the WT2 browser walk, 2026-09-11 — no gate could
  // see it, because in Node there is no IndexedDB to leave behind.
  //
  // `onupgradeneeded` firing IS the detection: it means the database did not exist a moment
  // ago, which also means there is nothing stored to read or delete. So for a read we undo the
  // creation and answer "absent"; only a write asks for createIfMissing.
  const open = (createIfMissing) => new Promise((resolve, reject) => {
    const request = idbFactory.open(DB_NAME, 1);
    let created = false;
    request.onupgradeneeded = () => {
      created = true;
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      if (created && !createIfMissing) {
        request.result.close();
        // Best-effort on purpose: if the delete is blocked by another tab the answer to the
        // caller is still "nothing was stored", which is true. Never reject — a reader must
        // not see an error because the page asked a question and got "no".
        const undo = idbFactory.deleteDatabase(DB_NAME);
        const finish = () => resolve(null);
        undo.onsuccess = finish; undo.onerror = finish; undo.onblocked = finish;
        return;
      }
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    // A blocked open means another tab holds an older version of this database open. Rejecting
    // is the honest answer: waiting would hang the click with no way for the reader to know
    // that a different tab is the thing to close.
    request.onblocked = () => reject(request.error || new Error("the database is open in another tab"));
  });

  const run = (mode, work, createIfMissing) => open(createIfMissing).then((db) => db === null
    ? undefined                       // the database did not exist; absent is the whole answer
    : new Promise((resolve, reject) => {
    let result;
    let request;
    try {
      const tx = db.transaction(STORE_NAME, mode);
      // The transaction's own events settle the promise, not the request's — a request can
      // succeed inside a transaction that then aborts, and resolving on the request would
      // report a write that never landed.
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
      request = work(tx.objectStore(STORE_NAME));
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => { /* the transaction's handlers above reject */ };
    } catch (err) {
      db.close();
      reject(err);
    }
  }));

  return {
    get: (key) => run("readonly", (store) => store.get(key), false),
    put: (key, value) => run("readwrite", (store) => store.put(value, key), true),
    // del does not create either: there is nothing to delete from a database that never
    // existed, and creating one in order to delete from it is the bug this file just fixed.
    del: (key) => run("readwrite", (store) => store.delete(key), false),
    // Best-effort by contract: a blocked delete (another tab has it open) still resolves,
    // because forget() has already removed the record and "your folder is forgotten" is true
    // either way. Rejecting here would show the reader an error about a success.
    drop: () => new Promise((resolve) => {
      const request = idbFactory.deleteDatabase(DB_NAME);
      const finish = () => resolve();
      request.onsuccess = finish; request.onerror = finish; request.onblocked = finish;
    })
  };
}
