"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatPctSafe, formatCompactCrSafe } from "@/lib/format";
import {
  amcDisclosureRef,
  amcDisclosurePath,
  type AmcAssetClass,
  type AmcDisclosureRow,
  type AmcSchemePortfolio,
} from "@/data/amc-scheme-portfolio";

/**
 * Additive Holdings-tab section: the scheme's complete, ISIN-level, all-asset-
 * class portfolio taken straight from the AMC's SEBI monthly disclosure —
 * rendered month-over-month, side by side, exactly like the RupeeVest equity
 * view above it, so a new column appears each month as disclosures accrue.
 * Renders nothing when the selected scheme has no mapped disclosure.
 */

const CLASS_COLOR: Record<AmcAssetClass, string> = {
  Equity: "bg-emerald-500",
  Debt: "bg-sky-500",
  "Cash & equiv": "bg-slate-400",
  Gold: "bg-amber-500",
  Silver: "bg-zinc-400",
  Other: "bg-violet-500",
};

/** ▲/▼ vs the next-older month's weight (mirrors the RupeeVest arrows). */
function Arrow({ cur, prev }: { cur: number | null; prev: number | null }) {
  if (cur == null || prev == null) return null;
  const d = cur - prev;
  if (d > 0.005)
    return (
      <span className="text-positive" aria-label="increased">
        ▲
      </span>
    );
  if (d < -0.005)
    return (
      <span className="text-negative" aria-label="decreased">
        ▼
      </span>
    );
  return null;
}

