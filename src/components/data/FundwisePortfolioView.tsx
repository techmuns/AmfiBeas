"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  type FundPortfolio,
  monthSlug,
} from "@/data/portfolio-tracker";
import { classifyCap } from "@/data/cap-classification";
import { classifySector, UNCLASSIFIED } from "@/data/sector-classification";

const MAX_SUGGESTIONS = 60;

type FundwiseTab = "holdings" | "peers" | "allocation";
const FUNDWISE_TABS: { id: FundwiseTab; label: string }[] = [
  { id: "holdings", label: "Holdings" },
  { id: "peers", label: "Peers" },
  { id: "allocation", label: "Allocation mix" },
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

  const holdings = useMemo(() => {
    if (!portfolio) return [];
    const q = holdingQuery.trim().toLowerCase();
    if (!q) return portfolio.rows;
    return portfolio.rows.filter((r) =>
      r.company_name.toLowerCase().includes(q)
    );
  }, [portfolio, holdingQuery]);

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
          ) : portfolio && tab === "allocation" ? (
            <FundHouseAllocation
              portfolio={portfolio}
              amc={selected.amc}
              latestMonth={selected.latestMonth}
            />
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

const CAP_META: { key: "large" | "mid" | "small"; label: string; color: string }[] = [
  { key: "large", label: "Large-cap", color: "hsl(var(--chart-1))" },
  { key: "mid", label: "Mid-cap", color: "hsl(var(--chart-2))" },
  { key: "small", label: "Small-cap", color: "hsl(var(--chart-4))" },
];

/**
 * Fund-wise Allocation mix — the selected fund house's equity book split by
 * market-cap tier and by sector, computed from the SAME aggregated holdings
 * the Holdings tab shows (each company weighted by its % of the book in the
 * latest month). Tables-first per the dashboard's house style. */
function FundHouseAllocation({
  portfolio,
  amc,
  latestMonth,
}: {
  portfolio: FundPortfolio;
  amc: string;
  latestMonth: string;
}) {
  const latestSlug = monthSlug(portfolio.meta.months[0]?.label ?? "");

  const { cap, sectors } = useMemo(() => {
    const capRaw = { large: 0, mid: 0, small: 0 };
    const secRaw = new Map<string, number>();
    let total = 0;
    for (const r of portfolio.rows) {
      const w = r.months[latestSlug]?.aum_pct_num ?? 0;
      if (!w) continue;
      total += w;
      capRaw[classifyCap(r.company_name)] += w;
      const s = classifySector(r.fincode, r.company_name);
      secRaw.set(s, (secRaw.get(s) ?? 0) + w);
    }
    const norm = (v: number) => (total > 0 ? (v / total) * 100 : 0);
    const sectors = [...secRaw.entries()]
      .map(([label, v]) => ({ label, pct: norm(v) }))
      .sort(
        (a, b) =>
          (a.label === UNCLASSIFIED ? 1 : 0) - (b.label === UNCLASSIFIED ? 1 : 0) ||
          b.pct - a.pct
      );
    return {
      cap: {
        large: norm(capRaw.large),
        mid: norm(capRaw.mid),
        small: norm(capRaw.small),
      },
      sectors,
    };
  }, [portfolio, latestSlug]);

  type XRow = { kind: string; bucket: string; pct: number };
  const exportRows: XRow[] = [
    ...CAP_META.map((c) => ({ kind: "Cap", bucket: c.label, pct: Number(cap[c.key].toFixed(1)) })),
    ...sectors.map((s) => ({ kind: "Sector", bucket: s.label, pct: Number(s.pct.toFixed(1)) })),
  ];
  const exportColumns: CsvColumn<XRow>[] = [
    { key: "kind", header: "Allocation" },
    { key: "bucket", header: "Bucket" },
    { key: "pct", header: "% of equity book" },
  ];

  const sectorMax = Math.max(0.01, ...sectors.map((s) => s.pct));

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Allocation mix — {amc}
          </h2>
          <p className="text-xs text-muted-foreground">
            How {amc}&apos;s combined equity book splits by market-cap tier and
            by sector. Each holding is weighted by its % of the book. As of{" "}
            {latestMonth}.
          </p>
        </div>
        <DownloadXlsxButton
          rows={exportRows}
          columns={exportColumns}
          filename={`${amc.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-allocation-mix.xlsx`}
          sheetName="Allocation Mix"
        />
      </div>

      {/* Cap allocation — stacked proportion bar + table */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Market-cap allocation</h3>
        <div className="flex h-6 w-full overflow-hidden rounded-md border">
          {CAP_META.map((c) =>
            cap[c.key] > 0 ? (
              <div
                key={c.key}
                className="flex items-center justify-center text-[10px] font-medium text-white"
                style={{ width: `${cap[c.key]}%`, backgroundColor: c.color }}
                title={`${c.label} ${cap[c.key].toFixed(1)}%`}
              >
                {cap[c.key] >= 8 ? `${cap[c.key].toFixed(0)}%` : ""}
              </div>
            ) : null
          )}
        </div>
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {CAP_META.map((c) => (
                <tr key={c.key} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    <span
                      className="mr-2 inline-block h-2.5 w-2.5 rounded-[2px] align-middle"
                      style={{ backgroundColor: c.color }}
                    />
                    {c.label}
                  </td>
                  <td className="px-3 py-2 text-right tabular font-medium">
                    {cap[c.key].toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sector allocation — table with proportion bars */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Sector allocation</h3>
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-muted/60 text-xs text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium">Sector</th>
                <th className="px-3 py-2 text-right font-medium">% of book</th>
                <th className="w-[40%] px-3 py-2 text-left font-medium">Weight</th>
              </tr>
            </thead>
            <tbody>
              {sectors.map((s) => (
                <tr key={s.label} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    {s.label === UNCLASSIFIED ? (
                      <span className="text-muted-foreground">{s.label}</span>
                    ) : (
                      s.label
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular text-foreground">
                    {s.pct.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2">
                    <div className="h-2 w-full overflow-hidden rounded-sm bg-muted">
                      <div
                        className="h-full rounded-sm bg-[hsl(var(--chart-1))]"
                        style={{ width: `${(s.pct / sectorMax) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Sectors derive from a curated company→sector map; holdings outside it
          show as Unclassified. Weights are % of {amc}&apos;s aggregated equity
          book (latest month), so they sum to ~100%.
        </p>
      </div>
    </section>
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
