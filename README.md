# XAU/USD Macro Driver Overview — self-updating

This site updates its own content automatically, even if nobody ever has it open.

## How it works
- `index.html` — the page. Reads `factors.json` on load.
- `factors.json` — the data. Regenerated automatically.
- `.github/workflows/update-factors.yml` — a GitHub Actions job that runs every
  4 hours (and can be triggered manually), fetches fresh gold-related headlines,
  auto-classifies them bullish/bearish, and commits an updated `factors.json`
  back to the repo. No API key, no server, no cost.
- `scripts/update_factors.mjs` — the script that job runs.

## Setup (one time)
1. Create a new GitHub repo and upload everything in this folder to it
   (keep the folder structure — `.github/workflows/` must stay exactly there).
2. Go to the repo's **Settings → Pages**, set source to your main branch, root folder.
   You'll get a URL like `https://yourusername.github.io/reponame`.
3. Go to the repo's **Actions** tab, find "Update gold macro factors", click
   **Run workflow** once to generate the first real `factors.json` immediately
   (otherwise it waits for the first scheduled run, up to 4 hours).
4. Done. From here it updates itself every 4 hours, forever, with zero maintenance.

## Changing the update frequency
Edit the `cron` line in `.github/workflows/update-factors.yml`.
`"0 */4 * * *"` = every 4 hours. `"0 * * * *"` = every hour. `"0 */12 * * *"` = twice a day.

## Editing the structural ("evergreen") commentary
Edit the `evergreenFactors` array in `scripts/update_factors.mjs`, commit, push —
the next scheduled (or manual) run picks it up automatically.
