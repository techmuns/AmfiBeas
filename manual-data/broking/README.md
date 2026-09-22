# Broking data

The Broking / Capital Markets tab reads monthly NSE **active clients per member
(broker)** from the CSV files in this folder. `scripts/build-broking.ts` turns
the newest month into `src/data/snapshots/broking.json`, which the tab renders.

## How to refresh (recommended: manual monthly drop — then it auto-deploys)

This is the reliable, free path — about 2 minutes a month:

1. Get the latest monthly "Active clients" numbers from NSE (or copy the top
   brokers' counts from any monthly report / news write-up — Business Standard,
   ET, etc. republish them).
2. Save them here as `active-clients-YYYY-MM.csv` with this header:

   ```
   broker,activeClients
   __market_total__,45450000
   Groww,13053752
   Zerodha,6801078
   ...
   ```

   - The optional `__market_total__` row is the whole-NSE active-client count
     (all members) so each broker's share is a **true market share** (e.g. Groww
     28.7%), not a share of just the listed brokers. Omit it and share falls back
     to the sum of the listed brokers.
   - Optionally add a `turnoverCr` column for average daily turnover per broker —
     the tab picks it up automatically.
   - For month-over-month movers, keep the previous month's file too (the tab
     compares the two newest months).
3. Run `npm run build:broking` (CI also runs it on push), commit the refreshed
   `src/data/snapshots/broking.json`, and the dashboard redeploys with it. The
   "sample data" banner disappears once the newest file is a real (non-`.sample`)
   CSV.

**Current data:** `active-clients-2026-05.csv` and `active-clients-2026-06.csv`
hold real NSE active-clients figures (June 2026), compiled from public reporting
— so the tab shows live, correct numbers (no sample banner).

## Why not fully automated? (NSE auto-fetch investigation, Sep 2026)

We built and tested a GitHub Actions auto-fetcher
(`.github/workflows/broking-active-clients.yml`). The honest result:

- **Headless browsers are blocked.** NSE's Akamai edge blocks headless Chromium
  from GitHub-runner IPs (HTTP/2 reset, then HTTP/1.1 hang) — so a Playwright
  scraper can't fetch NSE from CI.
- **curl_cffi reaches NSE.** A real-Chrome TLS/JA3-impersonating request
  (`scripts/ingest/broking_curl_probe.py`) *does* get 200s from NSE's homepage,
  `/all-reports` and `/api/*` from the same runners. The block is a fingerprint
  block, and curl_cffi beats it — a reusable capability for other NSE data.
- **…but this dataset isn't in NSE's free API.** NSE's discoverable report API
  (`/api/merged-daily-reports`) is daily-only (bhavcopies etc.); per-broker
  active clients is not in it, nor in the `/all-reports` catalog. That statistic
  lives in NSE's monthly *Market Pulse* PDF / member portal, not a free
  structured endpoint.

So the manual drop above is the practical free path. If NSE ever exposes a
structured active-clients endpoint, run the workflow in `mode: probe` to confirm
it, set the `NSE_ACTIVE_CLIENTS_URL` Actions variable, and switch `mode: full`
(and re-add a monthly `schedule`) — the fetch/parse/commit plumbing is ready.

## Status

The committed files below are an **approximate sample** (top brokers, from public
reporting, mid-2026) so the tab is fully built and testable. Replace them with
the official NSE monthly files and the "sample" banner disappears automatically
(it's shown whenever the newest file is still flagged `sample`).
