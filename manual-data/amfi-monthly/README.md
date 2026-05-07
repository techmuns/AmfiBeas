# AMFI monthly — manual PDF upload

Drop raw AMFI monthly PDFs into:

```
manual-data/amfi-monthly/pdfs/
```

The extractor auto-detects two AMFI publication formats:

1. **Monthly Report** — the per-scheme tabular report (`Sub Total - I/II/…`,
   `Grand Total`). Carries AUM totals, category sub-totals, net inflow.
   Does **not** carry SIP figures.
2. **Note for Press** / "Note for the Press" — the monthly press
   release. Carries AAUM, SIP Contribution, SIP AUM, SIP Accounts.

You don't have to label the file or rename it — the script picks the
right parser per file. A filename like `amfi-2026-04.pdf` or
`amfi-april-2026.pdf` is still useful as a backup if the PDF itself
doesn't state the period clearly.

## Running the extractor

```
npm run ingest:amfi-pdf
```

This reads every `*.pdf` under `pdfs/` and writes a clean JSON snapshot to:

```
src/data/snapshots/amfi-monthly-pdf.json
```

The script:

- Detects the format per file (`monthly-report` / `press-release` /
  `unknown`) and dispatches to the right parser.
- Records source provenance per row: `sourceFormat`, `sourcePdf`
  (filename), `sourcePages` (1-indexed page numbers each value was
  found on), `month` (YYYY-MM), `extractedAt` (ISO timestamp).
- **Never writes fake values.** Fields the format does not carry, or
  that cannot be confidently parsed, are simply omitted from the row
  — they are not zeroed.
- **Preserves prior data.** The snapshot is merged by `month`. New
  values overwrite previous ones for the same month; months not in
  the current run are kept as-is. A field that had a value previously
  but is not detected this run is left untouched, not blanked. So
  a press release run can fill in SIP fields a Monthly Report run
  left blank for the same month, and vice versa.

## Fields extracted (when available)

| Field             | Stored unit | Monthly Report source                     | Press release source                                                                               |
| ----------------- | ----------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `totalAum`        | ₹ Cr        | Grand Total · Net AUM as on month-end     | "Total" row · 1st column of the *Monthly AUM trend* table (page ~4)                                |
| `totalAaum`       | ₹ Cr        | Grand Total · Average Net AUM for the month | "Average Assets Under Management" / "AAUM" (older flat-key wording)                              |
| `equityAum`       | ₹ Cr        | Sub Total - II (Growth/Equity Oriented)   | "Equity" row · 1st column of the *Monthly AUM trend* table                                         |
| `activeEquityAum` | ₹ Cr        | n/a in the per-scheme table               | "Active Equity"                                                                                    |
| `debtAum`         | ₹ Cr        | Sub Total - I (Income/Debt Oriented)      | "Debt" row · 1st column of the *Monthly AUM trend* table                                           |
| `liquidAum`       | ₹ Cr        | Liquid Fund row · Net AUM                 | "Liquid funds" row · 1st column of the *Monthly AUM trend of income/debt-oriented schemes* table   |
| `sipContribution` | ₹ Cr        | not in this format                        | "SIP monthly contribution (crore)" row · 1st column                                                |
| `sipAum`          | ₹ Cr        | not in this format                        | "SIP assets (Rs lakh crore)" row · 1st column · ×100,000                                           |
| `sipAccounts`     | count       | not in this format                        | "Number of contributing SIP accounts (crore)" · ×10,000,000 (or "(in lakh)" · ×100,000)            |
| `netInflow`       | ₹ Cr        | Grand Total · Net Inflow / Outflow column | not parsed from press release (Monthly Report value preserved by merge)                            |

### Number-format conversions

The press-release "Monthly Note" mixes three quoting conventions; the
extractor converts each to a canonical stored unit:

| In the PDF                    | What it means                | Stored as                      |
| ----------------------------- | ---------------------------- | ------------------------------ |
| `(crore)` after a label       | already in ₹ Cr              | as-is                          |
| `(Rs lakh crore)` after label | × 100,000 to get ₹ Cr        | ₹ Cr                           |
| `(crore)` for SIP accounts    | × 10,000,000 to get a count  | count                          |
| `(in lakh)` for SIP accounts  | × 100,000 to get a count     | count                          |

If a future AMFI PDF uses a label not yet covered, edit:

- `parseMonthlyReport` (block / inline label maps) for the tabular form.
- `PRESS_RELEASE_PATTERNS` for the press release / Monthly Note form.

Both live in `scripts/ingest/amfi-monthly-pdf.ts`.

## What this does not do (yet)

- Does not change the `/monthly` UI.
- Does not replace the existing `industry-monthly.json` snapshot.
- Does not push values to AMC-level rows (`amc-monthly.json`).

The `/monthly` page will be wired to `amfi-monthly-pdf.json` in a
follow-up once we have at least one Monthly Report and one press
release ingested cleanly.
