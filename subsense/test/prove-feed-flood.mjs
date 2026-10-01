#!/usr/bin/env node
// Proves the calculator that SHIPS: slices the block between MODEL:START and
// MODEL:END out of feed-flood-calculator.html (the standalone copy of the live
// page, one folder up) and asserts against that, so a change to the page is a
// change to what is proven here.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../feed-flood-calculator.html", import.meta.url), "utf8");
const a = src.indexOf("/* MODEL:START */"), b = src.indexOf("/* MODEL:END */");
if (a === -1 || b === -1) { console.error("FAIL: model markers not found"); process.exit(2); }
const M = new Function(src.slice(a, b) +
  "\nreturn { computeFlood, rankFor, MIXES, FLOODER_UPLOADS_PER_WEEK, DORMANT_DAYS, YT_MAX, YT_RECOMMENDED, AVG_MINUTES };")();

let pass = 0, fail = 0;
const t = (name, ok, detail) => { ok ? pass++ : (fail++, console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`)); };

// The two numbers that must match the app's own code, not this page's opinion.
t("flooder threshold is the app's 21/week", M.FLOODER_UPLOADS_PER_WEEK === 21);
t("dormant threshold is the app's 60 days", M.DORMANT_DAYS === 60);
t("YouTube's published max is 2,000", M.YT_MAX === 2000);
t("YouTube's recommended cap is 5,000", M.YT_RECOMMENDED === 5000);

// Every band is a count of channels, so they must account for every channel.
for (const key of Object.keys(M.MIXES)) {
  for (const n of [1, 7, 50, 199, 320, 500, 901, 2001, 5001]) {
    const r = M.computeFlood(n, key);
    t(`bands account for all ${n} channels (${key})`,
      r.dormant + r.heavy + r.mid === n,
      `${r.dormant}+${r.heavy}+${r.mid} != ${n}`);
    t(`no negative band (${key}, ${n})`, r.dormant >= 0 && r.heavy >= 0 && r.mid >= 0);
    t(`heavyShare is a fraction (${key}, ${n})`, r.heavyShare >= 0 && r.heavyShare <= 1,
      String(r.heavyShare));
  }
}

// Degenerate input must produce zeros, never NaN — the number is shown to a user.
for (const bad of [0, -5, null, undefined, NaN]) {
  const r = M.computeFlood(bad, "typical");
  t(`zeroes not NaN for input ${String(bad)}`,
    r.perWeek === 0 && r.perYear === 0 && r.heavyShare === 0 && !Number.isNaN(r.perWeek));
}

// More channels can never mean less arriving.
let prev = -1, monotonic = true;
for (let n = 0; n <= 2000; n += 17) {
  const w = M.computeFlood(n, "typical").perWeek;
  if (w < prev) monotonic = false;
  prev = w;
}
t("volume never decreases as channels increase", monotonic);

// The headline claim on the page: a few channels make most of the flood.
const typical = M.computeFlood(320, "typical");
t("typical mix: heavy channels are a small minority", typical.heavyPctOfChannels <= 0.06,
  String(typical.heavyPctOfChannels));
t("typical mix: that minority still produces most of the volume", typical.heavyShare > 0.5,
  `${(typical.heavyShare * 100).toFixed(1)}%`);

// Arithmetic spot-check, computed by hand from the stated bands:
// 320 channels typical -> dormant round(128)=128, heavy round(16)=16, mid=176
// weekly = 16*21 + 176*1.5 = 336 + 264 = 600
t("hand-computed 320/typical = 600 per week", typical.perWeek === 600, String(typical.perWeek));
t("hand-computed bands 128/16/176",
  typical.dormant === 128 && typical.heavy === 16 && typical.mid === 176,
  `${typical.dormant}/${typical.heavy}/${typical.mid}`);
t("yearly is weekly x 52", typical.perYear === 600 * 52, String(typical.perYear));

// YouTube limit flags
t("2,001 channels is over YouTube's max", M.computeFlood(2001, "typical").overYouTubeMax);
t("1,999 channels is not", !M.computeFlood(1999, "typical").overYouTubeMax);
t("5,001 is over the recommended cap", M.computeFlood(5001, "typical").overYouTubeRecommended);

// --- The ON-SCREEN labels must match MIXES ---------------------------------
// Added 2026-09-02 after adversarial review: the page promises "the arithmetic
// is nothing more than these bands multiplied out", and nothing checked that the
// bands printed on screen ARE the bands in the code. They had already drifted —
// the busy band's high-volume rate is 25/wk, not the 21 the other two use and
// not the 21 the page defines as the threshold two sections later, and no label
// said so. A promise of auditability that nothing audits is just a promise.
// <small[^>]*>: the built page carries Astro's data-astro-cid-* attribute on every element.
const labels = [...src.matchAll(/value="(quiet|typical|busy)"[\s\S]{0,400}?<small[^>]*>([^<]+)<\/small>/g)];
t("all three bands carry an on-screen label", labels.length === 3, String(labels.length));
for (const [, key, label] of labels) {
  const mix = M.MIXES[key];
  const dormantPct = Math.round(mix.dormant * 100);
  const heavyPct = Math.round(mix.heavy * 100);
  const midPct = 100 - dormantPct - heavyPct;
  t(`${key}: label states the dormant share`, label.includes(`${dormantPct}% dormant`), label);
  t(`${key}: label states the middle share`, label.includes(`${midPct}%`), label);
  t(`${key}: label states the high-volume share`, label.includes(`${heavyPct}% high-volume`), label);
  t(`${key}: label states the high-volume RATE`, label.includes(`${mix.heavyRate}/week`), label);
}

// Ranks must cover every possible volume, including 0.
let covered = true;
for (const w of [0, 1, 49, 50, 149, 150, 399, 400, 999, 1000, 99999]) {
  const r = M.rankFor(w);
  if (!r || !r.name || !r.line) covered = false;
}
t("every volume has a rank", covered);

console.log(`\n${pass} passed, ${fail} failed`);
console.log(fail ? "FAIL" : "PASS");
process.exit(fail ? 1 : 0);
