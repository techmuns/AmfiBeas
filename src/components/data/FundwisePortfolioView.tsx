"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";
import { KeyTakeaway } from "@/components/ui/KeyTakeaway";
import {
  formatCompactCrSafe,
  formatPctSafe,
  formatSharesIndian,
} from "@/lib/format";
import {
  type FundHouseEntry,
  type FundHousePortfolio,
} from "@/data/fundwise-tracker";
import {
  type HoldingArrow,
  monthSlug,
} from "@/data/portfolio-tracker";
import { classifyCap } from "@/data/cap-classification";
import { classifySector, UNCLASSIFIED } from "@/data/sector-classification";
import { AmcAllocationCharts } from "@/components/data/AmcAllocationCharts";

const MAX_SUGGESTIONS = 60;
const MAX_COMPARE = 3;

type FundwiseTab = "holdings" | "peers" | "allocation" | "compare";
const FUNDWISE_TABS: { id: FundwiseTab; label: string }[] = [
  { id: "holdings", label: "Holdings" },
  { id: "peers", label: "Peers" },
  { id: "allocation", label: "Allocation mix" },
  { id: "compare", label: "Compare" },
];

function ArrowMark({ arrow }: { arrow: HoldingArrow }) {
  if (arrow === "up")
    return (
      <span className="text-positive" aria-label="increased">
        ▲
      </span>
    );
  if (arrow === "down")
    return (
      <span className="text-negative" aria-label="decreased">
        ▼
      </span>
    );
  return null;
}

/**
 * Fund-WISE portfolio view: pick a fund house (HDFC / SBI / ICICI …) and see
 * its holdings aggregated across every scheme it runs — share counts summed
 * and each company's weight expressed as a % of the AMC's whole equity book.
 * Mirrors the scheme-wise Holdings tab; the aggregated payload is precomputed
 * (scripts/build-fundwise-portfolios.ts) and fetched on demand.
 */
