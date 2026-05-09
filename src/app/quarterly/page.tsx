import { BarSeries } from "@/components/charts/BarSeries";
import { ChartPlaceholder } from "@/components/ui/ChartPlaceholder";
import { Donut } from "@/components/charts/Donut";
import { GroupedBars } from "@/components/charts/GroupedBars";
import { Card } from "@/components/ui/Card";
import { KpiCard } from "@/components/ui/KpiCard";
import { FilterBar } from "@/components/filters/FilterBar";
import { FiscalQuarterPicker } from "@/components/filters/FiscalQuarterPicker";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  availableQuartersDesc,
  formatQuarterlyProvenanceLine,
  formatQuarterlyProvenanceTooltip,
  getQuarterlyKpiProvenance,
  getQuarterlyKpiValue,
  latestIndustryProvenance,
  latestOpenEndedSchemeCount,
  latestQuarterlyCategoryProvenance,
  latestQuarterlyFolioAdditions,
  quarterlyActiveEquityGrossFlowsData,
  quarterlyAumMixForQuarter,
  quarterlyCategoryGrossFlowData,
  quarterlyFolioAdditionsTrend,
  quarterlyGrossFlowsData,
  quarterlyOpenEndedSchemeCountTrend,
  quarterlyTrend,
  resolveSelectedQuarter,
  type AmfiQuarterlyKpiField,
} from "@/data/amfi-quarterly";
import {
  formatCompactCrSafe,
  formatCroreCountSafe,
  formatIntSafe,
  formatLakhSafe,
} from "@/lib/format";
import { cn } from "@/lib/cn";
import type { AmfiMonthlyCategorySlug } from "@/data/snapshots/types";

const GROSS_FLOW_BARS = [
  {
    key: "fundsMobilized",
    name: "Funds mobilized",
    color: "hsl(var(--chart-2))",
  },
  {
    key: "repurchase",
    name: "Repurchase / Redemption",
    color: "hsl(var(--chart-6))",
  },
  { key: "netInflow", name: "Net inflow", color: "hsl(var(--chart-1))" },
];

/** Same four IIFL Figure 31-34 reference categories as /monthly's
 *  CATEGORY_DISPLAY so the quarterly view feels consistent. */
const CATEGORY_FLOW_CARDS: { slug: AmfiMonthlyCategorySlug; label: string }[] = [
  { slug: "flexi-cap", label: "Flexi Cap Fund" },
  { slug: "multi-asset", label: "Multi Asset Allocation Fund" },
  { slug: "sectoral-thematic", label: "Sectoral/Thematic Funds" },
  { slug: "large-cap", label: "Large Cap Fund" },
];

/** Sign-aware compact ₹ Cr formatter — mirrors the equivalent helper
 *  on /monthly so a negative net-inflow on /quarterly renders as
 *  "−₹32.4K Cr" rather than the unsigned "₹32.4K Cr". */
function formatSignedCompactCrSafe(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (v >= 0) return formatCompactCrSafe(v);
  return "−" + formatCompactCrSafe(-v);
}

