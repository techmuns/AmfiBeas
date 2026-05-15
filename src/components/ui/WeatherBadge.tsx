import { cn } from "@/lib/cn";

interface WeatherBadgeProps {
  /** Three-word forecast (e.g. "Sunny · Risk-on · Recovery"). */
  headline: string;
  tone: "sunny" | "stormy" | "neutral";
  className?: string;
}

const TONE_CLASS: Record<WeatherBadgeProps["tone"], string> = {
  sunny: "border-positive/40 bg-positive/10 text-positive",
  stormy: "border-negative/40 bg-negative/10 text-negative",
  neutral: "border-foreground/30 bg-muted text-foreground",
};

const TONE_GLYPH: Record<WeatherBadgeProps["tone"], string> = {
  sunny: "☀",
  stormy: "⛈",
  neutral: "⛅",
};

/** Compact "page weather" badge — three-word forecast with a glyph. */
export function WeatherBadge({ headline, tone, className }: WeatherBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium tracking-tight whitespace-nowrap",
        TONE_CLASS[tone],
        className
      )}
    >
      <span aria-hidden>{TONE_GLYPH[tone]}</span>
      {headline}
    </span>
  );
}
