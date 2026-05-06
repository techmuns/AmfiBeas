import { dataMode, isAnyLive } from "@/data/source";
import { cn } from "@/lib/cn";

export function DataModeBadge() {
  const mode = dataMode();
  const anyLive = isAnyLive();

  const label = anyLive ? "Mixed data" : "Demo data";
  const liveDomains = Object.entries(mode)
    .filter(([, v]) => v === "live")
    .map(([k]) =>
      k === "amcMaster"
        ? "AMC list"
        : k === "industryMonthly"
        ? "Industry"
        : k === "amcMonthly"
        ? "AMC monthly"
        : k === "otherSchemes"
        ? "Passive & Other Schemes"
        : "AMC quarterly"
    );

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] tabular",
        anyLive
          ? "border-positive/40 bg-positive/10 text-positive"
          : "border-border text-muted-foreground"
      )}
      title={
        anyLive
          ? `Live: ${liveDomains.join(", ")}`
          : "All data is synthetic until ingestion runs."
      }
    >
      <span
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          anyLive ? "bg-positive" : "bg-muted-foreground/40"
        )}
        aria-hidden
      />
      {label}
    </div>
  );
}
