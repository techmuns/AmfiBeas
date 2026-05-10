import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { FilterBar } from "@/components/filters/FilterBar";
import type { AmcStatus } from "@/components/filters/FilterBar";
import { QuarterPicker } from "@/components/filters/QuarterPicker";
import { GroupedBars } from "@/components/charts/GroupedBars";
import { MultiLine } from "@/components/charts/MultiLine";
import { cn } from "@/lib/cn";
import {
  SOURCED_FINANCIALS_SLUGS,
  fixedQuarterWindow,
  latestQuarter,
  qoqChange,
  quarterlyForAmc,
  yoyChangeQuarterly,
} from "@/data/aggregate";
import { aaumProvenance, amcAaumQuarterlySnapshot, amcQuarterlySnapshot } from "@/data/source";
import { AMCS, getAMC } from "@/data/amcs";
import {
  formatCompactCrSafe,
  formatDelta,
  formatQuarterLabelLong,
} from "@/lib/format";
import { liveScreenerNote, liveYieldNote } from "@/lib/provenance";
import { parseFilters } from "@/lib/filter";

const DEFAULT_SLUG = "hdfc";

function buildAmcStatus(): Record<string, AmcStatus> {
  const out: Record<string, AmcStatus> = {};
  for (const a of AMCS) {
    if (SOURCED_FINANCIALS_SLUGS.has(a.slug)) out[a.slug] = "live";
    else if (a.listed) out[a.slug] = "pending";
    else out[a.slug] = "unavailable";
  }
  return out;
}

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const status = buildAmcStatus();

  // Single-select: pick the first sourced AMC from the URL, else fall back to
  // hdfc. Unlisted / pending slugs in the URL are ignored.
  const requested = filters.amcs.find((s) => status[s] === "live");
  const slug = requested ?? DEFAULT_SLUG;
  const profile = getAMC(slug);

  const fullSeries = quarterlyForAmc(slug);

  // Period picker. KPI cards use this quarter; defaults to the most
  // recent available quarter for the selected AMC. Unrecognised values in
  // the URL are silently ignored. ICICI Pru's pre-listing gaps are simply
  // absent from `availableQuarters` — selector shows real-only quarters.
  const availableQuarters = fullSeries.map((q) => q.quarter);
  const requestedPeriod =
    typeof sp.period === "string" ? sp.period : undefined;
  const selectedPeriod =
    requestedPeriod && availableQuarters.includes(requestedPeriod)
      ? requestedPeriod
      : availableQuarters[availableQuarters.length - 1];
  const latest =
    fullSeries.find((q) => q.quarter === selectedPeriod) ??
    fullSeries[fullSeries.length - 1];

  // Fixed-window chart axis. All three chart groups (Revenue/Op/PAT bars,
  // Margin Trend, Yields) share the same x-axis: the latest 8 calendar
  // quarters in the overall snapshot, regardless of which AMC is selected.
  //
  // Rollover behaviour: `fixedQuarterWindow(latestQuarter(), 8)` derives
  // the window from snapshot data. When ingest lands 2026-Q2, latestQuarter
  // returns it and the window slides to 2024-Q3…2026-Q2 automatically.
  //
  // Per-AMC data is mapped onto the fixed window below — AMCs with gaps
  // (e.g. ICICI Pru) render nulls at missing positions so the gaps are
  // visible rather than silently shrinking the axis. Old snapshot rows
  // outside the visible window remain preserved by mergeBySlugQuarter.
  const CHART_HISTORY_WINDOW_QUARTERS = 8;

  const aaumMeta = amcAaumQuarterlySnapshot.meta;
  const yieldsSubtitle =
    amcAaumQuarterlySnapshot.rows.length > 0
      ? `bps of MF QAAUM · quarterly P&L ×4 / same-quarter AMFI MF QAAUM · ${new Date(aaumMeta.generatedAt).toISOString().slice(0, 10)}`
      : "bps of MF QAAUM · quarterly P&L ×4 / same-quarter AMFI MF QAAUM";

  const trend = (n: number) =>
    n > 0.05 ? "up" : n < -0.05 ? "down" : ("flat" as const);

  // No data → render empty state. Reaches this branch only if the default
  // slug somehow has no rows (defensive — hdfc is always sourced today).
  if (!latest || !profile) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Financials"
          subtitle="Single-AMC view · sourced quarterly P&L"
        />
        <FilterBar
          showRange={false}
          amcMode="single"
          amcStatus={status}
          defaultSlug={DEFAULT_SLUG}
        />
        <Card
          title="Financials unavailable"
          subtitle="No sourced quarterly P&L for the selected AMC."
        >
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            —
          </div>
        </Card>
      </div>
    );
  }

  // YoY / QoQ deltas computed against the selected period (not always the
  // latest), so picking an older quarter shows the right historic delta.
  const selectedIdx = fullSeries.findIndex((q) => q.quarter === selectedPeriod);
  const seriesUpToSelected = fullSeries.slice(0, selectedIdx + 1);
  const revenueYoy = yoyChangeQuarterly(seriesUpToSelected.map((q) => q.revenue));
  const opYoy = yoyChangeQuarterly(seriesUpToSelected.map((q) => q.operatingProfit));
  const patYoy = yoyChangeQuarterly(seriesUpToSelected.map((q) => q.pat));
  const patMargin = (latest.pat / latest.revenue) * 100;
  const opMargin = (latest.operatingProfit / latest.revenue) * 100;
  // Management-comparable "bps of AAUM": quarterly P&L × 4 / AAUM × 10,000.
  // Mirrors the disclosure on listed AMC investor decks.
  const revenueYieldBps = latest.avgAum
    ? (latest.revenue * 4 * 10_000) / latest.avgAum
    : 0;
  const opYieldBps = latest.avgAum
    ? (latest.operatingProfit * 4 * 10_000) / latest.avgAum
    : 0;
  const profitYieldBps = latest.avgAum
    ? (latest.pat * 4 * 10_000) / latest.avgAum
    : 0;

  // PAT-margin QoQ also tracks the selected period (compares to the
  // immediately-prior available quarter, which may not be calendar-
  // contiguous for ICICI given its post-listing gaps).
  const prevQuarterRow =
    selectedIdx > 0 ? fullSeries[selectedIdx - 1] : null;
  const prevPatMargin =
    prevQuarterRow && prevQuarterRow.revenue > 0
      ? (prevQuarterRow.pat / prevQuarterRow.revenue) * 100
      : patMargin;
  const patMarginQoq = qoqChange([prevPatMargin, patMargin]);

  // FIXED 2-year x-axis: every chart on /financials uses the same 8 most
  // recent calendar quarters in the overall snapshot, regardless of the
  // selected AMC's data coverage. AMCs with gaps (e.g. ICICI Pru's
  // pre-listing 2024-Q2…Q3 + post-listing missing 2025-Q2) render nulls
  // at those positions so the missing quarters are visible as gaps
  // rather than silently absent. When `latestQuarter()` rolls forward
  // (e.g. 2026-Q2 lands), `fixedWindow` slides automatically.
  const fixedWindow = fixedQuarterWindow(
    latestQuarter(),
    CHART_HISTORY_WINDOW_QUARTERS
  );
  const seriesByQuarter = new Map(fullSeries.map((q) => [q.quarter, q]));

  const pnlData = fixedWindow.map((quarter) => {
    const r = seriesByQuarter.get(quarter);
    return {
      quarter,
      revenue: r ? r.revenue : null,
      op: r ? r.operatingProfit : null,
      pat: r ? r.pat : null,
    };
  });
  const marginData = fixedWindow.map((quarter) => {
    const r = seriesByQuarter.get(quarter);
    if (!r || r.revenue === 0) {
      return { quarter, patMargin: null, opMargin: null };
    }
    return {
      quarter,
      patMargin: Number(((r.pat / r.revenue) * 100).toFixed(2)),
      opMargin: Number(((r.operatingProfit / r.revenue) * 100).toFixed(2)),
    };
  });
  // null (not 0) for quarters where the AMC has no row OR where AAUM is
  // missing — Recharts renders a gap rather than a misleading line drop.
  const yieldData = fixedWindow.map((quarter) => {
    const r = seriesByQuarter.get(quarter);
    const hasAaum =
      r !== undefined &&
      aaumProvenance(slug, quarter)?.status === "ok" &&
      r.avgAum > 0;
    return {
      quarter,
      revenue: hasAaum
        ? Number(((r.revenue * 4 * 10_000) / r.avgAum).toFixed(1))
        : null,
      op: hasAaum
        ? Number(((r.operatingProfit * 4 * 10_000) / r.avgAum).toFixed(1))
        : null,
      profit: hasAaum
        ? Number(((r.pat * 4 * 10_000) / r.avgAum).toFixed(1))
        : null,
    };
  });

  // ---- Peer comparison rows (PR #96): same quarter, all 5 sourced AMCs ----
  // Same metrics the KPI cards show for the focused AMC, but laid out as a
  // compact table so the reader sees how the focused AMC stacks up against
  // the listed peers in one glance. Drives off the SAME data the KPI cards
  // and charts use (`liveQuarterlyBySlug` via `quarterlyForAmc`) so peer
  // numbers cannot drift from the per-AMC numbers above. Missing rows
  // (e.g. ICICI Pru pre-listing quarters) render "—" rather than fake data.
  interface PeerRow {
    amcSlug: string;
    name: string;
    ticker: string | null;
    isFocused: boolean;
    avgAum: number | null;
    revenue: number | null;
    operatingProfit: number | null;
    pat: number | null;
    patMargin: number | null;
    opMargin: number | null;
    revenueYieldBps: number | null;
    opYieldBps: number | null;
    profitYieldBps: number | null;
    derivedFrom: string | null;
  }
  const peerRows: PeerRow[] = Array.from(SOURCED_FINANCIALS_SLUGS).map(
    (peerSlug) => {
      const peerProfile = getAMC(peerSlug);
      const series = quarterlyForAmc(peerSlug);
      const row = series.find((q) => q.quarter === selectedPeriod);
      const aaumOk =
        row &&
        aaumProvenance(peerSlug, selectedPeriod)?.status === "ok" &&
        row.avgAum > 0;
      const yieldFor = (numerator: number) =>
        aaumOk && row ? Number(((numerator * 4 * 10_000) / row.avgAum).toFixed(1)) : null;
      return {
        amcSlug: peerSlug,
        name: peerProfile?.name ?? peerSlug,
        ticker: peerProfile?.ticker ?? null,
        isFocused: peerSlug === slug,
        avgAum: row && aaumOk ? row.avgAum : null,
        revenue: row ? row.revenue : null,
        operatingProfit: row ? row.operatingProfit : null,
        pat: row ? row.pat : null,
        patMargin:
          row && row.revenue > 0
            ? Number(((row.pat / row.revenue) * 100).toFixed(1))
            : null,
        opMargin:
          row && row.revenue > 0
            ? Number(((row.operatingProfit / row.revenue) * 100).toFixed(1))
            : null,
        revenueYieldBps: row ? yieldFor(row.revenue) : null,
        opYieldBps: row ? yieldFor(row.operatingProfit) : null,
        profitYieldBps: row ? yieldFor(row.pat) : null,
        derivedFrom: row?.derivedFrom ?? null,
      };
    }
  );
  // Order peers by AAUM descending for the selected quarter; rows with no
  // AAUM go to the bottom. Stable on AMC name within ties.
  peerRows.sort((a, b) => {
    const aHas = a.avgAum !== null;
    const bHas = b.avgAum !== null;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    if (aHas && bHas && a.avgAum !== b.avgAum)
      return (b.avgAum ?? 0) - (a.avgAum ?? 0);
    return a.name.localeCompare(b.name);
  });

  const subtitle = `${profile.name}${profile.ticker ? ` (${profile.ticker})` : ""} · ${formatQuarterLabelLong(latest.quarter)}`;

  // Compact source / provenance line. Hostname only — keeps the line tight
  // while making the source unambiguous (screener.in for P&L, AMFI for AAUM).
  const pnlSourceHost = (() => {
    try {
      return new URL(amcQuarterlySnapshot.meta.source).hostname.replace(
        /^www\./,
        ""
      );
    } catch {
      return amcQuarterlySnapshot.meta.source;
    }
  })();
  const pnlSourceDate = new Date(amcQuarterlySnapshot.meta.generatedAt)
    .toISOString()
    .slice(0, 10);
  const aaumSourceDate = new Date(amcAaumQuarterlySnapshot.meta.generatedAt)
    .toISOString()
    .slice(0, 10);
  const provenanceLine = `P&L: ${pnlSourceHost} · ${pnlSourceDate} · MF QAAUM: AMFI · ${aaumSourceDate}`;
  // When the selected period is a derived row (e.g. icici-pru 2025-Q2),
  // swap the provenance note so it's clear this value isn't a direct
  // scrape. Truncate the long derivation note to the headline sentence
  // for the KPI caption.
  const derivedHeadline = latest.derivedFrom
    ? latest.derivedFrom.split(".")[0].trim() + "."
    : null;
  const pnlNote = derivedHeadline
    ? `Source: derived · ${derivedHeadline}`
    : liveScreenerNote();
  const yieldNote = derivedHeadline
    ? `P&L: derived · ${derivedHeadline} · MF QAAUM: AMFI · ${aaumSourceDate}`
    : liveYieldNote();

  return (
    <div className="space-y-6">
      <PageHeader title="Financials" subtitle={subtitle} />
      <FilterBar
        showRange={false}
        amcMode="single"
        amcStatus={status}
        defaultSlug={DEFAULT_SLUG}
      />
      <p className="-mt-2 text-[11px] tabular text-muted-foreground">
        {provenanceLine}
      </p>

      <QuarterPicker
        availableQuarters={availableQuarters}
        selectedQuarter={selectedPeriod}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Revenue from Operations"
          value={formatCompactCrSafe(latest.revenue)}
          delta={`${formatDelta(revenueYoy)} YoY`}
          trend={trend(revenueYoy)}
          note={pnlNote}
        />
        <KpiCard
          label="Operating Profit"
          value={formatCompactCrSafe(latest.operatingProfit)}
          delta={`${formatDelta(opYoy)} YoY`}
          trend={trend(opYoy)}
          note={pnlNote}
        />
        <KpiCard
          label="PAT"
          value={formatCompactCrSafe(latest.pat)}
          delta={`${formatDelta(patYoy)} YoY`}
          trend={trend(patYoy)}
          note={pnlNote}
        />
        <KpiCard
          label="PAT Margin"
          value={patMargin.toFixed(1) + "%"}
          delta={`${formatDelta(patMarginQoq)} QoQ`}
          trend={trend(patMarginQoq)}
          note={pnlNote}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Operating Margin (% of revenue)"
          value={opMargin.toFixed(1) + "%"}
          note={pnlNote}
        />
        <KpiCard
          label="Revenue Realization (bps of MF QAAUM)"
          value={
            latest.avgAum > 0 ? revenueYieldBps.toFixed(1) + " bps" : "—"
          }
          note={yieldNote}
        />
        <KpiCard
          label="Operating Margin (bps of MF QAAUM)"
          value={latest.avgAum > 0 ? opYieldBps.toFixed(1) + " bps" : "—"}
          note={yieldNote}
        />
        <KpiCard
          label="Profit Yield (bps of MF QAAUM)"
          value={
            latest.avgAum > 0 ? profitYieldBps.toFixed(1) + " bps" : "—"
          }
          note={yieldNote}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Revenue / Op Profit / PAT"
          subtitle="Quarterly · ₹ Cr · Revenue = Revenue from Operations (excludes Other Income)"
        >
          <GroupedBars
            data={pnlData}
            xKey="quarter"
            bars={[
              { key: "revenue", name: "Revenue from Ops", color: "hsl(var(--chart-1))" },
              { key: "op", name: "Op Profit", color: "hsl(var(--chart-2))" },
              { key: "pat", name: "PAT", color: "hsl(var(--chart-3))" },
            ]}
          />
        </Card>
        <Card title="Margin Trend" subtitle="PAT & Operating margin · %">
          <MultiLine
            data={marginData}
            xKey="quarter"
            valueFormat="pct"
            axisFormat="pct"
            lines={[
              { key: "patMargin", name: "PAT margin", color: "hsl(var(--chart-3))" },
              { key: "opMargin", name: "Operating margin", color: "hsl(var(--chart-2))" },
            ]}
          />
        </Card>
        <Card
          title="Yields (bps of MF QAAUM)"
          subtitle={yieldsSubtitle}
          className="lg:col-span-2"
        >
          <MultiLine
            data={yieldData}
            xKey="quarter"
            valueFormat="bps"
            axisFormat="bps"
            lines={[
              { key: "revenue", name: "Revenue realization", color: "hsl(var(--chart-1))" },
              { key: "op", name: "Operating yield", color: "hsl(var(--chart-2))" },
              { key: "profit", name: "Profit yield", color: "hsl(var(--chart-3))" },
            ]}
          />
        </Card>
      </section>

      <Card
        title="Listed-AMC Peer Comparison"
        subtitle={`${peerRows.length} listed AMCs · ${formatQuarterLabelLong(selectedPeriod)} · P&L: screener.in${peerRows.some((p) => p.derivedFrom) ? " / derived where applicable" : ""} · AAUM: AMFI Fundwise AAUM`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3 font-medium">AMC</th>
                <th className="py-2 pr-3 text-right font-medium tabular">AAUM</th>
                <th className="py-2 pr-3 text-right font-medium tabular">Revenue</th>
                <th className="py-2 pr-3 text-right font-medium tabular">Op Profit</th>
                <th className="py-2 pr-3 text-right font-medium tabular">PAT</th>
                <th className="py-2 pr-3 text-right font-medium tabular">PAT %</th>
                <th className="py-2 pr-3 text-right font-medium tabular">Op %</th>
                <th className="py-2 pr-3 text-right font-medium tabular">Rev Yield</th>
                <th className="py-2 pr-3 text-right font-medium tabular">Op Yield</th>
                <th className="py-2 pr-1 text-right font-medium tabular">Profit Yield</th>
              </tr>
            </thead>
            <tbody>
              {peerRows.map((p) => (
                <tr
                  key={p.amcSlug}
                  className={cn(
                    "border-b last:border-0",
                    p.isFocused && "bg-accent/40"
                  )}
                >
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          p.isFocused ? "font-semibold" : "font-medium"
                        )}
                      >
                        {p.name}
                      </span>
                      {p.ticker && (
                        <span className="text-xs text-muted-foreground">
                          {p.ticker}
                        </span>
                      )}
                      {p.derivedFrom && (
                        <span
                          className="inline-flex items-center rounded-full border bg-muted px-1.5 py-0.5 text-[10px] tabular text-muted-foreground"
                          title={p.derivedFrom}
                        >
                          derived
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                    {formatCompactCrSafe(p.avgAum)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                    {formatCompactCrSafe(p.revenue)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                    {formatCompactCrSafe(p.operatingProfit)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                    {formatCompactCrSafe(p.pat)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                    {p.patMargin !== null ? `${p.patMargin.toFixed(1)}%` : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                    {p.opMargin !== null ? `${p.opMargin.toFixed(1)}%` : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                    {p.revenueYieldBps !== null
                      ? `${p.revenueYieldBps.toFixed(1)} bps`
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular text-muted-foreground">
                    {p.opYieldBps !== null
                      ? `${p.opYieldBps.toFixed(1)} bps`
                      : "—"}
                  </td>
                  <td className="py-2 pr-1 text-right tabular text-muted-foreground">
                    {p.profitYieldBps !== null
                      ? `${p.profitYieldBps.toFixed(1)} bps`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] tabular text-muted-foreground">
          Sorted by AAUM descending. Highlighted row matches the AMC selected
          above. Yields = quarterly P&L × 4 / same-quarter AMFI MF QAAUM ×
          10,000. AAUM column shows AMFI Fundwise AAUM (₹ Cr); &quot;—&quot;
          marks quarters with missing AAUM or P&L source data.
        </p>
      </Card>
    </div>
  );
}