export function FundwisePortfolioView({
  fundHouses,
}: {
  fundHouses: FundHouseEntry[];
}) {
  const [selectedSlug, setSelectedSlug] = useState(fundHouses[0]?.slug ?? "");
  const [query, setQuery] = useState(fundHouses[0]?.amc ?? "");
  const [focused, setFocused] = useState(false);
  const [holdingQuery, setHoldingQuery] = useState("");
  // Client-requested sector filter for "top conviction ideas" within a house.
  const [sectorFilter, setSectorFilter] = useState("");
  const [tab, setTab] = useState<FundwiseTab>("holdings");

  const [loaded, setLoaded] = useState<Record<string, FundHousePortfolio>>({});
  const [errored, setErrored] = useState<Record<string, true>>({});
  const [reloadNonce, setReloadNonce] = useState(0);

  const selected =
    fundHouses.find((f) => f.slug === selectedSlug) ?? fundHouses[0] ?? null;
  const portfolio = selected ? loaded[selected.slug] ?? null : null;
  const hasError = selected ? Boolean(errored[selected.slug]) : false;
  const loading = Boolean(selected) && !portfolio && !hasError;

  // Avoid restarting the in-flight fetch on unrelated state changes.
  const loadedRef = useRef(loaded);
  const erroredRef = useRef(errored);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);
  useEffect(() => {
    erroredRef.current = errored;
  }, [errored]);

  useEffect(() => {
    if (!selected) return;
    const slug = selected.slug;
    if (loadedRef.current[slug] || erroredRef.current[slug]) return;
    const ctrl = new AbortController();
    fetch(selected.path, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<FundHousePortfolio>;
      })
      .then((data) => setLoaded((prev) => ({ ...prev, [slug]: data })))
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setErrored((prev) => ({ ...prev, [slug]: true }));
      });
    return () => ctrl.abort();
  }, [selected, reloadNonce]);

  function retry() {
    if (!selected) return;
    const slug = selected.slug;
    setErrored((prev) => {
      const next = { ...prev };
      delete next[slug];
      return next;
    });
    setReloadNonce((n) => n + 1);
  }

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? fundHouses.filter((f) => f.amc.toLowerCase().includes(q))
      : fundHouses;
    return matched.slice(0, MAX_SUGGESTIONS);
  }, [fundHouses, query]);

  const months = portfolio?.meta.months ?? [];
  const slugs = months.map((m) => monthSlug(m.label));

  const sectorOptions = useMemo(() => {
    if (!portfolio) return [] as string[];
    const set = new Set<string>();
    for (const r of portfolio.rows) set.add(classifySector(r.fincode, r.company_name));
    return [...set].sort(
      (a, b) =>
        (a === UNCLASSIFIED ? 1 : 0) - (b === UNCLASSIFIED ? 1 : 0) ||
        a.localeCompare(b)
    );
  }, [portfolio]);

  const holdings = useMemo(() => {
    if (!portfolio) return [];
    const q = holdingQuery.trim().toLowerCase();
    return portfolio.rows.filter(
      (r) =>
        (!q || r.company_name.toLowerCase().includes(q)) &&
        (!sectorFilter || classifySector(r.fincode, r.company_name) === sectorFilter)
    );
  }, [portfolio, holdingQuery, sectorFilter]);

  // Month-over-month read: biggest weight add / trim and the top-10
  // concentration shift, in percentage points of the AMC's equity book.
  const flowSummary = useMemo(() => {
    if (!portfolio || portfolio.meta.months.length < 2) return null;
    const cur = monthSlug(portfolio.meta.months[0].label);
    const prev = monthSlug(portfolio.meta.months[1].label);
    let topAdd: { name: string; d: number } | null = null;
    let topTrim: { name: string; d: number } | null = null;
    const curPcts: number[] = [];
    const prevPcts: number[] = [];
    for (const r of portfolio.rows) {
      const c = r.months[cur]?.aum_pct_num ?? 0;
      const p = r.months[prev]?.aum_pct_num ?? 0;
      const d = c - p;
      if (!topAdd || d > topAdd.d) topAdd = { name: r.company_name, d };
      if (!topTrim || d < topTrim.d) topTrim = { name: r.company_name, d };
      curPcts.push(c);
      prevPcts.push(p);
    }
    const top10 = (arr: number[]) =>
      arr.slice().sort((a, b) => b - a).slice(0, 10).reduce((s, x) => s + x, 0);
    const concCur = top10(curPcts);
    return {
      label: portfolio.meta.months[0].label,
      topAdd,
      topTrim,
      concCur,
      concDelta: concCur - top10(prevPcts),
    };
  }, [portfolio]);

  type ExportRow = Record<string, string | number | null>;
  const exportColumns: CsvColumn<ExportRow>[] = [
    { key: "company", header: "Company" },
    ...months.map((m) => ({ key: m.label, header: `${m.label} % of book` })),
    ...months.map((m) => ({ key: `${m.label} shares`, header: `${m.label} shares` })),
  ];
  const exportRows: ExportRow[] = holdings.map((r) => {
    const row: ExportRow = { company: r.company_name };
    slugs.forEach((slug, i) => {
      row[months[i].label] = r.months[slug]?.aum_pct_num ?? null;
      row[`${months[i].label} shares`] = r.months[slug]?.shares_num ?? null;
    });
    return row;
  });

  function pick(f: FundHouseEntry) {
    setSelectedSlug(f.slug);
    setQuery(f.amc);
    setHoldingQuery("");
    setFocused(false);
  }

  const loaderUi = (
    <div className="flex h-40 items-center justify-center gap-2 rounded-md border bg-card text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading holdings…
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Fund-house picker */}
      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setFocused(true);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Search a fund house — HDFC, SBI, ICICI…"
          aria-label="Search fund houses"
          className="w-full rounded-md border bg-background py-2.5 pl-9 pr-9 text-sm placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {focused && suggestions.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-card py-1 shadow-md">
            {suggestions.map((f) => (
              <li key={f.slug}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(f);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent",
                    f.slug === selectedSlug && "bg-accent/60"
                  )}
                >
                  <span className="font-medium">{f.amc}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {f.schemeCount} schemes · {formatCompactCrSafe(f.equityValueCr)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!selected ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
          No fund houses available.
        </div>
      ) : (
        <>
          {/* Fund-house header */}
          <div className="rounded-lg border bg-card px-5 py-4 text-sm">
            <div>
              Fund House -{" "}
              <span className="font-semibold">{selected.amc}</span>
            </div>
            <div className="mt-1 text-muted-foreground">
              {selected.schemeCount} schemes combined ·{" "}
              {selected.holdingsCount} distinct holdings
            </div>
            <div className="mt-1 text-muted-foreground">
              Equity book — {formatCompactCrSafe(selected.equityValueCr)} ·{" "}
              latest {selected.latestMonth}
            </div>
          </div>

          {/* Holdings · Peers · Allocation mix sub-tabs (sticky under Topbar). */}
          <div className="sticky top-14 z-20 -mx-6 flex gap-1 border-b bg-background/95 px-6 pt-1 backdrop-blur lg:-mx-8 lg:px-8">
            {FUNDWISE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={t.id === tab ? "page" : undefined}
                className={cn(
                  "-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  t.id === tab
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "peers" ? (
            <FundHousePeers
              fundHouses={fundHouses}
              selectedSlug={selectedSlug}
            />
          ) : tab === "compare" ? (
            <FundHouseCompare
              fundHouses={fundHouses}
              initialSlug={selectedSlug}
            />
          ) : tab === "allocation" ? (
            // Fund-house allocation bar charts (Cap + Sector by AMC) —
            // independent of the holdings fetch, same presentation as before.
            <AmcAllocationCharts />
          ) : loading ? (
            loaderUi
          ) : hasError ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground">
              <span className="text-negative">
                Couldn&apos;t load holdings for this fund house.
              </span>
              <button
                type="button"
                onClick={retry}
                className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
              >
                Retry
              </button>
            </div>
          ) : portfolio ? (
            <>
              {flowSummary && flowSummary.topAdd && flowSummary.topTrim && (
                <KeyTakeaway
                  headline={
                    <>
                      In {flowSummary.label}, across all its schemes{" "}
                      {selected.amc} raised its aggregate weight most in{" "}
                      <strong>{flowSummary.topAdd.name}</strong> (
                      <span className="text-positive">
                        +{flowSummary.topAdd.d.toFixed(1)}pp
                      </span>
                      ) and trimmed{" "}
                      <strong>{flowSummary.topTrim.name}</strong> (
                      <span className="text-negative">
                        {flowSummary.topTrim.d.toFixed(1)}pp
                      </span>
                      ).
                    </>
                  }
                  detail={
                    <>
                      Top-10 holdings = {flowSummary.concCur.toFixed(1)}% of the
                      equity book (
                      <span
                        className={
                          flowSummary.concDelta >= 0
                            ? "text-positive"
                            : "text-negative"
                        }
                      >
                        {flowSummary.concDelta >= 0 ? "+" : ""}
                        {flowSummary.concDelta.toFixed(1)}pp
                      </span>{" "}
                      MoM).
                    </>
                  }
                />
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold tracking-tight">
                  Equity Holdings — all schemes combined
                </h2>
                <div className="flex items-center gap-3">
                  <select
                    value={sectorFilter}
                    onChange={(e) => setSectorFilter(e.target.value)}
                    aria-label="Filter holdings by sector"
                    className="rounded-md border bg-card px-2 py-1.5 text-sm text-foreground focus:border-foreground focus:outline-none"
                  >
                    <option value="">All sectors</option>
                    {sectorOptions.map((sec) => (
                      <option key={sec} value={sec}>
                        {sec}
                      </option>
                    ))}
                  </select>
                  <div className="relative">
                    <input
                      type="search"
                      value={holdingQuery}
                      onChange={(e) => setHoldingQuery(e.target.value)}
                      placeholder="Search holdings"
                      aria-label="Search holdings by company"
                      className="w-56 rounded-md border bg-background py-1.5 pl-3 pr-8 text-sm placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
                    />
                    {holdingQuery && (
                      <button
                        type="button"
                        onClick={() => setHoldingQuery("")}
                        aria-label="Clear holdings filter"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {exportRows.length > 0 && (
                    <DownloadXlsxButton
                      rows={exportRows}
                      columns={exportColumns}
                      filename={`${selected.slug}-fundwise-holdings.xlsx`}
                      sheetName="Holdings"
                    />
                  )}
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border bg-card">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-muted/60 text-xs">
                      <th
                        rowSpan={2}
                        className="border-b border-r px-3 py-2 text-left font-medium align-bottom"
                      >
                        Company
                      </th>
                      {months.map((m) => (
                        <th
                          key={m.label}
                          colSpan={2}
                          className="border-b border-l px-3 py-2 text-center font-medium"
                        >
                          <div>{m.label}</div>
                          <div className="text-[11px] font-normal text-muted-foreground">
                            Book: {formatCompactCrSafe(Number(m.aumCr))}
                          </div>
                        </th>
                      ))}
                    </tr>
                    <tr className="bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                      {months.map((m) => (
                        <SubHead key={m.label} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.length === 0 ? (
                      <tr>
                        <td
                          colSpan={1 + months.length * 2}
                          className="px-3 py-8 text-center text-muted-foreground"
                        >
                          No holdings match &ldquo;{holdingQuery}&rdquo;.
                        </td>
                      </tr>
                    ) : (
                      holdings.map((row) => (
                        <tr
                          key={row.fincode || row.company_name}
                          className="border-b last:border-0 hover:bg-accent/40"
                        >
                          <td className="border-r px-3 py-2.5 font-medium">
                            {row.company_name}
                          </td>
                          {slugs.map((slug) => (
                            <Cells key={slug} cell={row.months[slug]} />
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-muted-foreground">
                {portfolio.rows.length} distinct equity holdings across{" "}
                {selected.schemeCount} {selected.amc} schemes. Weight = each
                company&apos;s aggregated ₹ value ÷ the fund house&apos;s total
                equity-holdings value that month; arrows compare a month&apos;s
                summed share count to the next-older month (
                {months.map((m) => m.label).join(" → ")}). Source: aggregated
                from RupeeVest Portfolio Tracker scheme holdings.
              </p>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

interface CompareCol {
  entry: FundHouseEntry;
  portfolio: FundHousePortfolio | null;
  errored: boolean;
}

/** Latest-month market-cap split (% of book) from a fund-house portfolio. */
function capSplit(portfolio: FundHousePortfolio | null): {
  large: number;
  mid: number;
  small: number;
} | null {
  if (!portfolio) return null;
  const slug = monthSlug(portfolio.meta.months[0]?.label ?? "");
  const raw = { large: 0, mid: 0, small: 0 };
  let total = 0;
  for (const r of portfolio.rows) {
    const w = r.months[slug]?.aum_pct_num ?? 0;
    if (!w) continue;
    total += w;
    raw[classifyCap(r.company_name)] += w;
  }
  if (total <= 0) return null;
  return {
    large: (raw.large / total) * 100,
    mid: (raw.mid / total) * 100,
    small: (raw.small / total) * 100,
  };
}

/** Top-N holdings (company + latest % of book) from a fund-house portfolio. */
function topHoldings(
  portfolio: FundHousePortfolio | null,
  n: number
): { name: string; pct: number }[] {
  if (!portfolio) return [];
  const slug = monthSlug(portfolio.meta.months[0]?.label ?? "");
  return portfolio.rows
    .slice(0, n)
    .map((r) => ({ name: r.company_name, pct: r.months[slug]?.aum_pct_num ?? 0 }));
}

/**
 * Fund-wise Compare — pick up to three fund houses and see their latest-month
 * profile side by side: scale & concentration stats (from the directory),
 * market-cap split and top holdings (from each house's aggregated portfolio,
 * fetched on demand). Excel export of the scalar comparison. */
function FundHouseCompare({
  fundHouses,
  initialSlug,
}: {
  fundHouses: FundHouseEntry[];
  initialSlug: string;
}) {
  const bySlug = useMemo(
    () => new Map(fundHouses.map((f) => [f.slug, f])),
    [fundHouses]
  );
  // Up to MAX_COMPARE slots; slot 1 seeded with the active fund house.
  const [slots, setSlots] = useState<string[]>(() => {
    const s = Array<string>(MAX_COMPARE).fill("");
    if (initialSlug && bySlug.has(initialSlug)) s[0] = initialSlug;
    return s;
  });
  const selected = slots.filter((s, i) => s && slots.indexOf(s) === i);

  const [loaded, setLoaded] = useState<Record<string, FundHousePortfolio>>({});
  const [errored, setErrored] = useState<Record<string, true>>({});
  const loadedRef = useRef(loaded);
  const erroredRef = useRef(errored);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);
  useEffect(() => {
    erroredRef.current = errored;
  }, [errored]);

  useEffect(() => {
    const ctrls: AbortController[] = [];
    for (const slug of selected) {
      if (loadedRef.current[slug] || erroredRef.current[slug]) continue;
      const entry = bySlug.get(slug);
      if (!entry) continue;
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      fetch(entry.path, { signal: ctrl.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<FundHousePortfolio>;
        })
        .then((data) => setLoaded((p) => ({ ...p, [slug]: data })))
        .catch((e: unknown) => {
          if ((e as Error).name === "AbortError") return;
          setErrored((p) => ({ ...p, [slug]: true }));
        });
    }
    return () => ctrls.forEach((c) => c.abort());
  }, [selected, bySlug]);

  const cols: CompareCol[] = selected.map((slug) => ({
    entry: bySlug.get(slug) as FundHouseEntry,
    portfolio: loaded[slug] ?? null,
    errored: Boolean(errored[slug]),
  }));

  const setSlot = (i: number, slug: string) =>
    setSlots((prev) => prev.map((s, idx) => (idx === i ? slug : s)));

  // Excel: scalar stats + cap split, one column per selected house.
  type XRow = Record<string, string | number>;
  const exportRows: XRow[] = (() => {
    if (cols.length === 0) return [];
    const metric = (label: string, get: (c: CompareCol) => string | number): XRow => {
      const row: XRow = { metric: label };
      cols.forEach((c) => {
        row[c.entry.amc] = get(c);
      });
      return row;
    };
    return [
      metric("Equity book (₹ Cr)", (c) => c.entry.equityValueCr),
      metric("Schemes", (c) => c.entry.schemeCount),
      metric("Distinct holdings", (c) => c.entry.holdingsCount),
      metric("Top-10 concentration (%)", (c) => c.entry.top10Pct),
      metric("Top-10 MoM (pp)", (c) => c.entry.top10DeltaPp ?? ""),
      metric("Large-cap (%)", (c) => {
        const s = capSplit(c.portfolio);
        return s ? Number(s.large.toFixed(1)) : "";
      }),
      metric("Mid-cap (%)", (c) => {
        const s = capSplit(c.portfolio);
        return s ? Number(s.mid.toFixed(1)) : "";
      }),
      metric("Small-cap (%)", (c) => {
        const s = capSplit(c.portfolio);
        return s ? Number(s.small.toFixed(1)) : "";
      }),
    ];
  })();
  const exportColumns: CsvColumn<XRow>[] = [
    { key: "metric", header: "Metric" },
    ...cols.map((c) => ({ key: c.entry.amc, header: c.entry.amc })),
  ];

  const latestMonth = cols[0]?.entry.latestMonth;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Compare fund houses
          </h2>
          <p className="text-xs text-muted-foreground">
            Pick up to {MAX_COMPARE} fund houses to compare their latest-month
            profile side by side.
            {latestMonth && <span className="ml-1">As of {latestMonth}.</span>}
          </p>
        </div>
        {cols.length > 0 && (
          <DownloadXlsxButton
            rows={exportRows}
            columns={exportColumns}
            filename="fund-house-compare.xlsx"
            sheetName="Compare"
          />
        )}
      </div>

      {/* Slot selectors */}
      <div className="flex flex-wrap gap-3">
        {slots.map((slug, i) => (
          <label key={i} className="flex flex-col gap-1 text-xs text-muted-foreground">
            Fund house {i + 1}
            <select
              value={slug}
              onChange={(e) => setSlot(i, e.target.value)}
              className="min-w-[12rem] rounded-md border bg-card px-2 py-1.5 text-sm text-foreground focus:border-foreground focus:outline-none"
            >
              <option value="">— none —</option>
              {fundHouses.map((f) => (
                <option
                  key={f.slug}
                  value={f.slug}
                  disabled={slots.includes(f.slug) && f.slug !== slug}
                >
                  {f.amc}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {cols.length === 0 ? (
        <div className="rounded-md border border-dashed bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          Select at least one fund house above to compare.
        </div>
      ) : (
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))`,
          }}
        >
          {cols.map((c) => {
            const split = capSplit(c.portfolio);
            const top = topHoldings(c.portfolio, 10);
            return (
              <div
                key={c.entry.slug}
                className="space-y-3 rounded-lg border bg-card p-4"
              >
                <div>
                  <div className="text-sm font-semibold">{c.entry.amc}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {c.entry.schemeCount} schemes · {c.entry.holdingsCount}{" "}
                    holdings
                  </div>
                </div>

                <dl className="space-y-1.5 text-sm">
                  <StatRow label="Equity book">
                    {formatCompactCrSafe(c.entry.equityValueCr)}
                  </StatRow>
                  <StatRow label="Top-10 conc.">
                    {c.entry.top10Pct.toFixed(1)}%
                    {c.entry.top10DeltaPp !== null && (
                      <span
                        className={cn(
                          "ml-1 text-[11px]",
                          c.entry.top10DeltaPp >= 0
                            ? "text-positive"
                            : "text-negative"
                        )}
                      >
                        {c.entry.top10DeltaPp >= 0 ? "+" : ""}
                        {c.entry.top10DeltaPp.toFixed(1)}pp
                      </span>
                    )}
                  </StatRow>
                  <StatRow label="Biggest add">
                    {c.entry.biggestAdd ? (
                      <span>
                        <span className="text-positive">
                          +{c.entry.biggestAdd.pp.toFixed(1)}pp
                        </span>{" "}
                        <span className="text-[11px] text-muted-foreground">
                          {c.entry.biggestAdd.company}
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </StatRow>
                  <StatRow label="Biggest trim">
                    {c.entry.biggestTrim ? (
                      <span>
                        <span className="text-negative">
                          {c.entry.biggestTrim.pp.toFixed(1)}pp
                        </span>{" "}
                        <span className="text-[11px] text-muted-foreground">
                          {c.entry.biggestTrim.company}
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </StatRow>
                </dl>

                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    Market-cap mix
                  </div>
                  {c.errored ? (
                    <div className="text-xs text-muted-foreground">
                      Couldn&apos;t load.
                    </div>
                  ) : split ? (
                    <div className="flex h-5 w-full overflow-hidden rounded border text-[10px] font-medium text-white">
                      <div
                        className="flex items-center justify-center"
                        style={{ width: `${split.large}%`, backgroundColor: "hsl(222 64% 44%)" }}
                        title={`Large ${split.large.toFixed(1)}%`}
                      >
                        {split.large >= 14 ? `${split.large.toFixed(0)}` : ""}
                      </div>
                      <div
                        className="flex items-center justify-center"
                        style={{ width: `${split.mid}%`, backgroundColor: "hsl(200 72% 46%)" }}
                        title={`Mid ${split.mid.toFixed(1)}%`}
                      >
                        {split.mid >= 14 ? `${split.mid.toFixed(0)}` : ""}
                      </div>
                      <div
                        className="flex items-center justify-center"
                        style={{ width: `${split.small}%`, backgroundColor: "hsl(28 80% 52%)" }}
                        title={`Small ${split.small.toFixed(1)}%`}
                      >
                        {split.small >= 14 ? `${split.small.toFixed(0)}` : ""}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">Loading…</div>
                  )}
                  {split && (
                    <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                      <span>L {split.large.toFixed(0)}%</span>
                      <span>M {split.mid.toFixed(0)}%</span>
                      <span>S {split.small.toFixed(0)}%</span>
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">
                    Top 10 holdings
                  </div>
                  {c.errored ? (
                    <div className="text-xs text-muted-foreground">
                      Couldn&apos;t load.
                    </div>
                  ) : top.length > 0 ? (
                    <ol className="space-y-1 text-sm">
                      {top.map((h, idx) => (
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
                    <div className="text-xs text-muted-foreground">Loading…</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StatRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

/**
 * Fund-wise Peers — every fund house side by side on equity-book scale,
 * top-10 concentration (+ MoM move) and the biggest single-stock weight add /
 * trim. The AMC-level counterpart of the scheme-wise Same-category funds
 * table. All figures are precomputed in the directory, so no holdings fetch
 * is needed. */
function FundHousePeers({
  fundHouses,
  selectedSlug,
}: {
  fundHouses: FundHouseEntry[];
  selectedSlug: string;
}) {
  const rows = [...fundHouses].sort((a, b) => b.equityValueCr - a.equityValueCr);
  const latestMonth = fundHouses.find((f) => f.slug === selectedSlug)?.latestMonth;

  type XRow = {
    fundHouse: string;
    schemes: number;
    equityBookCr: number;
    top10Pct: number;
    top10DeltaPp: number | null;
    biggestAddPp: number | null;
    biggestAddName: string;
    biggestTrimPp: number | null;
    biggestTrimName: string;
  };
  const exportColumns: CsvColumn<XRow>[] = [
    { key: "fundHouse", header: "Fund house" },
    { key: "schemes", header: "Schemes" },
    { key: "equityBookCr", header: "Equity book (₹ Cr)" },
    { key: "top10Pct", header: "Top-10 concentration (%)" },
    { key: "top10DeltaPp", header: "Top-10 MoM (pp)" },
    { key: "biggestAddPp", header: "Biggest add (pp MoM)" },
    { key: "biggestAddName", header: "Biggest add — stock" },
    { key: "biggestTrimPp", header: "Biggest trim (pp MoM)" },
    { key: "biggestTrimName", header: "Biggest trim — stock" },
  ];
  const exportRows: XRow[] = rows.map((p) => ({
    fundHouse: p.amc,
    schemes: p.schemeCount,
    equityBookCr: p.equityValueCr,
    top10Pct: p.top10Pct,
    top10DeltaPp: p.top10DeltaPp,
    biggestAddPp: p.biggestAdd?.pp ?? null,
    biggestAddName: p.biggestAdd?.company ?? "",
    biggestTrimPp: p.biggestTrim?.pp ?? null,
    biggestTrimName: p.biggestTrim?.company ?? "",
  }));

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Peer fund houses
          </h2>
          <p className="text-xs text-muted-foreground">
            Every fund house compared on equity-book scale, concentration and
            the month&apos;s biggest weight shifts — aggregated across all of
            each house&apos;s schemes.
            {latestMonth && <span className="ml-1">As of {latestMonth}.</span>}
          </p>
        </div>
        <DownloadXlsxButton
          rows={exportRows}
          columns={exportColumns}
          filename="fund-house-peers.xlsx"
          sheetName="Fund-house Peers"
        />
      </div>
      <div className="overflow-x-auto rounded-md border bg-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/60 text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Fund house</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                Equity book
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                Top-10 conc.
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                Biggest add (pp MoM)
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                Biggest trim (pp MoM)
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const isSelected = p.slug === selectedSlug;
              return (
                <tr
                  key={p.slug}
                  className={cn(
                    "border-b last:border-0",
                    isSelected ? "bg-accent/60" : "hover:bg-accent/30"
                  )}
                >
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <span className={cn(isSelected && "font-semibold")}>
                        {p.amc}
                      </span>
                      {isSelected && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Selected
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {p.schemeCount} schemes
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular align-top">
                    {formatCompactCrSafe(p.equityValueCr)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular align-top text-muted-foreground">
                    <div>{p.top10Pct.toFixed(1)}%</div>
                    {p.top10DeltaPp !== null && (
                      <div
                        className={cn(
                          "text-[11px]",
                          p.top10DeltaPp >= 0 ? "text-positive" : "text-negative"
                        )}
                      >
                        {p.top10DeltaPp >= 0 ? "+" : ""}
                        {p.top10DeltaPp.toFixed(1)}pp
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular align-top">
                    {p.biggestAdd ? (
                      <>
                        <div className="text-positive">
                          +{p.biggestAdd.pp.toFixed(1)}pp
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {p.biggestAdd.company}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular align-top">
                    {p.biggestTrim ? (
                      <>
                        <div className="text-negative">
                          {p.biggestTrim.pp.toFixed(1)}pp
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {p.biggestTrim.company}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SubHead() {
  return (
    <>
      <th className="border-b border-l px-3 py-1.5 text-right font-medium">
        % of book
      </th>
      <th className="border-b px-3 py-1.5 text-right font-medium">Shares</th>
    </>
  );
}

function Cells({
  cell,
}: {
  cell:
    | {
        aum_pct_num: number | null;
        shares_num: number | null;
        arrow: HoldingArrow;
      }
    | undefined;
}) {
  const arrow = cell ? cell.arrow : "missing";
  return (
    <>
      <td className="border-l px-3 py-2.5 text-right tabular text-muted-foreground">
        {formatPctSafe(cell?.aum_pct_num, 1)}
      </td>
      <td className="px-3 py-2.5 text-right tabular">
        <span className="inline-flex items-center justify-end gap-1">
          {formatSharesIndian(cell?.shares_num)} <ArrowMark arrow={arrow} />
        </span>
      </td>
    </>
  );
}
