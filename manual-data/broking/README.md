# Broking data (manual upload)

The Broking / Capital Markets tab reads monthly NSE **active clients per member
(broker)** from the CSV files in this folder. NSE publishes this data on
nseindia.com (Members → "Active clients of members"); it's behind a bot-wall, so
it can't be fetched automatically here and is refreshed by dropping the monthly
file in this folder — the same manual-upload pattern as `manual-data/market/`.

## How to refresh (one step, then it auto-deploys)

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
