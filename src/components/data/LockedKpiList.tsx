import { Lock } from "lucide-react";
import type { MorningstarKpi } from "@/config/morningstar-kpis";
import { cn } from "@/lib/cn";

interface LockedKpiListProps {
  items: readonly MorningstarKpi[];
  compact?: boolean;
}

export function LockedKpiList({ items, compact = false }: LockedKpiListProps) {
  if (compact) {
    return (
      <ul className="grid grid-cols-2 gap-1.5 text-xs md:grid-cols-3">
        {items.map((k) => (
          <li
            key={k.id}
            className={cn(
              "flex items-center gap-1.5 rounded-md border border-dashed bg-muted/40 px-2 py-1.5 text-muted-foreground"
            )}
            title={`${k.description} · ${k.dashboardUse}`}
          >
            <Lock className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{k.label}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {items.map((k) => (
        <li
          key={k.id}
          className="flex items-start gap-3 rounded-md border bg-muted/30 px-3 py-2.5"
        >
          <Lock
            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{k.label}</span>
              <span className="shrink-0 rounded-full border px-1.5 py-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                Locked
              </span>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {k.description}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
