import { CircleCheck, MinusCircle } from "lucide-react";
import type { MorningstarKpi, KpiStatus } from "@/config/morningstar-kpis";
import { cn } from "@/lib/cn";

interface PublicKpiItem extends MorningstarKpi {
  runtimeStatus: KpiStatus;
  rowCount?: number;
  fetchedAt?: string;
  sourceUrl?: string;
}

interface PublicKpiListProps {
  items: readonly PublicKpiItem[];
}

const STATUS_BADGE: Record<
  KpiStatus,
  { label: string; classes: string; Icon: typeof CircleCheck }
> = {
  available: {
    label: "Available",
    classes: "border-positive/40 bg-positive/10 text-positive",
    Icon: CircleCheck,
  },
  not_connected: {
    label: "Not connected",
    classes: "border-border text-muted-foreground",
    Icon: MinusCircle,
  },
  locked: {
    label: "Locked",
    classes: "border-border text-muted-foreground",
    Icon: MinusCircle,
  },
};

export function PublicKpiList({ items }: PublicKpiListProps) {
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {items.map((k) => {
        const badge = STATUS_BADGE[k.runtimeStatus];
        return (
          <li
            key={k.id}
            className="flex items-start gap-3 rounded-md border px-3 py-2.5"
          >
            <badge.Icon
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                k.runtimeStatus === "available"
                  ? "text-positive"
                  : "text-muted-foreground"
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{k.label}</span>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-1.5 py-0 text-[10px] uppercase tracking-wide",
                    badge.classes
                  )}
                >
                  {badge.label}
                </span>
              </div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {k.description}
              </div>
              {k.runtimeStatus === "available" && (
                <div className="mt-1 text-[10px] tabular text-muted-foreground">
                  {typeof k.rowCount === "number" ? `${k.rowCount} rows` : null}
                  {k.fetchedAt
                    ? ` · ${new Date(k.fetchedAt).toISOString().slice(0, 10)}`
                    : null}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
