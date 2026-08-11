"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/Card";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";

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

const fmtInt = (v: number | null | undefined) =>
  v == null ? "—" : Math.round(v).toLocaleString("en-IN");
const fmtCr = (v: number | null | undefined) =>
  v == null ? "—" : Math.round(v).toLocaleString("en-IN");
const fmtPct = (v: number | null | undefined) =>
  v == null ? "—" : `${v.toFixed(2)}`;

/** ▲ / ▼ against the next-older month. Nothing is shown when either side wasn't
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
  const [indexError, setIndexError] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState<IndexRow | null>(null);
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // The directory is one small file (~135 KB) fetched once; matching is local so
  // the dropdown responds on every keystroke without a round trip.
  useEffect(() => {
    let alive = true;
    fetch("/stocks/index.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("no index"))))
      .then((j: IndexFile) => {
        if (alive) setIndex(j);
      })
      .catch(() => {
        if (alive) setIndexError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Close the dropdown on an outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!index || q.length < 2) return [];
    const starts: IndexRow[] = [];
    const contains: IndexRow[] = [];
    for (const s of index.stocks) {
      const n = s.name.toLowerCase();
      if (n.startsWith(q)) starts.push(s);
      else if (n.includes(q)) contains.push(s);
      if (starts.length >= MAX_SUGGESTIONS) break;
    }
    // Name-initial matches first, then substring matches by holder count —
    // typing "bank" should surface the widely-held names, not an obscure one.
    return [...starts, ...contains.sort((a, b) => b.funds - a.funds)].slice(
      0,
      MAX_SUGGESTIONS
    );
  }, [index, query]);

  function pick(row: IndexRow) {
    setSelected(row);
    setQuery(row.name);
    setOpen(false);
    setLoading(true);
    setDetail(null);
    fetch(`/stocks/${row.slug}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("missing"))))
      .then((j: StockDetail) => setDetail(j))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (e.key === "ArrowDown" && suggestions.length > 0) setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
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
            placeholder={
              index
                ? `Search ${index.stocks.length.toLocaleString("en-IN")} companies held by mutual funds…`
                : "Loading companies…"
            }
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
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setSelected(null);
                setDetail(null);
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
              <li key={s.slug} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(s)}
                  className={cn(
                    "flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm",
                    i === highlight ? "bg-accent text-foreground" : "hover:bg-accent/50"
                  )}
                >
                  <span className="truncate">{s.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {s.sector} · {s.funds} fund{s.funds === 1 ? "" : "s"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {indexError && (
          <p className="mt-2 text-xs text-negative">
            Couldn&apos;t load the company directory. Reload the page to try again.
          </p>
        )}
        {open && index && query.trim().length >= 2 && suggestions.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            No company matching “{query.trim()}” is held by any tracked scheme.
          </p>
        )}
      </div>

      {/* ---- Empty state -------------------------------------------------- */}
      {!selected && !loading && (
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
                    onClick={() => pick(s)}
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
          Loading {selected?.name}…
        </div>
      )}

      {selected && !loading && !detail && (
        <div className="rounded-lg border border-dashed bg-card px-6 py-8 text-center text-sm text-muted-foreground">
          <TriangleAlert className="mx-auto mb-2 h-4 w-4" aria-hidden />
          Couldn&apos;t load holdings for {selected.name}.
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
