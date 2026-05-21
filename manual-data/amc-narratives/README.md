# AMC Narrative Layer

Structured records extracted from listed AMC quarterly earnings concalls.
Powers the **Concall Digest**, **Strategic Moves Timeline**, **Unique Investor
Share trend**, **Strategic Posture Radar**, and **cohort views** on
`/amc/[slug]`, `/compare`, and `/amc`.

## Layout

```
manual-data/amc-narratives/
├── pdfs/                ← raw concall PDFs uploaded by the analyst
│   └── <slug>-<period>.pdf
└── extracted/           ← structured JSONs transcribed from each PDF
    └── <slug>-<period>.json
```

## Naming

`<slug>-FY<YY>-Q<n>.<ext>` — e.g. `hdfc-FY26-Q4.pdf`. PDF and JSON share the
same stem so the ingest pairs them.

## Slugs

Must match the AMC slug registry in `src/data/amcs.ts`. Currently in scope:
`hdfc`, `icici-pru`, `nippon`, `absl`, `uti`, `canara-robeco`.

## JSON schema

One file per AMC per quarter. Every numeric field is nullable — most AMCs
don't disclose every metric every quarter, and the UI degrades gracefully.

```jsonc
{
  "amcSlug": "hdfc",
  "fiscalPeriod": "FY26-Q4",
  "callDate": "2026-04-22",
  "sourcePdf": "hdfc-FY26-Q4.pdf",
  "themes": [
    {
      "category": "growth" | "margins" | "regulatory" | "strategy" | "risk" | "cost",
      "headline": "Short, scannable sentence (≤ 14 words).",
      "detail": "Optional 1-2 sentence elaboration.",
      "metricRef": "uniqueInvestorShare"
    }
  ],
  "metrics": [
    { "field": "uniqueInvestorShare", "value": 27, "unit": "pct" },
    { "field": "digitalTransactionPct", "value": 97, "unit": "pct" },
    { "field": "p30InflowShare", "value": null, "unit": "pct" },
    { "field": "headcount", "value": 1700, "unit": "count" },
    { "field": "dividendPerShare", "value": 54, "unit": "inr" },
    { "field": "payoutRatio", "value": 81, "unit": "pct" },
    { "field": "berImpactBps", "value": 3.5, "unit": "bps" }
  ],
  "channelMix": {
    "directPct": null, "bankPct": null, "nationalDistPct": null,
    "mfdPct": null, "fintechPct": null,
    "note": "open architecture; fintech exponential growth"
  },
  "events": [
    { "type": "mandate_win", "label": "EPFO fixed-income mandate" },
    { "type": "fund_launch", "label": "Private credit AIF — first close with IFC" },
    { "type": "board_change", "label": "Rajan Anandan as tech committee invitee" },
    { "type": "international", "label": "5 live funds in GiftCity" },
    { "type": "regulatory", "label": "TER → BER framework live April 1 2026", "impactBps": 3.5 }
  ],
  "quotes": [
    { "text": "Digital AI value creator", "speaker": "CEO" }
  ],
  "initiatives": ["private credit", "GiftCity", "SIF", "AI tooling"]
}
```

## How the data flows

1. PDF lands in `pdfs/`.
2. Analyst writes the corresponding `extracted/<slug>-<period>.json`.
3. `npm run ingest:amc-narratives` reads every JSON in `extracted/`,
   validates, dedupes, and writes `src/data/snapshots/amc-narratives.json`.
4. `src/data/amc-narratives.ts` exposes typed accessors that pages consume.
