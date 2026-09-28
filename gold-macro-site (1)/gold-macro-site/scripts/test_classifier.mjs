import assert from "node:assert/strict";
import { classify, dedupe } from "./classifier.mjs";

const cases = [
  // The five headlines that were live on the site (two were mis-tagged bullish before):
  ["Gold Falls to Seven-Week Low as Rate-Hike Bets Rise", "bear", "driver"],
  ["Gold Sinks To 7-Week Low As Treasury Yields, Fed Hike Bets Rise — Hansen Warns Bullion’s ‘Resilience’ Faces Its ‘Toughest Test Yet’", "bear", "driver"],
  ["Gold hits seven-week low as oil surge fuels rate hike bets", "bear", "driver"],
  ["Gold and Silver Sink as Real US Bond Yields Hit Near-Record Highs", "bear", "driver"],
  ["Gold Price Today: Gold Falls 3.08% on September 28, 2026", "bear", "price"],
  // Direction handling
  ["Gold rallies as Fed rate-cut bets grow", "bull", "driver"],
  ["Rate cut bets fade, gold slips", "bear", "driver"],
  ["Rate-hike bets ease and gold rebounds", "bull", "driver"],
  ["Dollar slides, gold climbs", "bull", "driver"],
  ["Dollar surges to three-month high, pressuring gold", "bear", "driver"],
  ["Treasury yields fall after soft data", "bull", "driver"],
  ["Central banks bought record amounts of gold in Q2", "bull", "driver"],
  ["Ceasefire deal weighs on gold", "bear", "driver"],
  ["War escalates in the region; gold jumps", "bull", "driver"],
  ["Strong jobs data hits gold", "bear", "driver"],
  ["Gold hits record high", "bull", "price"],
  // Substring traps that must NOT fire
  ["Analyst warns gold rally is over", "bear", "price"],
  ["Analyst warns gold may fall", "bear", "price"],
  ["Gold price forecast for next week", null, null],
  ["Coward investors avoid bullion", null, null],
];

let failed = 0;
for (const [title, sent, kind] of cases) {
  const r = classify(title);
  try {
    if (sent === null) assert.equal(r?.kind === "driver" ? r : null, null, "should not be a driver");
    else { assert.ok(r, "no match"); assert.equal(r.sentiment, sent); assert.equal(r.kind, kind); }
    console.log("ok  ", title.slice(0, 70));
  } catch (e) { failed++; console.log("FAIL", title.slice(0, 70), "->", JSON.stringify(r), e.message); }
}

const d = dedupe([
  { title: "Gold Falls to Seven-Week Low as Rate-Hike Bets Rise", sentiment: "bear", kind: "driver" },
  { title: "Gold hits seven-week low as oil surge fuels rate hike bets", sentiment: "bear", kind: "driver" },
  { title: "Dollar slides, gold climbs", sentiment: "bull", kind: "driver" },
]);
try { assert.equal(d.length, 2); assert.equal(d[0].coverage, 2); console.log("ok   dedupe merges the same story"); }
catch (e) { failed++; console.log("FAIL dedupe", JSON.stringify(d)); }

console.log(failed ? `\n${failed} test(s) failed` : "\nall tests passed");
process.exit(failed ? 1 : 0);
