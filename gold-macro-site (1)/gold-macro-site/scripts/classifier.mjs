// Headline classifier for gold. Rule-based, but context-aware:
//  - word boundaries (so "Warns" never matches "war")
//  - direction-aware verbs ("yields rise" vs "yields fall", "cut bets fade" vs "cut bets grow")
//  - matched text is removed after each hit so generic rules can't double-count it
//  - price-action headlines ("Gold falls 3%") are the OUTCOME, not a driver, so they are
//    tagged kind:"price" and are excluded from the bias score.

const W = String.raw`(?: [\w-]+)`; // one filler word; never crosses punctuation/clauses
const UP = String.raw`(?:rise|rises|rising|rose|jump|jumps|jumped|climb|climbs|climbed|surge|surges|surged|spike|spikes|soar|soars|hit|hits|reach|reaches|touch|touches|advance|advances|gain|gains|firm|firms|strengthen|strengthens|rally|rallies|grow|grows|build|builds|mount|mounts|increase|increases)`;
const DOWN = String.raw`(?:fall|falls|fell|falling|drop|drops|dropped|slip|slips|slipped|slide|slides|slid|retreat|retreats|ease|eases|eased|decline|declines|tumble|tumbles|weaken|weakens|fade|fades|faded|recede|recedes|receded|wane|wanes|cool|cools|diminish|diminishes|shrink|shrinks|dip|dips)`;

const rule = (re, dir, weight, why, kind = "driver") => ({ re: new RegExp(re, "i"), dir, weight, why, kind });

