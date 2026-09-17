# Broking data

The Broking / Capital Markets tab reads monthly NSE **active clients per member
(broker)** from the CSV files in this folder. `scripts/build-broking.ts` turns
the newest month into `src/data/snapshots/broking.json`, which the tab renders.

## Automated refresh (free, GitHub Actions)

`.github/workflows/broking-active-clients.yml` refreshes this monthly for free.
NSE serves the data only through nseindia.com, which is Akamai bot-walled, so the
job drives a real (headless) browser to hold a session — the same technique the
schemewise-holdings job uses. NSE's exact endpoint isn't documented, so it's
**probe-first** (a one-time setup, then automatic forever):

1. **Actions → "Broking active clients (monthly)" → Run workflow → mode: `probe`.**
   It captures NSE's own API calls and uploads a `broking-probe` artifact listing
   each endpoint and how many broker rows it parsed.
2. Copy the endpoint the artifact flags as `LIKELY ENDPOINT` into the repo
   **Actions variable `NSE_ACTIVE_CLIENTS_URL`** (Settings → Secrets and variables
   → Actions → Variables). *(Configure this once — then it's automated forever.)*
3. Done. The monthly schedule now fetches, writes
   `active-clients-YYYY-MM.csv` (an official, non-sample file — the "sample data"
   banner disappears), rebuilds the snapshot and commits. Any failed/blocked fetch
   is skipped, never overwriting good data.

## Manual refresh (fallback — one step, then it auto-deploys)

1. Download the latest monthly "Active clients" list from NSE (or copy the top
   brokers' counts from the monthly report).
2. Save it here as `active-clients-YYYY-MM.csv` with this header:

   ```
   broker,activeClients
   Groww,13000000
   Zerodha,7950000
   ...
   ```

   (Optionally add a `turnoverCr` column for average daily turnover per broker
   when you have it — the tab will pick it up automatically.)
3. Run `npm run build:broking` (CI also runs it on push), commit the refreshed
   `src/data/snapshots/broking.json`, and the dashboard redeploys with it.

## Status

The committed files below are an **approximate sample** (top brokers, from public
reporting, mid-2026) so the tab is fully built and testable. Replace them with
the official NSE monthly files and the "sample" banner disappears automatically
(it's shown whenever the newest file is still flagged `sample`).
