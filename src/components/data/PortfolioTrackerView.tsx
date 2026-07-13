"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { fmtBps } from "@/lib/units";
import { KeyTakeaway } from "@/components/ui/KeyTakeaway";
import { PortfolioExportBar } from "@/components/data/PortfolioExportBar";
import { exportStamp, slugifyName } from "@/lib/portfolio-export/filename";
import {
  PortfolioHeadToHead,
  isLikelySameScheme,
} from "@/components/data/PortfolioHeadToHead";
import { PortfolioTrendsTab } from "@/components/data/PortfolioTrendsTab";
import { AmcDisclosurePanel } from "@/components/data/AmcDisclosurePanel";
import {
  SectorAllocationChart,
  type SectorAllocationRow,
} from "@/components/data/SectorAllocationChart";
import type { DashboardTabDef } from "@/components/layout/DashboardTabs";
import type { TrackerTabId } from "@/components/data/PortfolioTrackerTabs";
import {
  cleanSchemeName,
  formatCompactCrSafe,
  formatPctSafe,
  formatSharesIndian,
} from "@/lib/format";
import {
  type FundDirectoryEntry,
  type FundPortfolio,
  type HoldingArrow,
  monthSlug,
} from "@/data/portfolio-tracker";
import { classifySector, UNCLASSIFIED } from "@/data/sector-classification";
import { amcOf } from "@/data/amc-name-map";

const MAX_SUGGESTIONS = 60;
// Peer-average cohort cap. Top-N same-category peers by AUM are fetched
// and averaged to compute the OW/UW chips in the Holdings tab. Bounds
// the worst-case fetch (Thematic, n=91 → 20 fetches instead of 91).
const MAX_PEER_AVG_PEERS = 20;

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

/** Coerce a TrackerMonth's aumCr (string | number | null) to a number-or-null
 *  for the shared formatCompactCrSafe helper. */
function aumNum(aumCr: string | number | null): number | null {
  if (aumCr === null || aumCr === "" || aumCr === "-") return null;
  const n = typeof aumCr === "number" ? aumCr : Number(aumCr);
  return Number.isFinite(n) ? n : null;
}

