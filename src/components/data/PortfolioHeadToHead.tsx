"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { cleanSchemeName, formatCompactCrSafe, formatPctSafe } from "@/lib/format";
import {
  type FundDirectoryEntry,
  type FundPortfolio,
  type TrackerHolding,
  monthSlug,
} from "@/data/portfolio-tracker";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";
import { fmtBps, ppToBps } from "@/lib/units";
import { amcOf } from "@/data/amc-name-map";
import { classifyCap } from "@/data/cap-classification";
import { classifySector, UNCLASSIFIED } from "@/data/sector-classification";
import { MarketCapBar, type CapMix } from "@/components/data/MarketCapBar";

const MAX_B_SUGGESTIONS = 60;
const MAX_COMPARE_ROWS = 50;
// Same neutral band the rest of the dashboard uses for pp-comparisons —
// stocks within ±0.1pp of B count as "In line" rather than over/under-weight.
const NEUTRAL_BAND_PP = 0.1;

/**
 * Normalise a fund name for the variant-skip default-B heuristic. Strips
 * parenthetical plan suffixes ("(G)", "(IDCW)"), separator chars (so
 * "-Reg(G)" becomes " Reg G "), common plan tokens, and the noise word
 * "fund"; then lowercases and collapses whitespace. Two names that match
 * after this scrub are treated as variants of the same underlying scheme.
 */
