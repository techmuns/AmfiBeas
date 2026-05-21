import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import {
  EVENT_TYPE_BADGE,
  amcEventsAcrossCohort,
  amcNarrativesAll,
  fiscalPeriodSortKey,
  type StrategicEventType,
} from "@/data/amc-narratives";
import { MovesFilter } from "./MovesFilter";

const LISTED_AMC_SLUGS = [
  "hdfc",
  "icici-pru",
  "nippon",
  "absl",
  "uti",
  "canara-robeco",
] as const;

const DISPLAY_NAME: Record<string, string> = {
  hdfc: "HDFC",
  "icici-pru": "ICICI Pru",
  nippon: "Nippon",
  absl: "ABSL",
  uti: "UTI",
  "canara-robeco": "Canara Robeco",
};

const AMC_PILL_CLS: Record<string, string> = {
  hdfc: "border-chart-1/40 bg-chart-1/10 text-chart-1",
  "icici-pru": "border-chart-2/40 bg-chart-2/10 text-chart-2",
  nippon: "border-chart-3/40 bg-chart-3/10 text-chart-3",
  absl: "border-chart-4/40 bg-chart-4/10 text-chart-4",
  uti: "border-chart-5/40 bg-chart-5/10 text-chart-5",
  "canara-robeco":
    "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-400",
};

const ALL_AMCS_SENTINEL = "all";

interface StrategicMovesCohortLaneProps {
  /** URL param `?moveAmc=` — either `"all"` or one of the listed slugs.
   *  Defaults to "all" when absent. */
  selectedAmc?: string;
  /** URL param `?movePeriod=` — a fiscal-period string (e.g. "FY26-Q4")
   *  or absent. When absent the lane defaults to the most recent period
   *  that has at least one disclosed event. */
  selectedPeriod?: string;
}

/**
 * Strategic Moves — Cohort. Filter-driven view: two dropdowns control
 * which AMC × quarter slice the user sees. By default it lands on the
 * most recent quarter with All AMCs selected, surfacing what changed
 * across the cohort this period. Drill into a single AMC + quarter to
 * see only that intersection.
 */
export function StrategicMovesCohortLane({
  selectedAmc,
  selectedPeriod,
}: StrategicMovesCohortLaneProps = {}) {
  // Build the full event universe.
  const universe = amcEventsAcrossCohort([...LISTED_AMC_SLUGS]);
  // All available fiscal periods (newest first).
  const allPeriodsDesc = [
    ...new Set(
      LISTED_AMC_SLUGS.flatMap((slug) =>
        amcNarrativesAll(slug).map((r) => r.fiscalPeriod)
      )
    ),
  ].sort((a, b) => fiscalPeriodSortKey(b) - fiscalPeriodSortKey(a));

  if (allPeriodsDesc.length === 0) {
    return (
      <Card
        title="Strategic Moves — Cohort"
        subtitle="No concall data ingested yet."
        stackHeader
      />
    );
  }

  // Default period: the most recent period that contains at least one
  // disclosed event across the cohort.
  const periodsWithEvents = new Set(
    universe
      .filter((q) =>
        Object.values(q.bySlug).some((evs) => evs.length > 0)
      )
      .map((q) => q.fiscalPeriod)
  );
  const defaultPeriod =
    allPeriodsDesc.find((p) => periodsWithEvents.has(p)) ??
    allPeriodsDesc[0];
  const period = selectedPeriod ?? defaultPeriod;
  const amc = selectedAmc ?? ALL_AMCS_SENTINEL;

  // Slice the universe by the selection.
  const slice = universe.find((q) => q.fiscalPeriod === period);
  const events: Array<{
    slug: string;
    type: StrategicEventType;
    label: string;
    impactBps?: number;
  }> = [];
  if (slice) {
    for (const slug of LISTED_AMC_SLUGS) {
      if (amc !== ALL_AMCS_SENTINEL && amc !== slug) continue;
      const evs = slice.bySlug[slug] ?? [];
      for (const e of evs) events.push({ slug, ...e });
    }
  }

  const amcOptions = [
    { value: ALL_AMCS_SENTINEL, label: "All AMCs" },
    ...LISTED_AMC_SLUGS.map((slug) => ({
      value: slug,
      label: DISPLAY_NAME[slug],
    })),
  ];
  const periodOptions = allPeriodsDesc.map((p) => ({
    value: p,
    label: p === defaultPeriod ? `${p} (latest)` : p,
  }));

  const amcLabel =
    amc === ALL_AMCS_SENTINEL ? "all six listed AMCs" : DISPLAY_NAME[amc];

  return (
    <Card
      title="Strategic Moves — Cohort"
      subtitleNode={
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            Pick an AMC and a quarter to see every strategic move
            management disclosed at that intersection. Defaults to the
            latest available quarter with all AMCs selected.
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            {events.length === 0
              ? `No moves disclosed by ${amcLabel} in ${period}.`
              : `${events.length} ${events.length === 1 ? "event" : "events"} disclosed by ${amcLabel} in ${period}.`}
          </p>
        </div>
      }
      action={
        <MovesFilter
          amcOptions={amcOptions}
          periodOptions={periodOptions}
          selectedAmc={amc}
          selectedPeriod={period}
        />
      }
      stackHeader
    >
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Try a different quarter or AMC from the dropdowns above. Older
          quarters may have fewer disclosed moves; some AMCs (UTI,
          Canara Robeco, ICICI Pru) only have partial concall coverage.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {events.map((e, i) => {
            const badge = EVENT_TYPE_BADGE[e.type];
            return (
              <li
                key={`${e.slug}-${e.type}-${i}`}
                className="flex items-start gap-2.5 text-[12.5px] leading-snug"
              >
                <span
                  className={cn(
                    "mt-0.5 inline-flex w-[88px] shrink-0 items-center justify-center rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                    badge.cls
                  )}
                >
                  {badge.label}
                </span>
                <Link
                  href={`/amc/${e.slug}`}
                  className={cn(
                    "inline-flex w-[110px] shrink-0 items-center justify-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium hover:opacity-80",
                    AMC_PILL_CLS[e.slug] ?? "border-border bg-muted"
                  )}
                >
                  {DISPLAY_NAME[e.slug]}
                </Link>
                <span className="text-foreground/90">{e.label}</span>
                {typeof e.impactBps === "number" && (
                  <span className="ml-auto shrink-0 text-[10.5px] text-muted-foreground">
                    {e.impactBps >= 0 ? "+" : ""}
                    {e.impactBps.toFixed(1)} bps
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
