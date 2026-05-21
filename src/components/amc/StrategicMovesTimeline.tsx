import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import {
  EVENT_TYPE_BADGE,
  amcEventsTimeline,
  type StrategicEvent,
  type StrategicEventType,
} from "@/data/amc-narratives";

interface StrategicMovesTimelineProps {
  slug: string;
  amcDisplayName: string;
}

/**
 * Strategic Moves Timeline — horizontally scrollable carousel of all
 * disclosed strategic moves (mandates, fund launches, board changes,
 * international expansion, regulatory milestones) for an AMC, newest
 * first.
 *
 * Placement: below the Concall Digest on `/amc/[slug]`.
 */
export function StrategicMovesTimeline({
  slug,
  amcDisplayName,
}: StrategicMovesTimelineProps) {
  const events = amcEventsTimeline(slug);
  if (events.length === 0) {
    return (
      <Card
        title="Strategic Moves Timeline"
        subtitle={`Mandate wins, fund launches, board changes for ${amcDisplayName}.`}
        stackHeader
      >
        <p className="text-sm text-muted-foreground">
          No strategic events disclosed across the available concalls. As
          newer concalls are processed, every mandate / launch / board move
          will appear here, newest first.
        </p>
      </Card>
    );
  }
  return (
    <Card
      title="Strategic Moves Timeline"
      subtitleNode={
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            Every mandate win, fund launch, board change, international
            push, and regulatory milestone management has disclosed across
            the available concalls.
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            {events.length} events · newest first · scroll horizontally
          </p>
        </div>
      }
      stackHeader
    >
      <div className="overflow-x-auto">
        <ul className="flex gap-3 pb-1" style={{ minWidth: "max-content" }}>
          {events.map((e, i) => (
            <li
              key={`${e.fiscalPeriod}-${e.type}-${i}`}
              className="flex w-[230px] shrink-0 flex-col gap-2 rounded-lg border border-border bg-card/50 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <EventBadge type={e.type} />
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {e.fiscalPeriod}
                </span>
              </div>
              <p className="text-[12.5px] leading-snug text-foreground/90">
                {e.label}
              </p>
              {typeof e.impactBps === "number" && (
                <p className="text-[10.5px] text-muted-foreground">
                  Impact: {e.impactBps >= 0 ? "+" : ""}
                  {e.impactBps.toFixed(1)} bps
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function EventBadge({ type }: { type: StrategicEventType }) {
  const badge = EVENT_TYPE_BADGE[type];
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
        badge.cls
      )}
    >
      {badge.label}
    </span>
  );
}

/** Compact 2-row variant for `/compare`. Renders AMC A on top + AMC B
 *  below, both as horizontal strips for the same fiscal periods. */
export function StrategicMovesCompare({
  slugA,
  slugB,
  nameA,
  nameB,
}: {
  slugA: string;
  slugB: string;
  nameA: string;
  nameB: string;
}) {
  const eventsA = amcEventsTimeline(slugA);
  const eventsB = amcEventsTimeline(slugB);
  if (eventsA.length === 0 && eventsB.length === 0) return null;
  return (
    <Card
      title="Strategic Moves — Side-by-Side"
      subtitleNode={
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            How the two AMCs&rsquo; disclosed strategic moves stack up across
            quarters. Useful for spotting first-mover patterns.
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            {eventsA.length + eventsB.length} events total · newest first
          </p>
        </div>
      }
      stackHeader
    >
      <CompareRow name={nameA} events={eventsA} />
      <div className="mt-3">
        <CompareRow name={nameB} events={eventsB} />
      </div>
    </Card>
  );
}

function CompareRow({
  name,
  events,
}: {
  name: string;
  events: Array<StrategicEvent & { fiscalPeriod: string }>;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium text-foreground/80">
        {name}
      </p>
      {events.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">
          No events disclosed yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <ul className="flex gap-2 pb-1" style={{ minWidth: "max-content" }}>
            {events.slice(0, 12).map((e, i) => (
              <li
                key={`${e.fiscalPeriod}-${e.type}-${i}`}
                className="flex w-[200px] shrink-0 flex-col gap-1.5 rounded-md border border-border bg-card/50 p-2"
              >
                <div className="flex items-center justify-between gap-1">
                  <EventBadge type={e.type} />
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {e.fiscalPeriod}
                  </span>
                </div>
                <p className="text-[11.5px] leading-snug text-foreground/90">
                  {e.label}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
