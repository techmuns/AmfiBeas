"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ChartGuide } from "@/lib/chart-guides";
import { getChartGuide } from "@/lib/chart-guides";

interface AiExplainButtonProps {
  chartId: string;
  /** Overrides the registry entry. Useful for tests or one-off cards
   *  whose copy hasn't been promoted to chart-guides.ts yet. */
  guide?: ChartGuide;
  className?: string;
}

export function AiExplainButton({
  chartId,
  guide,
  className,
}: AiExplainButtonProps) {
  const resolved = guide ?? getChartGuide(chartId);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  if (!resolved) return null;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          open && "bg-muted text-foreground"
        )}
      >
        <Sparkles className="h-3 w-3" aria-hidden="true" />
        <span className="hidden sm:inline">Explain with AI</span>
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={`Explain ${resolved.title}`}
          className="absolute right-0 top-[calc(100%+6px)] z-30 w-[280px] sm:w-[340px] rounded-md border border-border bg-card p-3 text-[12px] leading-relaxed text-foreground shadow-lg"
        >
          <div className="flex items-start justify-between gap-2 pb-2">
            <p className="text-[13px] font-semibold tracking-tight">
              {resolved.title}
            </p>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="-mr-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="whitespace-pre-wrap text-muted-foreground">
            {resolved.body}
          </div>
        </div>
      )}
    </div>
  );
}
