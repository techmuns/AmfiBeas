"use client";

/**
 * Active Fund Performance — the "who's beating their peers" tab.
 *
 * This is the interactive, live counterpart to the manual Excel a category
 * analyst would otherwise maintain by hand: pick an actively-managed category
 * (Flexi Cap, Small Cap, ELSS …), a plan (Regular vs Direct) and a horizon
 * (1Y / 3Y / 5Y), and read out every scheme's return, its quartile inside its
 * own cohort, and how the big listed AMCs stack up — with a one-click Excel
 * export of exactly what's on screen.
 *
 * Data is LIVE: it fetches /api/returns-ranking (backed by the daily NAV
 * snapshot), so the numbers move with each committed refresh. Because
 * ClientTabs mounts only the active tab, the fetch fires only when this tab is
 * opened — no Worker CPU is spent for users who never look at it.
 *
 * NOTE — benchmark-beat: the boss's sheet also flags "beat your fact-sheet
 * benchmark (Nifty 500 TRI …)?". That needs total-return (TRI) index CAGRs,
 * which aren't in the repo yet (only NIFTY 500 price-return, short horizons).
 * The peer-quartile view below is complete and honest today; the TRI
 * benchmark-beat column is deliberately left as a labelled "coming next"
 * placeholder rather than faked from price-return data.
 */

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";
import { cn } from "@/lib/cn";
import { CATEGORY_BENCHMARK, type BenchmarkTriSnapshot } from "@/data/benchmark-tri";

// ---- API response shape (fields=full) --------------------------------------
type Quartile = "Q1" | "Q2" | "Q3" | "Q4";
interface PeriodStats {
  return: number | null;
  rank: number | null;
  peerCount: number | null;
  percentile: number | null;
  quartile: Quartile | null;
  statsAvailable?: boolean;
  categoryAverage?: number | null;
  categoryMedian?: number | null;
  excessVsAverage?: number | null;
  excessVsMedian?: number | null;
}
interface FundRow {
  schemecode: string;
  fundName: string;
  classification: string | null;
  plan: string;
  option: string;
  cohortKey: string;
  returns: Record<string, PeriodStats>;
}
interface ApiResponse {
  asOfDate: string | null;
  generatedAt?: string;
  total: number;
  funds: FundRow[];
}

// ---- Curated actively-managed universe (exact classification strings) ------
// Passives (Index / ETFs / Index Funds) are intentionally excluded — the whole
// point is to judge active management, and an index fund "beating its index" is
// meaningless.
const CATEGORY_GROUPS: { group: string; categories: string[] }[] = [
  {
    group: "Equity",
    categories: [
      "Equity : Flexi Cap",
      "Equity : Large Cap",
      "Equity : Large & Mid Cap",
      "Equity : Mid Cap",
      "Equity : Small Cap",
      "Equity : Multi Cap",
      "Equity : Focused",
      "Equity : Value / Contra",
      "Equity : Tax Saving (ELSS)",
      "Equity : Thematic",
    ],
  },
  {
    group: "Hybrid",
    categories: [
      "Hybrid : Aggressive Hybrid",
      "Hybrid : Dynamic Asset Allocation",
      "Hybrid : Multi Asset Allocation",
      "Hybrid : Equity Savings",
    ],
  },
];

const PERIODS = ["1Y", "3Y", "5Y"] as const;
type Period = (typeof PERIODS)[number];
type Plan = "regular" | "direct";

// ---- The big listed AMCs the desk tracks -----------------------------------
// Matched against the scheme name. Order matters only for display.
const LISTED_AMCS: { label: string; test: RegExp }[] = [
  { label: "HDFC", test: /^HDFC/i },
  { label: "Nippon India", test: /nippon/i },
  { label: "SBI", test: /^SBI/i },
  { label: "ICICI Pru", test: /^ICICI/i },
  { label: "UTI", test: /^UTI/i },
  { label: "Aditya Birla", test: /aditya birla|absl/i },
  { label: "Kotak", test: /^Kotak/i },
  { label: "Axis", test: /^Axis/i },
];
function listedAmcOf(fundName: string): string | null {
  for (const a of LISTED_AMCS) if (a.test.test(fundName)) return a.label;
  return null;
}

