import type { MarketWrap } from "@/data/market-wrap";

interface MarketWrapCardProps {
  wrap: MarketWrap;
}

/**
 * Market Wrap — the three-sentence headline read that sits at the
 * top of /monthly. Intentionally NOT wrapped in the standard Card
 * shell because the wrap should feel like a stripped-down editorial
 * lede, not "another chart card". Three short lines, each prefixed
 * with a vertical accent so the eye picks them up as a list.
 *
 * If the wrap has no lines (no data yet) the component renders
 * nothing — the page just starts at the next section.
 */
export function MarketWrapCard({ wrap }: MarketWrapCardProps) {
  if (wrap.lines.length === 0) return null;
  return (
    <section
      aria-label="Market wrap"
      className="rounded-lg border border-border bg-gradient-to-br from-muted/40 via-card to-card px-6 py-5 shadow-sm"
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Market Wrap
        </h2>
        <span className="text-[11px] tabular text-muted-foreground">
          Through {wrap.asOf}
        </span>
      </div>
      <ul className="space-y-3">
        {wrap.lines.map((line, i) => (
          <li
            key={i}
            className="flex items-start gap-3 text-[15px] font-medium leading-snug text-foreground"
          >
            <span
              aria-hidden
              className="mt-1.5 inline-block h-3.5 w-[3px] shrink-0 rounded-sm bg-foreground"
            />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
