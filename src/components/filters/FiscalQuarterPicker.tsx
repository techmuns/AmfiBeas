"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/cn";

interface QuarterChoice {
  /** Canonical quarter id, e.g. "FY26-Q4". */
  id: string;
  /** Display label, e.g. "4QFY26". */
  label: string;
}

interface Props {
  /** Available fiscal quarters newest first
   *  (e.g. [{ id: "FY26-Q4", label: "4QFY26" }, ...]). */
  availableQuarters: QuarterChoice[];
  /** Currently active quarter id. Must be one of `availableQuarters`. */
  selectedQuarterId: string;
}

/**
 * Pill row for picking a single fiscal quarter on the /quarterly page.
 * Drives the `quarter` URL param; the AMFI Quarterly Snapshot section's
 * KPI cards and AUM mix render the row for whichever quarter this
 * picks.
 *
 * Mirrors the MonthPicker convention: newest → oldest from left to
 * right so the most recent period is the eye-first action. Capped at
 * 8 quarters which is the full uploaded history today; the cap leaves
 * room for graceful overflow without code changes if more quarters
 * land. Selecting the latest available quarter REMOVES the `quarter`
 * param from the URL so default-state links stay clean.
 *
 * Note: This is distinct from the calendar-quarter `QuarterPicker`
 * used by /financials. That one uses YYYY-Qn ids and a different URL
 * param (`period`). Keeping them as separate components avoids a
 * shared cross-page coupling and lets each page format its labels
 * independently.
 */
export function FiscalQuarterPicker({
  availableQuarters,
  selectedQuarterId,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  // `availableQuarters` arrives newest-first (see availableQuartersDesc),
  // so slice from the start to keep the most recent quarters.
  const display = availableQuarters.slice(0, 8);
  const latest = availableQuarters[0]?.id;

  const setQuarter = (id: string) => {
    const next = new URLSearchParams(params.toString());
    if (id === latest) next.delete("quarter");
    else next.set("quarter", id);
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  if (availableQuarters.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs",
        pending && "opacity-70"
      )}
    >
      <span className="mr-1 text-muted-foreground">Period</span>
      {display.map((q) => {
        const active = q.id === selectedQuarterId;
        return (
          <button
            key={q.id}
            type="button"
            onClick={() => setQuarter(q.id)}
            aria-pressed={active}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] tabular transition-colors",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {q.label}
          </button>
        );
      })}
    </div>
  );
}
