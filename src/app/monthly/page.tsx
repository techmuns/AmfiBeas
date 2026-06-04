import Link from "next/link";
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
import { IiflHeatmap } from "@/components/charts/IiflHeatmap";
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
  snapshotSectionRead,
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
  historicalEpisodes,
  latestNifty500Row,
  marketIndexRows,
} from "@/data/market-indices";
import { BarsWithIndexLine } from "@/components/charts/BarsWithIndexLine";
import { BarsWithLabels } from "@/components/charts/BarsWithLabels";
import { CalendarHeatGrid } from "@/components/ui/CalendarHeatGrid";
import { EpisodeRecoveryCard } from "@/components/ui/EpisodeRecoveryCard";
import { episodeRecoveryRows } from "@/data/episode-recovery";
import { EpisodeReplayStrip } from "@/components/ui/EpisodeReplayStrip";
import { KeyTakeaway, DeltaCr } from "@/components/ui/KeyTakeaway";
import { StickyContextFooter } from "@/components/ui/StickyContextFooter";
import { LensToggle } from "@/components/ui/LensToggle";
import {
  categoryRotation,
  iiflActiveEquityHeatmapData,
  iiflActiveEquityHeatmapZScoreData,
} from "@/data/amfi-monthly-category";
import { VerticalBars } from "@/components/charts/VerticalBars";
import {
  MonthlyFlowsTable,
  type MonthlyFlowsTableRow,
} from "@/components/data/MonthlyFlowsTable";
import { MaaumTable, type MaaumColumn } from "@/components/data/MaaumTable";
import { HowToRead } from "@/components/ui/HowToRead";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { MonthPicker } from "@/components/filters/MonthPicker";
import {
  formatCompactCrSafe,
  formatCroreCountSafe,
  formatMonthLabel,
} from "@/lib/format";
import { cn } from "@/lib/cn";
import {
  DashboardTabs,
  type DashboardTabDef,
} from "@/components/layout/DashboardTabs";
import { resolveTab } from "@/lib/tabs";

const MONTHLY_TABS = [
  { id: "snapshot", label: "Snapshot" },
  { id: "flows", label: "AUM" },
  { id: "flow-table", label: "Flow Table" },
  { id: "sip-retail", label: "SIP & Retail" },
  { id: "categories", label: "Categories" },
  { id: "market-cycle", label: "Market Cycle" },
] as const satisfies readonly DashboardTabDef[];
type MonthlyTabId = (typeof MONTHLY_TABS)[number]["id"];
const MONTHLY_TAB_IDS = MONTHLY_TABS.map((t) => t.id) as readonly MonthlyTabId[];

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

type RenderedCycleBand = {
  fromLabel: string;
  toLabel: string;
  phase: "Correction" | "Peak";
  color?: string;
};

/** Prepare cycle-phase bands for a chart whose x-axis is `labels`:
 *  keep only bands fully inside the window, give single-month runs
 *  visible width (pad one label each side, clamped to the window) so a
 *  point-in-time phase reads as a band, and recolour Peak green. Shared
 *  by the Total AAUM Trend and the SIP cards so they render identically. */
function renderedCycleBands(
  bands: { fromLabel: string; toLabel: string; phase: "Correction" | "Peak" }[],
  labels: string[]
): RenderedCycleBand[] {
  const idx = new Map(labels.map((l, i) => [l, i]));
  return bands
    .filter((b) => idx.has(b.fromLabel) && idx.has(b.toLabel))
    .map((b) => {
      const fromIdx = idx.get(b.fromLabel) as number;
      const toIdx = idx.get(b.toLabel) as number;
      const single = fromIdx === toIdx;
      const lo = single ? Math.max(0, fromIdx - 1) : fromIdx;
      const hi = single ? Math.min(labels.length - 1, toIdx + 1) : toIdx;
      return {
        fromLabel: labels[lo],
        toLabel: labels[hi],
        phase: b.phase,
        color: b.phase === "Peak" ? "hsl(var(--positive))" : undefined,
      };
    });
}

/** Legend for the shaded cycle-phase bands. Lists only the phases that
 *  actually appear in `bands`, so a window with no correction (e.g. the
 *  SIP cards) shows just the Peak row. */