const RULES = [
  // ---- Fed path: pricing of hikes/cuts (most specific first) ----
  rule(String.raw`\b(?:rate|fed)[- ]hikes? (?:bets|expectations|odds|fears|wagers|risk|talk)${W}{0,2}?\s+${DOWN}\b`, "bull", 3,
    "Fading rate-hike expectations lower the odds of tighter policy, easing pressure on non-yielding gold."),
  rule(String.raw`\b(?:rate|fed)[- ]hikes? (?:bets|expectations|odds|fears|wagers|risk|talk)\b`, "bear", 3,
    "Rising rate-hike expectations raise the opportunity cost of holding non-yielding gold and support the dollar — bearish."),
  rule(String.raw`\b(?:rate|fed)[- ]cuts? (?:bets|expectations|odds|hopes|wagers)${W}{0,2}?\s+${DOWN}\b`, "bear", 3,
    "Fading rate-cut expectations mean policy stays tighter for longer, a headwind for gold."),
  rule(String.raw`\b(?:rate|fed)[- ]cuts? (?:bets|expectations|odds|hopes|wagers)\b`, "bull", 3,
    "Growing rate-cut expectations lower the opportunity cost of holding non-yielding gold — bullish."),

  // ---- Real yields, nominal yields ----
  rule(String.raw`\breal (?:us |u\.s\. )?(?:bond |treasury )?yields?${W}{0,3}?\s+${UP}\b`, "bear", 4,
    "Rising real yields are the single most direct headwind for gold: they raise the opportunity cost of holding it."),
  rule(String.raw`\breal (?:us |u\.s\. )?(?:bond |treasury )?yields?${W}{0,3}?\s+${DOWN}\b`, "bull", 4,
    "Falling real yields lower the opportunity cost of holding gold — a direct tailwind."),
  rule(String.raw`\byields?${W}{0,3}?\s+${UP}\b`, "bear", 3,
    "Rising Treasury yields increase the opportunity cost of holding non-yielding gold."),
  rule(String.raw`\byields?${W}{0,3}?\s+${DOWN}\b`, "bull", 3,
    "Falling Treasury yields lower the opportunity cost of holding gold versus bonds."),

  // ---- Dollar ----
  rule(String.raw`\b(?:dollar|greenback|dxy)(?: index)?${W}{0,2}?\s+${UP}\b`, "bear", 3,
    "A stronger dollar makes gold pricier for foreign buyers and tends to weigh on XAU/USD."),
  rule(String.raw`\b(?:dollar|greenback|dxy)(?: index)?${W}{0,2}?\s+${DOWN}\b`, "bull", 3,
    "A softer dollar makes gold cheaper for foreign buyers and tends to lift XAU/USD."),
  rule(String.raw`\b(?:strong|stronger|firmer|higher) (?:us )?dollar\b`, "bear", 3,
    "A stronger dollar makes gold pricier for foreign buyers and tends to weigh on XAU/USD."),
  rule(String.raw`\b(?:weak|weaker|softer|lower) (?:us )?dollar\b`, "bull", 3,
    "A softer dollar makes gold cheaper for foreign buyers and tends to lift XAU/USD."),
  rule(String.raw`\bde-?dollari[sz]ation\b|\bde-dollar\b`, "bull", 2,
    "Diversification away from the dollar structurally supports gold."),

  // ---- Central-bank tone ----
  rule(String.raw`\bhawkish\b|\bhigher[- ]for[- ]longer\b`, "bear", 3,
    "A hawkish stance points to tighter-for-longer policy, typically a headwind for gold."),
  rule(String.raw`\bdovish\b`, "bull", 3,
    "A dovish stance points to easier policy ahead, typically supportive for gold."),
  rule(String.raw`\b(?:fed|federal reserve)\b${W}{0,2}?\s+(?:cuts?|slash\w*|lowers?)\b${W}{0,2}?\s+rates?\b`, "bull", 3,
    "A Fed rate cut lowers the opportunity cost of holding gold."),
  rule(String.raw`\b(?:fed|federal reserve)\b${W}{0,2}?\s+(?:hikes?|raises?)\b${W}{0,2}?\s+rates?\b`, "bear", 3,
    "A Fed rate hike raises the opportunity cost of holding gold."),
  rule(String.raw`\brate[- ]cuts?\b`, "bull", 2, "Rate cuts lower the opportunity cost of holding non-yielding gold."),
  rule(String.raw`\brate[- ]hikes?\b`, "bear", 2, "Rate hikes raise the opportunity cost of holding non-yielding gold."),

  // ---- Inflation & labour data (through the lens of Fed reaction) ----
  rule(String.raw`\b(?:hotter|higher|stronger)[- ]than[- ]expected (?:cpi|pce|ppi|inflation)\b`, "bear", 3,
    "Hotter-than-expected inflation raises the odds the Fed stays restrictive — a headwind for gold."),
  rule(String.raw`\b(?:cooler|softer|lower|weaker)[- ]than[- ]expected (?:cpi|pce|ppi|inflation)\b`, "bull", 3,
    "Cooler-than-expected inflation raises the odds of rate cuts — supportive for gold."),
  rule(String.raw`\binflation${W}{0,2}?\s+(?:rises?|accelerat\w+|heats?|jumps?|surges?|picks? up|re-?accelerat\w+)\b`, "bear", 2,
    "Hotter inflation raises the odds the Fed stays restrictive for longer — a headwind for gold."),
  rule(String.raw`\binflation${W}{0,2}?\s+(?:eases?|cools?|slows?|falls?|declines?|moderates?)\b`, "bull", 2,
    "Cooling inflation raises the odds of rate cuts, typically supportive for gold."),
  rule(String.raw`\b(?:strong|stronger|robust|solid|hot|upbeat|better[- ]than[- ]expected)\s+(?:us\s+)?(?:jobs|payrolls|nonfarm|employment|labou?r|job)\b`, "bear", 2,
    "Strong labour data cuts the odds of near-term rate cuts, typically pressuring gold."),
  rule(String.raw`\b(?:weak|weaker|soft|softer|disappointing|dismal|worse[- ]than[- ]expected)\s+(?:us\s+)?(?:jobs|payrolls|nonfarm|employment|labou?r|job)\b`, "bull", 2,
    "Weak labour data raises the odds of Fed rate cuts, which tends to support gold."),
  rule(String.raw`\bunemployment(?: rate)?${W}{0,1}?\s+(?:rises?|jumps?|climbs?|increases?)\b`, "bull", 2,
    "Rising unemployment raises the odds of Fed rate cuts, which tends to support gold."),
  rule(String.raw`\bunemployment(?: rate)?${W}{0,1}?\s+(?:falls?|drops?|declines?)\b`, "bear", 2,
    "Falling unemployment reduces the odds of near-term rate cuts, typically pressuring gold."),
  rule(String.raw`\bstrong (?:us )?gdp\b`, "bear", 1, "Strong growth data reduces the relative appeal of safe-haven gold."),
  rule(String.raw`\brecession (?:fears?|worr\w+|concerns?|risks?)\b`, "bull", 2,
    "Recession concerns typically drive safe-haven demand into gold and raise rate-cut odds."),

  // ---- Geopolitics / safe haven ----
  rule(String.raw`\bsafe[- ]haven (?:demand|appeal|bid|flows?|buying)${W}{0,2}?\s+(?:fades?|wanes?|falls?|drops?|weakens?|ebbs?|slumps?)\b`, "bear", 2,
    "Fading safe-haven demand removes a support under gold."),
  rule(String.raw`\b(?:ceasefire|cease-fire|de-?escalat\w*|peace (?:deal|talks|agreement)|truce)\b`, "bear", 2,
    "De-escalation reduces the safe-haven risk premium in gold."),
  rule(String.raw`\b(?:wars?|invasion|invades?|invaded|missiles?|airstrikes?|escalat\w*|military (?:strike|action|conflict)|geopolitical (?:tensions?|risks?|uncertainty|fears|concerns?))\b`, "bull", 2,
    "Rising geopolitical risk typically boosts safe-haven demand for gold."),
  rule(String.raw`\bsafe[- ]haven\b`, "bull", 2, "Points to safe-haven demand as investors seek protection from risk."),
  rule(String.raw`\btariffs?\b`, "bull", 1, "Trade-tension headlines often drive safe-haven flows into gold."),
  rule(String.raw`\b(?:debt (?:concerns?|worries|ceiling|crisis)|deficits?|credit downgrade|downgrades? (?:us|u\.s\.))\b`, "bull", 1,
    "Concerns about US fiscal health support gold as a hedge."),
  rule(String.raw`\brisk[- ]on\b`, "bear", 1, "A risk-on tone reduces demand for safe-haven assets like gold."),
  rule(String.raw`\bstocks?${W}{0,2}?\s+(?:rally|rallies|surge|surges|soar|soars)\b`, "bear", 1,
    "Strong equities reduce the relative appeal of safe-haven gold."),

  // ---- Flows / official sector ----
  rule(String.raw`\bcentral banks?${W}{0,4}?\s+(?:buy|buys|buying|bought|purchas\w+|add|adds|accumulat\w+)\b`, "bull", 3,
    "Central-bank accumulation reinforces structural demand for gold."),
  rule(String.raw`\bcentral banks?${W}{0,4}?\s+(?:sell|sells|selling|sold|dump\w*|reduc\w+|cut|cuts)\b`, "bear", 3,
    "Central-bank selling is a headwind for gold demand."),
  rule(String.raw`\betfs?${W}{0,3}?\s+(?:inflows?|buying|holdings? (?:rise|climb|increase))\b`, "bull", 2,
    "Rising ETF holdings show investment demand for gold."),
  rule(String.raw`\betfs?${W}{0,3}?\s+(?:outflows?|selling|redemptions?)\b`, "bear", 2,
    "ETF outflows show investors reducing gold exposure."),

  // ---- Price action: outcome, not driver (excluded from bias) ----
  rule(String.raw`\b(?:gold|bullion|xau|silver)\b${W}{0,5}?\s+(?:hits?|reach\w*|touch\w*|set\w*|scal\w+|near\w*|at|to|sinks? to|falls? to)\s+(?:(?:a|an|new|fresh)\s+)?(?:\w+[- ](?:week|month|year)s?|multi-\w+|record|all-time)[- ]lows?\b`, "bear", 1,
    "Gold is at a fresh low. This describes the price outcome, so it is not counted in the bias score.", "price"),
  rule(String.raw`\b(?:gold|bullion|xau)\b${W}{0,5}?\s+(?:hits?|reach\w*|touch\w*|set\w*|scal\w+|near\w*|at|to)\s+(?:(?:a|an|new|fresh)\s+)?(?:record|all-time|\w+[- ](?:week|month|year)s?)[- ]highs?\b`, "bull", 1,
    "Gold is at a fresh high. This describes the price outcome, so it is not counted in the bias score.", "price"),
  rule(String.raw`\b(?:rally|gains?|advance|bounce|rebound)(?: \w+)?(?: is| has| may| could| might)? (?:over|ends?|ended|stalls?|stalled|fades?|faded|fizzles?|runs? out|running out)\b`, "bear", 1,
    "The recent gold rally is described as fading. This describes the price outcome, so it is not counted in the bias score.", "price"),
  rule(String.raw`\b(?:gold|bullion|xau|silver)\b${W}{0,4}?\s+(?:falls?|fell|drops?|dropped|sinks?|sank|slides?|slid|slumps?|tumbles?|plunges?|plummets?|declines?|dips?|slips?|retreats?|loses?|extends? (?:losses|declines?))\b`, "bear", 1,
    "Gold's price is falling. This describes the outcome rather than a cause, so it is not counted in the bias score.", "price"),
  rule(String.raw`\b(?:gold|bullion|xau|silver)\b${W}{0,4}?\s+(?:rises?|rose|climbs?|climbed|jumps?|jumped|surges?|surged|rall(?:y|ies|ied)|gains?|gained|advances?|soars?|soared|rebounds?|rebounded)\b`, "bull", 1,
    "Gold's price is rising. This describes the outcome rather than a cause, so it is not counted in the bias score.", "price"),
];

