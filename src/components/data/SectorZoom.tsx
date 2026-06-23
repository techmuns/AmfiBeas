"use client";

import { useEffect, useState } from "react";
import { Maximize2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SectorShiftScheme } from "@/data/cap-flows";

/** ₹ Cr, Indian-grouped, negatives in brackets (mirrors the insights tables). */
function fmtCr(v: number): string {
  const abs = Math.abs(Math.round(v)).toLocaleString("en-IN");
  return v < 0 ? `(${abs})` : abs;
}

/**
 * Per-sector "zoom": a small button that opens a modal listing the specific
 * schemes (not just AMCs) that bought/sold the most in a rotating sector, and
 * by how much (net ₹ Cr). Top 5. Client-only — embedded in the server-rendered
 * sector card via the Card `action` slot.
 */
export function SectorZoom({
  sector,
  direction,
  month,
  schemes,
}: {
  sector: string;
  direction: "up" | "down";
  month: string;
  schemes: SectorShiftScheme[];
}) {
  const [open, setOpen] = useState(false);
  const up = direction === "up";

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (schemes.length === 0) return null;

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
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-lg border bg-card p-4 shadow-xl"
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

            <div className="mt-3 overflow-hidden rounded-md border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted/60 text-xs text-muted-foreground">
                    <th className="px-3 py-2 text-left font-medium">Scheme</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      Net ₹ Cr
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
                      <td
                        className={cn(
                          "whitespace-nowrap px-3 py-2 text-right tabular",
                          up ? "text-positive" : "text-negative"
                        )}
                      >
                        {fmtCr(s.netCr)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
              Top {schemes.length} schemes by net ₹ {up ? "bought" : "sold"} in{" "}
              {sector} ({month}). Net = Σ(month-over-month share change × trade
              price) across the sector&rsquo;s stocks.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
