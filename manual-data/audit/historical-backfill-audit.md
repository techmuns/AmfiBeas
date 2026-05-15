# Historical backfill audit

Generated as part of the historical-coverage data audit. Reads
the three snapshot families produced by the ingestion scripts and
summarises what is now available for signal work.

## 1. Files detected

| Folder                                  | Files | Notes                                                                 |
| --------------------------------------- | ----: | --------------------------------------------------------------------- |
| `manual-data/amfi-monthly/pdfs/`        |    85 | Monthly Reports and press-release Monthly Notes across 62 unique months |
| `manual-data/amfi-quarterly/pdfs/`      |    28 | `aqu-vol19-issueI.pdf` → `aqu-vol25-issueIV.pdf` (7 fiscal years)      |
| `manual-data/market/`                   |     7 | `NIFTY 500-…-to-….csv` annual exports (2019-04 → 2026-03)              |

The `manual-data/market/indices` empty file is a placeholder and
is ignored by the ingester.

## 2. Successful parses

| Step                       | Files in | Rows out | Snapshot                                  |
| -------------------------- | -------: | -------: | ----------------------------------------- |
| `ingest:amfi-pdf`          |    85/85 |       62 industry months + 2,303 category rows | `amfi-monthly-pdf.json` + `amfi-monthly-category.json` |
| `ingest:amfi-quarterly-pdf`|    28/28 |       28 industry quarters + 1,047 category rows | `amfi-quarterly-industry.json` + `amfi-quarterly-category.json` |
| `ingest:market-indices`    |     7/7  |       84 month-end rows (NIFTY 500)         | `market-indices-monthly.json`             |

## 3. Failed parses

None. Every uploaded PDF and CSV was consumed by the existing parsers
or the new market-indices parser.

## 4. Date coverage by dataset

| Dataset             | First    | Last     | Rows | Notes                                                                                                |
| ------------------- | -------- | -------- | ---: | ---------------------------------------------------------------------------------------------------- |
| AMFI monthly        | 2019-04  | 2026-04  |   62 | 23 months missing between **2022-05 and 2024-03** — no monthly PDFs uploaded for that span           |
| AMFI monthly category | 2019-04 | 2026-04  | 2,303 | Same month-set as industry rows                                                                     |
| AMFI quarterly      | FY20-Q1  | FY26-Q4  |   28 | Complete — 7 fiscal years (FY20-FY26) with no gaps                                                  |
| AMFI quarterly cat. | FY20-Q1  | FY26-Q4  | 1,047 | 39 categories × 28 quarters minus a few pre-2021 categories that didn't exist                       |
| NIFTY 500 month-end | 2019-04  | 2026-03  |   84 | Lags AMFI monthly by one month (no April 2026 daily file uploaded)                                  |

## 5. Field coverage by metric (monthly)

`X/62` indicates the number of months out of the 62 covered for which
a numeric value was extracted. The 23 unconvered months between
2022-05 and 2024-03 are *not* counted in the denominator — they have
no row at all.

| Field                       | Rows w/ value |
| --------------------------- | ------------: |
| `totalAum`                  | 62 / 62       |
| `totalAaum`                 | 62 / 62       |
| `equityAum`                 | 62 / 62       |
| `equityAaum`                | 62 / 62       |
| `activeEquityAum`           | 55 / 62       |
| `activeEquityAaum`          | 55 / 62       |
| `etfIndexAum`               | 56 / 62       |
| `etfIndexAaum`              | 56 / 62       |
| `arbitrageAum`              | 55 / 62       |
| `arbitrageAaum`             | 55 / 62       |
| `debtAum`                   | 62 / 62       |
| `debtAaum`                  | 62 / 62       |
| `liquidAum`                 | 54 / 62       |
| `liquidAaum`                |  0 / 62       |
| `netInflow`                 | 62 / 62       |
| `equityNetInflow`           | 62 / 62       |
| `activeEquityNetInflow`     | 55 / 62       |
| `debtNetInflow`             | 62 / 62       |
| `liquidNetInflow`           | 54 / 62       |
| `sipContribution`           | 23 / 62       |
| `sipAum`                    | 23 / 62       |
| `sipAccounts`               | 21 / 62       |
| `industryFolios`            | 62 / 62       |
| `industryNfoCount`          | 60 / 62       |
| `industryNfoFundsMobilized` | 60 / 62       |
| `hybridAum/Aaum/NetInflow`  | 62 / 62       |
| `otherSchemesAum/Aaum/NetInflow` | 62 / 62  |

## 6. Field coverage by metric (quarterly)

