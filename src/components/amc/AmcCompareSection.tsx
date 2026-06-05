import { Card } from "@/components/ui/Card";
import { LensToggle } from "@/components/ui/LensToggle";
import { HorizontalBars } from "@/components/charts/HorizontalBars";
import { TabIntroCard } from "@/components/ui/TabIntroCard";
import { amcIndexRows, type AmcIndexRow } from "@/data/amc-detail";
import {
  SOURCED_FINANCIALS_SLUGS,
  quarterlyForAmc,
  yieldsForAmc,
  type QuarterlyYields,
} from "@/data/aggregate";
import type { QuarterlyFinancial } from "@/data/types";
import { AMCS } from "@/data/amcs";
import { AMC_COLORS, amcShortLabel } from "@/lib/chart-meta";
import type { ValueFormat, AxisFormat } from "@/components/charts/format";

// ---- Switchable KPIs for the two horizontal-bar compare charts ----
// Every metric here is REAL (company filings + AMFI Fundwise AAUM); the
// synthetic per-AMC monthly series in generator.ts is deliberately excluded.
type KpiSpec = {
  label: string;
  short: string;
  valueFormat: ValueFormat;
  axisFormat: AxisFormat;
};

const FIN_KPIS = {
  revenue: { label: "Operating Revenue", short: "Revenue", valueFormat: "cr", axisFormat: "cr" },
  operatingProfit: { label: "Operating Profit", short: "Op. Profit", valueFormat: "cr", axisFormat: "cr" },
  pat: { label: "Net Profit (PAT)", short: "PAT", valueFormat: "cr", axisFormat: "cr" },
  opMargin: { label: "Operating Margin", short: "Op. Margin", valueFormat: "pct", axisFormat: "pct" },
  patMargin: { label: "PAT Margin", short: "PAT Margin", valueFormat: "pct", axisFormat: "pct" },
  revenueYield: { label: "Revenue Yield", short: "Rev. Yield", valueFormat: "bps", axisFormat: "bps" },
  profitYield: { label: "Profit Yield", short: "Profit Yield", valueFormat: "bps", axisFormat: "bps" },
} satisfies Record<string, KpiSpec>;
export type FinKpiId = keyof typeof FIN_KPIS;
export const FIN_KPI_DEFAULT: FinKpiId = "pat";
const finLenses = (Object.keys(FIN_KPIS) as FinKpiId[]).map((k) => ({
  value: k,
  label: FIN_KPIS[k].short,
}));

const AUM_KPIS = {
  avgAum: { label: "Average AUM", short: "AAUM", valueFormat: "cr", axisFormat: "cr" },
  marketShare: { label: "Market Share", short: "Mkt Share", valueFormat: "pct", axisFormat: "pct" },
  qoqGrowth: { label: "QoQ Asset Growth", short: "QoQ", valueFormat: "pct", axisFormat: "pct" },
  yoyGrowth: { label: "YoY Asset Growth", short: "YoY", valueFormat: "pct", axisFormat: "pct" },
} satisfies Record<string, KpiSpec>;
export type AumKpiId = keyof typeof AUM_KPIS;
export const AUM_KPI_DEFAULT: AumKpiId = "avgAum";
const aumLenses = (Object.keys(AUM_KPIS) as AumKpiId[]).map((k) => ({
  value: k,
  label: AUM_KPIS[k].short,
}));

function finValue(kpi: FinKpiId, f: QuarterlyFinancial, y: QuarterlyYields): number {
  switch (kpi) {
    case "pat": return f.pat;
    case "revenue": return f.revenue;
    case "operatingProfit": return f.operatingProfit;
    case "patMargin": return y.patMargin;
    case "opMargin": return y.opMargin;
    case "revenueYield": return y.revenueYieldBps;
    case "profitYield": return y.profitYieldBps;
  }
}

function aumValue(kpi: AumKpiId, r: AmcIndexRow): number | null {
  switch (kpi) {
    case "avgAum": return r.avgAum;
    case "marketShare": return r.marketSharePct;
    case "qoqGrowth": return r.qoqGrowthPct;
    case "yoyGrowth": return r.yoyGrowthPct;
  }
}

/** Resolve the two compare KPIs from URL search params, falling back to
 *  the defaults when absent or unrecognised. */
export function parseCompareKpis(
  sp: Record<string, string | string[] | undefined>
): { finKpi: FinKpiId; aumKpi: AumKpiId } {
  const finKpi: FinKpiId =
    typeof sp.finKpi === "string" && sp.finKpi in FIN_KPIS
      ? (sp.finKpi as FinKpiId)
      : FIN_KPI_DEFAULT;
  const aumKpi: AumKpiId =
    typeof sp.aumKpi === "string" && sp.aumKpi in AUM_KPIS
      ? (sp.aumKpi as AumKpiId)
      : AUM_KPI_DEFAULT;
  return { finKpi, aumKpi };
}

/**
 * Side-by-side comparison of the publicly-listed AMCs across two
 * switchable horizontal-bar charts: financial performance (company
 * filings) and AUM & market position (AMFI Fundwise AAUM). Stateless
 * apart from the two KPI selections, which are URL params so the view
 * is shareable. `preserveParams` carries any host-page params (e.g.
 * `view=compare`) that the KPI toggle links must keep.
 */