export function AmcDisclosurePanel({ schemecode }: { schemecode: string }) {
  const ref = amcDisclosureRef(schemecode);

  const [loaded, setLoaded] = useState<Record<string, AmcSchemePortfolio>>({});
  const [errored, setErrored] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");

  // Reset the holdings filter when the scheme changes — a render-phase adjust
  // (not a setState-in-effect), matching the pattern used across this view.
  const [prevCode, setPrevCode] = useState(schemecode);
  if (prevCode !== schemecode) {
    setPrevCode(schemecode);
    setQuery("");
  }

  // Ref mirrors let the fetch effect dedup without putting the maps in deps.
  const loadedRef = useRef(loaded);
  const erroredRef = useRef(errored);
  useEffect(() => {
    loadedRef.current = loaded;
  }, [loaded]);
  useEffect(() => {
    erroredRef.current = errored;
  }, [errored]);

  // Fetch the scheme's disclosure on demand (only setState in async callbacks).
  useEffect(() => {
    if (!ref) return;
    const code = schemecode;
    if (loadedRef.current[code] || erroredRef.current[code]) return;
    const ctrl = new AbortController();
    fetch(amcDisclosurePath(code), { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<AmcSchemePortfolio>;
      })
      .then((json) => setLoaded((prev) => ({ ...prev, [code]: json })))
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setErrored((prev) => ({ ...prev, [code]: true }));
      });
    return () => ctrl.abort();
  }, [schemecode, ref]);

  const data = loaded[schemecode] ?? null;
  const hasError = Boolean(errored[schemecode]);
  const loading = Boolean(ref) && !data && !hasError;

  const months = data?.months ?? [];
  const monthKeys = months.map((m) => m.key);
  const latest = months[0] ?? null;

  const filtered = useMemo<AmcDisclosureRow[]>(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.rows;
    return data.rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.industry ?? "").toLowerCase().includes(q) ||
        (r.isin ?? "").toLowerCase().includes(q)
    );
  }, [data, query]);

  if (!ref) return null;

  return (
    <section className="space-y-3 rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight">
              Full portfolio — direct from AMC
            </h3>
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              AMC filing
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {ref.amcSchemeName} · every asset class, as disclosed
            {latest ? ` · latest ${latest.label}` : ` · ${ref.asOfMonth}`}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the AMC disclosure…
        </div>
      ) : hasError || !data || !latest ? (
        <p className="py-4 text-sm text-muted-foreground">
          The direct-from-AMC portfolio for this scheme couldn&apos;t be loaded.
        </p>
      ) : (
        <>
          {/* Allocation bar — latest disclosed month */}
          {latest.allocation.length > 0 && (
            <div className="space-y-2">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                {latest.allocation.map((a) => (
                  <div
                    key={a.class}
                    className={cn("h-full", CLASS_COLOR[a.class])}
                    style={{ width: `${a.pct}%` }}
                    title={`${a.class}: ${a.pct.toFixed(1)}%`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {latest.allocation.map((a) => (
                  <span key={a.class} className="inline-flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 rounded-full", CLASS_COLOR[a.class])} />
                    {a.class} {a.pct.toFixed(1)}%
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Holdings search */}
          <div className="relative w-full max-w-xs">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter holdings…"
              aria-label="Filter AMC holdings"
              className="w-full rounded-md border bg-background py-1.5 pl-3 pr-8 text-sm placeholder:text-muted-foreground focus:border-foreground focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear holdings filter"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Month-over-month holdings table (newest month first, side by side) */}
          <div className="max-h-[32rem] overflow-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-muted/80 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th rowSpan={2} className="border-b border-r px-3 py-2 text-left align-bottom font-medium">
                    Instrument
                  </th>
                  <th rowSpan={2} className="border-b px-3 py-2 text-left align-bottom font-medium">
                    Class
                  </th>
                  <th rowSpan={2} className="border-b border-r px-3 py-2 text-left align-bottom font-medium">
                    Industry / Rating
                  </th>
                  {months.map((m) => (
                    <th key={m.key} colSpan={2} className="border-b border-l px-3 py-2 text-center font-medium">
                      <div className="normal-case">{m.label}</div>
                      <div className="text-[10px] font-normal normal-case text-muted-foreground">
                        {formatPctSafe(m.coveragePct)} of NAV itemised
                      </div>
                    </th>
                  ))}
                </tr>
                <tr className="bg-muted/80 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {months.map((m) => (
                    <FragmentSubHead key={m.key} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={3 + months.length * 2} className="px-3 py-8 text-center text-muted-foreground">
                      No holdings match &ldquo;{query}&rdquo;.
                    </td>
                  </tr>
                ) : (
                  filtered.map((r, i) => (
                    <tr key={`${r.isin ?? r.name}-${i}`} className="border-b last:border-0 hover:bg-accent/40">
                      <td className="border-r px-3 py-2 font-medium">{r.name}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className={cn("h-2 w-2 rounded-full", CLASS_COLOR[r.assetClass])} />
                          {r.assetClass}
                        </span>
                      </td>
                      <td className="border-r px-3 py-2 text-muted-foreground">{r.industry || "—"}</td>
                      {monthKeys.map((mk, mi) => {
                        const cell = r.months[mk];
                        const prev = mi + 1 < monthKeys.length ? r.months[monthKeys[mi + 1]] : undefined;
                        return (
                          <Cells
                            key={mk}
                            pct={cell?.pctToNav ?? null}
                            value={cell?.marketValueCr ?? null}
                            prevPct={prev?.pctToNav ?? null}
                          />
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            {data.rows.length} instruments across {months.length}{" "}
            {months.length === 1 ? "month" : "months"} (
            {months.map((m) => m.label).join(" ← ")}); newest month first, arrows
            compare each month&apos;s % to NAV to the next-older column. Weights
            in {latest.label} sum to {formatPctSafe(latest.coveragePct)} of NAV
            (rows without an ISIN — cash, TREPS, net receivables, derivatives —
            are not itemised in the filing). A new column is added automatically
            each month.{" "}
            {data.sourceUrl && (
              <a
                href={data.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
              >
                Source filing <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </p>
        </>
      )}
    </section>
  );
}

/** Per-month sub-header: "% to NAV" + "Value" (mirrors RupeeVest's two cols). */
function FragmentSubHead() {
  return (
    <>
      <th className="border-b border-l px-3 py-1.5 text-right font-medium">% to NAV</th>
      <th className="border-b px-3 py-1.5 text-right font-medium">Value</th>
    </>
  );
}

function Cells({
  pct,
  value,
  prevPct,
}: {
  pct: number | null;
  value: number | null;
  prevPct: number | null;
}) {
  return (
    <>
      <td className="border-l px-3 py-2 text-right tabular-nums text-muted-foreground">
        <span className="inline-flex items-center justify-end gap-1">
          {formatPctSafe(pct)} <Arrow cur={pct} prev={prevPct} />
        </span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{formatCompactCrSafe(value)}</td>
    </>
  );
}
