import { cn } from "@/lib/cn";

interface NarrativeBlockProps {
  /** Eyebrow text rendered above the headline (small caps). */
  eyebrow?: string;
  /** Optional pull quote / strapline. */
  strapline?: string;
  /** The three paragraphs in narrative order. */
  paragraphs: { opening: string; middle: string; closing: string };
  className?: string;
}

/**
 * Three-paragraph executive-summary block — designed to read like
 * the lede of a markets column: opening (what changed), middle
 * (what it means), closing (what to watch). Renders with a left-
 * accent rule and serif-grade typographic spacing.
 */
export function NarrativeBlock({
  eyebrow,
  strapline,
  paragraphs,
  className,
}: NarrativeBlockProps) {
  return (
    <div
      className={cn(
        "relative rounded-xl border bg-card p-6 shadow-sm",
        className
      )}
    >
      <span className="absolute left-0 top-6 bottom-6 w-1 rounded-r bg-foreground/20" />
      <div className="ml-3 space-y-4">
        {eyebrow && (
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </div>
        )}
        {strapline && (
          <h3 className="text-lg font-semibold tracking-tight">
            {strapline}
          </h3>
        )}
        <div className="space-y-3 text-sm leading-relaxed text-foreground/90">
          <p className="first-letter:text-2xl first-letter:font-semibold first-letter:tracking-tight first-letter:text-foreground first-letter:mr-1">
            {paragraphs.opening}
          </p>
          <p>{paragraphs.middle}</p>
          <p className="text-foreground/85">{paragraphs.closing}</p>
        </div>
      </div>
    </div>
  );
}
