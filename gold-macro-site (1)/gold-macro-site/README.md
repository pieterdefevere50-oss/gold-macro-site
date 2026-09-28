# XAU/USD Macro Driver Overview — self-updating

A static GitHub Pages site that rebuilds its own data every 4 hours via GitHub Actions. No server, no API keys, no cost.

## What it shows
- **Data-driven factors** computed from FRED: real yields (10Y TIPS), the Fed broad dollar index, and the market-implied Fed path (2Y yield vs fed funds).
- **Live news**, classified bullish/bearish/neutral by direction-aware rules, with duplicate stories merged.
- **Net bias score (−100…+100)** over macro *drivers* only — price-action headlines are shown but excluded (price is the outcome, not the cause).
- **Market strip** with as-of dates and 4-week changes; live gold price in the browser.
- **History charts** of gold price and bias score, growing with every update, so you can judge whether the bias leads price.
- Stale-data banner if the job stops running; failed sources fall back to the last reading, flagged **STALE**.

## Files
| File | Purpose |
|---|---|
| `index.html` | The page. Reads `factors.json` and `history.json`. |
| `factors.json` | Generated data (do not edit by hand). |
| `history.json` | Append-only log of gold price + bias score per run. |
| `scripts/update_factors.mjs` | Fetches data, builds factors, computes bias. |
| `scripts/classifier.mjs` | Headline classification rules + de-duplication. |
| `scripts/test_classifier.mjs` | Tests. Run: `node scripts/test_classifier.mjs` |
| `.github/workflows/update-factors.yml` | Schedule (runs tests first, then updates). |

## Setup
Already deployed? Just commit these files, then in the **Actions** tab run **Update gold macro factors → Run workflow** once. The first run replaces the old `factors.json` with the new format.

New repo: upload everything (keep `.github/workflows/` exactly as is), set **Settings → Pages** to the main branch root, then run the workflow once.

## Maintenance
- **Manual factors** (central-bank buying, fiscal, geopolitics) are hand-written in `manualFactors` in `scripts/update_factors.mjs`. Re-check them occasionally (World Gold Council publishes quarterly central-bank data) and bump `MANUAL_REVIEWED` — the page shows the review date.
- **Thresholds / weights** are documented in the page's Methodology section and live in `update_factors.mjs`.
- **New keyword rules**: add to `RULES` in `classifier.mjs` and add a test case; the workflow refuses to publish if tests fail.
- **Frequency**: edit the `cron` line (`"0 * * * *"` = hourly).

## Known limits
No free keyless feed exists for ETF flows or futures positioning (COT), so they are not included. The dollar series is the Fed broad index, not ICE DXY. Headline classification is rule-based and can still mis-tag — every live item links to its source.
