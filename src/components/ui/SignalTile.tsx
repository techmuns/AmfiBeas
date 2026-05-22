"use client";

import { useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Sparkline } from "@/components/charts/Sparkline";
import { cn } from "@/lib/cn";

interface SignalTileProps {
  label: string;
  pill: string;
  pillTone: "positive" | "negative" | "neutral";
  /** Short, large-font main insight rendered on the front of the card.
   *  Keep this to 2-4 words — the back is where the prose belongs. */
  headline: string;
  valueLine: string | null;
  sparkline?: { label: string; value: number }[];
  sparkColor?: string;
  /** Detailed analyst read shown on the back of the card. */
  read: string;
  footer?: ReactNode;
}

const PILL_TONE_CLASS: Record<SignalTileProps["pillTone"], string> = {
  positive: "border-positive/40 bg-positive/10 text-positive",
  negative: "border-negative/40 bg-negative/10 text-negative",
  neutral: "border-border bg-muted text-muted-foreground",
};

/**
 * Flippable Sector Read tile. Front shows the short headline (large
 * font); click anywhere on the card to rotate to the back face which
 * carries the full valueLine / sparkline / analyst read.
 *
 * Self-sizing: a hidden copy of the back-face body renders in normal
 * flow to set the card's height, so both faces share the larger of
 * the two natural sizes and the flip never causes a layout jump.
 */
export function SignalTile({
  label,
  pill,
  pillTone,
  headline,
  valueLine,
  sparkline,
  sparkColor,
  read,
  footer,
}: SignalTileProps) {
  const [flipped, setFlipped] = useState(false);
  const toggle = () => setFlipped((f) => !f);

  const pillClass = cn(
    "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tabular tracking-tight",
    PILL_TONE_CLASS[pillTone]
  );

  const HeaderRow = (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={pillClass}>{pill}</span>
    </div>
  );

  const BackBody = (
    <div className="flex flex-1 flex-col gap-2">
      {valueLine && (
        <div className="text-[11px] tabular text-foreground/80">{valueLine}</div>
      )}
      {sparkline && sparkline.length > 1 && (
        <div className="-mx-1">
          <Sparkline data={sparkline} color={sparkColor} height={24} />
        </div>
      )}
      <p className="text-[12px] leading-snug text-muted-foreground">{read}</p>
      {footer && (
        <div
          className="mt-auto pt-1"
          // Don't let clicks on the footer's link trigger a flip.
          onClick={(e) => e.stopPropagation()}
        >
          {footer}
        </div>
      )}
    </div>
  );

  return (
    <div className="h-full [perspective:1000px]">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={flipped}
        aria-label={`${label}: ${flipped ? "show summary" : "show details"}`}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        className="relative h-full w-full cursor-pointer text-left transition-transform duration-500 [transform-style:preserve-3d] focus-visible:outline-none"
        style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
      >
        {/* Sizer — invisible copy of the back-face content (the
            longer of the two faces) sets the card's intrinsic height
            so both visible faces share the same footprint. */}
        <div
          aria-hidden
          className="invisible flex flex-col gap-2 rounded-lg border px-4 py-3"
        >
          {HeaderRow}
          {BackBody}
        </div>

        {/* Front face — large headline, centred. */}
        <div className="absolute inset-0 flex flex-col gap-2 rounded-lg border bg-card px-4 py-3 shadow-sm [backface-visibility:hidden]">
          {HeaderRow}
          <div className="flex flex-1 flex-col items-center justify-center gap-1 px-2 text-center">
            <span className="text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
              {headline}
            </span>
            {valueLine && (
              <span className="text-[11px] tabular text-foreground/70">
                {valueLine}
              </span>
            )}
          </div>
          <div className="flex items-center justify-end gap-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            <RotateCw className="h-3 w-3" />
            <span>Tap for details</span>
          </div>
        </div>

        {/* Back face — full read, rotated 180°. */}
        <div className="absolute inset-0 flex flex-col gap-2 rounded-lg border bg-card px-4 py-3 shadow-sm [backface-visibility:hidden] [transform:rotateY(180deg)]">
          {HeaderRow}
          {BackBody}
          <div className="flex items-center justify-end gap-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            <RotateCw className="h-3 w-3 [transform:scaleX(-1)]" />
            <span>Tap to flip back</span>
          </div>
        </div>
      </div>
    </div>
  );
}