// ---- Small presentational helpers ------------------------------------------
const QUARTILE_STYLE: Record<Quartile, string> = {
  Q1: "bg-positive/15 text-positive border-positive/30",
  Q2: "bg-muted text-foreground border-border",
  Q3: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400",
  Q4: "bg-negative/15 text-negative border-negative/30",
};
const QUARTILE_BAR: Record<Quartile, string> = {
  Q1: "bg-positive",
  Q2: "bg-muted-foreground/50",
  Q3: "bg-amber-500",
  Q4: "bg-negative",
};
const QUARTILE_LABEL: Record<Quartile, string> = {
  Q1: "Top quartile",
  Q2: "2nd quartile",
  Q3: "3rd quartile",
  Q4: "Bottom quartile",
};

function prettyCat(c: string): string {
  return c.replace(/^(Equity|Hybrid)\s*:\s*/, "");
}
function fmtPct(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(1)}%` : "—";
}
function fmtSigned(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
}
function catSlug(c: string): string {
  return prettyCat(c).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function QuartileBadge({ q }: { q: Quartile | null }) {
  if (!q) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium",
        QUARTILE_STYLE[q]
      )}
      title={QUARTILE_LABEL[q]}
    >
      {q}
    </span>
  );
}

export function ActiveFundPerformance() {
  const [category, setCategory] = useState<string>("Equity : Flexi Cap");
  const [plan, setPlan] = useState<Plan>("regular");
  const [period, setPeriod] = useState<Period>("3Y");

  // The request identity — refetch whenever category or plan changes. `loading`,
  // `data` and `error` are DERIVED from whether the last resolved result matches
  // the current request key, so the effect never calls setState synchronously
  // (which would trigger cascading renders).
  const reqKey = `${category}|${plan}`;
  const [result, setResult] = useState<{
    key: string;
    data: ApiResponse | null;
    error: string | null;
  }>({ key: "", data: null, error: null });

  useEffect(() => {
    const controller = new AbortController();
    // Option is pinned to growth (IDCW plans double-count the same strategy and
    // distort a peer ranking).
    const url =
      `/api/returns-ranking?classification=${encodeURIComponent(category)}` +
      `&plan=${plan}&option=growth&fields=full&period=1Y,3Y,5Y`;
    fetch(url, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json() as Promise<ApiResponse>;
      })
      .then((json) => setResult({ key: reqKey, data: json, error: null }))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          key: reqKey,
          data: null,
          error: e instanceof Error ? e.message : "Failed to load data",
        });
      });
    return () => controller.abort();
  }, [reqKey, category, plan]);

  const settled = result.key === reqKey;
  const data = settled ? result.data : null;
  const error = settled ? result.error : null;
  const loading = !settled;

  // Benchmark TRI snapshot — category-independent, fetched once. setState only
  // runs inside the async .then, never synchronously in the effect body.
  const [bench, setBench] = useState<BenchmarkTriSnapshot | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/nav-data/benchmark-tri.json", { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<BenchmarkTriSnapshot>) : null))
      .then((j) => setBench(j))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const benchId = CATEGORY_BENCHMARK[category] ?? null;
  const benchIndex = benchId && bench ? bench.indices[benchId] ?? null : null;
  const benchReturn = benchIndex?.periods[period]?.triEstCagrPct ?? null;

  // ---- Derived view (sorted funds, quartile spread, cohort stats) ----------
  const view = useMemo(() => {
    const funds = data?.funds ?? [];
    const withReturn = funds.filter(
      (f) => typeof f.returns[period]?.return === "number"
    );
    withReturn.sort(
      (a, b) => (b.returns[period]!.return ?? 0) - (a.returns[period]!.return ?? 0)
    );

    const counts: Record<Quartile, number> = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
    let ranked = 0;
    for (const f of withReturn) {
      const q = f.returns[period]?.quartile;
      if (q && f.returns[period]?.statsAvailable) {
        counts[q] += 1;
        ranked += 1;
      }
    }

    // Cohort-level stats are identical across every fund in the cohort — read
    // them off the first fund that carries them.
    let median: number | null = null;
    let average: number | null = null;
    for (const f of withReturn) {
      const s = f.returns[period];
      if (s && typeof s.categoryMedian === "number") {
        median = s.categoryMedian;
        average = s.categoryAverage ?? null;
        break;
      }
    }
    const best = withReturn[0]?.returns[period]?.return ?? null;
    const worst = withReturn[withReturn.length - 1]?.returns[period]?.return ?? null;

    // Best-performing scheme per listed AMC, in this category/plan/period.
    const listed = LISTED_AMCS.map((a) => {
      const match = withReturn.find((f) => a.test.test(f.fundName));
      return { label: a.label, fund: match ?? null };
    });

    return { rows: withReturn, counts, ranked, median, average, best, worst, listed };
  }, [data, period]);

  // How many schemes beat their category's benchmark TRI over the horizon.
  const benchBeat = useMemo(() => {
    if (benchReturn == null) return null;
    let beat = 0;
    let n = 0;
    for (const f of view.rows) {
      const r = f.returns[period]?.return;
      if (typeof r === "number") {
        n += 1;
        if (r > benchReturn) beat += 1;
      }
    }
    return { beat, n, pct: n ? Math.round((beat / n) * 100) : 0 };
  }, [view.rows, period, benchReturn]);

  // ---- Excel export (mirrors the on-screen table) --------------------------
  type XRow = Record<string, string | number>;
  const exportRows: XRow[] = useMemo(
    () =>
      view.rows.map((f, i) => {
        const s = f.returns[period];
        return {
          rank: i + 1,
          fund: f.fundName,
          amc: listedAmcOf(f.fundName) ?? "",
          plan: f.plan,
          category: prettyCat(category),
          ret1y: f.returns["1Y"]?.return ?? "",
          ret3y: f.returns["3Y"]?.return ?? "",
          ret5y: f.returns["5Y"]?.return ?? "",
          quartile: s?.statsAvailable ? s.quartile ?? "" : "",
          cohortRank:
            s?.statsAvailable && s.rank && s.peerCount
              ? `${s.rank}/${s.peerCount}`
              : "",
          percentile: s?.statsAvailable && s.percentile != null ? s.percentile : "",
          vsMedian: typeof s?.excessVsMedian === "number" ? s.excessVsMedian : "",
          benchmark: benchIndex?.label ?? "",
          benchReturn: benchReturn ?? "",
          vsBenchmark:
            typeof s?.return === "number" && benchReturn != null
              ? Math.round((s.return - benchReturn) * 10) / 10
              : "",
          beatBenchmark:
            typeof s?.return === "number" && benchReturn != null
              ? s.return > benchReturn
                ? "Yes"
                : "No"
              : "",
        };
      }),
    [view.rows, period, category, benchIndex, benchReturn]
  );
  const exportColumns: CsvColumn<XRow>[] = [
    { key: "rank", header: `Rank (${period})` },
    { key: "fund", header: "Scheme" },
    { key: "amc", header: "Listed AMC" },
    { key: "plan", header: "Plan" },
    { key: "category", header: "Category" },
    { key: "ret1y", header: "1Y Return (%)" },
    { key: "ret3y", header: "3Y CAGR (%)" },
    { key: "ret5y", header: "5Y CAGR (%)" },
    { key: "quartile", header: `${period} Quartile` },
    { key: "cohortRank", header: `${period} Rank in cohort` },
    { key: "percentile", header: `${period} Percentile` },
    { key: "vsMedian", header: `${period} vs category median (pp)` },
    { key: "benchmark", header: "Benchmark (TRI est.)" },
    { key: "benchReturn", header: `Benchmark ${period} TRI est. (%)` },
    { key: "vsBenchmark", header: `${period} vs benchmark (pp)` },
    { key: "beatBenchmark", header: "Beat benchmark?" },
  ];

  const asOf = data?.asOfDate ?? null;

  return (
    <div className="space-y-6">
      {/* ---- Controls -------------------------------------------------------*/}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="afp-category">
            Category
          </label>
          <select
            id="afp-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-md border bg-card px-3 py-1.5 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {CATEGORY_GROUPS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.categories.map((c) => (
                  <option key={c} value={c}>
                    {prettyCat(c)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <Segmented
            options={[
              { id: "regular", label: "Regular" },
              { id: "direct", label: "Direct" },
            ]}
            value={plan}
            onChange={(v) => setPlan(v as Plan)}
          />
          <Segmented
            options={PERIODS.map((p) => ({ id: p, label: p }))}
            value={period}
            onChange={(v) => setPeriod(v as Period)}
          />
        </div>
        <div className="flex items-center gap-2">
          {asOf && (
            <span className="text-[11px] text-muted-foreground">
              Live · NAV as of {asOf}
            </span>
          )}
          <DownloadXlsxButton
            rows={exportRows}
            columns={exportColumns}
            filename={`active-fund-performance-${catSlug(category)}-${plan}.xlsx`}
            sheetName={`${prettyCat(category)} ${plan}`.slice(0, 31)}
            label="Excel"
            size="md"
          />
        </div>
      </div>

      {error && (
        <Card title="Couldn't load performance data">
          <p className="text-sm text-negative">{error}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The live returns API didn&apos;t respond. Try again in a moment or
            switch category.
          </p>
        </Card>
      )}

      {loading && !data ? (
        <SkeletonBlock />
      ) : (
        <>
          {/* ---- Verdict + quartile spread ---------------------------------*/}
          <Card
            title={`${prettyCat(category)} · ${plan === "regular" ? "Regular" : "Direct"} — ${period} scorecard`}
          >
            {view.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No {period} track record for growth schemes in this cohort yet.
                Try a shorter horizon or another category.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat
                    label={`Top quartile (${period})`}
                    value={`${view.counts.Q1}`}
                    sub={`of ${view.ranked} ranked`}
                    tone="pos"
                  />
                  <Stat
                    label="Category median"
                    value={fmtPct(view.median)}
                    sub={`avg ${fmtPct(view.average)}`}
                  />
                  <Stat label="Best in category" value={fmtPct(view.best)} tone="pos" />
                  <Stat label="Weakest in category" value={fmtPct(view.worst)} tone="neg" />
                </div>

                {/* Quartile distribution — the at-a-glance spread */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Quartile spread ({view.ranked} ranked schemes)</span>
                    <span>Best ← → Worst</span>
                  </div>
                  <div className="flex h-7 w-full overflow-hidden rounded-md border">
                    {(["Q1", "Q2", "Q3", "Q4"] as Quartile[]).map((q) =>
                      view.counts[q] > 0 ? (
                        <div
                          key={q}
                          className={cn(
                            "flex items-center justify-center text-[11px] font-medium text-background",
                            QUARTILE_BAR[q]
                          )}
                          style={{
                            width: `${(view.counts[q] / Math.max(view.ranked, 1)) * 100}%`,
                          }}
                          title={`${QUARTILE_LABEL[q]}: ${view.counts[q]} schemes`}
                        >
                          {view.counts[q]}
                        </div>
                      ) : null
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                    {(["Q1", "Q2", "Q3", "Q4"] as Quartile[]).map((q) => (
                      <span key={q} className="inline-flex items-center gap-1.5">
                        <span className={cn("h-2.5 w-2.5 rounded-sm", QUARTILE_BAR[q])} />
                        {q} · {QUARTILE_LABEL[q]}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Benchmark verdict — active vs the category's index (TRI est.) */}
                {benchIndex && benchReturn != null && benchBeat ? (
                  <div className="rounded-lg border bg-card px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <div className="text-[13px]">
                        <span className="text-muted-foreground">Benchmark</span>{" "}
                        <span className="font-semibold">{benchIndex.label}</span>
                        <span className="text-muted-foreground"> · {period} </span>
                        <span className="font-semibold tabular">{benchReturn.toFixed(1)}%</span>
                        <span className="text-muted-foreground"> (est.)</span>
                      </div>
                      <div className="text-[13px]">
                        <span
                          className={cn(
                            "text-[18px] font-semibold tabular",
                            benchBeat.pct >= 50 ? "text-positive" : "text-negative"
                          )}
                        >
                          {benchBeat.pct}%
                        </span>{" "}
                        <span className="text-muted-foreground">
                          beat it ({benchBeat.beat}/{benchBeat.n})
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-negative/25">
                      <div
                        className="bg-positive"
                        style={{ width: `${benchBeat.pct}%` }}
                        title={`${benchBeat.beat} of ${benchBeat.n} beat the benchmark`}
                      />
                    </div>
                    <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                      Share of {benchBeat.n} growth schemes with a {period} record that beat
                      their category index.{" "}
                      {benchBeat.pct >= 50
                        ? "Active management is adding value in this category."
                        : "Most active funds here are trailing the index."}{" "}
                      TRI est. = price return + dividend yield; benchmark as of{" "}
                      {benchIndex.asOf}.
                    </p>
                  </div>
                ) : benchId == null ? (
                  <p className="rounded-md border border-dashed border-muted-foreground/40 bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
                    Benchmark-beat isn&rsquo;t shown for this category — hybrid funds
                    are measured against a blended debt+equity index we don&rsquo;t
                    reconstruct. The quartiles above are peer-relative and live.
                  </p>
                ) : null}
              </div>
            )}
          </Card>

          {/* ---- Listed-AMC tracker ----------------------------------------*/}
          <Card title="Listed AMCs in this category">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {view.listed.map((l) => {
                const s = l.fund?.returns[period];
                return (
                  <div
                    key={l.label}
                    className={cn(
                      "rounded-lg border px-3 py-2.5",
                      l.fund ? "bg-card" : "bg-muted/30"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold tracking-tight">
                        {l.label}
                      </span>
                      {s?.statsAvailable ? (
                        <QuartileBadge q={s.quartile} />
                      ) : null}
                    </div>
                    {l.fund ? (
                      <div className="mt-1">
                        <div className="text-[15px] font-semibold tabular">
                          {fmtPct(s?.return)}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground" title={l.fund.fundName}>
                          {s?.statsAvailable && s.rank && s.peerCount
                            ? `#${s.rank} of ${s.peerCount}`
                            : l.fund.fundName}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        No active fund here
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* ---- Full ranked table -----------------------------------------*/}
          {view.rows.length > 0 && (
            <Card
              title={`Every scheme, ranked by ${period} return`}
              action={
                <DownloadXlsxButton
                  rows={exportRows}
                  columns={exportColumns}
                  filename={`active-fund-performance-${catSlug(category)}-${plan}.xlsx`}
                  sheetName={`${prettyCat(category)} ${plan}`.slice(0, 31)}
                />
              }
            >
              <div className="overflow-x-auto rounded-md border bg-card">
                <table className="w-full min-w-[800px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-muted/60 text-xs text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">#</th>
                      <th className="px-3 py-2 text-left font-medium">Scheme</th>
                      {PERIODS.map((p) => (
                        <th
                          key={p}
                          className={cn(
                            "px-3 py-2 text-right font-medium",
                            p === period && "text-foreground"
                          )}
                        >
                          {p}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-center font-medium">Quartile</th>
                      <th className="px-3 py-2 text-right font-medium">vs median</th>
                      <th className="px-3 py-2 text-right font-medium">vs TRI</th>
                      <th className="px-3 py-2 text-right font-medium">%ile</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.rows.map((f, i) => {
                      const s = f.returns[period];
                      const amc = listedAmcOf(f.fundName);
                      return (
                        <tr key={f.schemecode} className="border-b last:border-0">
                          <td className="px-3 py-2 tabular text-muted-foreground">
                            {i + 1}
                          </td>
                          <td className="px-3 py-2">
                            <span className="font-medium">{f.fundName}</span>
                            {amc && (
                              <span className="ml-2 rounded-full border border-border bg-muted px-1.5 py-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                                {amc}
                              </span>
                            )}
                          </td>
                          {PERIODS.map((p) => (
                            <td
                              key={p}
                              className={cn(
                                "px-3 py-2 text-right tabular",
                                p === period ? "font-semibold text-foreground" : "text-muted-foreground"
                              )}
                            >
                              {fmtPct(f.returns[p]?.return)}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-center">
                            <QuartileBadge q={s?.statsAvailable ? s.quartile : null} />
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 text-right tabular",
                              typeof s?.excessVsMedian === "number" &&
                                (s.excessVsMedian >= 0 ? "text-positive" : "text-negative")
                            )}
                          >
                            {fmtSigned(s?.excessVsMedian)}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 text-right tabular",
                              typeof s?.return === "number" &&
                                benchReturn != null &&
                                (s.return - benchReturn >= 0
                                  ? "text-positive"
                                  : "text-negative")
                            )}
                          >
                            {typeof s?.return === "number" && benchReturn != null
                              ? fmtSigned(s.return - benchReturn)
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular text-muted-foreground">
                            {s?.statsAvailable && s.percentile != null
                              ? s.percentile.toFixed(0)
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[10px] leading-snug text-muted-foreground/70">
                Growth option only. Quartile, rank and &ldquo;vs median&rdquo; are
                computed within the exact cohort (category · plan · option), in
                percentage points. &ldquo;vs TRI&rdquo; is the scheme&rsquo;s return
                less its benchmark&rsquo;s TRI estimate. Simple return for 1Y, CAGR
                for 3Y/5Y. Source: AmfiBeas daily NAV snapshot (AMFI)
                {asOf ? ` · as of ${asOf}` : ""}.
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ---- Local UI atoms --------------------------------------------------------
function Segmented({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={o.id === value}
          className={cn(
            "rounded px-3 py-1 text-sm font-medium transition-colors",
            o.id === value
              ? "bg-primary/10 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-[18px] font-semibold tabular",
          tone === "pos" && "text-positive",
          tone === "neg" && "text-negative"
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function SkeletonBlock() {
  return (
    <div className="space-y-4">
      <div className="h-28 animate-pulse rounded-lg border bg-muted/40" />
      <div className="h-24 animate-pulse rounded-lg border bg-muted/40" />
      <div className="h-64 animate-pulse rounded-lg border bg-muted/40" />
    </div>
  );
}
