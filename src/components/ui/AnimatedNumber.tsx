"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface AnimatedNumberProps {
  /** Target value to animate to. */
  value: number;
  /** Locale for `toLocaleString` (default "en-IN"). */
  locale?: string;
  /** Decimal places to show. Defaults to 0 (integer with grouping). */
  decimals?: number;
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
 * hydration, the count animates over `durationMs` (default 700).
 *
 * NOTE: props are intentionally serialisable (no function callbacks)
 * so this component can be embedded inside React Server Components
 * without React's "Functions cannot be passed directly to Client
 * Components" error.
 */
export function AnimatedNumber({
  value,
  locale = "en-IN",
  decimals = 0,
  durationMs = 700,
  reduceMotion = false,
  className,
}: AnimatedNumberProps) {
  const fmt = useMemo(
    () => (v: number) =>
      v.toLocaleString(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }),
    [locale, decimals]
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