export function PortfolioTrackerView({
  funds,
  tabs,
  initialTab,
  searchParams,
}: {
  funds: FundDirectoryEntry[];
  tabs: readonly DashboardTabDef[];
  initialTab: TrackerTabId;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  // Tab state lives entirely in the browser. Switching tabs is a pure client
  // state change (the active tab is mirrored to the URL hash, e.g. `#holdings`)
  // so it never triggers a `?tab=` round-trip to the Cloudflare Worker — which
  // is what keeps the Worker under its per-request CPU budget (Error 1102) on
  // the Free plan. `initialTab` seeds the first render from any incoming
  // `?tab=` deep link so existing bookmarks still land on the right tab.
  const [activeTab, setActiveTab] = useState<TrackerTabId>(initialTab);

  const selectTab = (id: TrackerTabId) => {
    setActiveTab(id);
    if (typeof window !== "undefined") {
      history.replaceState(null, "", `#${id}`);
    }
  };
  // Optional deep-link: /mfs-portfolio-tracker?fund=<schemecode> pre-selects a
  // scheme (used by the AMC scheme drill-down). Falls back to the first fund.
  const initialFund =
    (typeof searchParams.fund === "string"
      ? funds.find((f) => f.schemecode === searchParams.fund)
      : undefined) ?? funds[0];
  const [selectedCode, setSelectedCode] = useState(
    initialFund?.schemecode ?? ""
  );
  const [query, setQuery] = useState(
    initialFund ? cleanSchemeName(initialFund.fund) : ""
  );
  const [focused, setFocused] = useState(false);
  const [holdingQuery, setHoldingQuery] = useState("");
  // Client-requested filters: narrow the scheme picker to one fund house and
  // the holdings table to one sector — for surfacing "top conviction ideas".
  const [amcFilter, setAmcFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  // Holdings sort: which month-column + field, and direction. null = the
  // default (latest month, % of AUM, descending — biggest weights on top).
  const [holdingSort, setHoldingSort] = useState<{
    slug: string;
    field: "pct" | "shares";
    dir: "asc" | "desc";
  } | null>(null);
  // Head-to-head fund B — null means "use the variant-skipped default
  // for the current A". Cleared whenever A changes (see effect below).
  const [bUserPick, setBUserPick] = useState<string | null>(null);

  // Fetched holdings, keyed by schemecode, so re-selecting never refetches.
  const [loaded, setLoaded] = useState<Record<string, FundPortfolio>>({});
  const [errored, setErrored] = useState<Record<string, true>>({});
  const [reloadNonce, setReloadNonce] = useState(0);

  const selectedEntry =
    funds.find((f) => f.schemecode === selectedCode) ?? funds[0] ?? null;

  const portfolio = selectedEntry ? loaded[selectedEntry.schemecode] ?? null : null;
  const hasError = selectedEntry ? Boolean(errored[selectedEntry.schemecode]) : false;
  const loading = Boolean(selectedEntry) && !portfolio && !hasError;

  // Ref mirrors of loaded/errored so the fetch effects can dedup without
  // putting them in deps — which would otherwise abort the in-flight
  // request each time any OTHER fetch resolves and mutates state.
  const loadedRef = useRef(loaded);
  const erroredRef = useRef(errored);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);
  useEffect(() => {
    erroredRef.current = errored;
  }, [errored]);

  // Load the selected fund's holdings on demand (stale fetches are aborted).
  // Dedup via refs rather than putting loaded/errored in the deps: with
  // them in deps, every resolving peer fetch (up to 21 in parallel) re-ran
  // this effect, whose cleanup aborted the selected fund's still-in-flight
  // request and restarted it — so the holdings the user is waiting on only
  // settled after the whole peer fan-out finished.
  useEffect(() => {
    if (!selectedEntry) return;
    const code = selectedEntry.schemecode;
    if (loadedRef.current[code] || erroredRef.current[code]) return;
    const ctrl = new AbortController();
    fetch(selectedEntry.path, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<FundPortfolio>;
      })
      .then((data) => setLoaded((prev) => ({ ...prev, [code]: data })))
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setErrored((prev) => ({ ...prev, [code]: true }));
      });
    return () => ctrl.abort();
  }, [selectedEntry, reloadNonce]);

  // Funds sharing the selected fund's category, sorted by AUM desc. The
  // SameCategoryFunds section renders top-9 peers + selected (pinned), with
  // the cohort total surfaced in the subtitle.
  const sameCategoryFunds = useMemo(() => {
    if (!selectedEntry?.classification) return [] as FundDirectoryEntry[];
    return funds
      .filter((f) => f.classification === selectedEntry.classification)
      .slice()
      .sort((a, b) => (b.aumTotalCr ?? 0) - (a.aumTotalCr ?? 0));
  }, [funds, selectedEntry]);

  // Top-N same-category peers by AUM EXCLUDING the selected fund — the set
  // averaged into the OW/UW chip baseline. min(MAX_PEER_AVG_PEERS, cohort − 1).
  const peerAvgRows = useMemo(() => {
    if (!selectedEntry) return [] as FundDirectoryEntry[];
    return sameCategoryFunds
      .filter((f) => f.schemecode !== selectedEntry.schemecode)
      .slice(0, MAX_PEER_AVG_PEERS);
  }, [sameCategoryFunds, selectedEntry]);

  // Top-21 including self — the FETCH cohort. Slightly wider than peerAvgRows
  // so we always have ≥20 non-self peers available even when the selected fund
  // is itself ranked in the top-20 by AUM. The selected fund's own holdings
  // are already fetched by the selected-fund effect; the dup is harmless
  // because the loadedRef check dedups before issuing.
  const peerAvgFetchTargets = useMemo(() => {
    return sameCategoryFunds.slice(0, MAX_PEER_AVG_PEERS + 1);
  }, [sameCategoryFunds]);

  // Fan-out fetch peer holdings in parallel. Bounded at MAX_PEER_AVG_PEERS+1
  // requests per category (vs ~91 uncapped for Thematic). Aborts only on
  // cohort change (array reference), not on per-peer state updates.
  useEffect(() => {
    if (peerAvgFetchTargets.length === 0) return;
    const ctrls: AbortController[] = [];
    for (const p of peerAvgFetchTargets) {
      const code = p.schemecode;
      if (loadedRef.current[code] || erroredRef.current[code]) continue;
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      fetch(p.path, { signal: ctrl.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<FundPortfolio>;
        })
        .then((data) =>
          setLoaded((prev) => (prev[code] ? prev : { ...prev, [code]: data }))
        )
        .catch((e: unknown) => {
          if ((e as Error).name === "AbortError") return;
          setErrored((prev) =>
            prev[code] ? prev : { ...prev, [code]: true }
          );
        });
    }
    return () => ctrls.forEach((c) => c.abort());
  }, [peerAvgFetchTargets]);

  function retry() {
    if (!selectedEntry) return;
    const code = selectedEntry.schemecode;
    setErrored((prev) => {
      const next = { ...prev };
      delete next[code];
      return next;
    });
    setReloadNonce((n) => n + 1);
  }

  // Head-to-head: same-category cohort with A removed. The picker UI
  // surfaces every entry here verbatim (including variant twins of A).
  const bCandidates = useMemo(() => {
    if (!selectedEntry) return [] as FundDirectoryEntry[];
    return sameCategoryFunds.filter(
      (f) => f.schemecode !== selectedEntry.schemecode
    );
  }, [sameCategoryFunds, selectedEntry]);

  // Default B = largest non-variant peer by AUM (variant skip per
  // Revision 2). If every candidate is a flagged variant of A, fall back
  // to the largest non-A candidate so the tab still functions.
  const defaultBCode = useMemo(() => {
    if (!selectedEntry || bCandidates.length === 0) return null;
    const preferred = bCandidates.find(
      (c) => !isLikelySameScheme(selectedEntry, c)
    );
    return preferred?.schemecode ?? bCandidates[0]?.schemecode ?? null;
  }, [bCandidates, selectedEntry]);

  const effectiveBCode = bUserPick ?? defaultBCode;
  const effectiveBEntry = effectiveBCode
    ? funds.find((f) => f.schemecode === effectiveBCode) ?? null
    : null;
  const bPortfolio = effectiveBCode ? loaded[effectiveBCode] ?? undefined : undefined;
  const bErrored = effectiveBCode ? Boolean(errored[effectiveBCode]) : false;
  const bLoading = Boolean(effectiveBCode) && !bPortfolio && !bErrored;

  // Revision 1: every A-change clears the user's B pick so default-B
  // re-derives against the new cohort. Done unconditionally — we do not
  // try to preserve an old B even when it would still be a valid peer.
  // Set-during-render pattern (React's recommended "adjusting state on
  // prop change" approach) avoids the extra commit an effect would add.
  const [prevSelectedCode, setPrevSelectedCode] = useState(selectedCode);
  if (prevSelectedCode !== selectedCode) {
    setPrevSelectedCode(selectedCode);
    setBUserPick(null);
  }

  // Dedicated fetch for B when it sits OUTSIDE the top-21 peer fetch
  // cohort. Uses refs (loadedRef/erroredRef) so unrelated peer landings
  // don't abort and restart this fetch.
  useEffect(() => {
    const code = effectiveBCode;
    if (!code) return;
    if (loadedRef.current[code] || erroredRef.current[code]) return;
    const entry = funds.find((f) => f.schemecode === code);
    if (!entry) return;
    const ctrl = new AbortController();
    fetch(entry.path, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<FundPortfolio>;
      })
      .then((data) =>
        setLoaded((prev) => (prev[code] ? prev : { ...prev, [code]: data }))
      )
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setErrored((prev) => (prev[code] ? prev : { ...prev, [code]: true }));
      });
    return () => ctrl.abort();
  }, [effectiveBCode, funds, reloadNonce]);

  function pickB(code: string) {
    setBUserPick(code);
  }

  function retryB() {
    if (!effectiveBCode) return;
    const code = effectiveBCode;
    setErrored((prev) => {
      const next = { ...prev };
      delete next[code];
      return next;
    });
    setReloadNonce((n) => n + 1);
  }

  const amcOptions = useMemo(
    () => [...new Set(funds.map((f) => amcOf(f.fund)))].sort(),
    [funds]
  );

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = amcFilter
      ? funds.filter((f) => amcOf(f.fund) === amcFilter)
      : funds;
    const matched = q
      ? pool.filter((f) => f.fund.toLowerCase().includes(q))
      : pool;
    return matched.slice(0, MAX_SUGGESTIONS);
  }, [funds, query, amcFilter]);

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

  // Sort the holdings by the chosen month-column (default: latest month's
  // % of AUM, descending). Clicking a "% of AUM" / "Shares" header re-sorts.
  const sortSlug = holdingSort?.slug ?? slugs[0] ?? "";
  const sortField = holdingSort?.field ?? "pct";
  const sortDir = holdingSort?.dir ?? "desc";
  const sortValue = (r: (typeof holdings)[number]): number | null => {
    const c = r.months[sortSlug];
    const v = sortField === "pct" ? c?.aum_pct_num : c?.shares_num;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const sortedHoldings = [...holdings].sort((a, b) => {
    const av = sortValue(a);
    const bv = sortValue(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return sortDir === "desc" ? bv - av : av - bv;
  });
  const onSortHolding = (slug: string, field: "pct" | "shares") => {
    setHoldingSort((prev) => {
      if (prev && prev.slug === slug && prev.field === field) {
        return { slug, field, dir: prev.dir === "desc" ? "asc" : "desc" };
      }
      return { slug, field, dir: "desc" };
    });
  };


  // Month-over-month read for the selected fund: biggest weight add/trim
  // and the top-10 concentration shift, in percentage points of AUM.
  const flowSummary = useMemo(() => {
    if (!portfolio || portfolio.meta.months.length < 2) return null;
    const cur = monthSlug(portfolio.meta.months[0].label);
    const prev = monthSlug(portfolio.meta.months[1].label);
    const clean = (s: string) =>
      s.replace(/^eq\s*-\s*/i, "").replace(/^[\s^*#~]+/, "").replace(/[£@*#~]+$/, "").trim();
    let topAdd: { name: string; d: number } | null = null;
    let topTrim: { name: string; d: number } | null = null;
    const curPcts: number[] = [];
    const prevPcts: number[] = [];
    for (const r of portfolio.rows) {
      const c = r.months[cur]?.aum_pct_num ?? 0;
      const p = r.months[prev]?.aum_pct_num ?? 0;
      const d = c - p;
      if (!topAdd || d > topAdd.d) topAdd = { name: clean(r.company_name), d };
      if (!topTrim || d < topTrim.d) topTrim = { name: clean(r.company_name), d };
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

  // K of N peers loaded — drives the chart subtitle and the peer-average
  // denominator. Peers that haven't loaded yet are excluded from the average.
  const peerAvgLoadedCount = useMemo(() => {
    let n = 0;
    for (const p of peerAvgRows) if (loaded[p.schemecode]) n++;
    return n;
  }, [peerAvgRows, loaded]);

  // Sector allocation of the selected fund vs the same-category peer average,
  // for the latest month. Each holding is bucketed via classifySector
  // (curated fincode map + name fallback); weights are summed per sector. The
  // peer average sums each loaded peer's per-sector weight and divides by the
  // peer count (peers absent from a sector contribute 0). Feeds the
  // Overview-tab "Sector Allocation v/s Category Average" chart.
  const sectorVsCategory = useMemo<SectorAllocationRow[]>(() => {
    if (!portfolio) return [];
    const curSlug = monthSlug(portfolio.meta.months[0]?.label ?? "");
    if (!curSlug) return [];

    const sectorTotals = (data: FundPortfolio, slug: string) => {
      const m = new Map<string, number>();
      for (const r of data.rows) {
        const w = r.months[slug]?.aum_pct_num ?? 0;
        if (!w) continue;
        const s = classifySector(r.fincode, r.company_name);
        m.set(s, (m.get(s) ?? 0) + w);
      }
      return m;
    };

    const fundSectors = sectorTotals(portfolio, curSlug);

    const peerSum = new Map<string, number>();
    let K = 0;
    for (const p of peerAvgRows) {
      const data = loaded[p.schemecode];
      if (!data) continue;
      K++;
      const pSlug = monthSlug(data.meta.months[0]?.label ?? "");
      if (!pSlug) continue;
      for (const [s, w] of sectorTotals(data, pSlug)) {
        peerSum.set(s, (peerSum.get(s) ?? 0) + w);
      }
    }

    const sectors = new Set<string>([...fundSectors.keys(), ...peerSum.keys()]);
    const rows: SectorAllocationRow[] = [...sectors].map((s) => ({
      label: s,
      fund: fundSectors.get(s) ?? 0,
      peerAvg: K > 0 ? (peerSum.get(s) ?? 0) / K : null,
    }));
    // Unclassified sinks to the end; everything else by fund weight desc.
    rows.sort(
      (a, b) =>
        (a.label === UNCLASSIFIED ? 1 : 0) - (b.label === UNCLASSIFIED ? 1 : 0) ||
        (b.fund ?? 0) - (a.fund ?? 0)
    );
    return rows.slice(0, 12);
  }, [portfolio, peerAvgRows, loaded]);

  function pick(f: FundDirectoryEntry) {
    setSelectedCode(f.schemecode);
    setQuery(cleanSchemeName(f.fund));
    setHoldingQuery("");
    setFocused(false);
  }

  // Master export — gathers the selected scheme's full profile (returns,
  // ranking, ratios, holdings, sector allocation, peers) and builds a styled
  // workbook / PDF. The heavy export modules are dynamically imported on click.
  async function handleExcel() {
    if (!selectedEntry) return;
    const [{ gatherSchemeExport }, { downloadSchemeXlsx }] = await Promise.all([
      import("@/lib/portfolio-export/gather"),
      import("@/lib/portfolio-export/excel"),
    ]);
    const data = await gatherSchemeExport({
      entry: selectedEntry,
      amc: amcOf(selectedEntry.fund),
      portfolio,
      sectorRows: sectorVsCategory,
      generatedAt: exportStamp(),
    });
    await downloadSchemeXlsx(data, `${slugifyName(cleanSchemeName(selectedEntry.fund))}.xlsx`);
  }
  async function handlePdf() {
    if (!selectedEntry) return;
    const [{ gatherSchemeExport }, { downloadSchemePdf }] = await Promise.all([
      import("@/lib/portfolio-export/gather"),
      import("@/lib/portfolio-export/pdf"),
    ]);
    const data = await gatherSchemeExport({
      entry: selectedEntry,
      amc: amcOf(selectedEntry.fund),
      portfolio,
      sectorRows: sectorVsCategory,
      generatedAt: exportStamp(),
    });
    await downloadSchemePdf(data, `${slugifyName(cleanSchemeName(selectedEntry.fund))}.pdf`);
  }

  const loaderUi = (
    <div className="flex h-40 items-center justify-center gap-2 rounded-md border bg-card text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading holdings…
    </div>
  );

  const errorUi = (
    <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground">
      <span className="text-negative">
        Couldn&apos;t load holdings for this fund.
      </span>
      <button
        type="button"
        onClick={retry}
        className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
      >
        Retry
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Master export — one Excel + one PDF for the whole selected scheme. */}
      <PortfolioExportBar
        title="Download this scheme"
        hint={
          selectedEntry
            ? `${cleanSchemeName(selectedEntry.fund)} — profile, returns & ranking, risk ratios, holdings, sector mix & peers`
            : "Select a scheme to export its full profile"
        }
        onExcel={handleExcel}
        onPdf={handlePdf}
        disabled={!selectedEntry}
      />

      {/* Global fund picker + AMC filter — visible above the tab strip. */}
      <div className="flex max-w-3xl flex-wrap items-center gap-3">
        <select
          value={amcFilter}
          onChange={(e) => {
            setAmcFilter(e.target.value);
            setFocused(true);
          }}
          aria-label="Filter schemes by fund house"
          className="rounded-md border bg-card px-2 py-2.5 text-sm text-foreground focus:border-foreground focus:outline-none"
        >
          <option value="">All fund houses</option>
          {amcOptions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      <div className="relative min-w-[16rem] flex-1">
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
          placeholder="Search mutual funds here…"
          aria-label="Search mutual fund schemes"
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
          <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-card py-1 shadow-md">
            {suggestions.map((f) => (
              <li key={f.schemecode}>
                <button
                  type="button"
                  // mousedown fires before the input's blur, so the pick lands
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(f);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent",
                    f.schemecode === selectedCode && "bg-accent/60"
                  )}
                >
                  <span>{cleanSchemeName(f.fund)}</span>
                  {f.classification && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {f.classification}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      </div>

      {/* Client-side tab strip — switching tabs is pure browser state (mirrored
       *  to the URL hash), so a tab switch never spends Worker CPU (Error 1102). */}
      <div
        className="sticky top-14 z-20 -mx-6 mb-6 border-b border-border bg-background/85 backdrop-blur lg:-mx-8"
        data-component="dashboard-tabs"
      >
        <nav
          role="tablist"
          aria-label="Portfolio tracker sections"
          className="flex gap-1 overflow-x-auto px-6 py-2 lg:px-8"
        >
          {tabs.map((t) => {
            const active = t.id === activeTab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectTab(t.id as TrackerTabId)}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-primary/10 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      {!selectedEntry ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
          No fund selected.
        </div>
      ) : (
        <>
          {activeTab === "overview" && (
            <>
              {/* Fund name + category header — Overview tab only */}
              <div className="rounded-lg border bg-card px-5 py-4 text-sm">
                <div>
                  Fund Name -{" "}
                  <span className="font-semibold">
                    {cleanSchemeName(selectedEntry.fund)}
                  </span>
                </div>
                {selectedEntry.classification && (
                  <div className="mt-1 text-muted-foreground">
                    Category - {selectedEntry.classification}
                  </div>
                )}
                {selectedEntry.aumTotalCr != null && (
                  <div className="mt-1 text-muted-foreground">
                    Latest AUM — {formatCompactCrSafe(selectedEntry.aumTotalCr)}
                  </div>
                )}
              </div>

              {loading ? (
                loaderUi
              ) : hasError ? (
                errorUi
              ) : portfolio &&
                flowSummary &&
                flowSummary.topAdd &&
                flowSummary.topTrim ? (
                <KeyTakeaway
                  headline={
                    <>
                      In {flowSummary.label}, {cleanSchemeName(selectedEntry.fund)}{" "}
                      raised its weight most in{" "}
                      <strong>{flowSummary.topAdd.name}</strong> (
                      <span className="text-positive">
                        {fmtBps(flowSummary.topAdd.d)}
                      </span>
                      ) and trimmed{" "}
                      <strong>{flowSummary.topTrim.name}</strong> (
                      <span className="text-negative">
                        {fmtBps(flowSummary.topTrim.d)}
                      </span>
                      ).
                    </>
                  }
                  detail={
                    <>
                      Top-10 holdings = {flowSummary.concCur.toFixed(1)}% of
                      equity AUM (
                      <span
                        className={
                          flowSummary.concDelta >= 0
                            ? "text-positive"
                            : "text-negative"
                        }
                      >
                        {fmtBps(flowSummary.concDelta)}
                      </span>{" "}
                      MoM).
                    </>
                  }
                />
              ) : null}

              {portfolio &&
                sectorVsCategory.length > 0 &&
                selectedEntry.classification && (
                  <div className="rounded-lg border bg-card px-5 py-4">
                    <div className="mb-1">
                      <h2 className="text-base font-semibold tracking-tight">
                        Sector Allocation v/s Category Average
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        Sector mix (% of AUM) for the selected fund vs the
                        average across the top-{peerAvgRows.length} same-category
                        peers by AUM ({peerAvgLoadedCount} of {peerAvgRows.length}{" "}
                        loaded). Holdings outside the sector map show as
                        Unclassified.
                      </p>
                    </div>
                    <SectorAllocationChart
                      data={sectorVsCategory}
                      fundName={cleanSchemeName(selectedEntry.fund)}
                      peerLabel={selectedEntry.classification}
                    />
                  </div>
                )}
            </>
          )}

          {activeTab === "holdings" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold tracking-tight">
                  {portfolio?.meta.section || "Equity Holdings"}
                </h2>
                <div className="flex items-center gap-2">
                <select
                  value={sectorFilter}
                  onChange={(e) => setSectorFilter(e.target.value)}
                  aria-label="Filter holdings by sector"
                  disabled={!portfolio}
                  className="rounded-md border bg-card px-2 py-1.5 text-sm text-foreground focus:border-foreground focus:outline-none disabled:opacity-50"
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
                    placeholder="Search Here"
                    aria-label="Search holdings by company"
                    disabled={!portfolio}
                    className="w-56 rounded-md border bg-background py-1.5 pl-3 pr-8 text-sm placeholder:text-muted-foreground focus:border-foreground focus:outline-none disabled:opacity-50"
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
                </div>
              </div>

              {loading ? (
                loaderUi
              ) : hasError ? (
                errorUi
              ) : portfolio ? (
                <>
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
                                AUM: {formatCompactCrSafe(aumNum(m.aumCr))}
                              </div>
                            </th>
                          ))}
                        </tr>
                        <tr className="bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                          {months.map((m, i) => (
                            <FragmentSubHead
                              key={m.label}
                              slug={slugs[i]}
                              sortSlug={sortSlug}
                              sortField={sortField}
                              sortDir={sortDir}
                              onSort={onSortHolding}
                            />
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
                          sortedHoldings.map((row) => (
                            <tr
                              key={row.fincode}
                              className="border-b last:border-0 hover:bg-accent/40"
                            >
                              <td className="border-r px-3 py-2.5 font-medium">
                                {row.company_name}
                              </td>
                              {slugs.map((slug) => {
                                const cell = row.months[slug];
                                return <Cells key={slug} cell={cell} />;
                              })}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {portfolio.rows.length} equity holdings · arrows compare a
                    month&apos;s share count to the next-older month (
                    {months.map((m) => m.label).join(" → ")}); the oldest column
                    shows no arrow. Source: {portfolio.meta.source}.
                  </p>
                </>
              ) : null}

              <AmcDisclosurePanel schemecode={selectedCode} />
            </div>
          )}

          {activeTab === "head-to-head" && (
            <>
              {loading ? (
                loaderUi
              ) : hasError ? (
                errorUi
              ) : !portfolio ? null : !selectedEntry.classification ? (
                <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                  Head-to-head requires a categorised equity fund — this fund
                  has no classification.
                </div>
              ) : sameCategoryFunds.length <= 1 ? (
                <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                  No same-category peers available in{" "}
                  {selectedEntry.classification}.
                </div>
              ) : (
                <PortfolioHeadToHead
                  aEntry={selectedEntry}
                  aPortfolio={portfolio}
                  bEntry={effectiveBEntry}
                  bPortfolio={bPortfolio}
                  bLoading={bLoading}
                  bErrored={bErrored}
                  onPickB={pickB}
                  onRetryB={retryB}
                  bCandidates={bCandidates}
                  category={selectedEntry.classification}
                />
              )}
            </>
          )}

          {activeTab === "trends" && (
            <PortfolioTrendsTab
              schemecode={selectedEntry.schemecode}
              fundName={cleanSchemeName(selectedEntry.fund)}
            />
          )}
        </>
      )}
    </div>
  );
}

function FragmentSubHead({
  slug,
  sortSlug,
  sortField,
  sortDir,
  onSort,
}: {
  slug: string;
  sortSlug: string;
  sortField: "pct" | "shares";
  sortDir: "asc" | "desc";
  onSort: (slug: string, field: "pct" | "shares") => void;
}) {
  const indicator = (field: "pct" | "shares") =>
    sortSlug === slug && sortField === field
      ? sortDir === "desc"
        ? " ▼"
        : " ▲"
      : "";
  const btn = "ml-auto inline-flex items-center hover:text-foreground";
  return (
    <>
      <th className="border-b border-l px-3 py-1.5 text-right font-medium">
        <button
          type="button"
          onClick={() => onSort(slug, "pct")}
          className={btn}
        >
          % of AUM{indicator("pct")}
        </button>
      </th>
      <th className="border-b px-3 py-1.5 text-right font-medium">
        <button
          type="button"
          onClick={() => onSort(slug, "shares")}
          className={btn}
        >
          Shares{indicator("shares")}
        </button>
      </th>
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
