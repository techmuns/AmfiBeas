import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import {
  EVENT_TYPE_BADGE,
  amcEventsAcrossCohort,
  fiscalPeriodSortKey,
  type StrategicEventType,
} from "@/data/amc-narratives";

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

/**
 * Strategic Moves Cohort — a per-quarter newsfeed of every disclosed
 * strategic move across the six listed AMCs. Newest quarter at the top.
 *
 * Each row inside a quarter is a single event: event-type badge + AMC
 * chip + label. Click the AMC chip to jump into that AMC's page.
 */
export function StrategicMovesCohortLane() {
  const grouped = amcEventsAcrossCohort([...LISTED_AMC_SLUGS]);
  // newest quarter first
  const ordered = [...grouped].sort(
    (a, b) =>
      fiscalPeriodSortKey(b.fiscalPeriod) - fiscalPeriodSortKey(a.fiscalPeriod)
  );
  const totalEvents = ordered.reduce(
    (sum, q) =>
      sum +
      Object.values(q.bySlug).reduce((s, events) => s + events.length, 0),
    0
  );
  if (totalEvents === 0) {
    return (
      <Card
        title="Strategic Moves — Cohort"
        subtitle="Awaiting first concall ingest across the listed AMCs."
        stackHeader
      >
        <p className="text-sm text-muted-foreground">
          As each AMC&rsquo;s next earnings concall is processed, every
          disclosed mandate / launch / board / international / regulatory
          move will appear here, grouped by quarter, newest first.
        </p>
      </Card>
    );
  }
  return (
    <Card
      title="Strategic Moves — Cohort"
      subtitleNode={
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            Every strategic move management has named across the six
            listed AMCs, grouped by the quarter it was disclosed in.
            Newest first.
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            {totalEvents} events · {ordered.length} quarter
            {ordered.length === 1 ? "" : "s"} · click an AMC chip to open
            its page
          </p>
        </div>
      }
      stackHeader
    >
      <div className="space-y-5">
        {ordered.map(({ fiscalPeriod, bySlug }) => {
          const events = Object.entries(bySlug).flatMap(([slug, evs]) =>
            evs.map((e) => ({ slug, ...e }))
          );
          if (events.length === 0) return null;
          return (
            <section key={fiscalPeriod}>
              <h4 className="mb-2 flex items-baseline gap-3 border-b border-border pb-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-foreground/80">
                  {fiscalPeriod}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {events.length} event{events.length === 1 ? "" : "s"}
                </span>
              </h4>
              <ul className="space-y-1.5">
                {events.map((e, i) => {
                  const badge =
                    EVENT_TYPE_BADGE[e.type as StrategicEventType];
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
            </section>
          );
        })}
      </div>
    </Card>
  );
}
