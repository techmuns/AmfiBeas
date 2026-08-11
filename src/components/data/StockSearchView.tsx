"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X, TriangleAlert, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/Card";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";

/** A row from our own holdings directory (public/stocks/index.json). */
interface IndexRow {
  slug: string;
  name: string;
  sector: string;
  funds: number;
}
interface IndexFile {
  meta: {
    generatedAt: string;
    months: string[];
    schemes: number;
    stocks: number;
    source: string;
    note: string;
  };
  stocks: IndexRow[];
}
/** A suggestion from the company-search API. */
interface ApiRow {
  symbol: string;
  name: string;
  country: string;
  sector: string;
}
interface HolderRow {
  scheme: string;
  amc: string;
  code: string;
  aumCr: number | null;
  pctOfAum: number | null;
  shares: (number | null)[];
}
interface StockDetail {
  slug: string;
  fincode: string | null;
  name: string;
  sector: string;
  months: string[];
  fundCount: number;
  holdersByMonth: number[];
  totalShares: (number | null)[];
  funds: HolderRow[];
}

const MAX_SUGGESTIONS = 12;
const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

const fmtInt = (v: number | null | undefined) =>
  v == null ? "—" : Math.round(v).toLocaleString("en-IN");
const fmtCr = (v: number | null | undefined) =>
  v == null ? "—" : Math.round(v).toLocaleString("en-IN");
const fmtPct = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));

/**
 * Fold a company name to a comparison key. The search API and the AMC filings
 * spell the same company differently ("Reliance Industries Ltd" vs "Reliance
 * Industries Limited", "…Inc. Common Stock"), and the API returns a ticker while
 * our holdings are keyed by ISIN — so the name is the only bridge between them.
 */
function nameKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(common|ordinary)\s+(stock|shares?)\b/g, " ")
    .replace(/\bclass\s+[a-z]\b/g, " ")
    .replace(/\b(ltd|limited|inc|incorporated|plc|corp|corporation|company|the|adr)\b/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ▲ / ▼ against the next-older month. Nothing shows when either side wasn't
 *  disclosed — an absent filing is not a change in shareholding. */
function Delta({ cur, prev }: { cur: number | null; prev: number | null | undefined }) {
  if (cur == null || prev == null || cur === prev) return null;
  const up = cur > prev;
  return (
    <span
      className={cn("ml-1 text-[10px]", up ? "text-positive" : "text-negative")}
      aria-label={up ? "increased vs previous month" : "decreased vs previous month"}
    >
      {up ? "▲" : "▼"}
    </span>
  );
}

export function StockSearchView() {
  const [index, setIndex] = useState<IndexFile | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  /** Results tagged with the query they came from, so a stale response is simply
   *  ignored rather than having to be cleared imperatively. */
  const [apiResult, setApiResult] = useState<{ q: string; rows: ApiRow[] }>({
    q: "",
    rows: [],
  });
  const [searching, setSearching] = useState(false);
  /** "api" = live search; "local" = API unavailable, matching our own directory. */
  const [mode, setMode] = useState<"api" | "local">("api");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [notHeld, setNotHeld] = useState<ApiRow | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Our holdings directory: needed to resolve a picked company to its holder
  // list (the API knows tickers, our data knows ISINs) and as the search
  // fallback when the API is unavailable.
  useEffect(() => {
    let alive = true;
    fetch("/stocks/index.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no index"))))
      .then((j: IndexFile) => alive && setIndex(j))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const byName = useMemo(() => {
    const m = new Map<string, IndexRow>();
    for (const s of index?.stocks ?? []) {
      const k = nameKey(s.name);
      // Keep the most widely held on a key collision.
      const prev = m.get(k);
      if (!prev || s.funds > prev.funds) m.set(k, s);
    }
    return m;
  }, [index]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Debounced live search. A new keystroke aborts the in-flight request so late
  // responses can't overwrite the dropdown for a query the user has moved past.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setSearching(true);
      fetch(`/api/stock-search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then(async (r) => {
          const body = (await r.json().catch(() => ({}))) as { results?: ApiRow[] };
          if (!r.ok) {
            // Either the token isn't set yet (503) or the upstream failed (502).
            // Either way, fall back to matching our own directory so the tab
            // stays usable instead of dead.
            setMode("local");
            setApiResult({ q, rows: [] });
            return;
          }
          setMode("api");
          setApiResult({ q, rows: body.results ?? [] });
        })
        .catch((e) => {
          if ((e as Error).name !== "AbortError") {
            setMode("local");
            setApiResult({ q, rows: [] });
          }
        })
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  /** Local-directory matches, used when the API can't serve the search. */
  const localRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!index || q.length < MIN_QUERY) return [];
    const starts: IndexRow[] = [];
    const contains: IndexRow[] = [];
    for (const s of index.stocks) {
      const n = s.name.toLowerCase();
      if (n.startsWith(q)) starts.push(s);
      else if (n.includes(q)) contains.push(s);
      if (starts.length >= MAX_SUGGESTIONS) break;
    }
    return [...starts, ...contains.sort((a, b) => b.funds - a.funds)].slice(0, MAX_SUGGESTIONS);
  }, [index, query]);

  // One suggestion list for the dropdown, whichever source produced it. API rows
  // are used only while they match the current query, so a response that lands
  // after the user has typed on is discarded.
  const apiRows = useMemo(
    () => (apiResult.q === query.trim() ? apiResult.rows : []),
    [apiResult, query]
  );
  const suggestions = useMemo(() => {
    if (mode === "api") {
      return apiRows.slice(0, MAX_SUGGESTIONS).map((r) => ({
        key: r.symbol,
        name: r.name,
        meta: [r.symbol, r.country, r.sector].filter(Boolean).join(" · "),
        api: r as ApiRow | null,
        local: byName.get(nameKey(r.name)) ?? null,
      }));
    }
    return localRows.map((r) => ({
      key: r.slug,
      name: r.name,
      meta: `${r.sector} · ${r.funds} fund${r.funds === 1 ? "" : "s"}`,
      api: null,
      local: r,
    }));
  }, [mode, apiRows, localRows, byName]);

  const loadDetail = useCallback((row: IndexRow) => {
    setLoading(true);
    setDetail(null);
    setNotHeld(null);
    fetch(`/stocks/${row.slug}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("missing"))))
      .then((j: StockDetail) => setDetail(j))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, []);

  const pick = useCallback(
    (s: { name: string; api: ApiRow | null; local: IndexRow | null }) => {
      setQuery(s.name);
      setSelectedName(s.name);
      setOpen(false);
      if (s.local) {
        loadDetail(s.local);
      } else {
        // Searchable company, but no tracked scheme holds it.
        setDetail(null);
        setLoading(false);
        setNotHeld(s.api ?? { symbol: "", name: s.name, country: "", sector: "" });
      }
    },
    [loadDetail]
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = suggestions[highlight] ?? suggestions[0];
      if (row) pick(row);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  type HolderX = Record<string, string | number>;
  const holderColumns: CsvColumn<HolderX>[] = useMemo(
    () => [
      { key: "scheme", header: "Fund name" },
      { key: "amc", header: "Fund house" },
      { key: "aumCr", header: "Scheme AUM (₹ Cr)" },
      { key: "pctOfAum", header: "% of AUM" },
      ...(detail?.months ?? []).map((m) => ({ key: `m${m}`, header: `${m} shares` })),
    ],
    [detail]
  );
  const holderRows: HolderX[] = useMemo(() => {
    if (!detail) return [];
    return detail.funds.map((f) => {
      const row: HolderX = {
        scheme: f.scheme,
        amc: f.amc,
        aumCr: f.aumCr ?? "",
        pctOfAum: f.pctOfAum ?? "",
      };
      detail.months.forEach((m, i) => {
        row[`m${m}`] = f.shares[i] ?? "";
      });
      return row;
    });
  }, [detail]);

  return (
    <div className="space-y-6">
      {/* ---- Search ------------------------------------------------------- */}
      <div ref={boxRef} className="relative max-w-2xl">
        <label htmlFor="stock-search" className="sr-only">
          Search for a company
        </label>
        <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 focus-within:border-foreground">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            id="stock-search"
            type="text"
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-controls="stock-suggestions"
            aria-autocomplete="list"
            autoComplete="off"
            placeholder="Search a company by name or ticker…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setHighlight(0);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          {searching && (
            <Loader2
              className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
              aria-label="Searching"
            />
          )}
          {query && !searching && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSelectedName(null);
                setDetail(null);
                setNotHeld(null);
                setOpen(false);
              }}
              aria-label="Clear search"
              className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>

        {open && suggestions.length > 0 && (
          <ul
            id="stock-suggestions"
            role="listbox"
            className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-md border bg-card py-1 shadow-lg"
          >
            {suggestions.map((s, i) => (
              <li key={s.key} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(s)}
                  className={cn(
                    "flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm",
                    i === highlight ? "bg-accent text-foreground" : "hover:bg-accent/50"
                  )}
                >
                  <span className="truncate">
                    {s.name}
                    {/* Flag up front whether we hold MF data for this company. */}
                    {s.local && (
                      <span className="ml-1.5 text-[10px] text-positive">
                        {s.local.funds} fund{s.local.funds === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{s.meta}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {open && query.trim().length >= MIN_QUERY && !searching && suggestions.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            No company matching “{query.trim()}”.
          </p>
        )}
      </div>

      {/* ---- Empty state -------------------------------------------------- */}
      {!selectedName && !loading && (
        <div className="rounded-lg border border-dashed bg-card px-6 py-10 text-center">
          <p className="text-sm text-foreground">
            Search a company to see which mutual funds own it.
          </p>
          <p className="mx-auto mt-1.5 max-w-xl text-xs leading-snug text-muted-foreground">
            Every scheme holding the stock, the shares each holds, its weight in
            that scheme, and how the shareholding moved month over month — read
            straight from the AMCs&apos; monthly portfolio disclosures.
          </p>
          {index && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
              {index.stocks
                .slice()
                .sort((a, b) => b.funds - a.funds)
                .slice(0, 6)
                .map((s) => (
                  <button
                    key={s.slug}
                    type="button"
                    onClick={() => pick({ name: s.name, api: null, local: s })}
                    className="rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {s.name}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="rounded-lg border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          Loading {selectedName}…
        </div>
      )}

      {/* Company exists in search but no tracked scheme holds it. */}
      {notHeld && !loading && (
        <div className="rounded-lg border border-dashed bg-card px-6 py-8 text-center">
          <TriangleAlert className="mx-auto mb-2 h-4 w-4 text-muted-foreground" aria-hidden />
          <p className="text-sm text-foreground">
            No tracked mutual-fund scheme holds {notHeld.name}
            {notHeld.symbol ? ` (${notHeld.symbol})` : ""}.
          </p>
          <p className="mx-auto mt-1.5 max-w-xl text-xs leading-snug text-muted-foreground">
            {notHeld.country && notHeld.country !== "India"
              ? `This is a ${notHeld.country} listing — Indian mutual funds rarely hold it, and only their Indian equity holdings are disclosed here.`
              : "It may be held below the disclosure threshold, or held only by schemes outside the tracked universe."}
          </p>
        </div>
      )}

      {selectedName && !loading && !detail && !notHeld && (
        <div className="rounded-lg border border-dashed bg-card px-6 py-8 text-center text-sm text-muted-foreground">
          <TriangleAlert className="mx-auto mb-2 h-4 w-4" aria-hidden />
          Couldn&apos;t load holdings for {selectedName}.
        </div>
      )}

      {/* ---- Summary ------------------------------------------------------ */}
      {detail && (
        <>
          <section className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h2 className="text-base font-semibold tracking-tight">{detail.name}</h2>
              <span className="text-xs text-muted-foreground">
                as on {detail.months[0]}
                {detail.fincode ? ` · ${detail.fincode}` : ""}
              </span>
            </div>
            <div className="overflow-x-auto rounded-md border bg-card">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Sector</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      No. of funds
                    </th>
                    {detail.months.map((m) => (
                      <th
                        key={m}
                        className="whitespace-nowrap border-l px-3 py-2 text-right font-medium"
                      >
                        {m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="px-3 py-2.5 font-medium">{detail.sector}</td>
                    <td className="px-3 py-2.5 text-right tabular font-medium">
                      {detail.fundCount}
                    </td>
                    {detail.totalShares.map((v, i) => (
                      <td
                        key={detail.months[i]}
                        className="whitespace-nowrap border-l px-3 py-2.5 text-right tabular"
                      >
                        {fmtInt(v)}
                        <Delta cur={v} prev={detail.totalShares[i + 1]} />
                      </td>
                    ))}
                  </tr>
                  <tr className="border-t text-[11px] text-muted-foreground">
                    <td className="px-3 py-1.5" colSpan={2}>
                      Funds reporting that month
                    </td>
                    {detail.holdersByMonth.map((n, i) => (
                      <td
                        key={detail.months[i]}
                        className="border-l px-3 py-1.5 text-right tabular"
                      >
                        {n}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Total shares are summed over the funds that disclosed each month, so
              the month-on-month move partly reflects disclosure timing — the
              second row shows how many funds reported. ▲ ▼ mark an increase or
              decrease versus the previous month. Shareholding is{" "}
              <span className="font-medium">not</span> adjusted for outstanding
              derivative positions.
            </p>
          </section>

          {/* ---- Holders --------------------------------------------------- */}
          <Card
            title={`Schemes holding ${detail.name} (${detail.funds.length})`}
            action={
              <DownloadXlsxButton
                rows={holderRows}
                columns={holderColumns}
                filename={`${detail.slug}-mf-holders.xlsx`}
                sheetName="MF Holders"
              />
            }
          >
            <div className="overflow-x-auto rounded-md border bg-card">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60 text-xs text-muted-foreground">
                    <th className="sticky left-0 z-10 bg-muted/60 px-3 py-2 text-left font-medium">
                      Fund name
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      Scheme AUM (₹ Cr)
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      % of AUM
                    </th>
                    {detail.months.map((m) => (
                      <th
                        key={m}
                        className="whitespace-nowrap border-l px-3 py-2 text-right font-medium"
                      >
                        {m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {detail.funds.map((f) => (
                    <tr
                      key={`${f.code}-${f.scheme}`}
                      className="border-b last:border-0 hover:bg-accent/40"
                    >
                      <td className="sticky left-0 z-10 bg-card px-3 py-2.5">
                        <span className="font-medium">{f.scheme}</span>
                        {f.amc && (
                          <span className="ml-1.5 text-[11px] text-muted-foreground">
                            {f.amc}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular text-muted-foreground">
                        {fmtCr(f.aumCr)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular">
                        {fmtPct(f.pctOfAum)}
                      </td>
                      {f.shares.map((v, i) => (
                        <td
                          key={detail.months[i]}
                          className="whitespace-nowrap border-l px-3 py-2.5 text-right tabular"
                        >
                          {fmtInt(v)}
                          <Delta cur={v} prev={f.shares[i + 1]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[10px] leading-snug text-muted-foreground/80">
              “% of AUM” is the stock&apos;s weight in that scheme in its latest
              disclosed month. “Scheme AUM” is the market value of the scheme&apos;s
              disclosed portfolio, so it can differ slightly from the AMC&apos;s
              published AUM. A blank month means the scheme had not filed that
              month — not a nil holding. Source: AMC monthly portfolio disclosures.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
