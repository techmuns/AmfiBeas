"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/Card";

export interface PeriodChoice {
  /** Canonical period id (e.g. "2026-05"). */
  id: string;
  /** Display label (e.g. "May '26"). */
  label: string;
}

/**
 * Client-side period picker rendered AS the card header.
 *
 * Unlike {@link ClientPeriodSwitcher} (which sits above the card as a pill
 * strip), this variant hosts the picker as a compact dropdown inside the
 * card's own action slot, alongside the Live badge — so the period control
 * lives with the data it drives rather than floating above it.
 *
 * The period-dependent body is pre-rendered once per offered period at BUILD
 * time and handed in via `panels`; switching is a pure client state change, so
 * the host page stays `force-static` and a period switch never spends Worker
 * CPU (Cloudflare Free-plan budget; Error 1102).
 */
export function ClientPeriodCard({
  title,
  periods,
  defaultId,
  panels,
}: {
  title: string;
  periods: readonly PeriodChoice[];
  defaultId: string;
  panels: Record<string, { body: ReactNode; live: boolean }>;
}) {
  const [active, setActive] = useState(defaultId);
  const cur = panels[active] ?? panels[periods[0]?.id ?? ""];

  return (
    <Card
      title={title}
      action={
        <div className="flex items-center gap-2">
          {cur && (
            <span
              className={cn(
                "shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
                cur.live
                  ? "border-positive/40 bg-positive/10 text-positive"
                  : "border-border text-muted-foreground"
              )}
            >
              {cur.live ? "Live" : "Not connected"}
            </span>
          )}
          <select
            value={active}
            onChange={(e) => setActive(e.target.value)}
            aria-label="Select period"
            className="rounded-md border bg-card px-2 py-1 text-xs tabular text-foreground transition-colors focus:border-foreground focus:outline-none"
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      }
    >
      {cur?.body}
    </Card>
  );
}
