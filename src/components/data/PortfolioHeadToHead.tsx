"use client";

import { useMemo, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatPctSafe } from "@/lib/format";
import {
  type FundDirectoryEntry,
  type FundPortfolio,
} from "@/data/portfolio-tracker";
import {
  type CompareRow,
  type Signal,
  buildCompareRows,
  compareHeadline,
  partitionCompareRows,
  shortFundLabel,
  signalLabel,
  signalTone,
} from "@/lib/head-to-head";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";

const MAX_B_SUGGESTIONS = 60;
const MAX_COMPARE_ROWS = 50;

// Re-exported for the few call sites that pick the default comparison fund.
export { isLikelySameScheme, normalizeSchemeKey } from "@/lib/head-to-head";

type CompareView = "mutual" | "exclusive";

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
  // Mutual (shared) holdings are the default lens; Exclusive surfaces what
  // only one of the two funds holds.
  const [view, setView] = useState<CompareView>("mutual");

  const shortA = shortFundLabel(aEntry.fund);
  const shortB = bEntry ? shortFundLabel(bEntry.fund) : "";

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

  const compareRows = useMemo<CompareRow[]>(
    () => buildCompareRows(aPortfolio, bPortfolio),
    [aPortfolio, bPortfolio]
  );
  const { mutual, exclusive } = useMemo(
    () => partitionCompareRows(compareRows),
    [compareRows]
  );

  // Largest A>B and largest A<B amongst mutually-held stocks — the
  // apples-to-apples extremes for the one-line summary.
  const headline = useMemo(() => compareHeadline(compareRows), [compareRows]);

  // Per-fund exclusive counts for the Exclusive-view summary line.
  const onlyACount = useMemo(
    () => exclusive.filter((r) => r.signal === "only-a").length,
    [exclusive]
  );
  const onlyBCount = exclusive.length - onlyACount;

  const latestMonth = aPortfolio.meta.months[0]?.label ?? "";
  const viewRows = view === "mutual" ? mutual : exclusive;
  const displayRows = viewRows.slice(0, MAX_COMPARE_ROWS);

  // Excel export mirrors the visible lens (mutual vs exclusive) and never
  // shows positional "A"/"B" — columns carry the funds' own names.
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
    ...(view === "mutual"
      ? ([{ key: "delta", header: `Δ ${shortA} − ${shortB} (pp)` }] as CsvColumn<XRow>[])
      : []),
    { key: "signal", header: view === "mutual" ? "Signal" : "Held by" },
  ];
  const compareExportRows: XRow[] = viewRows.map((r) => ({
    company: r.name,
    a: r.a,
    b: r.b,
    delta: r.delta,
    signal: signalLabel(r.signal, shortA, shortB),
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
            <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-card py-1 shadow-lg">
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
          {/* Mutual ↔ Exclusive lens + export */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label="Holdings overlap lens"
              className="inline-flex rounded-lg border bg-card p-0.5 text-sm"
            >
              {(
                [
                  ["mutual", "Mutual holdings", mutual.length],
                  ["exclusive", "Exclusive holdings", exclusive.length],
                ] as const
              ).map(([id, label, count]) => {
                const active = view === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setView(id)}
                    className={cn(
                      "rounded-md px-3 py-1.5 font-medium transition-colors",
                      active
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                    <span
                      className={cn(
                        "ml-1.5 text-xs tabular",
                        active ? "text-background/70" : "text-muted-foreground"
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
            {viewRows.length > 0 && (
              <DownloadXlsxButton
                rows={compareExportRows}
                columns={compareExportColumns}
                filename={`head-to-head-${view}.xlsx`}
                sheetName={view === "mutual" ? "Mutual holdings" : "Exclusive holdings"}
              />
            )}
          </div>

          {/* View-appropriate one-liner */}
          {view === "mutual"
            ? (headline.over || headline.under) &&
              bEntry && (
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
              )
            : bEntry && (
                <p className="text-sm leading-snug text-foreground">
                  <strong>{shortA}</strong> alone holds{" "}
                  <strong>{onlyACount}</strong> stock{onlyACount === 1 ? "" : "s"}{" "}
                  {shortB} doesn&apos;t, and <strong>{shortB}</strong> alone holds{" "}
                  <strong>{onlyBCount}</strong> stock{onlyBCount === 1 ? "" : "s"}{" "}
                  {shortA} doesn&apos;t.
                </p>
              )}

          {viewRows.length === 0 ? (
            <div className="rounded-md border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              {view === "mutual"
                ? `These two funds share no common equity holdings for ${
                    latestMonth || "the latest month"
                  }.`
                : `Neither fund holds anything the other doesn't for ${
                    latestMonth || "the latest month"
                  } — every position is shared.`}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border bg-card">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Company</th>
                    <th className="px-3 py-2 text-right font-medium">
                      {aEntry.fund}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      {bEntry?.fund ?? "Comparison fund"}
                    </th>
                    {view === "mutual" && (
                      <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                        Δ
                        <span className="ml-1 font-normal normal-case text-muted-foreground/80">
                          {shortA} − {shortB}
                        </span>
                      </th>
                    )}
                    <th className="whitespace-nowrap px-3 py-2 text-left font-medium">
                      {view === "mutual" ? "Signal" : "Held by"}
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
                      {view === "mutual" && (
                        <td className="px-3 py-2.5 text-right tabular">
                          <DeltaPp value={r.delta} signal={r.signal} />
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        <SignalBadge
                          signal={r.signal}
                          shortA={shortA}
                          shortB={shortB}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {viewRows.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {viewRows.length > MAX_COMPARE_ROWS
                ? `Showing top ${MAX_COMPARE_ROWS} of ${viewRows.length} ${view} holdings by ${
                    view === "mutual" ? "|Δ|" : "weight"
                  }`
                : `${viewRows.length} ${view} holding${
                    viewRows.length === 1 ? "" : "s"
                  }, sorted by ${view === "mutual" ? "|Δ|" : "weight"}`}
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
        another fund in {category}. <strong>Mutual</strong> shows stocks both
        funds hold; <strong>Exclusive</strong> shows what only one of them holds.
      </p>
    </div>
  );
}

function DeltaPp({ value, signal }: { value: number; signal: Signal }) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const abs = Math.abs(value).toFixed(1);
  const tone = signalTone(signal);
  const cls =
    tone === "positive"
      ? "text-positive"
      : tone === "negative"
        ? "text-negative"
        : "text-muted-foreground";
  return (
    <span className={cls}>
      {sign}
      {abs}pp
    </span>
  );
}

function SignalBadge({
  signal,
  shortA,
  shortB,
}: {
  signal: Signal;
  shortA: string;
  shortB: string;
}) {
  const tone = signalTone(signal);
  const cls =
    tone === "positive"
      ? "text-positive"
      : tone === "negative"
        ? "text-negative"
        : "text-muted-foreground";
  return <span className={cn("text-xs", cls)}>{signalLabel(signal, shortA, shortB)}</span>;
}
