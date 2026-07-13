"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatPctSafe, formatCompactCrSafe } from "@/lib/format";
import {
  amcDisclosureRef,
  amcDisclosurePath,
  type AmcAssetClass,
  type AmcSchemePortfolio,
} from "@/data/amc-scheme-portfolio";

/**
 * Additive Holdings-tab section: the scheme's complete, ISIN-level, all-asset-
 * class portfolio taken straight from the AMC's SEBI monthly disclosure — a
 * companion to the RupeeVest month-over-month equity view above it. Renders
 * nothing when the selected scheme has no mapped disclosure.
 */

const CLASS_COLOR: Record<AmcAssetClass, string> = {
  Equity: "bg-emerald-500",
  Debt: "bg-sky-500",
  "Cash & equiv": "bg-slate-400",
  Gold: "bg-amber-500",
  Silver: "bg-zinc-400",
  Other: "bg-violet-500",
};

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

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.holdings;
    return data.holdings.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        (h.industry ?? "").toLowerCase().includes(q) ||
        (h.isin ?? "").toLowerCase().includes(q)
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
            {data ? ` · ${data.asOfMonth}` : ` · ${ref.asOfMonth}`}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the AMC disclosure…
        </div>
      ) : hasError || !data ? (
        <p className="py-4 text-sm text-muted-foreground">
          The direct-from-AMC portfolio for this scheme couldn&apos;t be loaded.
        </p>
      ) : (
        <>
          {/* Allocation bar */}
          {data.allocation.length > 0 && (
            <div className="space-y-2">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                {data.allocation.map((a) => (
                  <div
                    key={a.class}
                    className={cn("h-full", CLASS_COLOR[a.class])}
                    style={{ width: `${a.pct}%` }}
                    title={`${a.class}: ${a.pct.toFixed(1)}%`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {data.allocation.map((a) => (
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

          {/* Holdings table */}
          <div className="max-h-[28rem] overflow-auto rounded-md border">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-muted/80 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="border-b px-3 py-2 text-left font-medium">Instrument</th>
                  <th className="border-b px-3 py-2 text-left font-medium">Class</th>
                  <th className="border-b px-3 py-2 text-left font-medium">Industry / Rating</th>
                  <th className="border-b px-3 py-2 text-right font-medium">% to NAV</th>
                  <th className="border-b px-3 py-2 text-right font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                      No holdings match &ldquo;{query}&rdquo;.
                    </td>
                  </tr>
                ) : (
                  filtered.map((h, i) => (
                    <tr key={`${h.isin ?? h.name}-${i}`} className="border-b last:border-0 hover:bg-accent/40">
                      <td className="px-3 py-2 font-medium">{h.name}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className={cn("h-2 w-2 rounded-full", CLASS_COLOR[h.assetClass])} />
                          {h.assetClass}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{h.industry || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatPctSafe(h.pctToNav)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCompactCrSafe(h.marketValueCr)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            {data.holdings.length} disclosed holdings · weights sum to{" "}
            {formatPctSafe(data.coveragePct)} of NAV (rows without an ISIN — cash,
            TREPS, net receivables, derivatives — are not itemised in the filing).
            Latest month only; a month-over-month view builds forward as
            disclosures accrue.{" "}
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
