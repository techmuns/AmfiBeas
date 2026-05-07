# AMFI monthly — manual PDF upload

Drop raw AMFI monthly press-release / "Note for Press" PDFs into:

```
manual-data/amfi-monthly/pdfs/
```

That's it. No CSV conversion, no rename rules required — though a filename
that includes the month (e.g. `amfi-2025-04.pdf` or `amfi-april-2025.pdf`)
makes month detection more reliable when the PDF itself does not state
the period clearly on its first page.

## Running the extractor

```
npm run ingest:amfi-pdf
```

This reads every PDF under `pdfs/` and writes a clean JSON snapshot to:

```
src/data/snapshots/amfi-monthly-pdf.json
```

The script:

- Extracts each PDF's text page-by-page and runs labelled-number
  pattern matching.
- Records source provenance per row: `sourcePdf` (filename),
  `sourcePages` (1-indexed page numbers each value was found on),
  `month` (YYYY-MM), `extractedAt` (ISO timestamp).
- **Never writes fake values.** Fields that cannot be confidently
  parsed are simply omitted from the row — they are not zeroed.
- **Preserves prior data.** The snapshot is merged by `month`. New
  values overwrite previous ones for the same month; months not in
  the current run are kept as-is. A field that had a value previously
  but is not detected this run is left untouched, not blanked.

## Fields extracted (when available)

| Field            | ₹ unit | Source label patterns                                   |
| ---------------- | ------ | ------------------------------------------------------- |
| `totalAum`       | ₹ Cr   | "Average Assets Under Management", "AAUM", "Total AUM"  |
| `equityAum`      | ₹ Cr   | "Equity-Oriented", "Equity Schemes"                     |
| `activeEquityAum`| ₹ Cr   | "Active Equity"                                         |
| `debtAum`        | ₹ Cr   | "Debt-Oriented", "Debt Schemes"                         |
| `liquidAum`      | ₹ Cr   | "Liquid", "Liquid / Money Market"                       |
| `sipContribution`| ₹ Cr   | "SIP Contribution"                                      |
| `sipAum`         | ₹ Cr   | "SIP AUM"                                               |
| `sipAccounts`    | count  | "SIP Accounts" / "No. of SIP Accounts"                  |
| `netInflow`      | ₹ Cr   | "Net Inflow / Outflow", "Total Net Inflow"              |

The label list is intentionally generous; AMFI changes wording across
months. If your PDF uses a label not yet covered, add a new entry to
`LABEL_PATTERNS` in `scripts/ingest/amfi-monthly-pdf.ts`.

## What this does not do (yet)

- Does not change the `/monthly` UI.
- Does not replace the existing `industry-monthly.json` snapshot.
- Does not push values to AMC-level rows (`amc-monthly.json`).

The `/monthly` page will be wired to `amfi-monthly-pdf.json` in a
follow-up once the extractor has been validated against a real PDF.
