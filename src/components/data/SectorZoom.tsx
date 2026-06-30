"use client";

import { useEffect, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SectorShiftScheme, SectorShiftStock } from "@/data/cap-flows";
import { shortenCompany } from "@/lib/stock-name";

/** ₹ Cr, Indian-grouped, negatives in brackets (mirrors the insights tables). */
function fmtCr(v: number): string {
  const abs = Math.abs(Math.round(v)).toLocaleString("en-IN");
  return v < 0 ? `(${abs})` : abs;
}

/**
 * Per-sector "zoom": a button that opens a modal with the scheme-level detail
 * behind a rotating sector — the top schemes (with net traded vs holding-value
 * change), and for each driving stock, the specific schemes that bought/sold it.
 * Client-only — embedded in the server-rendered sector card via the Card action.
 */
export function SectorZoom({
  sector,
  direction,
  month,
  schemes,
  stocks,
}: {
  sector: string;
  direction: "up" | "down";
  month: string;
  schemes: SectorShiftScheme[];
  stocks: SectorShiftStock[];
}) {
  const [open, setOpen] = useState(false);
  const up = direction === "up";
  const toneCls = up ? "text-positive" : "text-negative";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (schemes.length === 0 && stocks.every((s) => !s.schemes?.length)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Show the schemes that ${up ? "bought" : "sold"} ${sector} the most`}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Maximize2 className="h-3 w-3" aria-hidden />
        Schemes
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${sector} — schemes that ${up ? "bought" : "sold"} the most`}
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">{sector}</h3>
                <p className="text-xs text-muted-foreground">
                  Schemes that {up ? "added the most" : "trimmed the most"} · {month}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {/* 1. Sector-level top schemes — trade flow vs value change. */}
            {schemes.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-md border">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-muted/60 text-xs text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Scheme</th>
                      <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                        Net traded
                      </th>
                      <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                        Value Δ
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {schemes.map((s) => (
                      <tr key={s.fund} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <span className="font-medium">{s.fund}</span>
                          {s.amc && (
                            <span className="ml-1.5 text-[11px] text-muted-foreground">
                              {s.amc}
                            </span>
                          )}
                        </td>
                        <td className={cn("whitespace-nowrap px-3 py-2 text-right tabular", toneCls)}>
                          {fmtCr(s.netCr)}
                        </td>
                        <td className={cn("whitespace-nowrap px-3 py-2 text-right tabular", toneCls)}>
                          {fmtCr(s.valueChgCr)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              <span className="font-medium">Net traded</span> = Σ(month-over-month
              share change × trade price), the pure buy/sell flow.{" "}
              <span className="font-medium">Value Δ</span> = change in the
              schemes&rsquo; holding value (includes price moves). ₹ Cr.
            </p>

            {/* 2. Per-stock breakdown — which schemes drove each name. */}
            {stocks.some((s) => s.schemes?.length) && (
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-medium text-foreground">
                  By stock — schemes that {up ? "bought" : "sold"} each name
                </p>
                <div className="space-y-2.5">
                  {stocks.map((st) => (
                    <div key={st.company} className="rounded-md border px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[13px] font-medium">
                          {shortenCompany(st.company)}
                        </span>
                        <span className={cn("shrink-0 text-[13px] tabular", toneCls)}>
                          {fmtCr(st.netCr)}
                        </span>
                      </div>
                      {st.schemes && st.schemes.length > 0 ? (
                        <ul className="mt-1 space-y-0.5">
                          {st.schemes.map((sc) => (
                            <li
                              key={sc.fund}
                              className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground"
                            >
                              <span className="truncate">{sc.fund}</span>
                              <span className={cn("shrink-0 tabular", toneCls)}>
                                {fmtCr(sc.netCr)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                          No scheme-level detail.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
