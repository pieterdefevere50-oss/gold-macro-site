// Runs on a GitHub Actions schedule (see .github/workflows/update-factors.yml).
// Fetches recent gold-related headlines, classifies them bullish/bearish/neutral
// with a keyword heuristic, merges them with the evergreen structural factors,
// and writes the result to factors.json — which the static site reads at load time.
// No API keys required.

import { writeFile } from "node:fs/promises";

const BULL_WORDS = [
  "rate cut","cuts rates","dovish","central bank buy","buys gold","gold reserves","adds gold",
  "safe haven","safe-haven","weaker dollar","dollar falls","dollar slides","yields fall","yields drop",
  "geopolitical tension","war","conflict escalat","record high","tariff","de-dollar","debt concern",
  "deficit","gold rallies","gold surges","gold jumps","gold climbs","inflation eases","weak jobs",
  "soft jobs","unemployment rises","stimulus","qe","recession fear"
];
const BEAR_WORDS = [
  "rate hike","hikes rates","hawkish","strong dollar","dollar rises","dollar surges","yields rise",
  "yields jump","gold falls","gold drops","gold slides","gold slumps","risk-on","risk on","strong jobs",
  "strong payrolls","inflation rises","inflation accelerat","selloff in gold","central bank sell",
  "sells gold","reduces gold","profit-taking","profit taking","rally in stocks","strong gdp"
];

function classify(headline) {
  const h = headline.toLowerCase();
  let bull = 0, bear = 0;
  for (const w of BULL_WORDS) if (h.includes(w)) bull++;
  for (const w of BEAR_WORDS) if (h.includes(w)) bear++;
  if (bull === 0 && bear === 0) return null;
  if (bull > bear) return "bull";
  if (bear > bull) return "bear";
  return "neutral";
}

// Very small, dependency-free RSS <item> parser — good enough for Google News RSS.
function parseRssItems(xml) {
  const items = [];
  const itemBlocks = xml.split("<item>").slice(1);
  for (const block of itemBlocks) {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    if (!titleMatch || !linkMatch) continue;
    const decode = (s) =>
      s.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "")
       .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
       .trim();
    items.push({
      title: decode(titleMatch[1]),
      link: decode(linkMatch[1]),
      pubDate: pubDateMatch ? decode(pubDateMatch[1]) : null,
    });
  }
  return items;
}

// Evergreen, structural drivers that don't go stale the way a specific dated
// headline does — no fixed figures like "bought X tonnes in May" live here.
// Anything event-specific and dated comes entirely from the live feed below.
const evergreenFactors = [
  {
    title: "Fed Rate Path / Policy Stance",
    sentiment: "neutral",
    impact: 5,
    text: "The single largest swing factor for gold. Rate-cut expectations lower the opportunity cost of holding non-yielding gold (bullish); hawkish repricing raises it (bearish). Check the live items below for the latest concrete signal."
  },
  {
    title: "US Dollar Index (DXY) Trend",
    sentiment: "neutral",
    impact: 5,
    text: "Gold is priced in USD, so dollar strength and gold tend to move inversely. A falling DXY is structurally bullish for XAU/USD; a rising DXY is structurally bearish."
  },
  {
    title: "Central Bank Gold Buying (Structural Trend)",
    sentiment: "bull",
    impact: 4,
    text: "Central banks globally have been net buyers of gold for several consecutive years, diversifying reserves away from the dollar. This is a slow-moving structural tailwind rather than a single event — specific recent purchases appear as live items below."
  },
  {
    title: "US Real Yields (10-Year Treasury)",
    sentiment: "neutral",
    impact: 3,
    text: "Falling real yields lower the opportunity cost of holding gold versus bonds (bullish); rising real yields do the opposite (bearish)."
  },
  {
    title: "US Fiscal Deficit / Debt Trajectory",
    sentiment: "bull",
    impact: 3,
    text: "Elevated US debt and deficit levels support structural demand for gold as a reserve-diversification and currency-debasement hedge."
  },
  {
    title: "Geopolitical Risk Premium",
    sentiment: "neutral",
    impact: 3,
    text: "Ongoing geopolitical stress supports a baseline safe-haven bid under gold. Acute escalations or de-escalations show up as live items below."
  },
];

async function main() {
  let liveItems = [];
  try {
    const rssUrl = "https://news.google.com/rss/search?q=gold+price+OR+XAUUSD+when:2d&hl=en-US&gl=US&ceid=US:en";
    const res = await fetch(rssUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    const xml = await res.text();
    const items = parseRssItems(xml).slice(0, 20);

    liveItems = items
      .map((item) => {
        const sentiment = classify(item.title);
        if (!sentiment) return null;
        return {
          title: item.title.replace(/\s*-\s*[^-]+$/, ""), // trim trailing " - Source Name"
          sentiment,
          impact: 2,
          text: "Live headline, auto-classified by keyword match. Verify against the source before treating as a firm signal.",
          link: item.link,
          pubDate: item.pubDate,
          isLive: true,
        };
      })
      .filter(Boolean)
      .slice(0, 10);
  } catch (err) {
    console.error("News fetch failed:", err.message);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    evergreen: evergreenFactors,
    live: liveItems,
  };

  await writeFile(new URL("../factors.json", import.meta.url), JSON.stringify(output, null, 2));
  console.log(`Wrote factors.json with ${liveItems.length} live item(s) at ${output.generatedAt}`);
}

main();
