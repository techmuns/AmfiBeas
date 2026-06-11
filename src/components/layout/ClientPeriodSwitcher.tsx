"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PeriodChoice {
  /** Canonical period id (e.g. "2026-05" or "FY26-Q4"). */
  id: string;
  /** Display label (e.g. "May '26" or "4QFY26"). */
  label: string;
}

/**
 * Client-side period picker for statically-rendered pages.
 *
 * The page renders the period-dependent section (e.g. the AMFI Snapshot KPI
 * card) once per offered period at BUILD time and hands those nodes to this
 * component, which shows the active one and hides the rest. Switching periods
 * is a pure client state change — no `?month=` / `?quarter=` round-trip to the
 * Worker — so the page can stay `force-static` and a period switch never spends
 * Worker CPU (what keeps it under the Cloudflare Free-plan budget, Error 1102).
 *
 * Mirrors the MonthPicker / FiscalQuarterPicker pill styling so it is visually
 * identical to the server-navigation pickers it replaces.
 */
export function ClientPeriodSwitcher({
  periods,
  defaultId,
  panels,
}: {
  periods: readonly PeriodChoice[];
  defaultId: string;
  panels: Record<string, ReactNode>;
}) {
  const [active, setActive] = useState(defaultId);

  if (periods.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-xs">
        <span className="mr-1 text-muted-foreground">Period</span>
        {periods.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActive(p.id)}
            aria-pressed={p.id === active}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] tabular transition-colors",
              p.id === active
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {periods.map((p) => (
        <div key={p.id} hidden={p.id !== active}>
          {panels[p.id]}
        </div>
      ))}
    </div>
  );
}