export function AmcCompareSection({
  basePath,
  finKpi,
  aumKpi,
  preserveParams = {},
}: {
  basePath: string;
  finKpi: FinKpiId;
  aumKpi: AumKpiId;
  preserveParams?: Record<string, string | undefined>;
}) {
  const data = amcIndexRows();

  // ---- Listed AMCs only -----------------------------------------------
  const listedAmcs = AMCS.filter((a) => a.listed);
  const listedSlugSet = new Set(listedAmcs.map((a) => a.slug));

  // Chart 2 — AUM & market position: every listed AMC from the AAUM ranking.
  const aumCompareBars = (data?.rows ?? [])
    .filter((r) => listedSlugSet.has(r.amcSlug))
    .map((r) => ({
      label: amcShortLabel(r.amcSlug),
      value: aumValue(aumKpi, r),
      color: AMC_COLORS[r.amcSlug],
    }))
    .filter((d): d is { label: string; value: number; color: string } =>
      typeof d.value === "number" && Number.isFinite(d.value)
    )
    .sort((a, b) => b.value - a.value);

  // Chart 1 — financial performance: listed AMCs with a sourced P&L,
  // aligned to the latest reported quarter present across them.
  const sourcedListed = listedAmcs.filter((a) =>
    SOURCED_FINANCIALS_SLUGS.has(a.slug)
  );
  const finQuarters = sourcedListed.flatMap((a) =>
    quarterlyForAmc(a.slug).map((q) => q.quarter)
  );
  const finQuarter =
    finQuarters.length > 0 ? [...finQuarters].sort().pop()! : null;
  const finCompareBars = sourcedListed
    .map((a) => {
      const series = quarterlyForAmc(a.slug);
      const yields = yieldsForAmc(a.slug);
      const f =
        series.find((q) => q.quarter === finQuarter) ??
        series[series.length - 1];
      const y =
        yields.find((q) => q.quarter === finQuarter) ??
        yields[yields.length - 1];
      if (!f || !y) return null;
      return {
        label: amcShortLabel(a.slug),
        value: finValue(finKpi, f, y),
        color: AMC_COLORS[a.slug],
      };
    })
    .filter((d): d is { label: string; value: number; color: string } =>
      d !== null && Number.isFinite(d.value)
    )
    .sort((a, b) => b.value - a.value);

  return (
    <>
      <TabIntroCard
        headline="How do the listed AMCs stack up on financials and AUM?"
        summary="Side-by-side bars across the publicly-listed AMCs. Switch the KPI on each chart to re-rank the cohort — financial performance (company filings) on top, AUM & market position (AMFI Fundwise AAUM) below."
        watchNext="Whether the AMC that leads on AUM scale also leads on profitability — size and margin don't always travel together."
      />

      <Card
        title="Financial performance"
        subtitleNode={
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">
              Listed AMCs ranked on the selected financial KPI.
            </p>
            <p className="text-[11px] text-muted-foreground/80">
              {`${finCompareBars.length} listed AMC${finCompareBars.length === 1 ? "" : "s"} with reported financials${finQuarter ? ` · ${finQuarter}` : ""} · Source: Company filings · AMFI Fundwise AAUM (yield base)`}
            </p>
          </div>
        }
      >
        <div className="mb-3">
          <LensToggle
            basePath={basePath}
            paramName="finKpi"
            defaultValue={FIN_KPI_DEFAULT}
            lenses={finLenses}
            active={finKpi}
            wrap
            preserveParams={{
              ...preserveParams,
              aumKpi: aumKpi === AUM_KPI_DEFAULT ? undefined : aumKpi,
            }}
          />
        </div>
        {finCompareBars.length > 0 ? (
          <HorizontalBars
            data={finCompareBars}
            seriesName={FIN_KPIS[finKpi].label}
            valueFormat={FIN_KPIS[finKpi].valueFormat}
            axisFormat={FIN_KPIS[finKpi].axisFormat}
          />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            No sourced financials available yet.
          </div>
        )}
      </Card>

      <Card
        title="AUM & market position"
        subtitleNode={
          <div className="space-y-0.5">
            <p className="text-xs text-muted-foreground">
              Listed AMCs ranked on the selected AUM / market KPI.
            </p>
            <p className="text-[11px] text-muted-foreground/80">
              {`${aumCompareBars.length} listed AMC${aumCompareBars.length === 1 ? "" : "s"}${data ? ` · ${data.fiscalLabel}` : ""} · Source: AMFI Fundwise AAUM`}
            </p>
          </div>
        }
      >
        <div className="mb-3">
          <LensToggle
            basePath={basePath}
            paramName="aumKpi"
            defaultValue={AUM_KPI_DEFAULT}
            lenses={aumLenses}
            active={aumKpi}
            wrap
            preserveParams={{
              ...preserveParams,
              finKpi: finKpi === FIN_KPI_DEFAULT ? undefined : finKpi,
            }}
          />
        </div>
        {aumCompareBars.length > 0 ? (
          <HorizontalBars
            data={aumCompareBars}
            seriesName={AUM_KPIS[aumKpi].label}
            valueFormat={AUM_KPIS[aumKpi].valueFormat}
            axisFormat={AUM_KPIS[aumKpi].axisFormat}
          />
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            No AAUM data available.
          </div>
        )}
      </Card>
    </>
  );
}
