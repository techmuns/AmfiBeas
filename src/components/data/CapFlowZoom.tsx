"use client";

import { useEffect, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CapFlowRow } from "@/data/cap-flows";

/** ₹ Cr, Indian-grouped, negatives in brackets. */
function fmtCr(v: number): string {
  const abs = Math.abs(Math.round(v)).toLocaleString("en-IN");
  return v < 0 ? `(${abs})` : abs;
}

function displayName(name: string): string {
  return name.replace(/\s+(Ltd\.?|Limited)$/i, "").trim();
}

/**
 * Per-card "zoom": a button that opens a modal expanding the card's AMC-level
 * "Top MF Buyers/Sellers" into the actual SCHEMES behind each name — every
 * scheme that bought (or sold) the stock this month, with its net ₹ Cr traded.
 * Client-only; embedded in the (client) FlowCard header.
 */
export function CapFlowZoom({
  title,
  kind,
  month,
  rows,
}: {
  title: string;
  kind: "bought" | "sold";
  month: string;
  rows: CapFlowRow[];
}) {
  const [open, setOpen] = useState(false);
  const bought = kind === "bought";
  const toneCls = bought ? "text-positive" : "text-negative";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const hasAny = rows.some((r) => (r.schemes?.length ?? 0) > 0);
  if (!hasAny) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Show which schemes ${bought ? "bought" : "sold"} these names`}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Maximize2 className="h-3 w-3" aria-hidden />
        Schemes
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border bg-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
                <p className="text-xs text-muted-foreground">
                  Schemes that {bought ? "bought" : "sold"} each name · {month}
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

            <div className="mt-3 space-y-2.5">
              {rows.map((r) => (
                <div key={r.company} className="rounded-md border px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium">
                      {displayName(r.company)}
                    </span>
                    <span className={cn("shrink-0 text-[13px] tabular", toneCls)}>
                      {bought ? "+" : "−"}₹{Math.abs(r.netCr).toLocaleString("en-IN")} Cr
                    </span>
                  </div>
                  {r.schemes && r.schemes.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {r.schemes.map((sc) => (
                        <li
                          key={sc.fund}
                          className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground"
                        >
                          <span className="truncate">
                            {sc.fund}
                            {sc.amc && (
                              <span className="ml-1.5 text-muted-foreground/70">
                                {sc.amc}
                              </span>
                            )}
                          </span>
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
            <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
              Net ₹ Cr traded = Σ(month-over-month share change × trade price) —
              the pure buy/sell flow, excluding price moves.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
