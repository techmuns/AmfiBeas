import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { HowToRead } from "@/components/ui/HowToRead";
import { cn } from "@/lib/cn";
import {
  EVENT_TYPE_BADGE,
  amcEventsAcrossCohort,
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

/**
 * Cohort-wide event lane: one row per quarter (newest first), with a
 * per-AMC count of disclosed strategic moves. Reading horizontally
 * shows which AMC was busiest each quarter; reading vertically shows
 * the cadence of a single AMC across the cohort window. Click a cell
 * to drill into that AMC + quarter.
 */
export function StrategicMovesCohortLane() {
  const grouped = amcEventsAcrossCohort([...LISTED_AMC_SLUGS]);
  if (grouped.length === 0) return null;
  const recent = grouped.slice(-8).reverse(); // newest first
  if (recent.length === 0) return null;
  return (
    <Card
      title="Strategic Moves — Cohort"
      subtitleNode={
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            Every disclosed strategic move across the 6 listed AMCs,
            grouped by fiscal quarter. Each pill type maps to an event
            category; pill count is the number of moves the AMC disclosed
            that quarter.
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            Last {recent.length} quarter{recent.length === 1 ? "" : "s"} ·
            click any cell to open that AMC&rsquo;s page
          </p>
        </div>
      }
      stackHeader
    >
      <div className="overflow-x-auto">
        <table
          className="w-full text-xs"
          style={{ minWidth: `${LISTED_AMC_SLUGS.length * 110 + 110}px` }}
        >
          <thead>
            <tr className="border-b text-left">
              <th className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Quarter
              </th>
              {LISTED_AMC_SLUGS.map((slug) => (
                <th
                  key={slug}
                  className="py-2 pr-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {DISPLAY_NAME[slug]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recent.map(({ fiscalPeriod, bySlug }) => (
              <tr
                key={fiscalPeriod}
                className="border-b last:border-0 align-top"
              >
                <td className="py-2 pr-3 text-[11px] font-medium text-foreground/80">
                  {fiscalPeriod}
                </td>
                {LISTED_AMC_SLUGS.map((slug) => {
                  const events = bySlug[slug] ?? [];
                  if (events.length === 0) {
                    return (
                      <td
                        key={slug}
                        className="py-2 pr-3 text-[11px] text-muted-foreground/50"
                      >
                        —
                      </td>
                    );
                  }
                  return (
                    <td key={slug} className="py-2 pr-3">
                      <Link
                        href={`/amc/${slug}`}
                        className="block space-y-1 rounded-sm hover:bg-muted/40"
                        title={`${events.length} move${events.length === 1 ? "" : "s"} — open ${DISPLAY_NAME[slug]}`}
                      >
                        {Object.entries(countByType(events)).map(
                          ([type, n]) => {
                            const badge =
                              EVENT_TYPE_BADGE[type as StrategicEventType];
                            return (
                              <span
                                key={type}
                                className={cn(
                                  "mr-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
                                  badge.cls
                                )}
                              >
                                {badge.label}
                                {n > 1 && (
                                  <span className="font-medium">×{n}</span>
                                )}
                              </span>
                            );
                          }
                        )}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <HowToRead>
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            Each pill is one type of disclosed move:{" "}
            <span className="text-foreground">Mandate</span>,{" "}
            <span className="text-foreground">Launch</span>,{" "}
            <span className="text-foreground">Board</span>,{" "}
            <span className="text-foreground">International</span>,{" "}
            <span className="text-foreground">Regulatory</span>,{" "}
            <span className="text-foreground">Tech / AI</span>,{" "}
            <span className="text-foreground">Partnership</span>.
          </li>
          <li>
            A bare dash means no move disclosed for that AMC that quarter
            (or no concall ingested yet).
          </li>
          <li>
            Rows are most-recent-first — handy for spotting who&rsquo;s
            been busy in the cohort lately.
          </li>
        </ul>
      </HowToRead>
    </Card>
  );
}

function countByType(
  events: Array<{ type: StrategicEventType }>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
}
