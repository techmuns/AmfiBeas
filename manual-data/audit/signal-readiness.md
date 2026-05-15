# Signal-readiness table

Lists every candidate dashboard signal in the brief, the source
fields each one needs, the rolling-window depth required, and a
readiness verdict against the current snapshot state.

Verdict legend:

- **Ready now** — every input field and required window depth is
  present today; a card / accessor can be built without new
  ingestion or new helpers beyond simple aggregation.
- **Ready after minor helper work** — inputs are present but a
  small derivation helper or merge would be needed (e.g. align
  AMFI monthly + NIFTY 500 by month-end).
- **Needs more data** — at least one input field is partially
  available; signal is feasible after additional uploads or a
  source extension.
- **Not feasible** — input field is not in any current source.

## 1. Flow-momentum signals

| Signal                                       | Inputs                                                                          | Window     | Verdict                          | Notes                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------- | ---------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Active Equity Net Inflow **z-score**         | `activeEquityNetInflow` (monthly)                                              | 24–36 m    | **Ready now**                    | 55/62 months of data. Compute trailing-N μ/σ and the latest deviation; the 7 early-2020 gaps render as null on the input.   |
| Active Equity Net Inflow **percentile**      | `activeEquityNetInflow`                                                         | full      | **Ready now**                    | Same denominator; rank latest vs full history.                                                                              |
| Equity Net Flow as **% of total net flow**   | `equityNetInflow`, `netInflow`                                                  | full      | **Ready after minor helper work**| 62/62 coverage for both, but the ratio can flip sign when `netInflow` is small or negative. A clipping / NA-guard helper is needed before surfacing this; otherwise the metric is fragile (the client explicitly asked us not to ship fragile metrics). |
| Active Equity share of total **AUM** / AAUM  | `activeEquityAum`, `totalAum` (or `…Aaum` variants)                             | latest+TTM | **Ready now**                    | Already surfaced as the "Active Equity Share of Total AAUM" trend on /monthly. Z-score / percentile overlay is incremental. |
| Active Equity share of **equity AUM**        | `activeEquityAum`, `etfIndexAum`, `arbitrageAum`                                | latest+TTM | **Ready now**                    | Surfaced today in the Equity AAUM Breakdown subtitle ("57.5% Active / 36.1% ETF & Index / 6.4% Arbitrage").                  |
| **Passive share of equity AUM**              | `etfIndexAum`, `activeEquityAum`                                                | full      | **Ready now**                    | Already plotted on /monthly's Passive Share chart. Z-score against the historical mean would be a small follow-up.           |
| **SIP AUM as % of total AUM** (history)      | `sipAum`, `totalAum`                                                            | full      | **Ready after minor helper work**| `sipAum` only present from 2022 onwards in press releases (23/62 months). Trend is computable from 2022; pre-2022 will render as null until older monthly notes are uploaded. |

## 2. NFO signals

| Signal                                       | Inputs                                       | Window | Verdict       | Notes                                                                                  |
| -------------------------------------------- | -------------------------------------------- | ------ | ------------- | -------------------------------------------------------------------------------------- |
| **NFO mobilisation percentile**              | `industryNfoFundsMobilized`                  | full   | **Ready now** | 60/62 months of history; percentile against the full series is straightforward.        |
| **NFO count percentile**                     | `industryNfoCount`                           | full   | **Ready now** | 60/62 months. Combine with mobilisation percentile for a two-axis view if useful.      |

## 3. Market-aware signals (require NIFTY 500 join)

| Signal                                       | Inputs                                                                       | Window | Verdict                          | Notes                                                                                                                                                                |
| -------------------------------------------- | ---------------------------------------------------------------------------- | ------ | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Flow stress** signal (Nifty 500 returns)   | `MarketIndexMonthlyRow.return1mPct/return3mPct`, `activeEquityNetInflow`     | TTM    | **Ready after minor helper work**| Both sides exist for 2019-04 → 2026-03; one tiny join helper by `month` would let us flag months where Nifty fell ≥ X% AND flows stayed positive.                    |
| Market **drawdown vs active equity flows**   | `MarketIndexMonthlyRow.drawdownPct`, `activeEquityNetInflow`                 | full   | **Ready after minor helper work**| Same join helper. The drawdown series is fully populated against the rolling all-time high.                                                                          |
| **Flow recovery after weak market periods**  | `MarketIndexMonthlyRow.return3mPct/return6mPct`, trailing `activeEquityNetInflow` avg | full | **Ready after minor helper work**| Define a "weak market" window (e.g. trailing 6M < −10%) and compare the next 3M / 6M flow average vs the cross-history mean.                                          |

## 4. Recommended first signal cards

Tightly scoped to inputs that are fully populated and methodologies
that don't risk amplification by tiny denominators:

1. **Active Equity Net Inflow z-score** — clearest, single-series,
   24-month rolling baseline; complements the existing TTM-avg
   reference line on the chart.
2. **NFO mobilisation percentile** — single-series, 5 years of
   history, easy interpretation.
3. **Market drawdown vs active equity flows** — pairs the NIFTY
   500 drawdown line with the active-equity net flow bar; surfaces
   the "Indian investor buys the dip" narrative without any new
   data work beyond the small join helper.

Signals to **defer** (per client guidance — fragile metrics not
welcome in this PR):

- Equity Net Flow % of total net flow (negative denominator risk).
- SIP AUM % of total AUM (history too short for cross-cycle reading).
- Any quartile / outperformance / unique-buyer signal (out of scope).

## 5. Roadmap to wider history

If the client uploads:

- **Monthly PDFs for 2022-05 → 2024-03** (23 months) → unlocks
  uninterrupted monthly z-scores across the 5-year window.
- **Monthly press-release notes for 2019-04 → 2022-03** → unlocks
  SIP-based ratios across the full 5-year window.
- **NIFTY 500 daily file for April 2026** → lines up the market
  snapshot with the latest AMFI monthly.
- **AMFI PDFs from FY15-FY19** → unlocks 10-year reasoning.
- **AMFI PDFs from FY10-FY14** → unlocks 15-year reasoning.