All quarterly industry rows carry the full grand-total set, equity /
debt buckets, and folios across the entire FY20-Q1 → FY26-Q4 range.

| Field                       | Rows w/ value |
| --------------------------- | ------------: |
| `grandTotalAum`             | 28 / 28       |
| `grandTotalLastMonthAaum`   | 28 / 28       |
| `grandTotalNetInflow`       | 28 / 28       |
| `grandTotalFundsMobilized`  | 28 / 28       |
| `grandTotalRepurchase`      | 28 / 28       |
| `grandTotalFolios`          | 28 / 28       |
| `equityAum`                 | 28 / 28       |
| `debtAum`                   | 28 / 28       |
| `equityLastMonthAaum`       | 28 / 28       |

## 7. Field coverage by metric (NIFTY 500)

| Field                       | Rows w/ value | Notes                                                            |
| --------------------------- | ------------: | ---------------------------------------------------------------- |
| `level`                     | 84 / 84       | Month-end close on the last trading day of each calendar month   |
| `return1mPct`               | 83 / 84       | Null only on the very first month (no prior to compare)          |
| `return3mPct`               | 81 / 84       | Null for the first 3 months                                      |
| `return6mPct`               | 78 / 84       | Null for the first 6 months                                      |
| `return12mPct`              | 72 / 84       | Null for the first 12 months                                     |
| `drawdownPct`               | 84 / 84       | Computed against the rolling running peak; 0 on the first row    |

## 8. Missing fields

- **`liquidAaum`** — 0 / 62 months. The monthly parser captures
  `liquidAum` (closing balance, from the Liquid Fund row's Net AUM
  column) but not the Average Net AUM column on the same row. Not
  required for any current dashboard chart, but recording it as a
  known gap if a Liquid AAUM share signal is wanted later.
- **NIFTY 500 April 2026** — daily file for April 2026 not uploaded;
  market snapshot lags AMFI monthly by one month.

## 9. Parse warnings

- During the quarterly re-ingest a previously-emitted format
  inconsistency was detected: the text-based fallback for older AMFI
  quarterly PDFs (vol19-21) produced `FY2020-Q1`-style quarter ids
  while the explicit filename map for vol22-25 used `FY23-Q1`-style
  (2-digit). The data layer's quarter sort still happened to render
  correctly by accident (lexicographic ordering), but `?quarter=…`
  filters and any downstream code keyed on `quarter` would have
  silently skipped the older rows.
  - **Fix in this PR**: `quarterIdFromStart` now uses the 2-digit
    `fyShort` for both the canonical id and the display label.
  - **Result**: 28 quarters now share the same `FY20-Q1` … `FY26-Q4`
    format.
- The 23 missing months (2022-05 → 2024-03) generate no warnings
  during ingestion — the script simply has no PDFs to read for those
  months. Quarterly disclosures cover the same window cleanly.
- Seven months in early 2020 (`2020-02, 2020-03, 2020-07-09, 2020-11,
  2020-12`) have no `activeEquityAum`. These predate AMFI's split of
  Solution-oriented schemes into a separate Sub Total row in the
  Monthly Report; the parser correctly omits the field rather than
  fabricating it.

## 10. Snapshot coverage statement

- ✅ Monthly snapshot now covers **April 2019 onwards** for the
  fields where source disclosure exists, with a known gap of 23
  months from May 2022 to March 2024 that future monthly PDFs would
  fill.
- ✅ Quarterly snapshot covers **FY20-Q1 onwards** — full coverage
  spanning the Apr 2019 → Mar 2026 window.
- ✅ NIFTY 500 snapshot covers **April 2019 → March 2026** (84
  month-ends), lagging the latest AMFI monthly by one month.

## 11. Signal-horizon readiness

| Horizon            | Industry coverage | Industry months                             | Verdict |
| ------------------ | ----------------- | ------------------------------------------- | ------- |
| 5-year signals     | ✅ Sufficient     | 62 monthly + 28 quarterly across FY20-FY26  | Yes — most cross-cycle baselines are computable |
| 10-year signals    | ❌ Insufficient   | History starts 2019-04 — 7 fiscal years     | Not yet — need pre-FY20 uploads to evaluate two cycles |
| 15-year signals    | ❌ Insufficient   | Same                                       | Not yet — would need uploads back to ~FY11 |

The 23-month gap (2022-05 → 2024-03) does *not* break 5-year
cross-cycle reasoning at quarterly granularity, but it does mean
monthly-only signals (e.g. monthly z-score, monthly TTM averaging)
will skip those months as null on the input series.
