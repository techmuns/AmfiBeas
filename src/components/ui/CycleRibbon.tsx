import { cn } from "@/lib/cn";

interface CyclePhasePoint {
  month: string;
  phase:
    | "Expansion"
    | "Peak"
    | "Correction"
    | "Recovery"
    | "Base"
    | "Insufficient data";
}

interface CycleRibbonProps {
  /** Per-month phase history, chronological. */
  points: CyclePhasePoint[];
  /** Optional cap on how many trailing months to display. Defaults to
   *  all available points. */
  lastN?: number;
  /** Optional className for the wrapper. */
  className?: string;
}

const PHASE_CLASS: Record<CyclePhasePoint["phase"], string> = {
  Expansion: "bg-positive/40",
  Recovery: "bg-positive/25",
  Correction: "bg-negative/40",
  Peak: "bg-foreground/30",
  Base: "bg-foreground/15",
  "Insufficient data": "bg-muted",
};

const MONTH_ABBREV = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function shortLabel(month: string): string {
  const [y, m] = month.split("-");
  const idx = Number(m) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx > 11) return month;
  return `${MONTH_ABBREV[idx]} '${y.slice(2)}`;
}

/**
 * Cycle Ribbon — a thin horizontal strip that colours each trailing
 * month by its cycle phase (Expansion / Peak / Correction / Recovery
 * / Base). Designed to sit under section titles or above time-series
 * charts so the reader can scan the regime context at a glance.
 *
 * Visual: each cell is a single-month tile with a tone background
 * driven by the phase. Hovering a cell surfaces the month + phase via
 * the native `title` attribute. The strip auto-truncates to `lastN`
 * months (default = all points).
 */
export function CycleRibbon({ points, lastN, className }: CycleRibbonProps) {
  if (points.length === 0) return null;
  const shown = typeof lastN === "number" ? points.slice(-lastN) : points;
  if (shown.length === 0) return null;
  const first = shown[0].month;
  const last = shown[shown.length - 1].month;
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex h-2 w-full overflow-hidden rounded-sm border border-border/60">
        {shown.map((p) => (
          <div
            key={p.month}
            className={cn("flex-1", PHASE_CLASS[p.phase])}
            title={`${shortLabel(p.month)} · ${p.phase}`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] tabular text-muted-foreground">
        <span>{shortLabel(first)}</span>
        <CycleRibbonLegend />
        <span>{shortLabel(last)}</span>
      </div>
    </div>
  );
}

function CycleRibbonLegend() {
  const items: { phase: CyclePhasePoint["phase"]; label: string }[] = [
    { phase: "Recovery", label: "Recovery" },
    { phase: "Expansion", label: "Expansion" },
    { phase: "Peak", label: "Peak" },
    { phase: "Base", label: "Base" },
    { phase: "Correction", label: "Correction" },
  ];
  return (
    <span className="hidden flex-wrap items-center gap-x-2.5 gap-y-0.5 sm:inline-flex">
      {items.map((i) => (
        <span key={i.phase} className="inline-flex items-center gap-1">
          <span
            className={cn("inline-block h-2 w-2 rounded-sm", PHASE_CLASS[i.phase])}
          />
          {i.label}
        </span>
      ))}
    </span>
  );
}
