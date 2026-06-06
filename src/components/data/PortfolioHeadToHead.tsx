"use client";

import { useMemo, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatPctSafe } from "@/lib/format";
import {
  type FundDirectoryEntry,
  type FundPortfolio,
  monthSlug,
} from "@/data/portfolio-tracker";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";

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
  const [bQuery, setBQuery] = useState(bEntry?.fund ?? "");
  const [bFocused, setBFocused] = useState(false);

  // Externally-driven B changes (A re-picked → default-B re-derives) sync
  // into the picker's text so the visible fund-name tracks the fund being
  // compared. User-driven edits to `bQuery` are preserved until B actually
  // changes. Set-during-render avoids an extra commit and matches React's
  // recommended "adjusting state on prop change" pattern.
  const bSchemecode = bEntry?.schemecode ?? null;
  const [prevBSchemecode, setPrevBSchemecode] = useState(bSchemecode);
  if (prevBSchemecode !== bSchemecode) {
    setPrevBSchemecode(bSchemecode);
    setBQuery(bEntry?.fund ?? "");
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

  // Largest A>B and largest A<B *amongst stocks both funds hold* — the
  // apples-to-apples extremes for the one-line summary. Holdings only one
  // fund holds are surfaced in the table itself and don't dominate the
  // headline (otherwise a single 6% bet would always crowd it out).
  const headline = useMemo(() => {
    let over: CompareRow | null = null;
    let under: CompareRow | null = null;
    for (const r of compareRows) {
      if (r.signal === "A overweight" && (!over || r.delta > over.delta))
        over = r;
      if (r.signal === "A underweight" && (!under || r.delta < under.delta))
        under = r;
    }
    return { over, under };
  }, [compareRows]);

  const latestMonth = aPortfolio.meta.months[0]?.label ?? "";
  const totalRows = compareRows.length;
  const displayRows = compareRows.slice(0, MAX_COMPARE_ROWS);
  type XRow = {
    company: string;
    a: number | null;
    b: number | null;
    delta: number;
    signal: string;
  };
  const compareExportColumns: CsvColumn<XRow>[] = [
    { key: "company", header: "Company" },
    { key: "a", header: `${aEntry.fund} (%)` },
    { key: "b", header: bEntry ? `${bEntry.fund} (%)` : "Comparison fund (%)" },
    { key: "delta", header: "Δ A − B (pp)" },
    { key: "signal", header: "Signal" },
  ];
  const compareExportRows: XRow[] = compareRows.map((r) => ({
    company: r.name,
    a: r.a,
    b: r.b,
    delta: r.delta,
    signal: r.signal,
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
                      setBQuery(f.fund);
                      setBFocused(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent",
                      f.schemecode === bEntry?.schemecode && "bg-accent/60"
                    )}
                  >
                    <span>{f.fund}</span>
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
          <span className="font-medium text-foreground">{aEntry.fund}</span>
          <span className="mx-2">vs</span>
          <span className="font-medium text-foreground">{bEntry.fund}</span>
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
          {totalRows > 0 && (
            <div className="flex justify-end">
              <DownloadXlsxButton
                rows={compareExportRows}
                columns={compareExportColumns}
                filename="portfolio-head-to-head.xlsx"
                sheetName="A vs B"
              />
            </div>
          )}
          {(headline.over || headline.under) && bEntry && (
            <p className="text-sm leading-snug text-foreground">
              vs <strong>{bEntry.fund}</strong>,{" "}
              <strong>{aEntry.fund}</strong> is
              {headline.over && (
                <>
                  {" "}most overweight{" "}
                  <strong>{headline.over.name}</strong> (
                  <span className="text-positive">
                    +{headline.over.delta.toFixed(1)}pp
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
                    {headline.under.delta.toFixed(1)}pp
                  </span>
                  )
                </>
              )}
              .
            </p>
          )}

          {totalRows === 0 ? (
            <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              No comparable equity holdings between these two funds for{" "}
              {latestMonth || "the latest month"}.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border bg-card">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Company</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      A %
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      B %
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      Δ A − B
                    </th>
                    <th className="whitespace-nowrap px-3 py-2 text-left font-medium">
                      Signal
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
                      <td className="px-3 py-2.5">
                        <SignalBadge signal={r.signal} />
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
                ? `Showing top ${MAX_COMPARE_ROWS} of ${totalRows} joined holdings by |Δ|`
                : `${totalRows} joined holding${totalRows === 1 ? "" : "s"}, sorted by |Δ|`}
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
        <span className="font-medium text-foreground">{aEntry.fund}</span> with
        another fund in {category}.
      </p>
    </div>
  );
}

function DeltaPp({ value, signal }: { value: number; signal: Signal }) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const abs = Math.abs(value).toFixed(1);
  const cls =
    signal === "In line"
      ? "text-muted-foreground"
      : value > 0
        ? "text-positive"
        : "text-negative";
  return (
    <span className={cls}>
      {sign}
      {abs}pp
    </span>
  );
}

function SignalBadge({ signal }: { signal: Signal }) {
  const tone =
    signal === "A overweight"
      ? "text-positive"
      : signal === "A underweight"
        ? "text-negative"
        : "text-muted-foreground";
  return <span className={cn("text-xs", tone)}>{signal}</span>;
}
