// Runs on a GitHub Actions schedule (see .github/workflows/update-factors.yml).
// 1. Pulls market data (no API keys): FRED CSV endpoints + gold-api.com
// 2. Turns that data into DATA-DRIVEN macro factors (real yields, dollar, Fed stance)
// 3. Pulls & classifies news headlines (direction-aware rules, de-duplicated)
// 4. Computes the net bias, appends to history.json, writes factors.json
// If a source fails, the last known reading is kept and flagged "stale" — never blanked.

import { readFile, writeFile } from "node:fs/promises";
import { classify, dedupe } from "./classifier.mjs";

const OUT = new URL("../factors.json", import.meta.url);
const HIST = new URL("../history.json", import.meta.url);
const UA = "Mozilla/5.0 (compatible; gold-macro-site-bot)";
const MANUAL_REVIEWED = "2026-09-28"; // update this date when you re-check the manual factors below
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}
const readJSON = async (u) => { try { return JSON.parse(await readFile(u, "utf8")); } catch { return null; } };

// ---------- FRED ----------
async function fred(id, days = 150) {
  const start = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start}`);
  const rows = csv.trim().split(/\r?\n/).slice(1)
    .map((l) => l.split(","))
    .map(([d, v]) => ({ d, v: parseFloat(v) }))
    .filter((r) => r.d && Number.isFinite(r.v));
  if (!rows.length) throw new Error("no numeric rows");
  return rows;
}
function summarize(rows, lookbackDays = 28) {
  const last = rows[rows.length - 1];
  const cutoff = new Date(last.d).getTime() - lookbackDays * 864e5;
  const prior = [...rows].reverse().find((r) => new Date(r.d).getTime() <= cutoff) ?? rows[0];
  return { value: last.v, asOf: last.d, prior: prior.v, priorDate: prior.d, change: last.v - prior.v,
           changePct: prior.v ? ((last.v - prior.v) / prior.v) * 100 : 0 };
}

// ---------- Data-driven factors ----------
function realYieldFactor(s) {
  if (!s) return null;
  const bp = Math.round(s.change * 100);
  let sentiment = "neutral", read = "little changed, so no clear push either way";
  if (s.change >= 0.10) { sentiment = "bear"; read = "rising real yields raise the opportunity cost of holding non-yielding gold — bearish"; }
  else if (s.change <= -0.10) { sentiment = "bull"; read = "falling real yields lower the opportunity cost of holding gold — bullish"; }
  return { key: "real_yields", title: "US Real Yields (10Y TIPS)", sentiment, impact: 5, dataDriven: true, asOf: s.asOf,
    text: `10Y real yield is ${s.value.toFixed(2)}%, ${bp >= 0 ? "up" : "down"} ${Math.abs(bp)}bp over 4 weeks (as of ${s.asOf}): ${read}. Real yields are the most direct macro driver of gold.` };
}
function dollarFactor(s) {
  if (!s) return null;
  const p = s.changePct;
  let sentiment = "neutral", read = "roughly flat, so no clear push either way";
  if (p >= 1) { sentiment = "bear"; read = "a firmer dollar makes gold pricier for foreign buyers — bearish"; }
  else if (p <= -1) { sentiment = "bull"; read = "a softer dollar makes gold cheaper for foreign buyers — bullish"; }
  return { key: "dollar", title: "US Dollar Trend (Fed Broad Index)", sentiment, impact: 4, dataDriven: true, asOf: s.asOf,
    text: `The Fed's broad trade-weighted dollar index is ${s.value.toFixed(1)}, ${p >= 0 ? "up" : "down"} ${Math.abs(p).toFixed(1)}% over 4 weeks (as of ${s.asOf}): ${read}.` };
}
function fedFactor(dff, y2, lo, hi) {
  if (!dff || !y2) return null;
  const spread = y2.value - dff.value;
  let sentiment = "neutral", read = "roughly in line with the policy rate, so markets price little net change";
  if (spread >= 0.25) { sentiment = "bear"; read = "above the policy rate, meaning markets are pricing higher-for-longer or further hikes — bearish"; }
  else if (spread <= -0.25) { sentiment = "bull"; read = "below the policy rate, meaning markets are pricing rate cuts — bullish"; }
  const range = lo && hi ? ` Target range: ${lo.value.toFixed(2)}%–${hi.value.toFixed(2)}%.` : "";
  return { key: "fed_path", title: "Fed Policy Path (market-implied)", sentiment, impact: 5, dataDriven: true, asOf: y2.asOf,
    text: `The 2-year Treasury yield (${y2.value.toFixed(2)}%) is ${Math.abs(spread * 100).toFixed(0)}bp ${spread >= 0 ? "above" : "below"} the effective fed funds rate (${dff.value.toFixed(2)}%): ${read}.${range}` };
}

// Manual structural factors — no free keyless data source exists for these, so they are
// hand-written and clearly labelled with a review date on the page.
const manualFactors = [
  { key: "cb_buying", title: "Central Bank Gold Buying (Structural Trend)", sentiment: "bull", impact: 4,
    text: "Central banks globally have been net buyers of gold for several consecutive years, diversifying reserves away from the dollar. A slow-moving structural tailwind; check World Gold Council quarterly data for the latest." },
  { key: "fiscal", title: "US Fiscal Deficit / Debt Trajectory", sentiment: "bull", impact: 3,
    text: "Elevated US debt and deficit levels support structural demand for gold as a reserve-diversification and currency-debasement hedge." },
  { key: "geopolitics", title: "Geopolitical Risk Premium", sentiment: "neutral", impact: 3,
    text: "Ongoing geopolitical stress supports a baseline safe-haven bid under gold. Acute escalations or de-escalations show up as live items below." },
].map((f) => ({ ...f, manual: true, reviewed: MANUAL_REVIEWED }));

