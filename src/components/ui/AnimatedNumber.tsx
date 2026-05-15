"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface AnimatedNumberProps {
  /** Target value to animate to. */
  value: number;
  /** Caller-supplied formatter. Defaults to en-IN integer with grouping. */
  format?: (v: number) => string;
  /** Animation duration in ms. */
  durationMs?: number;
  /** When true, render the formatted target instantly (no animation).
   *  Useful for SSR / reduced-motion fallbacks. */
  reduceMotion?: boolean;
  className?: string;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Counts up from 0 to `value` on mount. Pure client-side; the static
 * SSR render shows the formatted target so there is no flash. After
 * hydration, the count animates over `durationMs` (default 600).
 */
export function AnimatedNumber({
  value,
  format,
  durationMs = 700,
  reduceMotion = false,
  className,
}: AnimatedNumberProps) {
  const fmt = useMemo(
    () => format ?? ((v: number) => Math.round(v).toLocaleString("en-IN")),
    [format]
  );
  const [display, setDisplay] = useState<string>(() => fmt(value));
  const startedRef = useRef(false);

  useEffect(() => {
    if (reduceMotion) return;
    if (startedRef.current) return;
    startedRef.current = true;
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    const from = 0;
    const to = value;
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      const v = from + (to - from) * easeOutCubic(t);
      setDisplay(fmt(v));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs, fmt, reduceMotion]);

  return <span className={className}>{display}</span>;
}