export function classify(headline) {
  let h = " " + String(headline).toLowerCase()
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, "-") + " ";
  const hits = [];
  for (const r of RULES) {
    if (r.re.test(h)) { hits.push(r); h = h.replace(r.re, " "); }
  }
  if (!hits.length) return null;

  const drivers = hits.filter((r) => r.kind === "driver");
  const pool = drivers.length ? drivers : hits;
  const kind = drivers.length ? "driver" : "price";
  const bull = pool.filter((r) => r.dir === "bull");
  const bear = pool.filter((r) => r.dir === "bear");
  const sum = (a) => a.reduce((s, r) => s + r.weight, 0);
  const net = sum(bull) - sum(bear);

  let sentiment, why;
  const top = (a) => [...new Set(a.sort((x, y) => y.weight - x.weight).map((r) => r.why))].slice(0, 2).join(" ");
  if (bull.length && bear.length && Math.abs(net) <= 1) {
    sentiment = "neutral";
    why = "Headline mixes bullish and bearish signals that roughly offset: " + bull[0].why + " But: " + bear[0].why;
  } else if (net > 0) { sentiment = "bull"; why = top(bull); }
  else if (net < 0) { sentiment = "bear"; why = top(bear); }
  else { sentiment = "neutral"; why = pool[0].why; }

  return { sentiment, kind, why, strength: Math.abs(net) };
}

const STOP = new Set(["the","and","for","with","from","after","amid","over","its","are","was","this","that","gold","price","prices","today","says","say"]);
const tokens = (t) => new Set(String(t).toLowerCase().split(/[^a-z0-9.%]+/).filter((w) => w.length > 2 && !STOP.has(w)));
function jaccard(a, b) {
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter; return uni ? inter / uni : 0;
}

// Collapse the same story reported by several outlets into one item with a coverage count.
export function dedupe(items, threshold = 0.4) {
  const groups = [];
  for (const it of items) {
    const tk = tokens(it.title);
    const g = groups.find((x) => x.item.sentiment === it.sentiment && x.item.kind === it.kind && jaccard(x.tk, tk) >= threshold);
    if (g) g.item.coverage = (g.item.coverage || 1) + 1; else groups.push({ item: { ...it, coverage: 1 }, tk });
  }
  return groups.map((g) => g.item);
}
