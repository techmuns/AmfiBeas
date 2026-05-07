"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/cn";
import { formatMonthLabel } from "@/lib/format";

interface Props {
  /** Available months newest first (e.g. ["2026-03", "2026-02", ...]).
   *  Each entry must be a YYYY-MM string. */
  availableMonths: string[];
  /** Currently active month. Must be one of `availableMonths`. */
  selectedMonth: string;
}

/**
 * Pill row for picking a single month. Drives the `month` URL param
 * on /monthly; the AMFI Monthly Snapshot section's KPI cards render
 * the row for whichever month this picks.
 *
 * Rendering convention matches QuarterPicker: newest → oldest from
 * left to right so the most recent period is the eye-first action.
 * Capped at 12 months so a long backfill of uploaded PDFs doesn't
 * overflow the section header. Selecting the latest available month
 * REMOVES the `month` param from the URL (default state) so links
 * stay clean.
 */
export function MonthPicker({ availableMonths, selectedMonth }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Cap at 12 most-recent months. `availableMonths` arrives newest-
  // first (see availableMonthsDesc), so slicing from the start keeps
  // the most recent months.
  const display = availableMonths.slice(0, 12);
  const latest = availableMonths[0];

  const setMonth = (m: string) => {
    const next = new URLSearchParams(params.toString());
    if (m === latest) next.delete("month");
    else next.set("month", m);
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  if (availableMonths.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs",
        pending && "opacity-70"
      )}
    >
      <span className="mr-1 text-muted-foreground">Period</span>
      {display.map((m) => {
        const active = m === selectedMonth;
        return (
          <button
            key={m}
            type="button"
            onClick={() => setMonth(m)}
            aria-pressed={active}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] tabular transition-colors",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {formatMonthLabel(m)}
          </button>
        );
      })}
    </div>
  );
}