export default async function QuarterlyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  // Quarter selector — `?quarter=FY26-Q4` resolves to the matching row
  // when valid; otherwise we fall back to the latest available quarter
  // so the page is never blank just because the URL is stale.
  const requestedQuarterRaw = sp.quarter;
  const requestedQuarter =
    typeof requestedQuarterRaw === "string" ? requestedQuarterRaw : undefined;
  const selectedRow = resolveSelectedQuarter(requestedQuarter);
  const availableQuarters = availableQuartersDesc();

  // ---- AMFI Quarterly Snapshot — KPI cards (selected quarter) -------
  // Mirrors /monthly's AMFI Monthly Snapshot. Renders one KPI card
  // per field the SELECTED quarter row carries; absent fields drop
  // out rather than rendering "—". Source line is sourced from each
  // field's own provenance entry so the hover tooltip points at the
  // exact PDF + page + row + column.
  const QUARTERLY_KPI_CARDS: {
    field: AmfiQuarterlyKpiField;
    label: string;
    format: (v: number | null) => string;
  }[] = [
    { field: "grandTotalAum", label: "Total AUM", format: formatCompactCrSafe },
    {
      field: "grandTotalLastMonthAaum",
      label: "Last-month AAUM",
      format: formatCompactCrSafe,
    },
    { field: "equityAum", label: "Equity AUM", format: formatCompactCrSafe },
    { field: "debtAum", label: "Debt AUM", format: formatCompactCrSafe },
    { field: "hybridAum", label: "Hybrid AUM", format: formatCompactCrSafe },
    {
      field: "otherSchemesAum",
      label: "Other Schemes AUM",
      format: formatCompactCrSafe,
    },
    {
      field: "grandTotalNetInflow",
      label: "Net Inflow",
      format: formatSignedCompactCrSafe,
    },
    {
      field: "grandTotalFundsMobilized",
      label: "Funds Mobilized",
      format: formatCompactCrSafe,
    },
    {
      field: "grandTotalRepurchase",
      label: "Repurchase / Redemption",
      format: formatCompactCrSafe,
    },
    {
      field: "grandTotalFolios",
      label: "Folios",
      format: (v: number | null) => formatCroreCountSafe(v),
    },
  ];
  const quarterlyKpiCards = QUARTERLY_KPI_CARDS.flatMap((spec) => {
    const value = getQuarterlyKpiValue(selectedRow, spec.field);
    if (value === null) return [];
    const provenance = getQuarterlyKpiProvenance(selectedRow, spec.field);
    return [
      {
        ...spec,
        value,
        formatted: spec.format(value),
        note: formatQuarterlyProvenanceLine(provenance) ?? "",
        noteHover: formatQuarterlyProvenanceTooltip(provenance) ?? undefined,
      },
    ];
  });

  const snapshotSubtitle = selectedRow
    ? `Industry-wide · live from uploaded AMFI Quarterly Report PDFs · ${selectedRow.quarterLabel}`
    : "Upload AMFI Quarterly PDFs to manual-data/amfi-quarterly/pdfs/, then run npm run ingest:amfi-quarterly-pdf";

  // ---- AUM Mix & Trend (selected quarter for mix; full series for trend) ----
  const { slices: mixSlices, residual: mixResidual } =
    quarterlyAumMixForQuarter(selectedRow);
  const mixHasData = mixSlices.length > 0;
  const mixSubtitle =
    mixHasData && mixResidual !== null
      ? `Quarter-end Net AUM · share of Total AUM · residual = Solution-Oriented + close-ended schemes · ${selectedRow?.quarterLabel ?? ""}`
      : mixHasData
        ? `Quarter-end Net AUM · partial breakdown · residual not computed · ${selectedRow?.quarterLabel ?? ""}`
        : "Quarter-end Net AUM not available for the selected quarter";
  const mixHoverProvenance = formatQuarterlyProvenanceTooltip(
    getQuarterlyKpiProvenance(selectedRow, "grandTotalAum")
  );

  // Last-month AAUM trend across ALL ingested quarters (full series,
  // not bound to the selected-quarter picker — the selector controls
  // the snapshot KPI cards, the trend rolls forward as new PDFs land).
  const aaumTrendData = quarterlyTrend("grandTotalLastMonthAaum", 8);
  const aaumTrendHasData = aaumTrendData.length > 0;
  const aaumTrendSubtitle = aaumTrendHasData
    ? `Last-month AAUM · ${aaumTrendData.length} quarter${aaumTrendData.length === 1 ? "" : "s"} · ₹ Cr`
    : "Last-month AAUM not available";
  const aaumTrendHoverProvenance = formatQuarterlyProvenanceTooltip(
    latestIndustryProvenance("grandTotalLastMonthAaum")
  );

  // ---- Quarterly Gross Flows ----------------------------------------
  // KPI cards reflect the SELECTED quarter so they update with the
  // picker; bar charts span the full history regardless of selection.
  const industryGrossFlows = quarterlyGrossFlowsData();
  const activeEquityGrossFlows = quarterlyActiveEquityGrossFlowsData();
  const hasIndustryGross = industryGrossFlows.some(
    (r) =>
      r.fundsMobilized !== null ||
      r.repurchase !== null ||
      r.netInflow !== null
  );
  const hasActiveEquityGross = activeEquityGrossFlows.some(
    (r) =>
      r.fundsMobilized !== null ||
      r.repurchase !== null ||
      r.netInflow !== null
  );
  const selectedFundsMobilized = selectedRow?.grandTotalFundsMobilized ?? null;
  const selectedRepurchase = selectedRow?.grandTotalRepurchase ?? null;
  const selectedNetInflow = selectedRow?.grandTotalNetInflow ?? null;
  const selectedActiveEquityNetInflow = selectedRow?.activeEquityNetInflow ?? null;
  const grossFlowsSourceLine =
    formatQuarterlyProvenanceLine(
      getQuarterlyKpiProvenance(selectedRow, "grandTotalFundsMobilized")
    ) ?? "Source: AMFI Quarterly Report";
  const fundsHover = formatQuarterlyProvenanceTooltip(
    getQuarterlyKpiProvenance(selectedRow, "grandTotalFundsMobilized")
  );
  const repurchaseHover = formatQuarterlyProvenanceTooltip(
    getQuarterlyKpiProvenance(selectedRow, "grandTotalRepurchase")
  );
  const netInflowHover = formatQuarterlyProvenanceTooltip(
    getQuarterlyKpiProvenance(selectedRow, "grandTotalNetInflow")
  );
  const activeEquityNetInflowHover = formatQuarterlyProvenanceTooltip(
    getQuarterlyKpiProvenance(selectedRow, "activeEquityNetInflow")
  );
  const industryFundsHover = formatQuarterlyProvenanceTooltip(
    latestIndustryProvenance("grandTotalFundsMobilized")
  );
  const activeEquityHover = formatQuarterlyProvenanceTooltip(
    latestIndustryProvenance("equityFundsMobilized")
  );
  const categoryFlowCards = CATEGORY_FLOW_CARDS.map((c) => {
    const data = quarterlyCategoryGrossFlowData(c.slug);
    const hasData = data.some(
      (r) =>
        r.fundsMobilized !== null ||
        r.repurchase !== null ||
        r.netInflow !== null
    );
    const hover = formatQuarterlyProvenanceTooltip(
      latestQuarterlyCategoryProvenance(c.slug, "categoryFundsMobilized")
    );
    return { ...c, data, hasData, hover };
  });
  const hasCategoryGross = categoryFlowCards.some((c) => c.hasData);

  // ---- Folios & Scheme Count ----------------------------------------
  const totalFolios = selectedRow?.grandTotalFolios ?? null;
  const folioAdditions = latestQuarterlyFolioAdditions();
  const openEndedSchemes = latestOpenEndedSchemeCount();
  const foliosTrend = quarterlyTrend("grandTotalFolios", 8);
  const folioAdditionsTrend = quarterlyFolioAdditionsTrend(8);
  const schemesTrend = quarterlyOpenEndedSchemeCountTrend(8);
  const foliosHover = formatQuarterlyProvenanceTooltip(
    getQuarterlyKpiProvenance(selectedRow, "grandTotalFolios")
  );
  const foliosSourceLine =
    formatQuarterlyProvenanceLine(
      getQuarterlyKpiProvenance(selectedRow, "grandTotalFolios")
    ) ?? "Source: AMFI Quarterly Report";
  const hasAnyFolioKpi =
    totalFolios !== null || folioAdditions !== null || openEndedSchemes !== null;
  const hasAnyFolioTrend =
    foliosTrend.length > 0 ||
    folioAdditionsTrend.length > 0 ||
    schemesTrend.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quarterly KPIs"
        subtitle="Quarterly AMFI industry dashboard"
      />
      <FilterBar showRange="quarterly" />

      {/* Data-status legend — same key as /monthly so users can read
          the live vs demo treatments at a glance. */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Data status:</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-positive" />
          Live · sourced data
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm border border-dashed border-muted-foreground/60 bg-muted" />
          Demo · placeholder
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
          Pending · not connected
        </span>
      </div>

      {/* AMFI Quarterly Snapshot — first live section, mirrors
          /monthly's AMFI Monthly Snapshot card. The FiscalQuarterPicker
          sits in the action slot and drives the selected-quarter
          KPI grid below. */}
      <Card
        title="AMFI Quarterly Snapshot"
        subtitle={snapshotSubtitle}
        action={
          <div className="flex flex-col items-end gap-2">
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
                selectedRow
                  ? "border-positive/40 bg-positive/10 text-positive"
                  : "border-border text-muted-foreground"
              )}
            >
              {selectedRow ? "Live" : "Not connected"}
            </span>
            {selectedRow && availableQuarters.length > 0 && (
              <FiscalQuarterPicker
                availableQuarters={availableQuarters}
                selectedQuarterId={selectedRow.quarter}
              />
            )}
          </div>
        }
      >
        {quarterlyKpiCards.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {quarterlyKpiCards.map((c) => (
              <KpiCard
                key={c.field}
                label={c.label}
                value={c.formatted}
                note={c.note}
                noteHover={c.noteHover}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No AMFI quarterly PDF data ingested yet.
          </div>
        )}
      </Card>

      {/* AMFI Quarterly AUM Mix & Trend — Donut bound to the selected
          quarter; bar trend shows the full 8-quarter history. */}
      {selectedRow && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              AMFI Quarterly AUM Mix &amp; Trend
            </h2>
            <p className="text-xs text-muted-foreground">
              Live from uploaded AMFI Quarterly Report PDFs
            </p>
          </div>
          <section className="grid gap-4 lg:grid-cols-2">
            <Card title="Quarter-end AUM Mix" subtitle={mixSubtitle}>
              {mixHasData ? (
                <Donut data={mixSlices} />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Mix unavailable for the selected quarter
                </div>
              )}
              <div
                className="mt-3 text-[10px] tabular text-muted-foreground/80"
                title={mixHoverProvenance ?? undefined}
              >
                Source: AMFI Quarterly Report
              </div>
            </Card>
            <Card
              title="Last-month AAUM Trend"
              subtitle={aaumTrendSubtitle}
            >
              {aaumTrendHasData ? (
                <BarSeries
                  data={aaumTrendData}
                  name="Last-month AAUM"
                  color="hsl(var(--chart-1))"
                  valueFormat="cr"
                  axisFormat="cr"
                  labelFormat="none"
                />
              ) : (
                <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                  Last-month AAUM unavailable
                </div>
              )}
              <div
                className="mt-3 text-[10px] tabular text-muted-foreground/80"
                title={aaumTrendHoverProvenance ?? undefined}
              >
                Source: AMFI Quarterly Report · Average Net AUM column
                is last-month only — not a true quarterly average
              </div>
            </Card>
          </section>
        </div>
      )}

      {/* Quarterly Gross Flows — 4 KPI cards (selected quarter) +
          industry / active-equity / per-category bar charts. */}
      {(hasIndustryGross || hasActiveEquityGross) && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Quarterly Gross Flows
            </h2>
            <p className="text-xs text-muted-foreground">
              Live from uploaded AMFI Quarterly Report PDFs
            </p>
          </div>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Industry Funds Mobilized"
              value={formatCompactCrSafe(selectedFundsMobilized)}
              note={grossFlowsSourceLine}
              noteHover={fundsHover ?? undefined}
            />
            <KpiCard
              label="Industry Repurchase / Redemption"
              value={formatCompactCrSafe(selectedRepurchase)}
              note={grossFlowsSourceLine}
              noteHover={repurchaseHover ?? undefined}
            />
            <KpiCard
              label="Industry Net Inflow"
              value={formatSignedCompactCrSafe(selectedNetInflow)}
              note={grossFlowsSourceLine}
              noteHover={netInflowHover ?? undefined}
            />
            <KpiCard
              label="Active-Equity Net Inflow"
              value={formatSignedCompactCrSafe(selectedActiveEquityNetInflow)}
              note={grossFlowsSourceLine}
              noteHover={activeEquityNetInflowHover ?? undefined}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            {hasIndustryGross && (
              <Card
                title="Industry Gross Flows"
                subtitle={`${industryGrossFlows.length} quarter${industryGrossFlows.length === 1 ? "" : "s"} · ₹ Cr`}
              >
                <GroupedBars
                  data={industryGrossFlows}
                  xKey="quarterLabel"
                  bars={GROSS_FLOW_BARS}
                  labelFormat="none"
                  valueFormat="cr"
                  axisFormat="cr"
                />
                <div
                  className="mt-3 text-[10px] tabular text-muted-foreground/80"
                  title={industryFundsHover ?? undefined}
                >
                  Source: AMFI Quarterly Report
                </div>
              </Card>
            )}

            {hasActiveEquityGross && (
              <Card
                title="Active-Equity Gross Flows"
                subtitle={`${activeEquityGrossFlows.length} quarter${activeEquityGrossFlows.length === 1 ? "" : "s"} · ₹ Cr · Sub II + (Sub III − Arbitrage) + Sub IV`}
              >
                <GroupedBars
                  data={activeEquityGrossFlows}
                  xKey="quarterLabel"
                  bars={GROSS_FLOW_BARS}
                  labelFormat="none"
                  valueFormat="cr"
                  axisFormat="cr"
                />
                <div
                  className="mt-3 text-[10px] tabular text-muted-foreground/80"
                  title={activeEquityHover ?? undefined}
                >
                  Source: AMFI Quarterly Report
                </div>
              </Card>
            )}
          </section>

          {hasCategoryGross && (
            <section className="grid gap-4 lg:grid-cols-2">
              {categoryFlowCards.map((c) => (
                <Card
                  key={c.slug}
                  title={c.label}
                  subtitle={`${c.data.length} quarter${c.data.length === 1 ? "" : "s"} · ₹ Cr`}
                >
                  {c.hasData ? (
                    <GroupedBars
                      data={c.data}
                      xKey="quarterLabel"
                      bars={GROSS_FLOW_BARS}
                      labelFormat="none"
                      valueFormat="cr"
                      axisFormat="cr"
                      height={220}
                    />
                  ) : (
                    <div className="flex h-52 items-center justify-center text-sm text-muted-foreground">
                      Category data unavailable
                    </div>
                  )}
                  <div
                    className="mt-3 text-[10px] tabular text-muted-foreground/80"
                    title={c.hover ?? undefined}
                  >
                    Source: AMFI Quarterly Report
                  </div>
                </Card>
              ))}
            </section>
          )}

          <p className="text-[11px] text-muted-foreground">
            Funds mobilized + repurchase + net inflow are 3-month sums
            from the AMFI Quarterly Report Grand Total / Sub Total
            rows. Active-Equity gross flows sum Sub II, Sub III less
            the Arbitrage Fund row, and Sub IV — the same envelope used
            by IIFL Figure 19-22.
          </p>
        </div>
      )}

      {/* Quarterly Folios & Scheme Count — 3 KPI cards + 3 trend charts. */}
      {(hasAnyFolioKpi || hasAnyFolioTrend) && (
        <div className="space-y-3">
          <div>
            <h2 className="text-sm font-medium tracking-tight">
              Quarterly Folios &amp; Scheme Count
            </h2>
            <p className="text-xs text-muted-foreground">
              Live from uploaded AMFI Quarterly Report PDFs
            </p>
          </div>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <KpiCard
              label="Total Folios"
              value={formatCroreCountSafe(totalFolios)}
              note={foliosSourceLine}
              noteHover={foliosHover ?? undefined}
            />
            <KpiCard
              label="Folio Additions QoQ"
              value={formatLakhSafe(folioAdditions)}
              note={foliosSourceLine}
              noteHover={
                foliosHover
                  ? `${foliosHover} · derived QoQ Δ from grandTotalFolios`
                  : undefined
              }
            />
            <KpiCard
              label="Open-Ended Scheme Count"
              value={formatIntSafe(openEndedSchemes)}
              note="Source: AMFI Quarterly Report"
              noteHover="AMFI Quarterly Report · Sum of categorySchemes across 39 open-ended categories (close-ended + interval excluded)"
            />
          </section>

          {hasAnyFolioTrend && (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Card
                title="Folios Trend"
                subtitle={`Industry-wide · ${foliosTrend.length} quarter${foliosTrend.length === 1 ? "" : "s"} · crore folios`}
              >
                {foliosTrend.length > 0 ? (
                  <BarSeries
                    data={foliosTrend}
                    name="Folios"
                    color="hsl(var(--chart-1))"
                    valueFormat="crore-count"
                    axisFormat="crore-count"
                    labelFormat="none"
                  />
                ) : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    Folios unavailable
                  </div>
                )}
                <div
                  className="mt-3 text-[10px] tabular text-muted-foreground/80"
                  title={foliosHover ?? undefined}
                >
                  Source: AMFI Quarterly Report
                </div>
              </Card>

              <Card
                title="Folio Additions Trend"
                subtitle={`Net new folios per quarter · ${folioAdditionsTrend.length} quarter${folioAdditionsTrend.length === 1 ? "" : "s"} · lakh`}
              >
                {folioAdditionsTrend.length > 0 ? (
                  <BarSeries
                    data={folioAdditionsTrend}
                    name="Folio Additions"
                    color="hsl(var(--chart-4))"
                    valueFormat="lakh"
                    axisFormat="lakh"
                    labelFormat="none"
                  />
                ) : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    Need at least two consecutive quarters of folios
                  </div>
                )}
                <div
                  className="mt-3 text-[10px] tabular text-muted-foreground/80"
                  title={foliosHover ?? undefined}
                >
                  Source: AMFI Quarterly Report · derived QoQ Δ
                </div>
              </Card>

              <Card
                title="Open-Ended Scheme Count Trend"
                subtitle={`Sum across 39 open-ended categories · ${schemesTrend.length} quarter${schemesTrend.length === 1 ? "" : "s"}`}
              >
                {schemesTrend.length > 0 ? (
                  <BarSeries
                    data={schemesTrend}
                    name="Open-Ended Schemes"
                    color="hsl(var(--chart-5))"
                    valueFormat="count"
                    axisFormat="count"
                    labelFormat="none"
                  />
                ) : (
                  <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                    Scheme count unavailable
                  </div>
                )}
                <div
                  className="mt-3 text-[10px] tabular text-muted-foreground/80"
                  title="AMFI Quarterly Report · Sum of categorySchemes across 39 open-ended categories"
                >
                  Source: AMFI Quarterly Report · derived from categorySchemes
                </div>
              </Card>
            </section>
          )}
        </div>
      )}

      {/* IIFL Active-Equity Category Trends — PENDING placeholder.
          The original live version aggregated AMFI Monthly Reports for
          true QAAUM share. Per the source-discipline rule for
          /quarterly, we do NOT render that live here. The card below
          documents the gap so the surface stays in the page outline
          and a future quarterly-AAUM source can light it up. */}
      <Card
        tone="pending"
        title="IIFL Active-Equity Category Trends"
        subtitle="Requires a true quarterly QAAUM source · currently not sourced from AMFI Quarterly Report"
      >
        <div className="flex h-32 items-center justify-center text-center text-xs text-muted-foreground">
          The AMFI Quarterly Report&rsquo;s &ldquo;Average Net AUM&rdquo;
          column is last-month AAUM only, not a true 3-month period
          average — so QAAUM share cannot be computed without monthly
          aggregation. This card will light up when a quarterly QAAUM
          source is wired in.
        </div>
      </Card>

      {/* Demo · SIP KPIs — sourced from AMFI Monthly Notes on /monthly,
          and the AMFI Quarterly Report does not carry SIP fields.
          Kept here as pending placeholders so the page outline stays
          consistent with /monthly. */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          tone="pending"
          label="SIP Contribution"
          value="—"
          note="Pending · AMFI Quarterly Report has no SIP rows"
        />
        <KpiCard
          tone="pending"
          label="SIP AUM"
          value="—"
          note="Pending · AMFI Quarterly Report has no SIP rows"
        />
        <KpiCard
          tone="pending"
          label="SIP Accounts"
          value="—"
          note="Pending · AMFI Quarterly Report has no SIP rows"
        />
        <KpiCard
          tone="pending"
          label="SIP Share"
          value="—"
          note="Pending · peer share requires per-AMC quarterly SIP data"
        />
      </section>

      {/* Demo · per-AMC market-share + scheme outperformance + top
          quartile widgets. /monthly has live monthly aggregations for
          these; the quarterly versions need per-AMC quarterly fields
          we don't yet ingest, so they sit as pending placeholders. */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card
          tone="pending"
          title="AUM Market Share"
          subtitle="Pending · per-AMC quarterly AUM share"
        >
          <ChartPlaceholder height={240} />
        </Card>
        <Card
          tone="pending"
          title="SIP Market Share"
          subtitle="Pending · per-AMC quarterly SIP share"
        >
          <ChartPlaceholder height={240} />
        </Card>
        <Card
          tone="pending"
          title="Active Equity Market Share"
          subtitle="Pending · per-AMC quarterly active-equity share"
          className="lg:col-span-2"
        >
          <ChartPlaceholder height={240} />
        </Card>
        <Card
          tone="pending"
          title="Scheme Outperformance"
          subtitle="Pending · AMC × quarter · % over benchmark"
          className="lg:col-span-2"
        >
          <ChartPlaceholder height={240} />
        </Card>
        <Card
          tone="pending"
          title="Top Quartile %"
          subtitle="Pending · share of AMC funds ranked Q1 · latest quarter"
          className="lg:col-span-2"
        >
          <ChartPlaceholder height={120} />
        </Card>
      </section>
    </div>
  );
}
