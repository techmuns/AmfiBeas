export function formatINR(value: number, opts?: { compact?: boolean }) {
  if (opts?.compact) {
    if (value >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`;
    if (value >= 1e5) return `₹${(value / 1e5).toFixed(2)} L`;
    return `₹${value.toLocaleString("en-IN")}`;
  }
  return `₹${value.toLocaleString("en-IN")}`;
}

export function formatPct(value: number, digits = 2) {
  return `${value.toFixed(digits)}%`;
}

export function formatBps(value: number) {
  return `${value.toFixed(0)} bps`;
}

export function formatDelta(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatMonthLabel(month: string) {
  const [yStr, mStr] = month.split("-");
  const y = yStr.slice(2);
  const idx = Number(mStr) - 1;
  return `${MONTH_NAMES[idx]} '${y}`;
}

export function formatQuarterLabel(quarter: string) {
  const [y, q] = quarter.split("-");
  return `${q} '${y.slice(2)}`;
}

export function formatCompactCr(value: number) {
  if (value >= 1e7) return `₹${(value / 1e7).toFixed(2)}L Cr`;
  if (value >= 1e5) return `₹${(value / 1e5).toFixed(1)}K Cr`;
  if (value >= 1e3) return `₹${(value / 1e3).toFixed(1)}K Cr`;
  return `₹${value.toFixed(0)} Cr`;
}

export function formatAxisCr(value: number) {
  if (value >= 1e7) return `${(value / 1e7).toFixed(1)}L`;
  if (value >= 1e5) return `${(value / 1e5).toFixed(0)}K`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toFixed(0);
}

/** Display string for an unavailable metric. Used everywhere we'd otherwise
 *  show a fake number (NaN, undefined, null, or zero-from-missing-source). */
export const UNAVAILABLE = "—";

/** Returns true when a metric value should be treated as unavailable —
 *  null, undefined, NaN, or non-finite. Use this guard at every render site
 *  that displays a numeric metric. */
export function isUnavailable(value: number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "number") return true;
  return !Number.isFinite(value);
}

/** Run `formatter(value)` only when the value is finite and defined.
 *  Otherwise return UNAVAILABLE ("—"). */
export function formatOrUnavailable<T extends number>(
  value: T | null | undefined,
  formatter: (v: T) => string
): string {
  if (isUnavailable(value)) return UNAVAILABLE;
  return formatter(value as T);
}

/** Locale-formatted integer with safe-fallback. */
export function formatIntSafe(value: number | null | undefined): string {
  return formatOrUnavailable(value, (v) =>
    Math.round(v).toLocaleString("en-IN")
  );
}

/** Lakh-formatted count (e.g. folios, investor additions). */
export function formatLakhSafe(value: number | null | undefined): string {
  return formatOrUnavailable(value, (v) => `${(v / 1e5).toFixed(1)} L`);
}

/** Crore-formatted count (used for total folios at industry scale). */
export function formatCroreCountSafe(
  value: number | null | undefined
): string {
  return formatOrUnavailable(value, (v) => `${(v / 1e7).toFixed(2)} Cr`);
}

/** Percentage with safe fallback. */
export function formatPctSafe(
  value: number | null | undefined,
  digits = 1
): string {
  return formatOrUnavailable(value, (v) => `${v.toFixed(digits)}%`);
}

/** Compact INR (₹ Cr) with safe fallback. */
export function formatCompactCrSafe(
  value: number | null | undefined
): string {
  return formatOrUnavailable(value, (v) => formatCompactCr(v));
}
