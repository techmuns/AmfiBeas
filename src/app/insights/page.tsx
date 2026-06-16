import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
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
  type SectorFlow,
  holdingsInsights,
  fmtINR,
  fmtPct1,
  fmtX,
  fmtBps,
  monthLong,
} from "@/data/insights";

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

export default function InsightsPage() {
  const sip = sipLongTerm();
  const eqAum = equityAumLongTerm();
  const nfo = nfoCycleInsight();
  const streaks = categoryStreaks(3);
  const breaks = streakBreaks(4);
  const moves = topOwnershipMoves(6);
  const rotation = sectorRotation(5);
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
                      {u.company}
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

      {/* ---- 6. Sector rotation (from the Overview top-20) ------------------*/}
      {(rotation.inflow || rotation.outflow) && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium tracking-tight">Sector rotation</h2>
          <Insight
            kicker={`Where MF money rotated · ${rotation.month}`}
            headline={
              <>
                Across the top names MFs traded this month, money rotated{" "}
                {rotation.inflow && (
                  <>
                    into{" "}
                    <span className={pos}>
                      {rotation.inflow.sector} (+₹{fmtINR(rotation.inflow.netCr)}{" "}
                      Cr net)
                    </span>
                  </>
                )}
                {rotation.inflow && rotation.outflow && " and "}
                {rotation.outflow && (
                  <>
                    out of{" "}
                    <span className={neg}>
                      {rotation.outflow.sector} (−₹
                      {fmtINR(Math.abs(rotation.outflow.netCr))} Cr net)
                    </span>
                  </>
                )}
                .
              </>
            }
            support="Buys minus sells across the Top-20 large/mid/small-cap names on the Overview, bucketed by sector. The leading stocks driving each side are below."
            source={`Source: aggregated scheme holdings, ${rotation.month}; sector map (Capitaline/RupeeVest taxonomy).`}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            {(
              [
                rotation.inflow && { flow: rotation.inflow, kind: "in" as const },
                rotation.outflow && { flow: rotation.outflow, kind: "out" as const },
              ].filter(Boolean) as { flow: SectorFlow; kind: "in" | "out" }[]
            ).map(({ flow, kind }) => (
              <Card
                key={flow.sector}
                title={`${flow.sector} — ${kind === "in" ? "top buys" : "top sells"} (${rotation.month})`}
              >
                <div className="overflow-x-auto rounded-md border bg-card">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-muted/60 text-xs text-muted-foreground">
                        <th className="px-3 py-2 text-left font-medium">Company</th>
                        <th className="px-3 py-2 text-right font-medium">% of o/s</th>
                        <th className="px-3 py-2 text-right font-medium">Net ₹ Cr</th>
                        <th className="px-3 py-2 text-left font-medium">
                          {kind === "in" ? "Lead buyers" : "Lead sellers"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {flow.stocks.map((s) => (
                        <tr key={s.company} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">
                            {s.company}
                            <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                              {s.tier}
                            </span>
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 text-right tabular",
                              kind === "in" ? "text-positive" : "text-negative"
                            )}
                          >
                            {s.pctOutstanding === null ? "—" : fmtPct1(s.pctOutstanding)}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 text-right tabular",
                              kind === "in" ? "text-positive" : "text-negative"
                            )}
                          >
                            {fmtINR(s.netCr)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {s.amcs.join(", ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-[10px] text-muted-foreground/70">
                  Net {kind === "in" ? "buying" : "selling"} in {flow.sector} this
                  month: ₹{fmtINR(Math.abs(flow.netCr))} Cr across the Overview
                  Top-20 names.
                </p>
              </Card>
            ))}
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
                    <td className="px-3 py-2 font-medium">{r.company}</td>
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
    </div>
  );
}
