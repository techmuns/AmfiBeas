"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  type FundPortfolio,
  type HoldingArrow,
  monthSlug,
} from "@/data/portfolio-tracker";

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

function formatAum(aumCr: string | number | null): string {
  if (aumCr === null || aumCr === "" || aumCr === "-") return "—";
  const n = typeof aumCr === "number" ? aumCr : Number(aumCr);
  if (!Number.isFinite(n)) return String(aumCr);
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function PortfolioTrackerView({ funds }: { funds: FundPortfolio[] }) {
  const [selectedCode, setSelectedCode] = useState(
    funds[0]?.meta.schemecode ?? ""
  );
  const [query, setQuery] = useState(funds[0]?.meta.fund ?? "");
  const [focused, setFocused] = useState(false);
  const [holdingQuery, setHoldingQuery] = useState("");

  const selected =
    funds.find((f) => f.meta.schemecode === selectedCode) ?? funds[0] ?? null;

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return funds.filter((f) => !q || f.meta.fund.toLowerCase().includes(q));
  }, [funds, query]);

  const months = selected?.meta.months ?? [];
  const slugs = months.map((m) => monthSlug(m.label));

  const holdings = useMemo(() => {
    if (!selected) return [];
    const q = holdingQuery.trim().toLowerCase();
    if (!q) return selected.rows;
    return selected.rows.filter((r) =>
      r.company_name.toLowerCase().includes(q)
    );
  }, [selected, holdingQuery]);

  function pick(f: FundPortfolio) {
    setSelectedCode(f.meta.schemecode);
    setQuery(f.meta.fund);
    setHoldingQuery("");
    setFocused(false);
  }

  return (
    <div className="space-y-5">
      {/* Fund search */}
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
          <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-card py-1 shadow-md">
            {suggestions.map((f) => (
              <li key={f.meta.schemecode}>
                <button
                  type="button"
                  // mousedown fires before the input's blur, so the pick lands
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(f);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent",
                    f.meta.schemecode === selectedCode && "bg-accent/60"
                  )}
                >
                  <span>{f.meta.fund}</span>
                  {f.meta.classification && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {f.meta.classification}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!selected ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
          No fund selected.
        </div>
      ) : (
        <>
          {/* Fund name + category header */}
          <div className="rounded-lg border bg-card px-5 py-4 text-sm">
            <div>
              Fund Name -{" "}
              <span className="font-semibold">{selected.meta.fund}</span>
            </div>
            {selected.meta.classification && (
              <div className="mt-1 text-muted-foreground">
                Category - {selected.meta.classification}
              </div>
            )}
          </div>

          {/* Equity holdings */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold tracking-tight">
                {selected.meta.section || "Equity Holdings"}
              </h2>
              <div className="relative">
                <input
                  type="search"
                  value={holdingQuery}
                  onChange={(e) => setHoldingQuery(e.target.value)}
                  placeholder="Search Here"
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
                          AUM: ₹ {formatAum(m.aumCr)} (Cr.)
                        </div>
                      </th>
                    ))}
                  </tr>
                  <tr className="bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {months.map((m) => (
                      <FragmentSubHead key={m.label} />
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
                        key={row.fincode}
                        className="border-b last:border-0 hover:bg-accent/40"
                      >
                        <td className="border-r px-3 py-2.5 font-medium">
                          {row.company_name}
                        </td>
                        {slugs.map((slug) => {
                          const cell = row.months[slug];
                          return (
                            <Cells key={slug} cell={cell} />
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              {selected.rows.length} equity holdings · arrows compare a month&apos;s
              share count to the next-older month ({months.map((m) => m.label).join(" → ")});
              the oldest column shows no arrow. Source: {selected.meta.source}.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function FragmentSubHead() {
  return (
    <>
      <th className="border-b border-l px-3 py-1.5 text-right font-medium">
        % of AUM
      </th>
      <th className="border-b px-3 py-1.5 text-right font-medium">
        No. of Shares
      </th>
    </>
  );
}

function Cells({
  cell,
}: {
  cell:
    | {
        aum_pct_raw: string;
        shares_raw: string;
        arrow: HoldingArrow;
      }
    | undefined;
}) {
  const pct = cell ? cell.aum_pct_raw : "-";
  const shares = cell ? cell.shares_raw : "-";
  const arrow = cell ? cell.arrow : "missing";
  return (
    <>
      <td className="border-l px-3 py-2.5 text-right tabular text-muted-foreground">
        {pct === "-" ? "—" : pct}
      </td>
      <td className="px-3 py-2.5 text-right tabular">
        <span className="inline-flex items-center justify-end gap-1">
          {shares === "-" ? "—" : shares} <ArrowMark arrow={arrow} />
        </span>
      </td>
    </>
  );
}
