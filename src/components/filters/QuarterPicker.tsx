"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/cn";
import { formatQuarterLabel } from "@/lib/format";

interface Props {
  /** Available quarters in ascending order (oldest first). */
  availableQuarters: string[];
  /** Currently active quarter. Must be one of `availableQuarters`. */
  selectedQuarter: string;
}

/**
 * Pill row for picking a single quarter. Drives the `period` URL param.
 * Caps display at the most recent 8 quarters so a long P&L history doesn't
 * crowd the header. The default (latest) quarter strips `period` from the
 * URL to keep links clean.
 */
export function QuarterPicker({ availableQuarters, selectedQuarter }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const display = availableQuarters.slice(-8);
  const latest = availableQuarters[availableQuarters.length - 1];

  const setPeriod = (q: string) => {
    const next = new URLSearchParams(params.toString());
    if (q === latest) next.delete("period");
    else next.set("period", q);
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  if (availableQuarters.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5 rounded-lg border bg-card px-4 py-2.5 text-xs",
        pending && "opacity-70"
      )}
    >
      <span className="mr-1 text-muted-foreground">Period</span>
      {display.map((q) => {
        const active = q === selectedQuarter;
        return (
          <button
            key={q}
            type="button"
            onClick={() => setPeriod(q)}
            aria-pressed={active}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs tabular transition-colors",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {formatQuarterLabel(q)}
          </button>
        );
      })}
    </div>
  );
}
