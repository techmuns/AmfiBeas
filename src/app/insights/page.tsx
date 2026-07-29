import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import { SectorZoom } from "@/components/data/SectorZoom";
import type { CsvColumn } from "@/lib/csv";
import { cn } from "@/lib/cn";
import {
  sipLongTerm,
  equityAumLongTerm,
  nfoCycleInsight,
  categoryStreaks,
  streakBreaks,
  topOwnershipMoves,
  sectorRotation,
  holdingsInsights,
  fmtINR,
  fmtPct1,
  fmtX,
  fmtBps,
  monthLong,
} from "@/data/insights";
import { fmtBps as fmtBpsFromPp } from "@/lib/units";
import { shortenCompany } from "@/lib/stock-name";
import {
  insightsPlus,
  TIER_LABEL,
  type CapTier,
  type LedgerQuadrant,
} from "@/data/insights-plus";

// Static: every insight is computed at build time from the bundled snapshots,
// so the Worker serves a prerendered page (no per-request CPU; Error 1102).
export const dynamic = "force-static";

export const metadata = {
  title: "Insights — AmfiBeas",
};

/** One insight block: a bold "so what" headline, the supporting numbers, and
 *  a source line. The whole tab is built from these. */
function Insight({
  kicker,
  headline,
  support,
  source,
}: {
  kicker: string;
  headline: React.ReactNode;
  support?: React.ReactNode;
  source: string;
}) {
  return (
    <div className="rounded-lg border bg-card px-5 py-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {kicker}
      </div>
      <p className="mt-1.5 text-[15px] font-medium leading-snug text-foreground">
        {headline}
      </p>
      {support && (
        <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">
          {support}
        </p>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground/70">{source}</p>
    </div>
  );
}

const pos = "text-positive font-medium";
const neg = "text-negative font-medium";

const TIERS: CapTier[] = ["large", "mid", "small"];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** One quadrant of the conviction ledger: headline ₹ + breadth, the Large/Mid/
 *  Small split, and the names that drove it. `tone` colours the buy vs sell side. */
function QuadrantCard({
  label,
  blurb,
  quad,
  tone,
}: {
  label: string;
  blurb: string;
  quad: LedgerQuadrant;
  tone: "buy" | "sell";
}) {
  const toneCls = tone === "buy" ? "text-positive" : "text-negative";
  const sign = tone === "buy" ? "+" : "−";
  return (
    <div className="rounded-lg border bg-card px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold tracking-tight">{label}</span>
        <span className={cn("shrink-0 text-[15px] font-semibold tabular", toneCls)}>
          {sign}₹{fmtINR(quad.totalCr)} Cr
        </span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{blurb}</p>
      <p className="mt-2 text-[12px] text-foreground">
        <span className="font-semibold tabular">{quad.companies}</span>{" "}
        <span className="text-muted-foreground">companies ·</span>{" "}
        <span className="font-semibold tabular">{quad.positions}</span>{" "}
        <span className="text-muted-foreground">fund-house positions</span>
      </p>
      <table className="mt-2 w-full border-collapse text-[11px]">
        <tbody>
          {TIERS.map((t) => {
            const cell = quad.byTier[t];
            return (
              <tr key={t} className="border-t">
                <td className="py-1 pr-2 text-muted-foreground">{TIER_LABEL[t]}</td>
                <td className={cn("py-1 text-right tabular", cell.valueCr > 0 && toneCls)}>
                  ₹{fmtINR(cell.valueCr)} Cr
                </td>
                <td className="py-1 pl-2 text-right tabular text-muted-foreground">
                  {cell.companies} cos
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {quad.top.length > 0 && (
        <div className="mt-2 border-t pt-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/80">
            Biggest names
          </p>
          <ul className="mt-1 space-y-0.5">
            {quad.top.slice(0, 4).map((n) => (
              <li
                key={n.company}
                className="flex items-baseline justify-between gap-2 text-[11px]"
              >
                <span className="truncate">
                  {shortenCompany(n.company)}
                  {n.amcs.length > 0 && (
                    <span className="ml-1.5 text-muted-foreground/70">
                      {n.amcs.slice(0, 2).join(", ")}
                    </span>
                  )}
                </span>
                <span className={cn("shrink-0 tabular", toneCls)}>
                  ₹{fmtINR(n.valueCr)} Cr
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function InsightsPage() {
  const sip = sipLongTerm();
  const eqAum = equityAumLongTerm();
  const nfo = nfoCycleInsight();
  const streaks = categoryStreaks(3);
  const breaks = streakBreaks(4);
  const moves = topOwnershipMoves(6);
  const rotation = sectorRotation();
  const sectorGainers = rotation.rows.filter((r) => r.direction === "up");
  const sectorLosers = rotation.rows.filter((r) => r.direction === "down");
  const { uniques, amcShare, meta } = holdingsInsights;

  const shareGainers = amcShare.rows.filter((r) => (r.momBps ?? 0) > 0).slice(0, 3);
  const shareLosers = [...amcShare.rows]
    .filter((r) => (r.momBps ?? 0) < 0)
    .sort((a, b) => (a.momBps ?? 0) - (b.momBps ?? 0))
    .slice(0, 3);

  // ---- Excel exports for the three tables ----------------------------------
  type StreakX = Record<string, string | number>;
  const streakColumns: CsvColumn<StreakX>[] = [
    { key: "category", header: "Category" },
    { key: "streak", header: "Consecutive positive months" },
    { key: "cumulative", header: "Cumulative net inflow (₹ Cr)" },
    { key: "latest", header: "Latest month inflow (₹ Cr)" },
  ];
  const streakRows: StreakX[] = streaks.map((s) => ({
    category: s.category,
    streak: s.cappedByHistory ? `${s.streakMonths}+` : s.streakMonths,
    cumulative: Math.round(s.cumulativeCr),
    latest: Math.round(s.latestInflowCr),
  }));

  type ShareX = Record<string, string | number>;
  const shareColumns: CsvColumn<ShareX>[] = [
    { key: "amc", header: "Fund house" },
    { key: "share", header: "Share of tracked equity book (%)" },
    { key: "mom", header: "MoM (bps)" },
    { key: "book", header: "Equity book (₹ Cr)" },
  ];
  const shareRows: ShareX[] = amcShare.rows.map((r) => ({
    amc: r.amc,
    share: Number(r.latestSharePct.toFixed(1)),
    mom: r.momBps ?? "",
    book: r.latestBookCr,
  }));

  type UniqueX = Record<string, string | number>;
  const uniqueColumns: CsvColumn<UniqueX>[] = [
    { key: "company", header: "Company" },
    { key: "fundHouse", header: "Only holder" },
    { key: "valueCr", header: "Position (₹ Cr)" },
    { key: "newThisMonth", header: "New this month" },
  ];
  const uniqueRows: UniqueX[] = uniques.rows.map((u) => ({
    company: u.company,
    fundHouse: u.fundHouse,
    valueCr: u.valueCr,
    newThisMonth: u.newThisMonth ? "Yes" : "No",
  }));

  // ---- Deep-read blocks (precomputed in build-insights-plus.ts) -------------
  const { convictionLedger: ledger, contested, churn, flowsVsPerf, persistence } =
    insightsPlus;
  const q = ledger.quadrants;

  type LedgerX = Record<string, string | number>;
  const ledgerColumns: CsvColumn<LedgerX>[] = [
    { key: "action", header: "Action" },
    { key: "tier", header: "Cap tier" },
    { key: "valueCr", header: "Value (₹ Cr)" },
    { key: "companies", header: "Companies" },
    { key: "positions", header: "Fund-house positions" },
  ];
  const LEDGER_ACTIONS: { key: keyof typeof q; label: string }[] = [
    { key: "new", label: "New position" },
    { key: "increased", label: "Added to" },
    { key: "decreased", label: "Trimmed" },
    { key: "exited", label: "Exited fully" },
  ];
  const ledgerRows: LedgerX[] = LEDGER_ACTIONS.flatMap((a) => [
    {
      action: a.label,
      tier: "All",
      valueCr: q[a.key].totalCr,
      companies: q[a.key].companies,
      positions: q[a.key].positions,
    },
    ...TIERS.map((t) => ({
      action: a.label,
      tier: TIER_LABEL[t],
      valueCr: q[a.key].byTier[t].valueCr,
      companies: q[a.key].byTier[t].companies,
      positions: q[a.key].byTier[t].positions,
    })),
  ]);

  type ContestedX = Record<string, string | number>;
  const contestedColumns: CsvColumn<ContestedX>[] = [
    { key: "company", header: "Company" },
    { key: "tier", header: "Cap tier" },
    { key: "buyers", header: "Fund houses buying" },
    { key: "sellers", header: "Fund houses selling" },
    { key: "buyCr", header: "Bought (₹ Cr)" },
    { key: "sellCr", header: "Sold (₹ Cr)" },
    { key: "netCr", header: "Net (₹ Cr, + bought)" },
    { key: "topBuyer", header: "Largest buyer" },
    { key: "topSeller", header: "Largest seller" },
  ];
  const contestedXRows: ContestedX[] = contested.rows.map((r) => ({
    company: r.company,
    tier: TIER_LABEL[r.tier],
    buyers: r.buyers,
    sellers: r.sellers,
    buyCr: r.buyCr,
    sellCr: r.sellCr,
    netCr: r.netCr,
    topBuyer: r.topBuyer,
    topSeller: r.topSeller,
  }));

  type ChurnX = Record<string, string | number>;
  const churnColumns: CsvColumn<ChurnX>[] = [
    { key: "amc", header: "Fund house" },
    { key: "turnoverPct", header: "Monthly turnover (%)" },
    { key: "buyCr", header: "Bought (₹ Cr)" },
    { key: "sellCr", header: "Sold (₹ Cr)" },
    { key: "bookCr", header: "Equity book (₹ Cr)" },
    { key: "holdings", header: "Holdings" },
    { key: "schemes", header: "Schemes" },
  ];
  const churnXRows: ChurnX[] = churn.rows.map((r) => ({
    amc: r.amc,
    turnoverPct: r.turnoverPct,
    buyCr: r.buyCr,
    sellCr: r.sellCr,
    bookCr: r.bookCr,
    holdings: r.holdings,
    schemes: r.schemes,
  }));
  const churnTop = churn.rows.slice(0, 6);
  const churnBottom = [...churn.rows].slice(-6).reverse();

  const FLOW_QUADRANTS: {
    key: keyof typeof flowsVsPerf.quadrants;
    label: string;
    blurb: string;
    tone: "good" | "bad" | "warn" | "neutral";
  }[] = [
    {
      key: "winning",
      label: "Winning on merit",
      blurb: "Top-half performance, gathering assets faster than the median fund.",
      tone: "good",
    },
    {
      key: "coasting",
      label: "Coasting on brand",
      blurb: "Bottom-half performance, yet still gathering faster than the median.",
      tone: "warn",
    },
    {
      key: "undiscovered",
      label: "Undiscovered",
      blurb: "Top-half performance the money hasn’t found yet.",
      tone: "neutral",
    },
    {
      key: "falling",
      label: "Falling behind",
      blurb: "Bottom-half performance and gathering slower than the median.",
      tone: "bad",
    },
  ];
  type FlowX = Record<string, string | number>;
  const flowColumns: CsvColumn<FlowX>[] = [
    { key: "quadrant", header: "Quadrant" },
    { key: "fund", header: "Scheme" },
    { key: "amc", header: "Fund house" },
    { key: "classification", header: "Category" },
    { key: "percentile", header: `${flowsVsPerf.period} percentile in category` },
    { key: "perfReturn", header: `${flowsVsPerf.period} return (%)` },
    { key: "bookGrowthPct", header: "Book growth (%)" },
    { key: "navReturnPct", header: "NAV return (%)" },
    { key: "impliedFlowPct", header: "Implied net flow (%)" },
    { key: "bookCr", header: "Book (₹ Cr)" },
  ];
  const flowXRows: FlowX[] = FLOW_QUADRANTS.flatMap((qd) =>
    flowsVsPerf.quadrants[qd.key].rows.map((r) => ({
      quadrant: qd.label,
      fund: r.fund,
      amc: r.amc,
      classification: r.classification,
      percentile: r.percentile,
      perfReturn: r.perfReturn ?? "",
      bookGrowthPct: r.bookGrowthPct,
      navReturnPct: r.navReturnPct,
      impliedFlowPct: r.impliedFlowPct,
      bookCr: r.bookCr,
    }))
  );

  type PersistX = Record<string, string | number>;
  const persistColumns: CsvColumn<PersistX>[] = [
    { key: "prior", header: "Quartile in prior 3 years" },
    { key: "q1", header: "→ Q1 now" },
    { key: "q2", header: "→ Q2 now" },
    { key: "q3", header: "→ Q3 now" },
    { key: "q4", header: "→ Q4 now" },
    { key: "total", header: "Funds" },
  ];
  const persistXRows: PersistX[] = persistence.matrix.map((row, i) => ({
    prior: `Q${i + 1}`,
    q1: row[0],
    q2: row[1],
    q3: row[2],
    q4: row[3],
    total: persistence.rowTotals[i],
  }));
  const isoMonth = (iso: string) => {
    const d = new Date(iso + "T00:00:00Z");
    return `${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Insights"
        subtitle="The “so what” layer — signals, correlations and patterns read out of every dataset on this dashboard."
      />

      {/* ---- 1. Long-term structural trends -------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-tight">
          Long-term structural trends
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {sip && (
            <Insight
              kicker="SIP flows · 10-year view"
              headline={
                <>
                  Monthly SIP inflows have{" "}
                  <span className={pos}>
                    doubled — ₹{fmtINR(sip.doubledSinceValue ?? 0)} Cr to ₹
                    {fmtINR(sip.latestValue)} Cr
                  </span>{" "}
                  — in {sip.doubledInMonths} months (
                  {monthLong(sip.doubledSinceMonth ?? "")} →{" "}
                  {monthLong(sip.latestMonth)}).
                </>
              }
              support={
                <>
                  Over the full decade the series is up {fmtX(sip.multiple)}: ₹
                  {fmtINR(sip.firstValue)} Cr in {monthLong(sip.firstMonth)} to ₹
                  {fmtINR(sip.latestValue)} Cr today. This is the structural,
                  market-cycle-resistant bid under Indian equities.
                </>
              }
              source="Source: AMFI Monthly Report, SIP contribution series since 2016."
            />
          )}
          {eqAum && (
            <Insight
              kicker="Equity AUM · 7-year view"
              headline={
                <>
                  Industry equity AUM is{" "}
                  <span className={pos}>{fmtX(eqAum.multiple)} in 7 years</span>{" "}
                  — ₹{fmtINR(eqAum.firstValue)} Cr to ₹{fmtINR(eqAum.latestValue)}{" "}
                  Cr — and doubled in just {eqAum.doubledInMonths} months.
                </>
              }
              support={
                <>
                  The doubling since {monthLong(eqAum.doubledSinceMonth ?? "")} is
                  flows plus markets compounding together; the AUM-change
                  attribution on the Quarterly page splits the two.
                </>
              }
              source="Source: AMFI Monthly Report, equity AUM series since 2019."
            />
          )}
        </div>
      </section>

      {/* ---- 2. Cycle correlations ------------------------------------------ */}
      {nfo && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium tracking-tight">
            Cycle correlations
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <Insight
              kicker="NFO launches × market cycle"
              headline={
                <>
                  NFO mobilisation runs{" "}
                  <span className={pos}>{fmtX(nfo.multiple)} hotter in bull
                  phases</span>{" "}
                  — ₹{fmtINR(nfo.bullAvg)} Cr/month in Expansion/Peak vs ₹
                  {fmtINR(nfo.stressAvg)} Cr in Correction/Base months.
                </>
              }
              support={
                <>
                  AMCs launch products when sentiment pays. A burst of NFOs is a
                  late-cycle tell; a drought marks washed-out sentiment. The last
                  3 months averaged{" "}
                  <span className={nfo.latest3mAvg < nfo.stressAvg ? neg : pos}>
                    ₹{fmtINR(nfo.latest3mAvg)} Cr
                  </span>{" "}
                  — below even the stress-phase norm — while the cycle model reads{" "}
                  “{nfo.latestPhase}”.
                </>
              }
              source={`Source: AMFI NFO mobilisation (${monthLong(nfo.firstMonth)} → ${monthLong(nfo.lastMonth)}) joined with the dashboard's cycle-phase model (active-equity flow z-score + Nifty 500 drawdown), ${nfo.bullMonths} bull / ${nfo.stressMonths} stress months.`}
            />
            {moves.divergenceNote && (
              <Insight
                kicker="₹ value vs ownership — read the right lens"
                headline={<>{moves.divergenceNote}</>}
                support={
                  <>
                    Rupee rankings are skewed by company size and price moves.
                    The ownership table below ranks the same month by % of
                    shares outstanding actually traded — the conviction lens.
                  </>
                }
                source={`Source: aggregated scheme holdings, ${moves.month}; shares outstanding from screener.in.`}
              />
            )}
          </div>
        </section>
      )}

      {/* ---- 3. Flow streaks -------------------------------------------------*/}
      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-tight">
          Consecutive-flow streaks
        </h2>
        <Card
          title="Categories with unbroken positive-flow runs"
          action={
            <DownloadXlsxButton
              rows={streakRows}
              columns={streakColumns}
              filename="category-flow-streaks.xlsx"
              sheetName="Flow Streaks"
            />
          }
        >
          <p className="mb-3 text-[13px] leading-snug text-muted-foreground">
            {streaks.filter((s) => s.streakMonths >= 24).length} active-equity
            categories have taken in net money for{" "}
            <span className="font-medium text-foreground">
              at least 24 consecutive months — 8+ straight quarters
            </span>{" "}
            — the persistence pattern that historically precedes strong basket
            performance. Sectoral/Thematic leads with ₹
            {fmtINR(streaks[0]?.cumulativeCr ?? 0)} Cr accumulated over its run.
          </p>
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted/60 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Consecutive positive months
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Cumulative net inflow (₹ Cr)
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Latest month (₹ Cr)
                  </th>
                </tr>
              </thead>
              <tbody>
                {streaks.map((s) => (
                  <tr key={s.category} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{s.category}</td>
                    <td className="px-3 py-2 text-right tabular">
                      {s.streakMonths}
                      {s.cappedByHistory ? "+" : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular">
                      {fmtINR(s.cumulativeCr)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular",
                        s.latestInflowCr >= 0 ? "text-positive" : "text-negative"
                      )}
                    >
                      {fmtINR(s.latestInflowCr)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {breaks.length > 0 && (
            <p className="mt-3 text-[13px] text-negative">
              Streaks broken this month:{" "}
              {breaks
                .map(
                  (b) =>
                    `${b.category} (ended a ${b.priorStreakMonths}-month run with ₹${fmtINR(b.latestInflowCr)} Cr)`
                )
                .join("; ")}
              .
            </p>
          )}
          <p className="mt-3 text-[10px] text-muted-foreground/70">
            “24+” means the run spans the full stored history and may be longer.
            Source: AMFI Monthly Report category net inflows.
          </p>
        </Card>
      </section>

      {/* ---- 4. Fund-house share shifts -------------------------------------*/}
      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-tight">
          Fund-house share shifts
        </h2>
        <Card
          title={`Active-equity book share — month-over-month movers (${amcShare.months[0] ?? ""})`}
          action={
            <DownloadXlsxButton
              rows={shareRows}
              columns={shareColumns}
              filename="fund-house-share-shifts.xlsx"
              sheetName="Share Shifts"
            />
          }
        >
          <p className="mb-3 text-[13px] leading-snug text-muted-foreground">
            Who is actually winning equity assets this month:{" "}
            {shareGainers.map((r, i) => (
              <span key={r.amc}>
                {i > 0 && ", "}
                <span className="font-medium text-foreground">{r.amc}</span>{" "}
                <span className={pos}>{fmtBps(r.momBps ?? 0)}</span>
              </span>
            ))}
            {" gained share, while "}
            {shareLosers.map((r, i) => (
              <span key={r.amc}>
                {i > 0 && ", "}
                <span className="font-medium text-foreground">{r.amc}</span>{" "}
                <span className={neg}>{fmtBps(r.momBps ?? 0)}</span>
              </span>
            ))}
            {" gave it up."}
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {[
              { label: "Top gainers", rows: shareGainers, tone: pos },
              { label: "Top losers", rows: shareLosers, tone: neg },
            ].map((g) => (
              <div key={g.label} className="overflow-x-auto rounded-md border bg-card">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-muted/60 text-xs text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">{g.label}</th>
                      <th className="px-3 py-2 text-right font-medium">Share</th>
                      <th className="px-3 py-2 text-right font-medium">MoM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.amc} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium">{r.amc}</td>
                        <td className="px-3 py-2 text-right tabular">
                          {fmtPct1(r.latestSharePct)}
                        </td>
                        <td className={cn("px-3 py-2 text-right tabular", g.tone)}>
                          {fmtBps(r.momBps ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground/70">
            Share of the tracked equity-holdings universe ({meta.universeSchemes}{" "}
            schemes rolled up by fund house), {amcShare.months[1] ?? ""} →{" "}
            {amcShare.months[0] ?? ""}. Source: aggregated scheme holdings.
          </p>
        </Card>
      </section>

      {/* ---- 4b. Conviction ledger ------------------------------------------*/}
      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-tight">Conviction ledger</h2>
        <Card
          title={`Every position change, split four ways (${ledger.monthCur})`}
          action={
            <DownloadXlsxButton
              rows={ledgerRows}
              columns={ledgerColumns}
              filename="conviction-ledger.xlsx"
              sheetName="Conviction Ledger"
            />
          }
        >
          <p className="mb-3 text-[13px] leading-snug text-muted-foreground">
            Net buying hides the two moves that actually carry conviction. Opening
            a brand-new position and exiting one completely are decisions; topping
            up an existing holding is housekeeping. Across{" "}
            <span className="font-medium text-foreground">{ledger.funds}</span>{" "}
            active-equity schemes from{" "}
            <span className="font-medium text-foreground">{ledger.amcs}</span>{" "}
            fund houses, MFs opened{" "}
            <span className={pos}>{q.new.companies}</span> new names worth{" "}
            <span className={pos}>₹{fmtINR(q.new.totalCr)} Cr</span> and walked away
            from <span className={neg}>{q.exited.companies}</span> entirely
            (₹{fmtINR(q.exited.totalCr)} Cr).
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <QuadrantCard
              label="New positions"
              blurb="Nothing held last month — a fresh idea."
              quad={q.new}
              tone="buy"
            />
            <QuadrantCard
              label="Added to"
              blurb="Existing holding increased."
              quad={q.increased}
              tone="buy"
            />
            <QuadrantCard
              label="Trimmed"
              blurb="Existing holding reduced, not closed."
              quad={q.decreased}
              tone="sell"
            />
            <QuadrantCard
              label="Exited fully"
              blurb="Position closed to zero — a verdict."
              quad={q.exited}
              tone="sell"
            />
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground/70">
            One “position” = one fund house in one stock; a company can appear on
            both sides when houses moved in opposite directions, so the quadrants
            are not netted off. Value = shares moved × the month’s implied trade
            price. Split/bonus corporate actions excluded; positions under ₹1 Cr
            ignored. {ledger.monthPrev} → {ledger.monthCur}. Source: AMC monthly
            portfolio disclosures.
          </p>
        </Card>
      </section>

      {/* ---- 4c. Contested stocks -------------------------------------------*/}
      {contested.rows.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium tracking-tight">
            Where fund houses disagree
          </h2>
          <Card
            title={`Most contested stocks — bought and sold in the same month (${contested.month})`}
            action={
              <DownloadXlsxButton
                rows={contestedXRows}
                columns={contestedColumns}
                filename="contested-stocks.xlsx"
                sheetName="Contested Stocks"
              />
            }
          >
            <p className="mb-3 text-[13px] leading-snug text-muted-foreground">
              A consensus trade tells you what is already priced in. These are the
              names where professional managers looked at the same disclosure and
              reached opposite conclusions — the most genuinely two-sided being{" "}
              <span className="font-medium text-foreground">
                {shortenCompany(contested.rows[0].company)}
              </span>
              , with {contested.rows[0].buyers} fund houses buying while{" "}
              {contested.rows[0].sellers} sold.
            </p>
            <div className="overflow-x-auto rounded-md border bg-card">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Company</th>
                    <th className="px-3 py-2 text-center font-medium">Buying</th>
                    <th className="px-3 py-2 text-center font-medium">Selling</th>
                    <th className="px-3 py-2 text-right font-medium">Bought</th>
                    <th className="px-3 py-2 text-right font-medium">Sold</th>
                    <th className="px-3 py-2 text-left font-medium">
                      Largest buyer vs seller
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {contested.rows.map((r) => (
                    <tr key={r.company} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">
                        {shortenCompany(r.company)}
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          {TIER_LABEL[r.tier]}
                        </span>
                      </td>
                      <td className={cn("px-3 py-2 text-center tabular", pos)}>
                        {r.buyers}
                      </td>
                      <td className={cn("px-3 py-2 text-center tabular", neg)}>
                        {r.sellers}
                      </td>
                      <td className={cn("px-3 py-2 text-right tabular", pos)}>
                        {fmtINR(r.buyCr)}
                      </td>
                      <td className={cn("px-3 py-2 text-right tabular", neg)}>
                        {fmtINR(r.sellCr)}
                      </td>
                      <td className="px-3 py-2 text-[12px] text-muted-foreground">
                        <span className="text-positive">{r.topBuyer}</span>
                        {" vs "}
                        <span className="text-negative">{r.topSeller}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground/70">
              Requires at least 2 fund houses on each side and ₹50 Cr of gross
              two-way activity; ranked by how evenly the houses split, then by
              gross value. ₹ Cr. Source: AMC monthly portfolio disclosures.
            </p>
          </Card>
        </section>
      )}

      {/* ---- 4d. Churn league ------------------------------------------------*/}
      {churn.rows.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium tracking-tight">
            Portfolio churn — who actually trades
          </h2>
          <Card
            title={`Monthly portfolio turnover by fund house (${churn.month})`}
            action={
              <DownloadXlsxButton
                rows={churnXRows}
                columns={churnColumns}
                filename="portfolio-churn.xlsx"
                sheetName="Portfolio Churn"
              />
            }
          >
            <p className="mb-3 text-[13px] leading-snug text-muted-foreground">
              Nearly every fund house describes itself as long-term. This is the
              measurable version: the share of the equity book genuinely rotated in
              a month. The median house turned over{" "}
              <span className="font-medium text-foreground">
                {churn.medianTurnoverPct}%
              </span>
              , but the range runs from{" "}
              <span className={neg}>{churn.rows[0].turnoverPct}%</span> (
              {churn.rows[0].amc}) down to{" "}
              <span className={pos}>
                {churn.rows[churn.rows.length - 1].turnoverPct}%
              </span>{" "}
              ({churn.rows[churn.rows.length - 1].amc}) — a difference in
              philosophy, not in market conditions.
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              {[
                { title: "Most active", rows: churnTop, tone: neg },
                { title: "Most patient", rows: churnBottom, tone: pos },
              ].map((grp) => (
                <div key={grp.title} className="overflow-hidden rounded-md border bg-card">
                  <div className="border-b bg-muted/60 px-3 py-2 text-xs font-medium text-muted-foreground">
                    {grp.title}
                  </div>
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="text-[11px] text-muted-foreground">
                        <th className="px-3 py-1.5 text-left font-medium">
                          Fund house
                        </th>
                        <th className="px-3 py-1.5 text-right font-medium">
                          Turnover
                        </th>
                        <th className="px-3 py-1.5 text-right font-medium">
                          Book (₹ Cr)
                        </th>
                        <th className="px-3 py-1.5 text-right font-medium">
                          Holdings
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {grp.rows.map((r) => (
                        <tr key={r.amc} className="border-t">
                          <td className="px-3 py-2 font-medium">{r.amc}</td>
                          <td className={cn("px-3 py-2 text-right tabular", grp.tone)}>
                            {r.turnoverPct.toFixed(2)}%
                          </td>
                          <td className="px-3 py-2 text-right tabular text-muted-foreground">
                            {fmtINR(r.bookCr)}
                          </td>
                          <td className="px-3 py-2 text-right tabular text-muted-foreground">
                            {r.holdings}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground/70">
              Turnover = min(buys, sells) ÷ average equity book for the month — the
              portion of the portfolio genuinely rotated, so pure inflow-driven
              buying doesn’t inflate it. Fund houses with a book under ₹
              {fmtINR(churn.minBookCr)} Cr excluded. {churn.monthPrev} →{" "}
              {churn.month}. Source: AMC monthly portfolio disclosures.
            </p>
          </Card>
        </section>
      )}

      {/* ---- 5. Unique conviction bets --------------------------------------*/}
      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-tight">
          Unique conviction bets
        </h2>
        <Card
          title={`Stocks held by exactly one fund house (${meta.monthCur})`}
          action={
            <DownloadXlsxButton
              rows={uniqueRows}
              columns={uniqueColumns}
              filename="unique-holdings.xlsx"
              sheetName="Unique Holdings"
            />
          }
        >
          <p className="mb-3 text-[13px] leading-snug text-muted-foreground">
            {uniques.total} companies in the tracked universe are owned by a{" "}
            <span className="font-medium text-foreground">
              single fund house
            </span>{" "}
            ({uniques.newThisMonth} positions opened this month) — the clearest
            statement of differentiated conviction, since no peer holds them.
          </p>
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted/60 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Company</th>
                  <th className="px-3 py-2 text-left font-medium">Only holder</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Position (₹ Cr)
                  </th>
                </tr>
              </thead>
              <tbody>
                {uniques.rows.map((u) => (
                  <tr key={u.company} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">
                      {shortenCompany(u.company)}
                      {u.newThisMonth && (
                        <span className="ml-2 rounded-full border border-positive/40 bg-positive/10 px-1.5 py-0 text-[10px] uppercase tracking-wide text-positive">
                          New
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{u.fundHouse}</td>
                    <td className="px-3 py-2 text-right tabular">
                      {u.valueCr.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground/70">
            Positions ≥ ₹25 Cr only; “New” = no shares held in {meta.monthPrev}.
            Source: aggregated scheme holdings grouped by fund house.
          </p>
        </Card>
      </section>

      {/* ---- 6. Sector rotation (active-equity AUM-share shifts) ------------*/}
      {rotation.rows.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium tracking-tight">Sector rotation</h2>
          <Insight
            kicker={`Sector allocation shifts · ${rotation.monthPrev} → ${rotation.month}`}
            headline={
              <>
                This month MFs raised their equity allocation most in{" "}
                {sectorGainers.map((r, i) => (
                  <span key={r.sector}>
                    {i > 0 && " and "}
                    <span className={pos}>{r.sector}</span> (
                    {fmtBpsFromPp(r.changePp)})
                  </span>
                ))}
                {sectorGainers.length > 0 && sectorLosers.length > 0 && ", and cut it most in "}
                {sectorLosers.map((r, i) => (
                  <span key={r.sector}>
                    {i > 0 && " and "}
                    <span className={neg}>{r.sector}</span> ({fmtBpsFromPp(r.changePp)})
                  </span>
                ))}
                .
              </>
            }
            support="Each sector's share of total active-equity MF holdings value, latest vs prior month — the 2 biggest share gainers and 2 biggest losers. This is size-normalised (a large sector only surfaces when its share actually moves) and robust to fincode changes. The names driving each move are below."
            source={`Source: aggregated active-equity scheme holdings, ${rotation.monthPrev} → ${rotation.month}; sector map (Capitaline/RupeeVest taxonomy).`}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            {rotation.rows.map((r) => {
              const up = r.direction === "up";
              return (
                <Card
                  key={r.sector}
                  title={`${r.sector} — AUM share ${fmtBpsFromPp(r.changePp)} (${rotation.month})`}
                  action={
                    <SectorZoom
                      sector={r.sector}
                      direction={r.direction}
                      month={rotation.month}
                      schemes={r.schemes ?? []}
                      stocks={r.stocks}
                    />
                  }
                >
                  <p className="mb-3 min-h-[2.5rem] text-[13px] leading-snug text-muted-foreground">
                    {r.sector}&rsquo;s share of active-equity MF AUM{" "}
                    {up ? "rose" : "fell"} from{" "}
                    <span className="font-medium text-foreground">
                      {r.pctPrev.toFixed(2)}%
                    </span>{" "}
                    to{" "}
                    <span className={cn("font-medium", up ? pos : neg)}>
                      {r.pctCur.toFixed(2)}%
                    </span>
                    . MFs {up ? "added the most" : "trimmed the most"}:
                  </p>
                  <div className="overflow-x-auto rounded-md border bg-card">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="bg-muted/60 text-xs text-muted-foreground">
                          <th className="px-3 py-2 text-left font-medium">Company</th>
                          <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                            Net ₹ Cr
                          </th>
                          <th className="px-3 py-2 text-left font-medium">
                            {up ? "Lead buyers" : "Lead sellers"}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.stocks.length === 0 ? (
                          <tr>
                            <td
                              colSpan={3}
                              className="px-3 py-3 text-center text-muted-foreground"
                            >
                              Share moved on price; no notable net {up ? "buys" : "sells"}.
                            </td>
                          </tr>
                        ) : (
                          r.stocks.map((s) => (
                            <tr key={s.company} className="border-b last:border-0">
                              <td className="h-11 px-3 align-middle font-medium">
                                <span className="line-clamp-2">
                                  {shortenCompany(s.company)}
                                </span>
                              </td>
                              <td
                                className={cn(
                                  "h-11 whitespace-nowrap px-3 text-right align-middle tabular",
                                  up ? "text-positive" : "text-negative"
                                )}
                              >
                                {fmtINR(s.netCr)}
                              </td>
                              <td className="h-11 px-3 align-middle text-muted-foreground">
                                <span className="line-clamp-2">{s.amcs.join(", ")}</span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* ---- 7. Ownership moves ----------------------------------------------*/}
      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-tight">
          Biggest ownership moves
        </h2>
        <Card title={`MF stake changes as % of shares outstanding (${moves.month})`}>
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted/60 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Company</th>
                  <th className="px-3 py-2 text-left font-medium">Sector</th>
                  <th className="px-3 py-2 text-right font-medium">
                    % of shares outstanding
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Net ₹ Cr</th>
                  <th className="px-3 py-2 text-left font-medium">Lead AMCs</th>
                </tr>
              </thead>
              <tbody>
                {moves.rows.map((r) => (
                  <tr key={r.company} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{shortenCompany(r.company)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.sector}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular font-medium",
                        r.pctOutstanding >= 0 ? "text-positive" : "text-negative"
                      )}
                    >
                      {fmtPct1(r.pctOutstanding)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular",
                        r.netCr >= 0 ? "text-positive" : "text-negative"
                      )}
                    >
                      {fmtINR(r.netCr)}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.amcs.join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground/70">
            Ranked by the absolute share of the company traded, not ₹ value —
            immune to price-move distortion. Negatives in brackets. Source:
            aggregated scheme holdings; shares outstanding from screener.in.
          </p>
        </Card>
      </section>

      {/* ---- 8. Do flows reward performance? --------------------------------*/}
      {flowsVsPerf.universe > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium tracking-tight">
            Does money reward performance?
          </h2>
          <Card
            title={`${flowsVsPerf.period} performance vs asset gathering (${flowsVsPerf.windowLabel})`}
            action={
              <DownloadXlsxButton
                rows={flowXRows}
                columns={flowColumns}
                filename="flows-vs-performance.xlsx"
                sheetName="Flows vs Performance"
              />
            }
          >
            <p className="mb-3 text-[13px] leading-snug text-muted-foreground">
              Investors are supposed to follow returns. Plotting each scheme’s{" "}
              {flowsVsPerf.period} rank inside its own category against how fast it
              gathered assets says otherwise:{" "}
              <span className="font-medium text-foreground">
                {flowsVsPerf.quadrants.coasting.count}
              </span>{" "}
              of {flowsVsPerf.universe} schemes sit in the bottom half of their
              category and are <em>still</em> growing faster than the median fund,
              while{" "}
              <span className="font-medium text-foreground">
                {flowsVsPerf.quadrants.undiscovered.count}
              </span>{" "}
              beat their peers and are growing slower.
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              {FLOW_QUADRANTS.map((qd) => {
                const bucket = flowsVsPerf.quadrants[qd.key];
                const border =
                  qd.tone === "good"
                    ? "border-positive/40"
                    : qd.tone === "bad"
                      ? "border-negative/40"
                      : qd.tone === "warn"
                        ? "border-amber-500/40"
                        : "border-border";
                return (
                  <div
                    key={qd.key}
                    className={cn("rounded-lg border bg-card px-4 py-3.5", border)}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-semibold tracking-tight">
                        {qd.label}
                      </span>
                      <span className="shrink-0 text-[13px] font-semibold tabular text-muted-foreground">
                        {bucket.count} schemes
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {qd.blurb}
                    </p>
                    {bucket.rows.length > 0 && (
                      <table className="mt-2 w-full border-collapse text-[11px]">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground/80">
                            <th className="py-1 text-left font-medium">Scheme</th>
                            <th className="py-1 text-right font-medium">Pctile</th>
                            <th className="py-1 pl-2 text-right font-medium">
                              Flow
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {bucket.rows.slice(0, 5).map((r) => (
                            <tr key={r.fund} className="border-t">
                              <td className="max-w-[220px] truncate py-1 pr-2">
                                {r.fund}
                              </td>
                              <td className="py-1 text-right tabular">
                                {r.percentile.toFixed(0)}
                              </td>
                              <td
                                className={cn(
                                  "py-1 pl-2 text-right tabular",
                                  r.impliedFlowPct >= flowsVsPerf.medianFlowPct
                                    ? "text-positive"
                                    : "text-negative"
                                )}
                              >
                                {r.impliedFlowPct > 0 ? "+" : ""}
                                {r.impliedFlowPct.toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[10px] leading-snug text-muted-foreground/70">
              Percentile = the scheme’s {flowsVsPerf.period} return rank within its
              own category, plan and option cohort (100 = best).{" "}
              <span className="font-medium">Implied net flow</span> = book growth
              less the fund’s own NAV return over the window, so a market rally
              doesn’t read as asset gathering — an estimate, not a disclosed flow.
              Because the book is disclosure-derived, schemes are compared against
              the median fund ({flowsVsPerf.medianFlowPct > 0 ? "+" : ""}
              {flowsVsPerf.medianFlowPct}%) rather than against zero. Source: AMC
              monthly disclosures + AMFI NAV history.
            </p>
          </Card>
        </section>
      )}

      {/* ---- 9. Quartile persistence ----------------------------------------*/}
      {persistence.funds > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium tracking-tight">
            Does past performance persist?
          </h2>
          <Card
            title={`Where the winners went — quartile transitions across two 3-year blocks`}
            action={
              <DownloadXlsxButton
                rows={persistXRows}
                columns={persistColumns}
                filename="quartile-persistence.xlsx"
                sheetName="Quartile Persistence"
              />
            }
          >
            <p className="mb-3 text-[13px] leading-snug text-muted-foreground">
              Of the funds that were <span className="font-medium text-foreground">top
              quartile</span> over {isoMonth(persistence.priorWindow.from)} –{" "}
              {isoMonth(persistence.priorWindow.to)}, only{" "}
              <span className="font-medium text-foreground">
                {persistence.q1StayPct}%
              </span>{" "}
              were still top quartile over the next three years — and{" "}
              <span className={neg}>{persistence.q1ToBottomHalfPct}%</span> fell into
              the bottom half. Pure chance would give 25% and 50%. Past returns, on
              this evidence, carry close to no information about the next three
              years.
            </p>
            <div className="overflow-x-auto rounded-md border bg-card">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">
                      Quartile {isoMonth(persistence.priorWindow.from)} –{" "}
                      {isoMonth(persistence.priorWindow.to)}
                    </th>
                    {[1, 2, 3, 4].map((n) => (
                      <th key={n} className="px-3 py-2 text-right font-medium">
                        → Q{n} now
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-medium">Funds</th>
                  </tr>
                </thead>
                <tbody>
                  {persistence.matrix.map((row, i) => {
                    const total = persistence.rowTotals[i] || 1;
                    return (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium">
                          Q{i + 1}
                          {i === 0 && (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                              best
                            </span>
                          )}
                        </td>
                        {row.map((c, jdx) => {
                          const share = (c / total) * 100;
                          // Tint the diagonal (stayed put) and shade by weight so
                          // the near-uniform spread is visible at a glance.
                          const diag = i === jdx;
                          return (
                            <td
                              key={jdx}
                              className={cn(
                                "px-3 py-2 text-right tabular",
                                diag && "font-semibold"
                              )}
                            >
                              <span
                                className={cn(
                                  "inline-block rounded px-1.5 py-0.5",
                                  share >= 32
                                    ? "bg-accent text-accent-foreground"
                                    : share >= 26
                                      ? "bg-muted"
                                      : ""
                                )}
                              >
                                {share.toFixed(0)}%
                              </span>
                              <span className="ml-1.5 text-[10px] text-muted-foreground/70">
                                {c}
                              </span>
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right tabular text-muted-foreground">
                          {persistence.rowTotals[i]}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {persistence.topStayers.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] font-medium text-foreground">
                  Stayed top quartile in both blocks
                </p>
                <ul className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                  {persistence.topStayers.map((s) => (
                    <li
                      key={s.fund}
                      className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground"
                    >
                      <span className="truncate">{s.fund}</span>
                      <span className={cn("shrink-0 tabular", pos)}>
                        {s.recent.toFixed(1)}% CAGR
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-3 text-[10px] leading-snug text-muted-foreground/70">
              {persistence.funds} actively-managed equity schemes across{" "}
              {persistence.cohorts} categories with a full six years of NAV history.
              Quartiles are assigned <em>within</em> each category (comparing a
              small-cap fund to a large-cap one would just measure the cap cycle),
              using cohorts of at least {persistence.minCohort} funds. The two
              windows are non-overlapping 3-year CAGRs, so the earlier block cannot
              flatter the later one. Source: AMFI NAV history.
            </p>
          </Card>
        </section>
      )}
    </div>
  );
}
