import { cn } from "@/lib/cn";
import { AiExplainButton } from "@/components/ui/AiExplainButton";
import type { ChartGuide } from "@/lib/chart-guides";

interface DesignLanguageCardProps {
  /** Card title — h3-sized, brand navy. Title-only header: no
   *  subtitle / subtitleNode / denominator caption is accepted. */
  title: string;
  /** chartId resolves to a `chart-guides.ts` entry, surfaced via the
   *  AiExplainButton in the card header. */
  chartId: string;
  /** Optional inline override for the AI-explain content. Use when
   *  the entry hasn't been added to the registry yet. */
  guide?: ChartGuide;
  /** KPI chip strip rendered above the chart (Archetype A). */
  chipStrip?: React.ReactNode;
  /** The chart itself. */
  children: React.ReactNode;
  /** Source attribution rendered below the chart. e.g. "Source:
   *  AMFI monthly press release · As of Apr-2026". */
  source?: string;
  className?: string;
}

export function DesignLanguageCard({
  title,
  chartId,
  guide,
  chipStrip,
  children,
  source,
  className,
}: DesignLanguageCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground shadow-sm",
        "print:break-inside-avoid",
        className
      )}
    >
      <div className="flex items-start justify-between gap-4 px-6 pt-5">
        <h3 className="text-sm font-semibold tracking-tight text-brand-navy">
          {title}
        </h3>
        <AiExplainButton chartId={chartId} guide={guide} />
      </div>
      <div className="px-6 pb-2 pt-4">
        {chipStrip ? <div className="mb-3">{chipStrip}</div> : null}
        {children}
      </div>
      {source ? (
        <p className="px-6 pb-5 text-[11px] italic text-brand-source">
          {source}
        </p>
      ) : (
        <div className="pb-5" />
      )}
    </div>
  );
}
