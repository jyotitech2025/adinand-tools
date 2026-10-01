// no-network.cjs — every way this process could reach the network, replaced by a thrower.
//
// WHY A PRELOAD AND NOT A MONKEYPATCH IN THE PROVER. tesseract.js runs its worker in a
// `worker_threads` Worker, and a worker thread starts a FRESH module registry and a fresh
// global object — a `globalThis.fetch = …` executed in prove-ocr.mjs's own module reaches
// the main thread and nothing else, so the one place that actually loads the language model
// and the core would still have a live `fetch`. Worker threads do, however, inherit
// `process.execArgv`, so `node --require tools/no-network.cjs …` runs THIS file inside the
// worker thread too. That is the only hook that covers both.
//
// prove-ocr.mjs proves the block really reaches the worker rather than assuming it: it asks
// tesseract for an off-origin language path on purpose and asserts the rejection carries
// this file's own message back out of the worker thread. A preload that silently failed to
// load would make every "it ran with no network" claim in that prover worthless, and the
// prover would still print GREEN.

"use strict";

function blocked(name) {
  return function () {
    throw new Error("no-network: blocked " + name);
  };
}

globalThis.fetch = blocked("fetch");

const http = require("node:http");
http.request = blocked("http.request");
http.get = blocked("http.get");

const https = require("node:https");
https.request = blocked("https.request");
https.get = blocked("https.get");

const net = require("node:net");
net.connect = blocked("net.connect");
net.createConnection = blocked("net.createConnection");

const dns = require("node:dns");
dns.lookup = blocked("dns.lookup");
