import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { ChartWithContext } from "@/components/ui/ChartWithContext";
import {
  adaptiveAverageOverlay,
  chartInsights,
  latestYoyPct,
} from "@/lib/chart-context";
import { PageHeader } from "@/components/layout/PageHeader";
import { BarSeries } from "@/components/charts/BarSeries";
import { IiflHeatmap, formatHeatmapMonth } from "@/components/charts/IiflHeatmap";
import { latestMonth } from "@/data/aggregate";
import {
  activeEquityNetInflowSignal,
  amfiMonthlyRows,
  availableMonthsDesc,
  formatKpiProvenanceLine,
  formatKpiProvenanceTooltip,
  getKpiProvenance,
  getKpiValue,
  kpiContext,
  latestAmfiMonthlyRow,
  monthlyFlowsData,
  monthlyIndustryFolioAdditionsTrend,
  monthlySipGrossShareTrend,
  monthlyTrend,
  resolveSelectedRow,
  type AmfiMonthlyKpiField,
} from "@/data/amfi-monthly";
import type { AmfiMonthlyPdfRow } from "@/data/snapshots/types";
import {
  cyclePhaseHistory,
  latestNifty500Row,
  marketIndexRows,
} from "@/data/market-indices";
import { BarsWithIndexLine } from "@/components/charts/BarsWithIndexLine";
import { BarsWithLabels } from "@/components/charts/BarsWithLabels";
import { CalendarHeatGrid } from "@/components/ui/CalendarHeatGrid";
import { EpisodeRecoveryCard } from "@/components/ui/EpisodeRecoveryCard";
import { episodeRecoveryRows } from "@/data/episode-recovery";
import { KeyTakeaway, DeltaCr } from "@/components/ui/KeyTakeaway";
import { StickyContextFooter } from "@/components/ui/StickyContextFooter";
import {
  categoryRotation,
  iiflActiveEquityHeatmapData,
} from "@/data/amfi-monthly-category";
import { VerticalBars } from "@/components/charts/VerticalBars";
import {
  MonthlyFlowsTable,
  MONTHLY_FLOWS_XLSX_COLUMNS,
  type MonthlyFlowsTableRow,
} from "@/components/data/MonthlyFlowsTable";
import {
  MaaumTable,
  MAAUM_XLSX_COLUMNS,
  type MaaumColumn,
} from "@/components/data/MaaumTable";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import { HowToRead } from "@/components/ui/HowToRead";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import type { ReactNode } from "react";
import { ClientPeriodCard } from "@/components/layout/ClientPeriodCard";
import {
  formatCompactCrSafe,
  formatCroreCountSafe,
  formatMonthLabel,
  formatMonthLong,
} from "@/lib/format";
import { ClientTabs, type ClientTabDef } from "@/components/layout/ClientTabs";

const MONTHLY_TABS = [
  { id: "snapshot", label: "Snapshot" },
  { id: "flows", label: "Flows & AUM" },
  // "Fee Mix" tab hidden from the UI per client request (the fee-tier
  // net-inflow split now lives implicitly in the Flow Table's Active Eq
  // column). Re-add { id: "fee-mix", label: "Fee Mix" } to restore it.
  { id: "categories", label: "Category Shifts" },
  { id: "market-cycle", label: "Market Phases" },
] as const satisfies readonly ClientTabDef[];

/** Month-end AUM mix shares (% of the month's own breakdown total) for a
 *  single row, keyed by category. Mirrors the Month-end AUM Mix card's
 *  segment logic exactly — including the residual "Other" bucket — so a
 *  month-over-month delta computed from two of these maps lines up with
 *  the shares the card renders. Returns an empty map when the row lacks
 *  a usable breakdown. */
function monthEndMixShares(
  row: AmfiMonthlyPdfRow | null
): Map<string, number> {
  const shares = new Map<string, number>();
  if (!row) return shares;
  const eq = getKpiValue(row, "equityAum");
  const db = getKpiValue(row, "debtAum");
  const lq = getKpiValue(row, "liquidAum");
  const total = getKpiValue(row, "totalAum");
  const segs: { key: string; value: number }[] = [];
  if (typeof eq === "number") segs.push({ key: "equity", value: eq });
  if (typeof db === "number") segs.push({ key: "debt", value: db });
  if (typeof lq === "number") segs.push({ key: "liquid", value: lq });
  if (
    typeof total === "number" &&
    typeof eq === "number" &&
    typeof db === "number" &&
    typeof lq === "number"
  ) {
    const residual = total - (eq + db + lq);
    if (residual > 0) segs.push({ key: "other", value: residual });
  }
  const sum = segs.reduce((s, x) => s + x.value, 0);
  if (sum > 0) {
    for (const s of segs) shares.set(s.key, (s.value / sum) * 100);
  }
  return shares;
}


// Statically rendered: every tab's panel — including all offered months of the
// AMFI Snapshot KPI card — is built at deploy time and switched in the browser
// (ClientTabs + ClientPeriodSwitcher), so neither a tab nor a period switch ever
// spends Worker CPU. That is what keeps this snapshot-heavy route under the
// Cloudflare Free-plan CPU budget (Error 1102).
export const dynamic = "force-static";