// ---------- News ----------
function parseRssItems(xml) {
  const decode = (s) => s.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "")
    .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
  return xml.split("<item>").slice(1).map((block) => {
    const t = block.match(/<title>([\s\S]*?)<\/title>/), l = block.match(/<link>([\s\S]*?)<\/link>/);
    const p = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/), s = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    if (!t || !l) return null;
    let title = decode(t[1]); const source = s ? decode(s[1]) : null;
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3)); // strip outlet suffix
    return { title, link: decode(l[1]), pubDate: p ? decode(p[1]) : null, source };
  }).filter(Boolean);
}

async function fetchLive() {
  const url = "https://news.google.com/rss/search?q=gold+price+OR+XAUUSD+OR+%22gold+futures%22+when:2d&hl=en-US&gl=US&ceid=US:en";
  const items = parseRssItems(await fetchText(url)).slice(0, 40);
  const classified = items.map((it) => {
    const c = classify(it.title);
    if (!c) return null;
    return { title: it.title, sentiment: c.sentiment, kind: c.kind, impact: c.kind === "price" ? 1 : 2,
             text: c.why, link: it.link, pubDate: it.pubDate, source: it.source, isLive: true };
  }).filter(Boolean);
  const merged = dedupe(classified).map((it) => ({ ...it, impact: it.kind === "driver" && it.coverage >= 3 ? 3 : it.impact }));
  const drivers = merged.filter((i) => i.kind === "driver").slice(0, 8);
  const prices = merged.filter((i) => i.kind === "price").slice(0, 2);
  return [...drivers, ...prices];
}

// ---------- Bias ----------
function computeBias(items) {
  let bull = 0, bear = 0, n = 0;
  for (const f of items) {
    if (f.kind === "price") continue; // price is the outcome, not a driver
    if (f.sentiment === "bull") { bull += f.impact; n++; } else if (f.sentiment === "bear") { bear += f.impact; n++; }
  }
  const total = bull + bear;
  const score = total ? Math.round(((bull - bear) / total) * 100) : 0;
  const label = score >= 20 ? "Bullish" : score <= -20 ? "Bearish" : "Mixed / Neutral";
  return { score, label, bullWeight: bull, bearWeight: bear, driversCounted: n };
}

async function main() {
  const prev = (await readJSON(OUT)) ?? {};
  const history = (await readJSON(HIST)) ?? [];
  const errors = [];
  const prevByKey = Object.fromEntries((prev.evergreen ?? []).map((f) => [f.key, f]));

  // FRED series
  const ids = { y10: "DGS10", real10: "DFII10", y2: "DGS2", dollar: "DTWEXBGS", dff: "DFF", lo: "DFEDTARL", hi: "DFEDTARU" };
  const S = {};
  await Promise.all(Object.entries(ids).map(async ([k, id]) => {
    try { S[k] = summarize(await fred(id)); } catch (e) { errors.push(`FRED ${id}: ${e.message}`); }
  }));

  // Gold spot
  let gold = prev.market?.gold ?? null, goldOk = false;
  try {
    const price = Number(JSON.parse(await fetchText("https://api.gold-api.com/price/XAU")).price);
    if (Number.isFinite(price) && price > 0) { gold = { price, asOf: new Date().toISOString() }; goldOk = true; }
  } catch (e) { errors.push(`gold price: ${e.message}`); }

  // Factors (fall back to last reading, flagged stale, if a source failed)
  const fromData = [fedFactor(S.dff, S.y2, S.lo, S.hi), realYieldFactor(S.real10), dollarFactor(S.dollar)];
  const wantedKeys = ["fed_path", "real_yields", "dollar"];
  const evergreen = [
    ...fromData.map((f, i) => f ?? (prevByKey[wantedKeys[i]] ? { ...prevByKey[wantedKeys[i]], stale: true } : null)).filter(Boolean),
    ...manualFactors,
  ];

  // Live news
  let live = [], liveOk = false;
  try { live = await fetchLive(); liveOk = true; }
  catch (e) { errors.push(`news: ${e.message}`); live = (prev.live ?? []).map((f) => ({ ...f, stale: true })); }

  // Nothing worked at all -> fail loudly (red X in Actions + email) instead of committing junk
  if (!Object.keys(S).length && !goldOk && !liveOk) { console.error("All sources failed:", errors); process.exit(1); }

  const bias = computeBias([...evergreen, ...live]);
  const generatedAt = new Date().toISOString();
  const market = {
    gold,
    realYield10: S.real10 ?? prev.market?.realYield10 ?? null,
    y10: S.y10 ?? prev.market?.y10 ?? null,
    y2: S.y2 ?? prev.market?.y2 ?? null,
    dollar: S.dollar ?? prev.market?.dollar ?? null,
    fedTarget: S.lo && S.hi ? { low: S.lo.value, high: S.hi.value, asOf: S.hi.asOf } : prev.market?.fedTarget ?? null,
  };

  await writeFile(OUT, JSON.stringify({ schema: 2, generatedAt, bias, market, evergreen, live, errors }, null, 2));

  history.push({ t: generatedAt, gold: gold?.price ?? null, score: bias.score });
  await writeFile(HIST, JSON.stringify(history.slice(-2000)));

  console.log(`factors.json written ${generatedAt} · bias ${bias.label} (${bias.score}) · ${live.length} live · ${errors.length} error(s)`);
  errors.forEach((e) => console.log("  warn:", e));
}
main();