function CyclePhaseLegend({
  bands,
  align = "left",
}: {
  bands: RenderedCycleBand[];
  align?: "left" | "center";
}) {
  const hasCorrection = bands.some((b) => b.phase === "Correction");
  const hasPeak = bands.some((b) => b.phase === "Peak");
  if (!hasCorrection && !hasPeak) return null;
  // Centered variant matches the BarsWithIndexLine legend (centred row of
  // round dots); left variant keeps the square chips that read as shaded
  // area bands.
  const dotClass = cn(
    "inline-block h-2.5 w-2.5",
    align === "center" ? "rounded-full" : "rounded-sm"
  );
  return (
    <p
      className={cn(
        "mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground",
        align === "center" && "justify-center"
      )}
    >
      <span>Shaded bands mark market cycle phases (Nifty 500):</span>
      {hasCorrection && (
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={dotClass}
            style={{ backgroundColor: "hsl(var(--negative) / 0.4)" }}
          />
          Correction — index in drawdown
        </span>
      )}
      {hasPeak && (
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={dotClass}
            style={{ backgroundColor: "hsl(var(--positive) / 0.4)" }}
          />
          Peak — stretched / euphoric inflows
        </span>
      )}
    </p>
  );
}

export default async function MonthlyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // ---- Lens toggles (parsed up-front so any chart below can read them).
  // Each chart owns its own URL param so the toggles don't collide.
  const heatmapLens: "share" | "zscore" =
    typeof sp.heatmap === "string" && sp.heatmap === "zscore"
      ? "zscore"
      : "share";
  // SIP Contribution period toggle. History now runs to ~10 years, so
  // the card offers 1Y / 3Y / 5Y / All — where "All" is capped at 84
  // months (the range that aligns with the cycle-phase / market-data
  // window and shows both correction phases). Defaults to All.
  const sipContribRange: "1y" | "3y" | "5y" | "all" =
    sp.sipContribPeriod === "1y"
      ? "1y"
      : sp.sipContribPeriod === "3y"
        ? "3y"
        : sp.sipContribPeriod === "5y"
          ? "5y"
          : "all";
  const sipContribMonths =
    sipContribRange === "1y"
      ? 12
      : sipContribRange === "3y"
        ? 36
        : sipContribRange === "5y"
          ? 60
          : 84;
  // Chart-type toggles. Each eligible bar-style time-series card on
  // the page owns its own `<thing>View` URL param. Bars is the
  // default and is never echoed into the URL — only the "trend"
  // value rides along so the default page stays URL-clean.
  // Chart-style toggles (Bars vs Trend) were removed across the
  // dashboard — every chart now renders the trend visual directly.
  // Stale `?...View=bars|trend` URLs are ignored silently.
  // Per-card lens toggles. Each one switches a trend chart between
  // an absolute number (₹ Cr / count / etc) and a meaningful share
  // / ratio specific to that card. Default is "absolute" — URL stays
  // clean unless the user actively picked "share".
  // Primary view toggle for the first SIP card: SIP flows-vs-gross-inflows
  // (default) or the SIP AUM trend (folded in from the old standalone card).
  const sipPrimaryView: "flows" | "aum" =
    sp.sipView === "aum" ? "aum" : "flows";
  // View toggle for the merged AUM trend card: industry Total AUM
  // (default) or the Active-Equity AUM & share.
  const aumView: "total" | "active" =
    sp.aumView === "active" ? "active" : "total";
  // Pass-through params for every LensToggle so toggling A doesn't
  // lose B (or the selected month / active tab).
  const preservedQueryParams: Record<string, string | undefined> = {
    tab: typeof sp.tab === "string" ? sp.tab : undefined,
    month: typeof sp.month === "string" ? sp.month : undefined,
    aumView: typeof sp.aumView === "string" ? sp.aumView : undefined,
    heatmap: typeof sp.heatmap === "string" ? sp.heatmap : undefined,
    aeFlowView:
      typeof sp.aeFlowView === "string" ? sp.aeFlowView : undefined,
    aeFlowRange:
      typeof sp.aeFlowRange === "string" ? sp.aeFlowRange : undefined,
    activePassiveLens:
      typeof sp.activePassiveLens === "string"
        ? sp.activePassiveLens
        : undefined,
    sipContribLens:
      typeof sp.sipContribLens === "string" ? sp.sipContribLens : undefined,
    sipContribPeriod:
      typeof sp.sipContribPeriod === "string" ? sp.sipContribPeriod : undefined,
    sipView: typeof sp.sipView === "string" ? sp.sipView : undefined,
    sipAccountsLens:
      typeof sp.sipAccountsLens === "string" ? sp.sipAccountsLens : undefined,
    aeFlowLens:
      typeof sp.aeFlowLens === "string" ? sp.aeFlowLens : undefined,
    nfoCountLens:
      typeof sp.nfoCountLens === "string" ? sp.nfoCountLens : undefined,
    nfoFundsLens:
      typeof sp.nfoFundsLens === "string" ? sp.nfoFundsLens : undefined,
  };

  // Resolve the active tab from the URL. Unknown / missing values
  // silently fall back to "snapshot" so stale bookmarks don't break.
  const activeTab = resolveTab<MonthlyTabId>(
    sp.tab,
    MONTHLY_TAB_IDS,
    "snapshot",
  );

  // AMFI Monthly Snapshot — first live AMFI widget. Reads directly from
  // the manually-uploaded-PDF snapshot. The selected row is whichever
  // month the URL `?month=YYYY-MM` query param picked, falling back to
  // the latest available month when missing or invalid. Cards only
  // render for KPIs the SELECTED row carries — never substitutes zero
  // or a dash for a missing value, never falls back to demo data.
  const requestedMonthRaw = sp.month;
  const requestedMonth =
    typeof requestedMonthRaw === "string" ? requestedMonthRaw : undefined;
  const amfiSelected = resolveSelectedRow(requestedMonth);
  const amfiAvailableMonths = availableMonthsDesc();
  // Header subtitle tracks the global period filter so the page title
  // agrees with the picker. Falls back to the dataset's latest month
  // when nothing is explicitly selected (keeps the default unchanged).
  const subtitle = `Industry-wide · ${
    requestedMonth ? amfiSelected?.month ?? latestMonth() : latestMonth()
  }`;

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

  const amfiCardsToRender = AMFI_CARDS.flatMap((spec) => {
    const value = getKpiValue(amfiSelected, spec.field);
    if (value === null) return [];
    const provenance = getKpiProvenance(amfiSelected, spec.field);
    // Anchor YoY / percentile / sparkline window to the user-selected
    // month, not the latest available. Otherwise the picker changes the
    // headline value but the pills stay stuck on the latest snapshot.
    const ctx = kpiContext(spec.field, 24, amfiSelected?.month);
    return [
      {
        ...spec,
        value,
        formatted: spec.format(value),
        // Visible note: "Source: AMFI Monthly Report · p.1" — short.
        // Tooltip on hover: same plus the full PDF filename for users
        // who want to verify provenance. Filename stays in the data
        // (row.fieldSources[field].sourcePdf) regardless.
        note: formatKpiProvenanceLine(provenance) ?? "",
        noteHover: formatKpiProvenanceTooltip(provenance) ?? undefined,
        sparkline: ctx.sparkline,
        yoyPct: ctx.yoyPct,
        percentile: ctx.percentile,
        ratioLine: amfiSelected ? spec.ratio?.(amfiSelected) : undefined,
      },
    ];
  });

  // Subtitle no longer carries the month; the month picker on the right
  // is the canonical place for period selection.
  const amfiSectionSubtitle = amfiSelected
    ? "Industry-wide · Source: AMFI Monthly Report"
    : "Upload AMFI monthly PDFs to manual-data/amfi-monthly/pdfs/, then run npm run ingest:amfi-pdf";

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
  const yoyPctOf = (
    month: string,
    field: "totalAum" | "totalAaum"
  ): number | null => {
    const cur = amfiRowByMonth.get(month)?.[field];
    const prev = amfiRowByMonth.get(monthMinus12(month))?.[field];
    return typeof cur === "number" && typeof prev === "number" && prev > 0
      ? ((cur - prev) / prev) * 100
      : null;
  };
  const totalAumChart = amfiRowsAsc
    .filter((r) => typeof r.totalAum === "number")
    .slice(-24)
    .map((r) => ({
      label: r.month,
      value: r.totalAum as number,
      line: yoyPctOf(r.month, "totalAum"),
    }));
  const totalAumChartHasData = totalAumChart.length > 0;
  const totalAumYoyLatest = (() => {
    for (let i = totalAumChart.length - 1; i >= 0; i--) {
      if (totalAumChart[i].line !== null) return totalAumChart[i].line;
    }
    return null;
  })();
  const activeEqShareChart = amfiRowsAsc
    .filter(
      (r) =>
        typeof r.activeEquityAaum === "number" &&
        typeof r.totalAaum === "number" &&
        (r.totalAaum as number) > 0
    )
    .slice(-24)
    .map((r) => ({
      label: r.month,
      value: r.activeEquityAaum as number,
      line: ((r.activeEquityAaum as number) / (r.totalAaum as number)) * 100,
    }));
  const activeEqShareChartHasData = activeEqShareChart.length > 0;
  const activeEqShareLatest =
    activeEqShareChart.length > 0
      ? activeEqShareChart[activeEqShareChart.length - 1].line
      : null;

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
  const activeEqNetInflowTrend = monthlyTrend("activeEquityNetInflow", 24);
  const activeEqNetInflowChart = activeEqNetInflowTrend.map((p) => ({
    month: p.label,
    value: p.value,
  }));
  const activeEqNetInflowHasData = activeEqNetInflowChart.length > 0;
  const activeEqTtmAvg = (() => {
    const last12 = activeEqNetInflowTrend
      .slice(-12)
      .map((p) => p.value)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    return last12.length > 0
      ? last12.reduce((s, v) => s + v, 0) / last12.length
      : null;
  })();
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

  // ---- "Share" series for SIP AUM (kept for the SIP AUM card) -------
  // SIP Contribution and SIP Contributing Accounts cards were replaced
  // with the IIFL Figure 6 / 7 charts above — their share series and
  // display lookups are no longer needed.
  const sipAumShare = amfiMonthlyRows()
    .filter(
      (r) =>
        typeof r.sipAum === "number" &&
        typeof r.totalAum === "number" &&
        r.totalAum > 0
    )
    .map((r) => ({
      label: r.month,
      value: ((r.sipAum as number) / (r.totalAum as number)) * 100,
    }));

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
  // to the most recent 36 months so the grid stays scannable.
  //
  // Total net flow is shown as an absolute ₹ Cr figure; Equity / Hybrid /
  // Active Eq are shown as a SIGNED % of the month's gross flow magnitude
  // (mirrors the AUM-mix "share of the whole" treatment). Gross magnitude
  // = Σ|Sub-total flows| over the non-overlapping majors (Equity II +
  // Debt I + Hybrid III + Other V) — Debt is kept in the denominator even
  // though it's no longer a displayed column, and Debt already contains
  // Liquid so Liquid is NOT added again. Dividing by gross gives values
  // bounded in [−100%, +100%] that stay meaningful even in churny /
  // outflow months, where dividing by the (small, possibly negative) net
  // total would flip signs and blow up.
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
      const hybrid = num(r.hybridNetInflow);
      const other = num(r.otherSchemesNetInflow);
      const total = num(r.netInflow);
      const activeEquity = num(r.activeEquityNetInflow);
      // Gross = Σ|non-overlapping majors|. Debt ⊇ Liquid, so Liquid is
      // excluded from the sum to avoid double-counting.
      const gross =
        Math.abs(equity ?? 0) +
        Math.abs(debt ?? 0) +
        Math.abs(hybrid ?? 0) +
        Math.abs(other ?? 0);
      const pctOfGross = (v: number | null): number | null =>
        v !== null && gross > 0 ? (v / gross) * 100 : null;

      const aaum = num(r.totalAaum);
      const prevAaum = prev ? num(prev.totalAaum) : null;
      const prev12Aaum = prev12 ? num(prev12.totalAaum) : null;
      return {
        month: r.month,
        totalFlow: total,
        equityFlowPct: pctOfGross(equity),
        hybridFlowPct: pctOfGross(hybrid),
        activeEquityFlowPct: pctOfGross(activeEquity),
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
          r.equityFlowPct !== null ||
          r.aaum !== null
      )
      .reverse()
      .slice(0, 36);
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
  const iiflHeatmapZScore = iiflActiveEquityHeatmapZScoreData();
  const heatmapActive =
    heatmapLens === "zscore" ? iiflHeatmapZScore : iiflHeatmap;
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
  const sipGrossShareSeries = monthlySipGrossShareTrend(72);
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
  const cyclePhaseBands: { fromLabel: string; toLabel: string; phase: "Correction" | "Peak" }[] = (() => {
    const out: { fromLabel: string; toLabel: string; phase: "Correction" | "Peak" }[] = [];
    let runStart: { idx: number; phase: "Correction" | "Peak" } | null = null;
    for (let i = 0; i < cyclePhasePoints.length; i++) {
      const p = cyclePhasePoints[i];
      const isNotable = p.phase === "Correction" || p.phase === "Peak";
      if (isNotable) {
        if (runStart === null || runStart.phase !== p.phase) {
          if (runStart !== null) {
            out.push({
              fromLabel: cyclePhasePoints[runStart.idx].month,
              toLabel: cyclePhasePoints[i - 1].month,
              phase: runStart.phase,
            });
          }
          runStart = { idx: i, phase: p.phase as "Correction" | "Peak" };
        }
      } else if (runStart !== null) {
        out.push({
          fromLabel: cyclePhasePoints[runStart.idx].month,
          toLabel: cyclePhasePoints[i - 1].month,
          phase: runStart.phase,
        });
        runStart = null;
      }
    }
    if (runStart !== null) {
      out.push({
        fromLabel: cyclePhasePoints[runStart.idx].month,
        toLabel: cyclePhasePoints[cyclePhasePoints.length - 1].month,
        phase: runStart.phase,
      });
    }
    return out;
  })();
  const episodes = historicalEpisodes();
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
  // Section reads — short data-driven 1-liners surfaced under
  // each section title.
  const snapshotRead = snapshotSectionRead();

  // Ambit-style headline for the Snapshot card: net inflow level, its
  // MoM ₹ change, SIP contribution share, and equity's share of gross
  // flows. Built from already-computed values (selected row + flows).
  const netInflowHeadline = (() => {
    if (!amfiSelected || typeof amfiSelected.netInflow !== "number") return null;
    const rows = amfiMonthlyRows();
    const idx = rows.findIndex((r) => r.month === amfiSelected.month);
    const prev = idx > 0 ? rows[idx - 1] : null;
    const ni = amfiSelected.netInflow;
    const prevNi =
      prev && typeof prev.netInflow === "number" ? prev.netInflow : null;
    const sipShare =
      typeof amfiSelected.sipContribution === "number" && ni > 0
        ? (amfiSelected.sipContribution / ni) * 100
        : null;
    const lf =
      monthlyFlowsRows.find((r) => r.month === amfiSelected.month) ?? null;
    let equityShare: number | null = null;
    if (lf && typeof lf.equity === "number") {
      const e = Math.abs(lf.equity);
      const d = typeof lf.debt === "number" ? Math.abs(lf.debt) : 0;
      const l = typeof lf.liquid === "number" ? Math.abs(lf.liquid) : 0;
      const tot = e + d + l;
      if (tot > 0) equityShare = (e / tot) * 100;
    }
    return { month: amfiSelected.month, ni, prevNi, sipShare, equityShare };
  })();
  const fmtNi = (v: number) =>
    v >= 0 ? formatCompactCrSafe(v) : "−" + formatCompactCrSafe(-v);

  // ---- Active vs Passive series ------------------------------------
  // 96-month window so the Share-of-Passive card can pick every
  // available March year-end + the most-recent Sep marker. The chart
  // self-filters; other consumers of this trend only look at the tail
  // so the wider window costs nothing.

  return (
    <div className="space-y-8">
      <PageHeader
        title="Monthly Operating KPIs"
        subtitle={subtitle}
      />

      <DashboardTabs
        basePath="/monthly"
        tabs={MONTHLY_TABS}
        activeId={activeTab}
        searchParams={sp}
      />

      {amfiSelected &&
        amfiAvailableMonths.length > 0 &&
        activeTab !== "flows" &&
        activeTab !== "sip-retail" &&
        activeTab !== "flow-table" && (
          <MonthPicker
            availableMonths={amfiAvailableMonths}
            selectedMonth={amfiSelected.month}
          />
        )}

      {activeTab === "snapshot" && (
      <Card
        title="AMFI Monthly Snapshot"
        subtitle={
          snapshotRead && amfiSelected
            ? `${amfiSectionSubtitle} · ${snapshotRead}`
            : amfiSectionSubtitle
        }
        action={
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
              amfiSelected
                ? "border-positive/40 bg-positive/10 text-positive"
                : "border-border text-muted-foreground"
            )}
          >
            {amfiSelected ? "Live" : "Not connected"}
          </span>
        }
      >
        {netInflowHeadline && (
          <KeyTakeaway
            className="mb-4"
            headline={
              <>
                Industry net inflow in {netInflowHeadline.month} was{" "}
                {fmtNi(netInflowHeadline.ni)}
                {netInflowHeadline.prevNi !== null && (
                  <>
                    {" "}
                    (<DeltaCr cr={netInflowHeadline.ni - netInflowHeadline.prevNi} />{" "}
                    MoM)
                  </>
                )}
                {netInflowHeadline.sipShare !== null && (
                  <>
                    ; SIPs contributed {netInflowHeadline.sipShare.toFixed(0)}% of
                    it
                  </>
                )}
                {netInflowHeadline.equityShare !== null && (
                  <>, and equity took {netInflowHeadline.equityShare.toFixed(0)}% of gross flows</>
                )}
                .
              </>
            }
          />
        )}
        {amfiCardsToRender.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {amfiCardsToRender.map((c) => (
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
      </Card>
      )}

      {activeTab === "flows" && amfiSelected && (
        <div className="space-y-3">
          {maaumColumns && (
            <Card
              title="Industry MAAUM Breakdown"
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
            >
              <MaaumTable
                yearAgo={maaumColumns.yearAgo}
                prevMonth={maaumColumns.prevMonth}
                latest={maaumColumns.latest}
              />
            </Card>
          )}
          {(totalAumChartHasData || activeEqShareChartHasData) && (
            <Card
              title={
                aumView === "active"
                  ? "Active Equity AUM & Share of Total"
                  : "Total AUM Trend"
              }
              subtitleNode={
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">
                    {aumView === "active"
                      ? "Active-equity MAAUM (excludes ETF / Index / arbitrage) and its share of total industry MAAUM."
                      : "Industry month-end (EOP) AUM with year-on-year growth."}
                  </p>
                  <p className="text-[11px] text-muted-foreground/80">
                    {aumView === "active"
                      ? `${activeEqShareChart.length} months${activeEqShareLatest !== null ? ` · latest share ${activeEqShareLatest.toFixed(0)}%` : ""} · Source: AMFI Monthly Report`
                      : `${totalAumChart.length} months${totalAumYoyLatest !== null ? ` · latest YoY +${totalAumYoyLatest.toFixed(0)}%` : ""} · Source: AMFI Monthly Report`}
                  </p>
                </div>
              }
              action={
                <LensToggle
                  basePath="/monthly"
                  paramName="aumView"
                  defaultValue="total"
                  lenses={[
                    { value: "total", label: "Total AUM" },
                    { value: "active", label: "Active Equity AUM" },
                  ]}
                  active={aumView}
                  preserveParams={preservedQueryParams}
                />
              }
            >
              {aumView === "active" ? (
                <BarsWithIndexLine
                  data={activeEqShareChart}
                  barColor="hsl(var(--chart-1))"
                  lineColor="hsl(var(--chart-2))"
                  valueFormat="cr"
                  axisFormat="cr"
                  lineValueFormat="pct"
                  lineAxisFormat="pct"
                  labelFormat="month"
                  barName="Active Equity MAAUM"
                  lineName="Active equity share of total"
                  lineDomain={[50, 60]}
                  lineTicks={[50, 52, 54, 56, 58, 60]}
                />
              ) : (
                <BarsWithIndexLine
                  data={totalAumChart}
                  barColor="hsl(var(--chart-1))"
                  lineColor="hsl(var(--foreground))"
                  valueFormat="cr"
                  axisFormat="cr"
                  lineValueFormat="pct"
                  lineAxisFormat="pct"
                  labelFormat="month"
                  barName="Total AUM (EOP)"
                  lineName="YoY growth"
                />
              )}
            </Card>
          )}
        </div>
      )}

      {activeTab === "sip-retail" && hasAnySipTrend && (
        <div className="space-y-3">
          <section className="space-y-4">
            {sipGrossShareSeries.length > 0 && (
              <Card
                title={
                  sipPrimaryView === "aum"
                    ? "SIP AUM Trend"
                    : "SIP flows vs Industry Gross Inflows"
                }
                action={
                  <LensToggle
                    basePath="/monthly"
                    paramName="sipView"
                    defaultValue="flows"
                    lenses={[
                      { value: "flows", label: "SIP Flows" },
                      { value: "aum", label: "SIP AUM" },
                    ]}
                    active={sipPrimaryView}
                    preserveParams={preservedQueryParams}
                  />
                }
              >
                {sipPrimaryView === "aum" ? (
                  sipAumShare.length > 0 ? (
                    (() => {
                      // SIP AUM as % of total industry AUM, over the full
                      // available SIP-AUM history (Jun '24 onward — all the
                      // months the AMFI press release reports SIP AUM for).
                      const bands = renderedCycleBands(
                        cyclePhaseBands,
                        sipAumShare.map((p) => p.label)
                      );
                      return (
                        <>
                          <BarSeries
                            data={sipAumShare}
                            name="SIP AUM (% of total AUM)"
                            color="hsl(var(--chart-2))"
                            valueFormat="pct"
                            axisFormat="pct1"
                            labelFormat="month"
                            cyclePhaseBands={bands}
                            dynamicYDomain
                          />
                          <CyclePhaseLegend bands={bands} />
                        </>
                      );
                    })()
                  ) : (
                    <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                      SIP AUM not yet ingested — appears once the next AMFI
                      Monthly Notes (press release) lands.
                    </div>
                  )
                ) : (
                  <BarsWithIndexLine
                    data={sipGrossShareChartData}
                    barColor="hsl(var(--chart-1))"
                    lineColor="hsl(var(--chart-3))"
                    valueFormat="cr"
                    axisFormat="cr"
                    lineValueFormat="pct"
                    lineAxisFormat="pct"
                    labelFormat="month"
                    barName="SIP Flows (₹ Cr)"
                    lineName="SIP Flows as % of gross Inflows (RHS)"
                    lineDomain={[0, 110]}
                    lineTicks={[0, 25, 50, 75, 100]}
                  />
                )}
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

      {activeTab === "sip-retail" && nfoFundsHasData && (
        <Card
          title="NFO Funds Mobilised"
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
          <p className="mt-2 text-[11px] text-muted-foreground">
            Bars: monthly NFO funds mobilised across all schemes (₹ Cr). The
            AMFI Monthly Report doesn&rsquo;t break out an active-equity-only
            figure, so this is the industry total.
          </p>
        </Card>
      )}

      {activeTab === "snapshot" && activeEqNetInflowHasData && (
        <Card
          title="Active Equity Net Inflows"
          subtitleNode={
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                Monthly net inflows into the active-equity envelope, against
                the trailing 12-month (TTM) average.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                {`${activeEqNetInflowChart.length} months${activeEqTtmAvg !== null ? ` · TTM avg ${formatCompactCrSafe(activeEqTtmAvg)}` : ""} · Source: AMFI Monthly Report`}
              </p>
            </div>
          }
        >
          <VerticalBars
            data={activeEqNetInflowChart}
            xKey="month"
            bars={[
              {
                key: "value",
                name: "Active equity net inflows",
                color: "hsl(var(--chart-1))",
              },
            ]}
            valueFormat="cr"
            axisFormat="cr"
            labelFormat="month"
            referenceValue={activeEqTtmAvg}
            referenceLabel="TTM avg"
            labelMode="last"
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Bars: monthly active-equity net inflow (₹ Cr). Dashed line =
            trailing 12-month average. Active equity = equity-oriented + hybrid
            (ex-arbitrage) + solution-oriented schemes.
          </p>
        </Card>
      )}

      {activeTab === "flow-table" && (
        <Card
          title="Monthly Flows & AUM · Table"
          subtitleNode={
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">
                The whole Flows tab as one grid — net flows by category,
                month-end AUM mix, and Industry AAUM, one row per month.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                {`Latest ${flowTableRows.length} month${flowTableRows.length === 1 ? "" : "s"} · newest first (★) · Source: AMFI Monthly Report`}
              </p>
            </div>
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
      )}

      {activeTab === "categories" &&
        rotation &&
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

      {activeTab === "categories" && rotation && (
        <CategoryRotationCard rotation={rotation} />
      )}


      {activeTab === "categories" && iiflHeatmapHasData && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium tracking-tight">
                Active-Equity Category Heatmap
              </h2>
              <p className="text-xs text-muted-foreground">
                {heatmapLens === "zscore"
                  ? "Net inflow z-score vs each category's own history · past 12 months · Source: AMFI Monthly Report"
                  : "Net inflow share of active equity categories · past 12 months · Source: AMFI Monthly Report"}
              </p>
            </div>
            <HeatmapLensToggle
              lens={heatmapLens}
              activeTab={typeof sp.tab === "string" ? sp.tab : undefined}
            />
          </div>

          <IiflHeatmap
            months={heatmapActive.months}
            rows={heatmapActive.rows}
            lens={heatmapLens}
          />

          <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {heatmapLens === "zscore" ? (
              <>
                Cell = (month value − category mean) ÷ category stdDev.
                Saturates at ±2σ.
                <InfoTooltip label="z-score is computed per category over its full available monthly history. Active equity = equity-oriented schemes + hybrid schemes excluding arbitrage + solution-oriented schemes." />
              </>
            ) : (
              <>
                Share = category net inflow ÷ active-equity net inflow.
                <InfoTooltip label="Active equity = equity-oriented schemes + hybrid schemes excluding arbitrage + solution-oriented schemes." />
              </>
            )}
          </p>
        </div>
      )}

      {activeTab === "market-cycle" && flowHeatCells.length > 0 && (
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

      {activeTab === "market-cycle" && episodeRecoveryData.length > 0 && (
        <EpisodeRecoveryCard rows={episodeRecoveryData} />
      )}

      {activeTab === "market-cycle" && episodes.length > 0 && (
        <Card
          title="Cycle Replay · How investors behaved in past drawdowns"
          subtitle="Each card is a distinct drawdown episode — colour pill captures the average flow z-score during the episode"
        >
          <EpisodeReplayStrip
            episodes={episodes}
            formatValue={(v) => formatCompactCrSafe(v)}
          />
        </Card>
      )}

      <StickyContextFooter
        cyclePhase={latestCyclePhase}
        flowZScore={activeEquitySignal?.zScore ?? null}
        drawdownPct={latestNifty?.drawdownPct ?? null}
        latestMonth={activeEquitySignal?.latestMonth ?? null}
      />
    </div>
  );
}

/** Sign-aware compact ₹ Cr — local helper so a negative active-equity
 *  net inflow renders as "−₹32.4K Cr" rather than the unsigned value. */
/** Heatmap lens toggle — pure-server segmented control rendered as
 *  two `<Link>`s so the App Router handles state. Each link preserves
 *  the current `?tab=` so toggling the heatmap lens doesn't bounce the
 *  reader back to the default tab. */
function HeatmapLensToggle({
  lens,
  activeTab,
}: {
  lens: "share" | "zscore";
  activeTab: string | undefined;
}) {
  const baseClass =
    "rounded-md border px-2.5 py-1 text-[11px] font-medium tracking-tight transition-colors";
  const activeClass = "border-foreground/40 bg-foreground/5 text-foreground";
  const inactiveClass =
    "border-border text-muted-foreground hover:bg-accent hover:text-foreground";
  const shareQuery: Record<string, string> = {};
  const zscoreQuery: Record<string, string> = { heatmap: "zscore" };
  if (activeTab) {
    shareQuery.tab = activeTab;
    zscoreQuery.tab = activeTab;
  }
  return (
    <div className="inline-flex items-center gap-1 rounded-md border bg-card p-0.5 shadow-sm">
      <Link
        href={{ pathname: "/monthly", query: shareQuery }}
        scroll={false}
        className={cn(baseClass, lens === "share" ? activeClass : inactiveClass)}
      >
        Share
      </Link>
      <Link
        href={{ pathname: "/monthly", query: zscoreQuery }}
        scroll={false}
        className={cn(baseClass, lens === "zscore" ? activeClass : inactiveClass)}
      >
        Z-score
      </Link>
    </div>
  );
}

/** Two-column compact rotation card: top gainers (green) on the left,
 *  top losers (red) on the right. Δ shown in percentage points. */
function CategoryRotationCard({
  rotation,
}: {
  rotation: NonNullable<ReturnType<typeof categoryRotation>>;
}) {
  return (
    <Card
      title="Category Rotation"
      subtitle={`${rotation.windowMonths}M avg vs prior ${rotation.windowMonths}M · share of active-equity net inflow`}
      action={
        <InfoTooltip
          label={`For each category in the active-equity envelope, the trailing ${rotation.windowMonths}-month average net-inflow share (${rotation.currentRange.start} → ${rotation.currentRange.end}) is compared to the prior ${rotation.windowMonths}-month window (${rotation.priorRange.start} → ${rotation.priorRange.end}). Δ is the difference in percentage points. Active equity = equity-oriented schemes + hybrid schemes excluding arbitrage + solution-oriented schemes.`}
        />
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <RotationList
          title="Gaining flow share"
          entries={rotation.gainers}
          accent="positive"
        />
        <RotationList
          title="Losing flow share"
          entries={rotation.losers}
          accent="negative"
        />
      </div>
    </Card>
  );
}

function RotationList({
  title,
  entries,
  accent,
}: {
  title: string;
  entries: NonNullable<ReturnType<typeof categoryRotation>>["gainers"];
  accent: "positive" | "negative";
}) {
  if (entries.length === 0) {
    return (
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          No category moved meaningfully in this window.
        </div>
      </div>
    );
  }
  const deltaClass =
    accent === "positive" ? "text-positive" : "text-negative";
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <ul className="mt-2 space-y-1.5">
        {entries.map((e) => (
          <li
            key={e.slug}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span className="truncate" title={e.label}>
              {e.label}
            </span>
            <span className="shrink-0 inline-flex items-center gap-2 text-[11px] tabular">
              <span className="text-muted-foreground">
                {e.priorSharePct.toFixed(1)}% → {e.currentSharePct.toFixed(1)}%
              </span>
              <span className={cn("font-semibold", deltaClass)}>
                {e.deltaSharePct >= 0 ? "+" : ""}
                {e.deltaSharePct.toFixed(2)}pp
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}



