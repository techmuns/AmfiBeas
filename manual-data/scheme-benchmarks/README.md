# Manual scheme-benchmark overrides

`overrides.json` patches the generated official-benchmark registry
(`public/nav-data/mf-scheme-benchmarks.json`) for the cases an automated parser
cannot safely resolve.

## When to add one

- An AMC announced a benchmark CHANGE in an addendum that the current factsheet
  does not yet reflect (record the old identity under `history`).
- The AMC's factsheet is an image-only PDF with no extractable text.
- Two schemes in the same house have names so close that the extractor marks the
  attachment ambiguous and leaves both unmapped.

## Rules (enforced by `npm run validate:scheme-benchmarks`)

1. `evidenceUrl` must be a first-party AMC URL (`https://<amc host>/…`). An
   override without one is rejected — a manual claim is not evidence.
2. `reason` is mandatory and must say why a human had to intervene.
3. `addedAt` (ISO timestamp) is mandatory; set `updatedAt` when you revise one.
4. Match by `schemecode` (an API scheme code) **or** `underlyingKey` (the
   registry's plan/option-independent key). `underlyingKey` is preferred: it
   covers the Direct/Regular/Growth/IDCW siblings in one entry.
5. Find an `underlyingKey` by grepping the generated registry, e.g.
   `jq -r '.schemes[] | select(.schemeCodes[] == "1305") | .underlyingKey' public/nav-data/mf-scheme-benchmarks.json`.
6. `officialBenchmarkName` must be the AMC's own spelling. If it does not
   resolve to a canonical index the scheme becomes `official-name-only` — the
   name is kept, the return is withheld. Do **not** reword it to force a match.

## Example

```json
{
  "underlyingKey": "hdfc::hdfc midcap",
  "schemeName": "HDFC Mid Cap Fund",
  "amc": "HDFC Mutual Fund",
  "officialBenchmarkName": "NIFTY Midcap 150 TRI",
  "evidenceUrl": "https://www.hdfcfund.com/…/factsheet-august-2026.pdf",
  "sourceType": "factsheet",
  "sourceDocumentDate": "2026-08-31",
  "effectiveFrom": null,
  "reason": "Factsheet is an image-only PDF; benchmark read manually from page 42.",
  "addedAt": "2026-09-17T00:00:00.000Z"
}
```