export default async function MonthlyPage() {
  // SIP-contribution trend window. The 1Y/3Y/5Y/All toggle was removed from the
  // UI, so this is fixed at the "All" range (84 months).
  const sipContribMonths = 84;

  // AMFI Monthly Snapshot — first live AMFI widget, read directly from the
  // manually-uploaded-PDF snapshot. The page defaults to the latest available
  // month; the in-card period switcher (client-side) lets readers step back
  // through recent months without a Worker round-trip. Cards only render for
  // KPIs the selected row carries — never substitutes zero or demo data.
  const amfiAvailableMonths = availableMonthsDesc();
  const latestMonthId = amfiAvailableMonths[0];
  const amfiSelected = resolveSelectedRow(undefined);
  // Header reads the latest available data month as "April 2026".
  const subtitle = formatMonthLong(latestMonthId ?? latestMonth());

  /** All cards we'd surface if the row had every field. The render below
   *  hides any whose value is null on the latest row, so a press-release-
   *  only month would skip totalAaum/netInflow, and a Monthly-Report-only
   *  month would skip the SIP cards.
   *
   *  totalAum is intentionally NOT in this list — totalAaum (period
   *  average) is the dashboard-canonical headline and is comparable to
   *  the bps-of-MF-QAAUM yields elsewhere. The closing-balance totalAum
   *  is still extracted and stored in the snapshot for any future
   *  consumer; just not rendered here. */
  const AMFI_CARDS: {
    field: AmfiMonthlyKpiField;
    label: string;
    format: (v: number) => string;
    sparklineColor?: string;
    /** Optional ratio caption derived from the selected row (e.g. "20.6% of total AUM"). */
    ratio?: (row: NonNullable<typeof amfiSelected>) => string | undefined;
  }[] = [
    {
      field: "totalAaum",
      label: "Total AAUM",
      format: formatCompactCrSafe,
      sparklineColor: "hsl(var(--chart-1))",
    },
    {
      field: "equityAum",
      label: "Equity AUM",
      format: formatCompactCrSafe,
      sparklineColor: "hsl(var(--chart-1))",
      ratio: (r) => {
        if (typeof r.equityAum !== "number" || typeof r.totalAum !== "number")
          return undefined;
        if (r.totalAum <= 0) return undefined;
        return `${((r.equityAum / r.totalAum) * 100).toFixed(1)}% of total AUM`;
      },
    },
    {
      field: "debtAum",
      label: "Debt AUM",
      format: formatCompactCrSafe,
      sparklineColor: "hsl(var(--chart-2))",
      ratio: (r) => {
        if (typeof r.debtAum !== "number" || typeof r.totalAum !== "number")
          return undefined;
        if (r.totalAum <= 0) return undefined;
        return `${((r.debtAum / r.totalAum) * 100).toFixed(1)}% of total AUM`;
      },
    },
    {
      field: "liquidAum",
      label: "Liquid AUM",
      format: formatCompactCrSafe,
      sparklineColor: "hsl(var(--chart-4))",
      ratio: (r) => {
        if (typeof r.liquidAum !== "number" || typeof r.totalAum !== "number")
          return undefined;
        if (r.totalAum <= 0) return undefined;
        return `${((r.liquidAum / r.totalAum) * 100).toFixed(1)}% of total AUM`;
      },
    },
    {
      field: "netInflow",
      label: "Net Inflow",
      // formatCompactCrSafe handles only positive values via its compact
      // suffixes; for negative net-flow values we render the magnitude
      // with the same suffix and a leading minus so signs are obvious.
      format: (v: number) => {
        if (v >= 0) return formatCompactCrSafe(v);
        return "−" + formatCompactCrSafe(-v);
      },
      sparklineColor: "hsl(var(--chart-3))",
      ratio: (r) => {
        if (typeof r.netInflow !== "number" || typeof r.totalAum !== "number")
          return undefined;
        if (r.totalAum <= 0) return undefined;
        return `${((r.netInflow / r.totalAum) * 100).toFixed(2)}% of opening AUM`;
      },
    },
    {
      field: "sipContribution",
      label: "SIP Contribution",
      format: formatCompactCrSafe,
      sparklineColor: "hsl(var(--chart-1))",
      ratio: (r) => {
        if (
          typeof r.sipContribution !== "number" ||
          typeof r.netInflow !== "number" ||
          r.netInflow <= 0
        )
          return undefined;
        return `${((r.sipContribution / r.netInflow) * 100).toFixed(0)}% of net inflow`;
      },
    },
    {
      field: "sipAum",
      label: "SIP AUM",
      format: formatCompactCrSafe,
      sparklineColor: "hsl(var(--chart-2))",
      ratio: (r) => {
        if (typeof r.sipAum !== "number" || typeof r.totalAum !== "number")
          return undefined;
        if (r.totalAum <= 0) return undefined;
        return `${((r.sipAum / r.totalAum) * 100).toFixed(1)}% of total AUM`;
      },
    },
    {
      field: "sipAccounts",
      label: "SIP Accounts",
      // SIP accounts are stored as a raw count (e.g. 97,200,000); the
      // safe formatter divides by 1e7 and emits "9.72 Cr".
      format: (v: number) => formatCroreCountSafe(v),
      sparklineColor: "hsl(var(--chart-3))",
      ratio: (r) => {
        if (typeof r.sipAccounts !== "number" || typeof r.totalAum !== "number")
          return undefined;
        if (r.totalAum <= 0) return undefined;
        // Accounts per ₹ Cr of AUM — investor density.
        return `${(r.sipAccounts / r.totalAum).toFixed(1)} per ₹ Cr AUM`;
      },
    },
  ];

  // KPI cards for a given selected row. Anchors YoY / percentile / sparkline
  // window to that month so each period shows its own pills.
  const buildCardsToRender = (sel: ReturnType<typeof resolveSelectedRow>) =>
    AMFI_CARDS.flatMap((spec) => {
      const value = getKpiValue(sel, spec.field);
      if (value === null) return [];
      const provenance = getKpiProvenance(sel, spec.field);
      const ctx = kpiContext(spec.field, 16, sel?.month);
      return [
        {
          ...spec,
          value,
          formatted: spec.format(value),
          note: formatKpiProvenanceLine(provenance) ?? "",
          noteHover: formatKpiProvenanceTooltip(provenance) ?? undefined,
          sparkline: ctx.sparkline,
          yoyPct: ctx.yoyPct,
          percentile: ctx.percentile,
          ratioLine: sel ? spec.ratio?.(sel) : undefined,
        },
      ];
    });

  // ---- Industry Performance (IIFL Research Figures 19-21) -----------
  // Figure 20: Total EOP AUM (₹ Cr bars) + YoY % line.
  // Figure 21: Active-Equity MAAUM (₹ Cr bars) + active-equity share of
  //            total MAAUM (%) line — "share has hovered ~54%".
  // Both span the latest 24 months (matching the report's window) and
  // share the BarsWithIndexLine dual-axis visual.
  const amfiRowsAsc = amfiMonthlyRows();
  const amfiRowByMonth = new Map(amfiRowsAsc.map((r) => [r.month, r]));
  const monthMinus12 = (ym: string): string => {
    const [y, m] = ym.split("-").map(Number);
    return `${y - 1}-${String(m).padStart(2, "0")}`;
  };

  // Figure 19: MAAUM breakdown table (3 periods + YoY / MoM). Equity is
  // the broad bucket = Active + ETF & Index + Arbitrage; Debt is Sub
  // Total I (still includes Liquid); Others = Sub Total V ex. ETF & Index.
  const maaumColumns: { yearAgo: MaaumColumn; prevMonth: MaaumColumn; latest: MaaumColumn } | null =
    (() => {
      const num = (v: number | undefined): number | null =>
        typeof v === "number" && Number.isFinite(v) ? v : null;
      const toColumn = (
        r: (typeof amfiRowsAsc)[number] | undefined
      ): MaaumColumn | null => {
        if (!r) return null;
        const active = num(r.activeEquityAaum);
        const etf = num(r.etfIndexAaum);
        const arb = num(r.arbitrageAaum);
        const debt = num(r.debtAaum);
        const total = num(r.totalAaum);
        const otherSub5 = num(r.otherSchemesAaum);
        if (active === null || etf === null || arb === null || total === null) {
          return null;
        }
        return {
          monthLabel: formatMonthLabel(r.month),
          equity: active + etf + arb,
          active,
          etf,
          arb,
          debt,
          others: otherSub5 !== null ? otherSub5 - etf : null,
          total,
        };
      };
      // Latest row that carries the full IIFL-style equity breakdown.
      let latestIdx = -1;
      for (let i = amfiRowsAsc.length - 1; i >= 0; i--) {
        if (toColumn(amfiRowsAsc[i])) {
          latestIdx = i;
          break;
        }
      }
      if (latestIdx < 1) return null;
      const latestRow = amfiRowsAsc[latestIdx];
      const latest = toColumn(latestRow);
      const prevMonth = toColumn(amfiRowsAsc[latestIdx - 1]);
      const yearAgo = toColumn(amfiRowByMonth.get(monthMinus12(latestRow.month)));
      if (!latest || !prevMonth || !yearAgo) return null;
      return { yearAgo, prevMonth, latest };
    })();

  // Figure 23: Active-equity net inflows (₹ Cr bars) with a trailing-12-
  // month (TTM) average reference line. Figure 25: Active-equity NFO
  // contribution — proxied by the industry's monthly NFO funds mobilised
  // (the AMFI Monthly Report carries only the all-scheme Grand Total, not
  // an active-equity split). Both span the latest 24 months.
  const nfoFundsChart = monthlyTrend("industryNfoFundsMobilized", 24).map(
    (p) => ({ month: p.label, value: p.value })
  );
  const nfoFundsHasData = nfoFundsChart.length > 0;

  // ---- Shared chart-context helpers (used by every insight call) ----
  // Computed once so we don't recompute the same maps per chart.
  const ddByMonthForInsights: Map<string, number> = (() => {
    const m = new Map<string, number>();
    for (const r of marketIndexRows("NIFTY_500")) {
      if (typeof r.drawdownPct === "number") m.set(r.month, r.drawdownPct);
    }
    return m;
  })();
  const cyclePhaseByMonth: Map<string, string> = (() => {
    const m = new Map<string, string>();
    for (const p of cyclePhaseHistory()) m.set(p.month, p.phase);
    return m;
  })();

  // Provenance captions for the section. All four contributing fields
  // (totalAum / equityAum / debtAum / liquidAum / totalAaum) come from
  // the AMFI Monthly Report on the current snapshot, so a single
  // "Source: AMFI Monthly Report" caption is accurate. Hover surfaces
  // the same per-field detail the KPI cards expose.

  // ---- SIP Trends section --------------------------------------------
  //
  // Three line/bar trend charts driven by the press-release Monthly
  // Notes' SIP fields. monthlyTrend(field, 24) returns the chronological
  // series of months that have a value for `field` — months where the
  // field is absent are OMITTED, never zeroed or interpolated. The
  // x-axis can therefore be non-uniform (e.g. sipAccounts is missing on
  // 2024-12 / 2025-01 because those Notes don't carry the row), but no
  // synthetic data is introduced.
  const sipContribTrend = monthlyTrend("sipContribution", sipContribMonths);
  const sipAumTrend = monthlyTrend("sipAum", 24);
  const sipAccountsTrend = monthlyTrend("sipAccounts", 24);


  const hasAnySipTrend =
    sipContribTrend.length > 0 ||
    sipAumTrend.length > 0 ||
    sipAccountsTrend.length > 0;


  // ---- Monthly Flows (Figure 22-style) section -----------------------
  //
  // Three category-level net-flow series: equity (Sub Total - II),
  // debt (Sub Total - I; INCLUDES liquid), and liquid (Liquid Fund
  // row alone). All from the AMFI Monthly Report. Cells are null
  // when a month's row didn't carry the field — Recharts' GroupedBars
  // skips null cells, which honours the "no fake zero" rule while
  // still rendering the other categories on the same x-axis.
  // Category net-flow rows (equity / debt / liquid, ₹ Cr) — still used by
  // the "Where the Money Went" Sankey to split the latest month's flow.
  const monthlyFlowsRows = monthlyFlowsData(24);

  // ---- Flow Table tab -----------------------------------------------
  // Tabular re-creation of the whole Flows tab: each row is a month,
  // columns consolidate net flows by category, month-end AUM-mix shares
  // (+ MoM pp move) and Industry AAUM (level + MoM / YoY). Built from
  // the same AMFI Monthly rows the Flows charts use; missing fields stay
  // null (rendered "—"), never zero-filled. Newest month first, capped
  // to the most recent 36 months so the grid stays scannable. Every flow
  // column shows the absolute ₹ Cr figure plus its MoM % change, mirroring
  // the AUM-mix "value + delta" treatment.
  const flowTableRows: MonthlyFlowsTableRow[] = (() => {
    const rows = amfiMonthlyRows(); // ascending
    const num = (v: number | null | undefined): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;
    const built = rows.map((r, i) => {
      const prev = i > 0 ? rows[i - 1] : null;
      const prev12 = i >= 12 ? rows[i - 12] : null;
      const shares = monthEndMixShares(r);
      const prevShares = monthEndMixShares(prev);
      const shareOf = (k: string): number | null =>
        shares.has(k) ? (shares.get(k) as number) : null;
      const ppMoM = (k: string): number | null =>
        shares.has(k) && prevShares.has(k)
          ? (shares.get(k) as number) - (prevShares.get(k) as number)
          : null;

      const equity = num(r.equityNetInflow);
      const debt = num(r.debtNetInflow);
      const liquid = num(r.liquidNetInflow);
      const hybrid = num(r.hybridNetInflow);
      const total = num(r.netInflow);
      const activeEquity = num(r.activeEquityNetInflow);

      const aaum = num(r.totalAaum);
      const prevAaum = prev ? num(prev.totalAaum) : null;
      const prev12Aaum = prev12 ? num(prev12.totalAaum) : null;
      return {
        month: r.month,
        totalFlow: total,
        equityFlow: equity,
        debtFlow: debt,
        liquidFlow: liquid,
        hybridFlow: hybrid,
        activeEquityFlow: activeEquity,
        equityShare: shareOf("equity"),
        debtShare: shareOf("debt"),
        liquidShare: shareOf("liquid"),
        otherShare: shareOf("other"),
        equitySharePpMoM: ppMoM("equity"),
        debtSharePpMoM: ppMoM("debt"),
        liquidSharePpMoM: ppMoM("liquid"),
        otherSharePpMoM: ppMoM("other"),
        aaum,
        aaumMoMPct:
          aaum !== null && prevAaum !== null && prevAaum > 0
            ? ((aaum - prevAaum) / prevAaum) * 100
            : null,
        aaumYoYPct:
          aaum !== null && prev12Aaum !== null && prev12Aaum > 0
            ? ((aaum - prev12Aaum) / prev12Aaum) * 100
            : null,
      };
    });
    return built
      .filter(
        (r) =>
          r.totalFlow !== null ||
          r.equityFlow !== null ||
          r.aaum !== null
      )
      .reverse()
      .slice(0, 24);
  })();
  const flowTableHasData = flowTableRows.length > 0;

  // ---- Active Equity & Equity Mix (IIFL Figure 19 / 21) section -----
  //
  // Three charts driven by the IIFL-derived equity breakdown fields
  // (activeEquityAaum, etfIndexAaum, arbitrageAaum) extracted from
  // the AMFI Monthly Report. All charts in this section use the AAUM
  // (period-average) basis so the trend line and share denominator
  // are consistent with IIFL's Figure 19 / 21 framing. Missing months
  // are omitted from each per-field series — never zero-filled.





  // ---- Industry Folios & NFO section ---------------------------------
  //
  // Four live KPI cards + up to three trend charts driven by the
  // industry-wide AMFI Monthly Report fields landed by PR #48:
  //   - industryFolios            (raw folio count)
  //   - industryNfoCount          (open + close-ended NFO launches)
  //   - industryNfoFundsMobilized (₹ Cr raised during the month)
  //
  // industryFolioAdditions is DERIVED from consecutive months of
  // industryFolios (delta) — never stored, always computed at render
  // time. When the prior month's folios are missing the delta is
  // omitted (no fake zero).
  const folioLatestRow = latestAmfiMonthlyRow();
  const industryFoliosLatest =
    folioLatestRow && typeof folioLatestRow.industryFolios === "number"
      ? folioLatestRow.industryFolios
      : null;
  const folioAdditionsTrend = monthlyIndustryFolioAdditionsTrend(24);
  const folioAdditionsFullHistory = monthlyIndustryFolioAdditionsTrend(10_000);

  // Folio additions denominator: latest monthly net add as % of the
  // existing folio base. Both `latest.value` (additions) and
  // `industryFoliosLatest` (folio base) are raw counts; the ratio is
  // therefore additions / base, expressed as a percentage.
  const folioAdditionsDenomCaption = (() => {
    if (folioAdditionsTrend.length === 0 || industryFoliosLatest === null)
      return undefined;
    const latest = folioAdditionsTrend[folioAdditionsTrend.length - 1];
    if (industryFoliosLatest <= 0) return undefined;
    const pct = (latest.value / industryFoliosLatest) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% of folio base · latest ${latest.label}`;
  })();
  const folioAdditionsInsights = chartInsights(folioAdditionsTrend, {
    metricName: "folio additions",
    drawdownByLabel: ddByMonthForInsights,
    cyclePhaseByLabel: cyclePhaseByMonth,
    yoyLag: 12,
  });


  const hasAnyFolioOrNfoTrend = folioAdditionsTrend.length > 0;


  // ---- Category Flow Share (IIFL Figure 31-34) section ---------------
  //
  // 12-month × 12-category heatmap of net-inflow share within the
  // IIFL active-equity envelope:
  //   netInflowSharePct = categoryNetInflow / activeEquityNetInflow × 100
  // Always anchored on the latest available month — independent of
  // the `?month=` selection elsewhere on /monthly — so the window
  // rolls forward automatically when new months are ingested. Cells
  // are null when either side is missing; the heatmap renders a
  // muted "—", never a fake zero.
  const iiflHeatmap = iiflActiveEquityHeatmapData();
  const iiflHeatmapHasData = iiflHeatmap.rows.some((r) =>
    r.values.some((v) => v !== null)
  );
  // Hover provenance for the source line — pull a representative
  // category's `categoryNetInflow` provenance (Flexi Cap is dense
  // across all months).

  // ---- Active Equity Flow Diagnostics ------------------------------
  // Three derived views sitting on top of the existing AMFI Monthly
  // Report fields. No new ingestion / no new categories — just
  // active-equity envelope flow vs. trailing-average, an AUM bridge
  // (Δ closing AAUM split into net flow + market-residual), and SIP
  // AUM as a % of Total AUM. Gross-inflow share is intentionally
  // dropped: the monthly snapshot only carries net flow, gross
  // (Funds Mobilized) lives on the quarterly snapshot.
  // ---- IIFL-style "MF Flows — Risk of Slowdown" (Figures 4-7) ---------
  // Composite data feeding the new combined section. Single-pass setup so
  // the JSX below stays declarative.
  const sipGrossShareSeries = monthlySipGrossShareTrend(48);
  const sipGrossShareChartData = sipGrossShareSeries.map((p) => ({
    label: p.month,
    value: p.sipContribution,
    line: p.sipShareOfGrossPct,
  }));
  const sipAccountsChartData = monthlyTrend("sipAccounts", 12).map((p) => ({
    label: p.label,
    // Raw SIP-account count; rendered in crore via the "crore-count" format
    // (e.g. 9.65 Cr) to keep the dashboard on Indian numbering.
    value: p.value,
  }));

  // Proportion diagnostics: category rotation + passive flow share. Each
  // renders independently under its own tab (rotation in categories,
  // passiveFlowShare in active-passive).
  const rotation = categoryRotation(3, 5, amfiSelected?.month);

  // The headline active-equity flow signal — feeds the market-tape /
  // sticky context footer at the foot of the page.
  const activeEquitySignal = activeEquityNetInflowSignal();
  const latestNifty = latestNifty500Row();
  const cyclePhasePoints = cyclePhaseHistory();
  // Cycle-phase bands — group consecutive months of "Correction" or
  // "Peak" into runs so any BarSeries on the page can draw a subtle
  // background tint over those stretches. The other phases stay
  // unshaded (most of the timeline) so the bands read as ambient
  // context, not clutter.
  // Recovery-tracker rows derived from the same episode list — for
  // each episode, compute the pre-baseline / trough / recovery
  // metrics so we can render "how long did it take investors to
  // come back?".
  const episodeRecoveryData = episodeRecoveryRows();
  // Sankey data — composes SIP vs Lump-sum on the source side, and
  // Calendar heat grid cells: every month in the active-equity
  // history, value = z-score of that month's flow vs the full
  // distribution. Drives the "7-year calendar" surface below.
  const flowHeatCells: { month: string; value: number | null; hoverDetail?: string }[] = (() => {
    const rows = amfiMonthlyRows();
    const series = rows
      .filter((r) => typeof r.activeEquityNetInflow === "number")
      .map((r) => ({ month: r.month, value: r.activeEquityNetInflow as number }));
    if (series.length === 0) return [];
    const values = series.map((p) => p.value);
    const n = values.length;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stdDev = n >= 2 && variance > 0 ? Math.sqrt(variance) : null;
    return series.map((p) => ({
      month: p.month,
      value: stdDev !== null ? (p.value - mean) / stdDev : null,
      hoverDetail: `${formatCompactCrSafe(p.value)} · ${
        stdDev !== null
          ? `${((p.value - mean) / stdDev).toFixed(2)}σ`
          : "—"
      }`,
    }));
  })();
  const latestCyclePhase =
    cyclePhasePoints.length > 0
      ? cyclePhasePoints[cyclePhasePoints.length - 1].phase
      : null;
  // Ambit-style headline for the Snapshot card: net inflow level, its
  // MoM ₹ change, SIP contribution share, and equity's share of gross
  // flows. Built from already-computed values (selected row + flows).
  const buildHeadline = (sel: ReturnType<typeof resolveSelectedRow>) => {
    if (!sel || typeof sel.netInflow !== "number") return null;
    const rows = amfiMonthlyRows();
    const idx = rows.findIndex((r) => r.month === sel.month);
    const prev = idx > 0 ? rows[idx - 1] : null;
    const ni = sel.netInflow;
    const prevNi =
      prev && typeof prev.netInflow === "number" ? prev.netInflow : null;
    const sipShare =
      typeof sel.sipContribution === "number" && ni > 0
        ? (sel.sipContribution / ni) * 100
        : null;
    const lf = monthlyFlowsRows.find((r) => r.month === sel.month) ?? null;
    let equityShare: number | null = null;
    if (lf && typeof lf.equity === "number") {
      const e = Math.abs(lf.equity);
      const d = typeof lf.debt === "number" ? Math.abs(lf.debt) : 0;
      const l = typeof lf.liquid === "number" ? Math.abs(lf.liquid) : 0;
      const tot = e + d + l;
      if (tot > 0) equityShare = (e / tot) * 100;
    }
    return { month: sel.month, ni, prevNi, sipShare, equityShare };
  };
  const fmtNi = (v: number) =>
    v >= 0 ? formatCompactCrSafe(v) : "−" + formatCompactCrSafe(-v);

  // The AMFI Monthly Snapshot card BODY (KeyTakeaway + KPI grid), rendered for
  // one selected month. We build one per offered month at deploy time and let
  // ClientPeriodCard toggle them in the browser via its in-header period
  // dropdown, so changing the period costs zero Worker CPU.
  const renderAmfiSnapshotBody = (
    sel: ReturnType<typeof resolveSelectedRow>
  ): ReactNode => {
    const cards = buildCardsToRender(sel);
    const headline = buildHeadline(sel);
    return (
      <>
        {headline && (
          <KeyTakeaway
            className="mb-4"
            headline={
              <>
                Industry net inflow in {headline.month} was{" "}
                {fmtNi(headline.ni)}
                {headline.prevNi !== null && (
                  <>
                    {" "}
                    (<DeltaCr cr={headline.ni - headline.prevNi} /> MoM)
                  </>
                )}
                {headline.sipShare !== null && (
                  <>; SIPs contributed {headline.sipShare.toFixed(0)}% of it</>
                )}
                {headline.equityShare !== null && (
                  <>
                    , and equity took {headline.equityShare.toFixed(0)}% of gross
                    flows
                  </>
                )}
                .
              </>
            }
          />
        )}
        {cards.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {cards.map((c) => (
              <KpiCard
                key={c.field}
                label={c.label}
                value={c.formatted}
                note={c.note}
                noteHover={c.noteHover}
                sparkline={c.sparkline}
                sparklineColor={c.sparklineColor}
                yoyPct={c.yoyPct}
                percentile={c.percentile}
                ratio={c.ratioLine}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No AMFI PDF data ingested yet.
          </div>
        )}
      </>
    );
  };

  // Months offered in the in-card period dropdown (most-recent first), each
  // pre-rendered for instant client switch. Capped to 6 so this static page
  // stays light enough to render under the Cloudflare Worker resource limit
  // (Error 1102) on a cache-miss — 12 full KPI-card panels was the bulk of
  // the page weight.
  const snapshotMonths = amfiAvailableMonths.slice(0, 6);
  const snapshotCardPanels: Record<
    string,
    { body: ReactNode; live: boolean }
  > = Object.fromEntries(
    snapshotMonths.map((m) => {
      const sel = resolveSelectedRow(m);
      return [m, { body: renderAmfiSnapshotBody(sel), live: Boolean(sel) }];
    })
  );

  // ---- Active vs Passive series ------------------------------------
  // 96-month window so the Share-of-Passive card can pick every
  // available March year-end + the most-recent Sep marker. The chart
  // self-filters; other consumers of this trend only look at the tail
  // so the wider window costs nothing.

  const snapshotPanel = (
    <>
      {snapshotMonths.length > 0 ? (
        <ClientPeriodCard
          title="AMFI Monthly Snapshot"
          periods={snapshotMonths.map((m) => ({
            id: m,
            label: formatMonthLabel(m),
          }))}
          defaultId={latestMonthId}
          panels={snapshotCardPanels}
        />
      ) : (
        <Card
          title="AMFI Monthly Snapshot"
          action={
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              Not connected
            </span>
          }
        >
          {renderAmfiSnapshotBody(amfiSelected)}
        </Card>
      )}

      {hasAnySipTrend && (
        <div className="space-y-3">
          <section className="space-y-4">
            {sipGrossShareSeries.length > 0 && (
              <Card
                title="SIP Inflows (gross)"
                action={
                  <InfoTooltip label="SIP Inflows are GROSS — the total amount invested through SIPs each month, as reported by AMFI (SIP contribution). Redemptions, SIP stoppages and STP/SWP-outs are NOT netted off. The orange line is gross SIP inflow as a share of the industry's total gross inflows." />
                }
              >
                <BarsWithIndexLine
                  data={sipGrossShareChartData}
                  barColor="hsl(var(--chart-1))"
                  lineColor="hsl(var(--chart-3))"
                  valueFormat="cr"
                  axisFormat="cr"
                  lineValueFormat="pct"
                  lineAxisFormat="pct"
                  labelFormat="month"
                  barName="SIP Inflows (₹ Cr, gross)"
                  lineName="SIP Inflows as % of gross inflows (RHS)"
                  lineDomain={[0, 110]}
                  lineTicks={[0, 25, 50, 75, 100]}
                />
              </Card>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
            {hasAnyFolioOrNfoTrend && folioAdditionsTrend.length > 0 && (
              <ChartWithContext
                title="Folio Additions Trend"
                subtitle="Net new folios opened each month. A breadth-of-investor signal."
                flowKind="net"
                denominatorCaption={(() => {
                  const span = `${folioAdditionsTrend.length} month${folioAdditionsTrend.length === 1 ? "" : "s"}`;
                  return folioAdditionsDenomCaption
                    ? `${span} · lakh · ${folioAdditionsDenomCaption}`
                    : `${span} · lakh`;
                })()}
                denominatorTooltip="Net new folios opened each month, in lakh — a breadth-of-investor signal tracking how many new accounts the industry adds."
                insights={folioAdditionsInsights}
                yoyBadge={(() => {
                  const v = latestYoyPct(folioAdditionsTrend, 12);
                  return v === null ? undefined : { label: "YoY", pct: v };
                })()}
              >
                {(() => {
                  const ov = adaptiveAverageOverlay(folioAdditionsFullHistory, folioAdditionsTrend, 12);
                  return (
                    <BarSeries
                      data={folioAdditionsTrend}
                      name="Folio Additions"
                      color="hsl(var(--chart-4))"
                      valueFormat="lakh"
                      axisFormat="lakh"
                      labelFormat="month"
                      trendline={ov.kind === "trailing" ? ov.trendline : undefined}
                      trendlineName={ov.kind === "trailing" ? ov.label : undefined}
                      referenceValue={ov.kind === "visible-mean" ? ov.referenceValue : undefined}
                      referenceLabel={ov.kind === "visible-mean" ? ov.label : undefined}
                    />
                  );
                })()}
              </ChartWithContext>
            )}

            {sipAccountsChartData.length > 0 && (
              <Card
                title="SIP Active contributing accounts (Cr)"
              >
                <BarsWithLabels
                  data={sipAccountsChartData}
                  barColor="hsl(var(--chart-3))"
                  valueFormat="crore-count"
                  axisFormat="crore-count"
                  labelFormat="month"
                  name="SIP Active contributing accounts (Cr)"
                  labelValueFormat="crore-count"
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Live SIP-account count, expressed in crore. Sourced from
                  the AMFI Monthly Note&apos;s SIP trend table.
                </p>
              </Card>
            )}
            </div>
          </section>
        </div>
      )}

      {nfoFundsHasData && (
        <Card
          title="New Fund Offers Mobilised"
          subtitleNode={
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                New Fund Offer money raised each month — a read on how much
                fresh supply is launching.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                {`${nfoFundsChart.length} months · industry total (active-equity split not separately disclosed) · Source: AMFI Monthly Report`}
              </p>
            </div>
          }
        >
          <VerticalBars
            data={nfoFundsChart}
            xKey="month"
            bars={[
              {
                key: "value",
                name: "NFO funds mobilised",
                color: "hsl(var(--chart-1))",
              },
            ]}
            valueFormat="cr"
            axisFormat="cr"
            labelFormat="month"
            labelMode="all"
          />
        </Card>
      )}
    </>
  );

  const flowsPanel = (
    <>
      {amfiSelected && (
        <div className="space-y-3">
          {maaumColumns && (
            <Card
              title="Monthly Avg Assets by Category"
              subtitleNode={
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">
                    Monthly average AUM by category, with the active-equity
                    split. Equity = Active + ETF &amp; Index + Arbitrage.
                  </p>
                  <p className="text-[11px] text-muted-foreground/80">
                    {`${maaumColumns.yearAgo.monthLabel} · ${maaumColumns.prevMonth.monthLabel} · ${maaumColumns.latest.monthLabel} · Source: AMFI Monthly Report`}
                  </p>
                </div>
              }
              action={
                <DownloadXlsxButton
                  rows={[
                    maaumColumns.latest,
                    maaumColumns.prevMonth,
                    maaumColumns.yearAgo,
                  ]}
                  columns={MAAUM_XLSX_COLUMNS}
                  filename="industry-maaum-breakdown.xlsx"
                  sheetName="MAAUM Breakdown"
                />
              }
            >
              <MaaumTable
                yearAgo={maaumColumns.yearAgo}
                prevMonth={maaumColumns.prevMonth}
                latest={maaumColumns.latest}
              />
            </Card>
          )}
        </div>
      )}

        <Card
          title="Flow Table — Net Flows, AUM Mix & Industry AAUM"
          subtitleNode={
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                The whole Flows tab as one heatmap grid — net flows split by
                Equity / Debt / Liquid (plus Hybrid and Active Eq), month-end
                AUM mix, and Industry AAUM, one row per month.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                {`Latest ${flowTableRows.length} month${flowTableRows.length === 1 ? "" : "s"} · newest first (★) · Source: AMFI Monthly Report`}
              </p>
            </div>
          }
          action={
            <DownloadXlsxButton
              rows={flowTableRows}
              columns={MONTHLY_FLOWS_XLSX_COLUMNS}
              filename="monthly-flows.xlsx"
              sheetName="Monthly Flows"
            />
          }
        >
          {flowTableHasData ? (
            <>
              <HowToRead>
                <ul className="list-disc space-y-0.5 pl-4">
                  <li>
                    <span className="text-foreground">Net Flows</span>: Total is
                    the industry net flow in ₹ Cr; Equity / Hybrid / Active Eq are
                    each a signed % of the month&rsquo;s gross flow magnitude
                    (which still counts debt &amp; liquid). {" "}
                    <span className="text-positive">Green = inflow</span>,{" "}
                    <span className="text-negative">red = outflow</span>; shade
                    intensity scales with the size of the move within each column.
                  </li>
                  <li>
                    <span className="text-foreground">AUM Mix</span> shows each
                    segment&rsquo;s share of month-end AUM, with the small MoM
                    change (pp) beneath.
                  </li>
                  <li>
                    <span className="text-foreground">Industry AAUM</span> is the
                    period-average asset base (₹ Cr) with its MoM / YoY growth.
                  </li>
                  <li>
                    &ldquo;—&rdquo; means that month&rsquo;s AMFI report
                    didn&rsquo;t carry the field — not zero.
                  </li>
                </ul>
              </HowToRead>
              <MonthlyFlowsTable rows={flowTableRows} />
            </>
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              No monthly flow data ingested yet.
            </div>
          )}
        </Card>
    </>
  );


  const categoriesPanel = (
    <>
      {rotation &&
        rotation.gainers.length > 0 &&
        rotation.losers.length > 0 &&
        (() => {
          const topGainer = rotation.gainers[0];
          const topLoser = rotation.losers.reduce((m, e) =>
            e.deltaSharePct < m.deltaSharePct ? e : m
          );
          return (
            <KeyTakeaway
              headline={
                <>
                  Over the {rotation.windowMonths}M ending{" "}
                  {formatMonthLabel(rotation.currentRange.end)},{" "}
                  <strong>{topGainer.label}</strong> gained the most
                  active-equity flow share (
                  <span className="text-positive">
                    +{topGainer.deltaSharePct.toFixed(2)}pp
                  </span>
                  ), while <strong>{topLoser.label}</strong> lost the most (
                  <span className="text-negative">
                    {topLoser.deltaSharePct.toFixed(2)}pp
                  </span>
                  ).
                </>
              }
            />
          );
        })()}

      {iiflHeatmapHasData && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium tracking-tight">
                Active-Equity Flows by Category
              </h2>
            </div>
            <DownloadXlsxButton
              rows={iiflHeatmap.rows.map((r) => {
                const row: Record<string, string | number | null> = {
                  category: r.label,
                };
                iiflHeatmap.months.forEach((m, i) => {
                  row[m] = r.values[i];
                });
                return row;
              })}
              columns={[
                { key: "category", header: "Category" },
                ...iiflHeatmap.months.map((m) => ({
                  key: m,
                  header: formatHeatmapMonth(m),
                })),
              ]}
              filename="active-equity-net-inflow-rotation.xlsx"
              sheetName="Flow Rotation"
            />
          </div>

          <IiflHeatmap
            months={iiflHeatmap.months}
            rows={iiflHeatmap.rows}
            lens="share"
          />

          <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <InfoTooltip label="Share = category net inflow ÷ active-equity net inflow. Active equity = equity-oriented schemes + hybrid schemes excluding arbitrage + solution-oriented schemes." />
          </p>
        </div>
      )}
    </>
  );

  const marketCyclePanel = (
    <>
      {flowHeatCells.length > 0 && (
        <Card
          title="Active Equity Flow · 7-year Calendar"
          subtitle="Each cell = one month · colour = z-score vs full history"
        >
          <CalendarHeatGrid
            cells={flowHeatCells}
            saturationBound={2}
            caption="Active-equity net inflow z-score per month"
          />
        </Card>
      )}

      {episodeRecoveryData.length > 0 && (
        <EpisodeRecoveryCard rows={episodeRecoveryData} />
      )}
    </>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Monthly Operating KPIs"
        subtitle={subtitle}
      />

      <ClientTabs
        tabs={MONTHLY_TABS}
        defaultId="snapshot"
        panels={{
          snapshot: snapshotPanel,
          flows: flowsPanel,
          categories: categoriesPanel,
          "market-cycle": marketCyclePanel,
        }}
      />

      <StickyContextFooter
        cyclePhase={latestCyclePhase}
        flowZScore={activeEquitySignal?.zScore ?? null}
        drawdownPct={latestNifty?.drawdownPct ?? null}
        latestMonth={activeEquitySignal?.latestMonth ?? null}
      />
    </div>
  );
}