export function normalizeSchemeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[-_/]+/g, " ")
    .replace(
      /\b(direct|dir|regular|reg|growth|g|idcw|dividend|div|payout|reinvestment|reinv|plan)\b/g,
      " "
    )
    .replace(/\bfund\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `a` and `b` look like variants of the same scheme (Direct/Reg,
 *  Growth/IDCW, …). Used only by the default-B selector — the picker itself
 *  still lists every same-category fund so users can pick variants manually. */
export function isLikelySameScheme(
  a: FundDirectoryEntry,
  b: FundDirectoryEntry
): boolean {
  const ka = normalizeSchemeKey(a.fund);
  const kb = normalizeSchemeKey(b.fund);
  if (!ka || !kb) return false;
  return ka === kb;
}

type Signal =
  | "A overweight"
  | "A underweight"
  | "In line"
  | "Only A holds"
  | "Only B holds";

interface CompareRow {
  fincode: string;
  name: string;
  a: number | null;
  b: number | null;
  delta: number;
  signal: Signal;
}

interface Props {
  aEntry: FundDirectoryEntry;
  aPortfolio: FundPortfolio;
  bEntry: FundDirectoryEntry | null;
  bPortfolio: FundPortfolio | undefined;
  bLoading: boolean;
  bErrored: boolean;
  onPickB: (schemecode: string) => void;
  onRetryB: () => void;
  bCandidates: FundDirectoryEntry[];
  category: string;
}

function cleanCompanyName(s: string): string {
  return s
    .replace(/^eq\s*-\s*/i, "")
    .replace(/^[\s^*#~]+/, "")
    .replace(/[£@*#~]+$/, "")
    .trim();
}

function classify(
  a: number | null,
  b: number | null
): { delta: number; signal: Signal } {
  if (a === null && b !== null) return { delta: -b, signal: "Only B holds" };
  if (a !== null && b === null) return { delta: a, signal: "Only A holds" };
  const delta = (a ?? 0) - (b ?? 0);
  if (Math.abs(delta) <= NEUTRAL_BAND_PP) return { delta, signal: "In line" };
  if (delta > 0) return { delta, signal: "A overweight" };
  return { delta, signal: "A underweight" };
}

/** Latest-month at-a-glance profile of a single scheme, mirroring the AMC
 *  compare card: scale, top-10 concentration (+ MoM move), the biggest single
 *  weight add / trim, market-cap mix and the top-10 holdings. */
interface SchemeSnapshot {
  equityCr: number | null;
  top10Pct: number;
  top10DeltaPp: number | null;
  biggestAdd: { company: string; pp: number } | null;
  biggestTrim: { company: string; pp: number } | null;
  split: CapMix | null;
  top: { name: string; pct: number }[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Build a scheme snapshot from its latest two months of holdings. The top-10
 * concentration, MoM delta and biggest add/trim use the same formulas the
 * fundwise directory build applies at the AMC level, so the head-to-head
 * summary and the fund-house Compare card stay numerically consistent.
 */
function schemeSnapshot(portfolio: FundPortfolio): SchemeSnapshot {
  const latestSlug = monthSlug(portfolio.meta.months[0]?.label ?? "");
  const prevSlug = portfolio.meta.months[1]
    ? monthSlug(portfolio.meta.months[1].label)
    : null;
  const pctOf = (r: TrackerHolding, s: string): number =>
    r.months[s]?.aum_pct_num ?? 0;

  // Top-10 concentration = Σ of the 10 largest weights that month; the MoM
  // delta compares each month's own top 10.
  const sumTop10 = (slug: string) =>
    portfolio.rows
      .map((r) => pctOf(r, slug))
      .sort((a, b) => b - a)
      .slice(0, 10)
      .reduce((s, x) => s + x, 0);
  const top10Pct = latestSlug ? round1(sumTop10(latestSlug)) : 0;
  const top10DeltaPp =
    latestSlug && prevSlug ? round1(top10Pct - sumTop10(prevSlug)) : null;

  // Biggest single-name weight add / trim, MoM (in pp of book).
  let biggestAdd: { company: string; pp: number } | null = null;
  let biggestTrim: { company: string; pp: number } | null = null;
  if (latestSlug && prevSlug) {
    for (const r of portfolio.rows) {
      const d = pctOf(r, latestSlug) - pctOf(r, prevSlug);
      const company = cleanCompanyName(r.company_name);
      if (!biggestAdd || d > biggestAdd.pp) biggestAdd = { company, pp: round1(d) };
      if (!biggestTrim || d < biggestTrim.pp) biggestTrim = { company, pp: round1(d) };
    }
  }

  // Market-cap mix (latest month, weighted by % of book, normalised to 100).
  let split: CapMix | null = null;
  if (latestSlug) {
    const raw = { large: 0, mid: 0, small: 0 };
    let total = 0;
    for (const r of portfolio.rows) {
      const w = pctOf(r, latestSlug);
      if (!w) continue;
      total += w;
      raw[classifyCap(r.company_name)] += w;
    }
    if (total > 0)
      split = {
        large: (raw.large / total) * 100,
        mid: (raw.mid / total) * 100,
        small: (raw.small / total) * 100,
      };
  }

  // Top-10 holdings (latest % of book), largest first.
  const top = latestSlug
    ? portfolio.rows
        .map((r) => ({
          name: cleanCompanyName(r.company_name),
          pct: pctOf(r, latestSlug),
        }))
        .filter((h) => h.pct > 0)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 10)
    : [];

  return {
    equityCr: portfolio.meta.aumTotalCr,
    top10Pct,
    top10DeltaPp,
    biggestAdd,
    biggestTrim,
    split,
    top,
  };
}

type HoldingsView = "mutuals" | "exclusive";

/** A short, distinct fund label for same-AMC comparisons (e.g. "HDFC Flexi
 *  Cap" / "HDFC Mid-Cap") — the first few meaningful words, minus plan tokens. */
function shortFundLabel(fund: string): string {
  return fund
    .replace(/\([^)]*\)/g, " ")
    .replace(/-?\b(Reg|Dir|Regular|Direct)\b/gi, " ")
    .replace(/\bFund\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 3)
    .join(" ");
}

/** Render an abstract signal with the two funds' short labels instead of A/B. */
function signalLabel(signal: Signal, aLabel: string, bLabel: string): string {
  switch (signal) {
    case "A overweight":
      return `${aLabel} overweight`;
    case "A underweight":
      return `${aLabel} underweight`;
    case "Only A holds":
      return `Only ${aLabel} holds`;
    case "Only B holds":
      return `Only ${bLabel} holds`;
    default:
      return "In line";
  }
}

export function PortfolioHeadToHead({
  aEntry,
  aPortfolio,
  bEntry,
  bPortfolio,
  bLoading,
  bErrored,
  onPickB,
  onRetryB,
  bCandidates,
  category,
}: Props) {
  const [bQuery, setBQuery] = useState(bEntry ? cleanSchemeName(bEntry.fund) : "");
  const [bFocused, setBFocused] = useState(false);
  // Common (both funds hold) vs unique (only one holds) holdings. Default
  // common — the apples-to-apples weight comparison.
  const [view, setView] = useState<HoldingsView>("mutuals");
  // Sector filter (mirrors the Holdings tab) — narrows the comparison table to
  // one sector. "" = all sectors.
  const [sectorFilter, setSectorFilter] = useState("");

  // Externally-driven B changes (A re-picked → default-B re-derives) sync
  // into the picker's text so the visible fund-name tracks the fund being
  // compared. User-driven edits to `bQuery` are preserved until B actually
  // changes. Set-during-render avoids an extra commit and matches React's
  // recommended "adjusting state on prop change" pattern.
  const bSchemecode = bEntry?.schemecode ?? null;
  const [prevBSchemecode, setPrevBSchemecode] = useState(bSchemecode);
  if (prevBSchemecode !== bSchemecode) {
    setPrevBSchemecode(bSchemecode);
    setBQuery(bEntry ? cleanSchemeName(bEntry.fund) : "");
  }

  const bSuggestions = useMemo(() => {
    const q = bQuery.trim().toLowerCase();
    const matched = q
      ? bCandidates.filter((f) => f.fund.toLowerCase().includes(q))
      : bCandidates;
    return matched.slice(0, MAX_B_SUGGESTIONS);
  }, [bCandidates, bQuery]);

  // Outer-join A and B's latest-month holdings by fincode. Holdings present
  // in only one fund land with a null on the missing side; classify() then
  // maps to "Only A/B holds" / "A over/under-weight" / "In line".
  const compareRows = useMemo<CompareRow[]>(() => {
    if (!bPortfolio) return [];
    const slugA = monthSlug(aPortfolio.meta.months[0]?.label ?? "");
    const slugB = monthSlug(bPortfolio.meta.months[0]?.label ?? "");
    if (!slugA || !slugB) return [];

    const map = new Map<
      string,
      { name: string; a: number | null; b: number | null }
    >();
    for (const r of aPortfolio.rows) {
      const w = r.months[slugA]?.aum_pct_num ?? null;
      if (w === null) continue;
      map.set(r.fincode, {
        name: cleanCompanyName(r.company_name),
        a: w,
        b: null,
      });
    }
    for (const r of bPortfolio.rows) {
      const w = r.months[slugB]?.aum_pct_num ?? null;
      if (w === null) continue;
      const ex = map.get(r.fincode);
      if (ex) ex.b = w;
      else
        map.set(r.fincode, {
          name: cleanCompanyName(r.company_name),
          a: null,
          b: w,
        });
    }

    const rows: CompareRow[] = [];
    for (const [fincode, { name, a, b }] of map) {
      const { delta, signal } = classify(a, b);
      rows.push({ fincode, name, a, b, delta, signal });
    }
    rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    return rows;
  }, [aPortfolio, bPortfolio]);

  // Per-scheme at-a-glance snapshots for the summary cards above the toggle.
  const snapA = useMemo(() => schemeSnapshot(aPortfolio), [aPortfolio]);
  const snapB = useMemo(
    () => (bPortfolio ? schemeSnapshot(bPortfolio) : null),
    [bPortfolio]
  );

  // Short labels for the two funds (AMC abbreviation, e.g. "HDFC" / "PPFAS").
  // Fall back to a short fund name when both funds are from the same AMC.
  const rawA = amcOf(aEntry.fund);
  const rawB = bEntry ? amcOf(bEntry.fund) : "B";
  const sameAmc = bEntry != null && rawA === rawB;
  const aLabel = sameAmc ? shortFundLabel(aEntry.fund) : rawA;
  const bLabel = sameAmc && bEntry ? shortFundLabel(bEntry.fund) : rawB;

  const mutualRows = compareRows.filter((r) => r.a !== null && r.b !== null);
  const exclusiveRows = compareRows.filter((r) => r.a === null || r.b === null);
  const onlyACount = exclusiveRows.filter((r) => r.signal === "Only A holds").length;
  const onlyBCount = exclusiveRows.length - onlyACount;
  const viewRows = view === "mutuals" ? mutualRows : exclusiveRows;

  // Sector options across the whole comparison (both views), so the dropdown
  // is stable when toggling Common/Unique. Unclassified sinks to the end.
  const sectorOf = (r: CompareRow) => classifySector(r.fincode, r.name);
  const sectorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of compareRows) set.add(classifySector(r.fincode, r.name));
    return [...set].sort(
      (a, b) =>
        (a === UNCLASSIFIED ? 1 : 0) - (b === UNCLASSIFIED ? 1 : 0) ||
        a.localeCompare(b)
    );
  }, [compareRows]);
  // A no-longer-present sector (after a fund change) silently falls back to all.
  const activeSector = sectorFilter && sectorOptions.includes(sectorFilter) ? sectorFilter : "";
  const filteredViewRows = activeSector
    ? viewRows.filter((r) => sectorOf(r) === activeSector)
    : viewRows;

  // Largest A>B and largest A<B *amongst stocks both funds hold* — the
  // apples-to-apples extremes for the one-line summary, honouring the sector
  // filter so the headline matches the table beneath it. Holdings only one
  // fund holds are surfaced in the table itself and don't dominate the headline.
  const headlineRows = activeSector
    ? mutualRows.filter((r) => sectorOf(r) === activeSector)
    : mutualRows;
  let headlineOver: CompareRow | null = null;
  let headlineUnder: CompareRow | null = null;
  for (const r of headlineRows) {
    if (r.signal === "A overweight" && (!headlineOver || r.delta > headlineOver.delta))
      headlineOver = r;
    if (r.signal === "A underweight" && (!headlineUnder || r.delta < headlineUnder.delta))
      headlineUnder = r;
  }
  const headline = { over: headlineOver, under: headlineUnder };

  const latestMonth = aPortfolio.meta.months[0]?.label ?? "";
  const totalRows = filteredViewRows.length;
  const displayRows = filteredViewRows.slice(0, MAX_COMPARE_ROWS);
  type XRow = {
    company: string;
    a: number | null;
    b: number | null;
    delta: number;
    signal: string;
  };
  const compareExportColumns: CsvColumn<XRow>[] = [
    { key: "company", header: "Company" },
    { key: "a", header: `${cleanSchemeName(aEntry.fund)} (%)` },
    { key: "b", header: bEntry ? `${cleanSchemeName(bEntry.fund)} (%)` : "Comparison fund (%)" },
    { key: "delta", header: `Δ ${aLabel} − ${bLabel} (bps)` },
    { key: "signal", header: "Signal" },
  ];
  const compareExportRows: XRow[] = filteredViewRows.map((r) => ({
    company: r.name,
    a: r.a,
    b: r.b,
    delta: ppToBps(r.delta),
    signal: signalLabel(r.signal, aLabel, bLabel),
  }));

  if (bCandidates.length === 0) {
    return (
      <section className="space-y-2">
        <Header aEntry={aEntry} category={category} />
        <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          No same-category peers available in {category}.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <Header aEntry={aEntry} category={category} />

      <div className="space-y-1.5">
        <label
          htmlFor="h2h-b-picker"
          className="text-xs font-medium text-muted-foreground"
        >
          Compare with…
        </label>
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="h2h-b-picker"
            type="search"
            value={bQuery}
            onChange={(e) => {
              setBQuery(e.target.value);
              setBFocused(true);
            }}
            onFocus={() => setBFocused(true)}
            onBlur={() => setBFocused(false)}
            placeholder="Search same-category funds…"
            aria-label="Search same-category funds to compare"
            className="w-full rounded-md border bg-background py-2.5 pl-9 pr-9 text-sm placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
          />
          {bQuery && (
            <button
              type="button"
              onClick={() => setBQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {bFocused && bSuggestions.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-card py-1 shadow-md">
              {bSuggestions.map((f) => (
                <li key={f.schemecode}>
                  <button
                    type="button"
                    // mousedown fires before the input's blur, so the pick lands
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onPickB(f.schemecode);
                      setBQuery(cleanSchemeName(f.fund));
                      setBFocused(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent",
                      f.schemecode === bEntry?.schemecode && "bg-accent/60"
                    )}
                  >
                    <span>{cleanSchemeName(f.fund)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {category}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {bEntry && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{cleanSchemeName(aEntry.fund)}</span>
          <span className="mx-2">vs</span>
          <span className="font-medium text-foreground">{cleanSchemeName(bEntry.fund)}</span>
          {latestMonth && (
            <span className="ml-2 text-xs">· Latest month: {latestMonth}</span>
          )}
        </p>
      )}

      {bErrored ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground">
          <span className="text-negative">
            Couldn&apos;t load holdings for the comparison fund.
          </span>
          <button
            type="button"
            onClick={onRetryB}
            className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
          >
            Retry
          </button>
        </div>
      ) : bLoading || !bPortfolio ? (
        <div className="flex h-40 items-center justify-center gap-2 rounded-md border bg-card text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading comparison fund holdings…
        </div>
      ) : (
        <>
          {snapB && (
            <div className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">
                  Snapshot
                </h3>
                <p className="text-xs text-muted-foreground">
                  {aLabel} vs {bLabel} at a glance — concentration, biggest
                  moves, market-cap mix and top holdings.
                  {latestMonth && <span className="ml-1">As of {latestMonth}.</span>}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <SchemeSnapshotCard
                  title={aLabel}
                  subtitle={cleanSchemeName(aEntry.fund)}
                  snap={snapA}
                />
                <SchemeSnapshotCard
                  title={bLabel}
                  subtitle={bEntry ? cleanSchemeName(bEntry.fund) : "Comparison fund"}
                  snap={snapB}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="inline-flex rounded-md border bg-card p-0.5 text-xs"
                role="group"
                aria-label="Holdings comparison view"
              >
                {(
                  [
                    { id: "mutuals", label: `Common holdings (${mutualRows.length})` },
                    { id: "exclusive", label: `Unique holdings (${exclusiveRows.length})` },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setView(opt.id)}
                    aria-pressed={view === opt.id}
                    className={cn(
                      "rounded px-2.5 py-1 font-medium transition-colors",
                      view === opt.id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <select
                value={activeSector}
                onChange={(e) => setSectorFilter(e.target.value)}
                aria-label="Filter comparison by sector"
                className="rounded-md border bg-card px-2 py-1.5 text-xs text-foreground focus:border-foreground focus:outline-none"
              >
                <option value="">All sectors</option>
                {sectorOptions.map((sec) => (
                  <option key={sec} value={sec}>
                    {sec}
                  </option>
                ))}
              </select>
            </div>
            {totalRows > 0 && (
              <DownloadXlsxButton
                rows={compareExportRows}
                columns={compareExportColumns}
                filename="portfolio-head-to-head.xlsx"
                sheetName={`${aLabel} vs ${bLabel}`}
              />
            )}
          </div>
          {view === "mutuals"
            ? (headline.over || headline.under) && (
                <p className="text-sm leading-snug text-foreground">
                  Among names both hold, <strong>{aLabel}</strong> is
                  {headline.over && (
                    <>
                      {" "}most overweight{" "}
                      <strong>{headline.over.name}</strong> (
                      <span className="text-positive">
                        {fmtBps(headline.over.delta)}
                      </span>
                      )
                    </>
                  )}
                  {headline.over && headline.under && " and"}
                  {headline.under && (
                    <>
                      {" "}most underweight{" "}
                      <strong>{headline.under.name}</strong> (
                      <span className="text-negative">
                        {fmtBps(headline.under.delta)}
                      </span>
                      )
                    </>
                  )}{" "}
                  vs <strong>{bLabel}</strong>.
                </p>
              )
            : exclusiveRows.length > 0 && (
                <p className="text-sm leading-snug text-foreground">
                  <strong>{aLabel}</strong> holds{" "}
                  <span className="text-positive">{onlyACount}</span> name
                  {onlyACount === 1 ? "" : "s"} <strong>{bLabel}</strong>{" "}
                  doesn&apos;t, and <strong>{bLabel}</strong> holds{" "}
                  <span className="text-negative">{onlyBCount}</span> name
                  {onlyBCount === 1 ? "" : "s"} <strong>{aLabel}</strong>{" "}
                  doesn&apos;t.
                </p>
              )}

          {totalRows === 0 ? (
            <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              {view === "mutuals"
                ? `No holdings ${aLabel} and ${bLabel} both hold`
                : `No unique holdings — every name is held by both`}
              {activeSector ? ` in ${activeSector}` : ""} for{" "}
              {latestMonth || "the latest month"}.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border bg-card">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Company</th>
                    <th className="px-3 py-2 text-right font-medium">
                      {cleanSchemeName(aEntry.fund)}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      {bEntry ? cleanSchemeName(bEntry.fund) : "Comparison fund"}
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      Δ {aLabel} − {bLabel}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((r) => (
                    <tr
                      key={r.fincode}
                      className="border-b last:border-0 hover:bg-accent/40"
                    >
                      <td className="px-3 py-2.5 font-medium">{r.name}</td>
                      <td className="px-3 py-2.5 text-right tabular text-muted-foreground">
                        {formatPctSafe(r.a, 1)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular text-muted-foreground">
                        {formatPctSafe(r.b, 1)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular">
                        <DeltaPp value={r.delta} signal={r.signal} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalRows > 0 && (
            <p className="text-xs text-muted-foreground">
              {totalRows > MAX_COMPARE_ROWS
                ? `Showing top ${MAX_COMPARE_ROWS} of ${totalRows} ${view === "mutuals" ? "common" : "unique"} holdings by |Δ|`
                : `${totalRows} ${view === "mutuals" ? "common" : "unique"} holding${totalRows === 1 ? "" : "s"}, sorted by |Δ|`}
              {activeSector ? ` · ${activeSector}` : ""}
              {latestMonth && ` · Latest month: ${latestMonth}`}.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Header({
  aEntry,
  category,
}: {
  aEntry: FundDirectoryEntry;
  category: string;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold tracking-tight">Head-to-head</h2>
      <p className="text-xs text-muted-foreground">
        Compare{" "}
        <span className="font-medium text-foreground">{cleanSchemeName(aEntry.fund)}</span> with
        another fund in {category}.
      </p>
    </div>
  );
}

function DeltaPp({ value, signal }: { value: number; signal: Signal }) {
  const cls =
    signal === "In line"
      ? "text-muted-foreground"
      : value > 0
        ? "text-positive"
        : "text-negative";
  return <span className={cls}>{fmtBps(value)}</span>;
}

function SnapRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

/** One scheme's at-a-glance card — the scheme-level mirror of the fund-house
 *  Compare card, summarising the head-to-head tab above the holdings toggle. */
function SchemeSnapshotCard({
  title,
  subtitle,
  snap,
}: {
  title: string;
  subtitle: string;
  snap: SchemeSnapshot;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="truncate text-[11px] text-muted-foreground" title={subtitle}>
          {subtitle}
        </div>
      </div>

      <dl className="space-y-1.5 text-sm">
        <SnapRow label="Equity book">
          {formatCompactCrSafe(snap.equityCr)}
        </SnapRow>
        <SnapRow label="Top-10 conc.">
          {snap.top10Pct.toFixed(1)}%
          {snap.top10DeltaPp !== null && (
            <span
              className={cn(
                "ml-1 text-[11px]",
                snap.top10DeltaPp >= 0 ? "text-positive" : "text-negative"
              )}
            >
              {fmtBps(snap.top10DeltaPp)}
            </span>
          )}
        </SnapRow>
        <SnapRow label="Biggest buy">
          {snap.biggestAdd ? (
            <span>
              <span className="text-positive">{fmtBps(snap.biggestAdd.pp)}</span>{" "}
              <span className="text-[11px] text-muted-foreground">
                {snap.biggestAdd.company}
              </span>
            </span>
          ) : (
            "—"
          )}
        </SnapRow>
        <SnapRow label="Biggest sell">
          {snap.biggestTrim ? (
            <span>
              <span className="text-negative">{fmtBps(snap.biggestTrim.pp)}</span>{" "}
              <span className="text-[11px] text-muted-foreground">
                {snap.biggestTrim.company}
              </span>
            </span>
          ) : (
            "—"
          )}
        </SnapRow>
      </dl>

      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          Market-cap mix
        </div>
        {snap.split ? (
          <MarketCapBar split={snap.split} />
        ) : (
          <div className="text-xs text-muted-foreground">—</div>
        )}
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          Top 10 holdings
        </div>
        {snap.top.length > 0 ? (
          <ol className="space-y-1 text-sm">
            {snap.top.map((h, idx) => (
              <li
                key={h.name}
                className="flex items-baseline justify-between gap-2"
              >
                <span className="truncate">
                  <span className="mr-1 text-[11px] text-muted-foreground">
                    {idx + 1}.
                  </span>
                  {h.name}
                </span>
                <span className="shrink-0 tabular text-muted-foreground">
                  {h.pct.toFixed(1)}%
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="text-xs text-muted-foreground">—</div>
        )}
      </div>
    </div>
  );
}
