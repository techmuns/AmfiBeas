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

| Field             | ₹ unit | Monthly Report source                       | Press release source                       |
| ----------------- | ------ | ------------------------------------------- | ------------------------------------------ |
| `totalAum`        | ₹ Cr   | Grand Total · Net AUM as on month-end       | "Industry / Total / Net AUM"               |
| `totalAaum`       | ₹ Cr   | Grand Total · Average Net AUM for the month | "Average Assets Under Management" / "AAUM" |
| `equityAum`       | ₹ Cr   | Sub Total - II (Growth/Equity Oriented)     | "Equity-Oriented", "Equity Schemes"        |
| `activeEquityAum` | ₹ Cr   | n/a in the per-scheme table                 | "Active Equity"                            |
| `debtAum`         | ₹ Cr   | Sub Total - I (Income/Debt Oriented)        | "Debt-Oriented", "Debt Schemes"            |
| `liquidAum`       | ₹ Cr   | Liquid Fund row · Net AUM                   | "Liquid", "Liquid / Money Market"          |
| `sipContribution` | ₹ Cr   | not in this format                          | "SIP Contribution"                         |
| `sipAum`          | ₹ Cr   | not in this format                          | "SIP AUM"                                  |
| `sipAccounts`     | count  | not in this format                          | "No. of SIP Accounts" (handles "in lakh")  |
| `netInflow`       | ₹ Cr   | Grand Total · Net Inflow / Outflow column   | "Net Inflow / Outflow", "Total Net Inflow" |

If a future AMFI PDF uses a label not yet covered, edit:

- `parseMonthlyReport` (block / inline label maps) for the tabular form.
- `PRESS_RELEASE_PATTERNS` for the press release form.

Both live in `scripts/ingest/amfi-monthly-pdf.ts`.

## What this does not do (yet)

- Does not change the `/monthly` UI.
- Does not replace the existing `industry-monthly.json` snapshot.
- Does not push values to AMC-level rows (`amc-monthly.json`).

The `/monthly` page will be wired to `amfi-monthly-pdf.json` in a
follow-up once we have at least one Monthly Report and one press
release ingested cleanly.
