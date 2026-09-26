// Runs on a GitHub Actions schedule (see .github/workflows/update-factors.yml).
// Fetches recent gold-related headlines, classifies them bullish/bearish/neutral
// with a keyword heuristic, merges them with the evergreen structural factors,
// and writes the result to factors.json — which the static site reads at load time.
// No API keys required.

import { writeFile } from "node:fs/promises";

// Each phrase maps to a short, specific explanation of why it points that
// direction for gold — this becomes the card's body text, not a disclaimer.
const BULL_PHRASES = {
  "rate cut": "Signals lower interest rates ahead, which reduces the opportunity cost of holding non-yielding gold — typically bullish.",
  "cuts rates": "Signals lower interest rates ahead, which reduces the opportunity cost of holding non-yielding gold — typically bullish.",
  "dovish": "A dovish tone from policymakers points to easier monetary policy ahead, typically supportive for gold.",
  "central bank buy": "Reflects central bank accumulation of gold reserves, reinforcing structural demand.",
  "buys gold": "Reflects central bank or institutional buying of gold, reinforcing demand.",
  "gold reserves": "Relates to gold reserve levels — accumulation trends tend to support the structural demand story.",
  "adds gold": "Reflects an institution adding to its gold holdings, reinforcing demand.",
  "safe haven": "Points to safe-haven demand as investors seek protection from risk.",
  "safe-haven": "Points to safe-haven demand as investors seek protection from risk.",
  "weaker dollar": "A softer dollar makes gold cheaper for foreign buyers and tends to lift XAU/USD.",
  "dollar falls": "A softer dollar makes gold cheaper for foreign buyers and tends to lift XAU/USD.",
  "dollar slides": "A softer dollar makes gold cheaper for foreign buyers and tends to lift XAU/USD.",
  "yields fall": "Falling yields lower the opportunity cost of holding gold versus interest-bearing bonds.",
  "yields drop": "Falling yields lower the opportunity cost of holding gold versus interest-bearing bonds.",
  "geopolitical tension": "Rising geopolitical risk typically boosts demand for gold as a hedge.",
  "war": "Conflict-related headlines typically boost safe-haven demand for gold.",
  "conflict escalat": "Escalating conflict typically boosts safe-haven demand for gold.",
  "record high": "Describes gold pushing to fresh highs — price momentum in its own right.",
  "tariff": "Trade-tension headlines often drive safe-haven flows into gold.",
  "de-dollar": "Reflects diversification away from the dollar, which structurally supports gold.",
  "debt concern": "Reflects concerns about US fiscal health, supporting gold as a hedge.",
  "deficit": "Reflects concerns about the US fiscal deficit, supporting gold as a hedge.",
  "gold rallies": "Describes upward price momentum in gold itself.",
  "gold surges": "Describes a sharp upward move in gold's price.",
  "gold jumps": "Describes a sharp upward move in gold's price.",
  "gold climbs": "Describes upward price momentum in gold itself.",
  "inflation eases": "Cooling inflation raises the odds of rate cuts, typically bullish for gold.",
  "weak jobs": "Weak labor data raises the odds of Fed rate cuts, which tends to support gold.",
  "soft jobs": "Soft labor data raises the odds of Fed rate cuts, which tends to support gold.",
  "unemployment rises": "Rising unemployment raises the odds of Fed rate cuts, which tends to support gold.",
  "stimulus": "Monetary or fiscal stimulus tends to weaken the dollar and support gold.",
  "qe": "Quantitative easing tends to weaken the dollar and support gold.",
  "recession fear": "Recession concerns typically drive safe-haven demand into gold.",
};
const BEAR_PHRASES = {
  "rate hike": "Signals higher-for-longer interest rates, raising the opportunity cost of holding gold — typically bearish.",
  "hikes rates": "Signals higher-for-longer interest rates, raising the opportunity cost of holding gold — typically bearish.",
  "hawkish": "A hawkish tone from policymakers points to tighter-for-longer policy, typically a headwind for gold.",
  "strong dollar": "Dollar strength makes gold more expensive for foreign buyers and tends to weigh on XAU/USD.",
  "dollar rises": "Dollar strength makes gold more expensive for foreign buyers and tends to weigh on XAU/USD.",
  "dollar surges": "A sharply stronger dollar tends to weigh heavily on XAU/USD.",
  "yields rise": "Rising yields increase the opportunity cost of holding non-yielding gold.",
  "yields jump": "A sharp rise in yields increases the opportunity cost of holding non-yielding gold.",
  "gold falls": "Describes downward price momentum in gold itself.",
  "gold drops": "Describes downward price momentum in gold itself.",
  "gold slides": "Describes downward price momentum in gold itself.",
  "gold slumps": "Describes a sharp downward move in gold's price.",
  "risk-on": "A 'risk-on' tone in markets tends to reduce demand for safe-haven assets like gold.",
  "risk on": "A 'risk-on' tone in markets tends to reduce demand for safe-haven assets like gold.",
  "strong jobs": "Strong labor data reduces the odds of near-term rate cuts, typically pressuring gold.",
  "strong payrolls": "Strong payrolls data reduces the odds of near-term rate cuts, typically pressuring gold.",
  "inflation rises": "Hotter inflation raises the odds the Fed stays restrictive for longer — a headwind for gold.",
  "inflation accelerat": "Accelerating inflation raises the odds the Fed stays restrictive for longer — a headwind for gold.",
  "selloff in gold": "Describes active selling pressure in the gold market.",
  "central bank sell": "Reflects central bank reserve reductions, a headwind for gold demand.",
  "sells gold": "Reflects selling of gold holdings, a headwind for demand.",
  "reduces gold": "Reflects a reduction in gold holdings, a headwind for demand.",
  "profit-taking": "Describes investors locking in gains after a run-up — typically a near-term headwind.",
  "profit taking": "Describes investors locking in gains after a run-up — typically a near-term headwind.",
  "rally in stocks": "Strong equities reduce the relative appeal of safe-haven gold.",
  "strong gdp": "Strong growth data reduces the relative appeal of safe-haven gold.",
};

function classify(headline) {
  const h = headline.toLowerCase();
  let bullHit = null, bearHit = null;
  for (const phrase in BULL_PHRASES) if (h.includes(phrase)) { bullHit = phrase; break; }
  for (const phrase in BEAR_PHRASES) if (h.includes(phrase)) { bearHit = phrase; break; }
  if (!bullHit && !bearHit) return null;
  if (bullHit && !bearHit) return { sentiment: "bull", explanation: BULL_PHRASES[bullHit] };
  if (bearHit && !bullHit) return { sentiment: "bear", explanation: BEAR_PHRASES[bearHit] };
  return { sentiment: "neutral", explanation: `Headline contains mixed signals — both "${bullHit}" (typically bullish) and "${bearHit}" (typically bearish) language appear.` };
}

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
        const result = classify(item.title);
        if (!result) return null;
        return {
          title: item.title.replace(/\s*-\s*[^-]+$/, ""),
          sentiment: result.sentiment,
          impact: 2,
          text: result.explanation,
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
