import Link from "next/link";
import { LineChart, BarChart3 } from "lucide-react";
import { cn } from "@/lib/cn";

interface ChartTypeToggleProps {
  /** Page path the toggle navigates back to (e.g. "/monthly"). */
  basePath: string;
  /** URL query-param key for this card's chart-type (e.g. "monthlyFlowsView"). */
  paramName: string;
  /** Currently-active mode. */
  active: "trend" | "bars";
  /** Extra query params to preserve on the link (e.g. `{ tab: "flows" }`). */
  preserveParams?: Record<string, string | undefined>;
  className?: string;
}

/**
 * Chart-mode segmented switch: "Trend" ↔ "Bars + Growth". Visually
 * distinct from `LensToggle` (which is a metric-units toggle —
 * `₹ Cr / %`) so a beginner can tell at a glance that this switch
 * changes the chart's SHAPE, not its units.
 *
 * Style differences vs LensToggle:
 *  - Slightly larger padding + an inline icon.
 *  - Active label gets a filled, higher-contrast background; inactive
 *    is the usual muted-border treatment.
 *  - The toggle sits AFTER the lens toggles in the action area so the
 *    chart-mode change is the last control on the right.
 *
 * URL handling mirrors LensToggle: default value (`trend`) drops the
 * param entirely so the canonical URL stays clean.
 */
export function ChartTypeToggle({
  basePath,
  paramName,
  active,
  preserveParams,
  className,
}: ChartTypeToggleProps) {
  const baseClass =
    "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-tight transition-colors";
  const activeClass =
    "border-foreground bg-foreground text-background";
  const inactiveClass =
    "border-border text-muted-foreground hover:bg-accent hover:text-foreground";

  const buildQuery = (value: "trend" | "bars") => {
    const out: Record<string, string> = {};
    if (preserveParams) {
      for (const [k, v] of Object.entries(preserveParams)) {
        if (k === paramName) continue;
        if (typeof v === "string" && v.length > 0) out[k] = v;
      }
    }
    if (value !== "trend") {
      out[paramName] = value;
    }
    return out;
  };

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-foreground/20 bg-card p-0.5 shadow-sm",
        className
      )}
      role="group"
      aria-label="Chart type"
    >
      <Link
        href={{ pathname: basePath, query: buildQuery("trend") }}
        scroll={false}
        className={cn(baseClass, active === "trend" ? activeClass : inactiveClass)}
        aria-pressed={active === "trend"}
      >
        <LineChart className="h-3 w-3" aria-hidden />
        Trend
      </Link>
      <Link
        href={{ pathname: basePath, query: buildQuery("bars") }}
        scroll={false}
        className={cn(baseClass, active === "bars" ? activeClass : inactiveClass)}
        aria-pressed={active === "bars"}
      >
        <BarChart3 className="h-3 w-3" aria-hidden />
        Bars + Growth
      </Link>
    </div>
  );
}
