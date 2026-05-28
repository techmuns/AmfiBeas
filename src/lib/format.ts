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

/**
 * Maps a calendar-quarter id (e.g. "2026-Q1") to the calendar month range
 * for that quarter. Quarters are Jan–Mar / Apr–Jun / Jul–Sep / Oct–Dec.
 */
function quarterMonthRange(q: string): { start: string; end: string } {
  switch (q) {
    case "Q1":
      return { start: "Jan", end: "Mar" };
    case "Q2":
      return { start: "Apr", end: "Jun" };
    case "Q3":
      return { start: "Jul", end: "Sep" };
    default:
      return { start: "Oct", end: "Dec" };
  }
}

/**
 * Indian fiscal year runs Apr–Mar. Calendar Q1 (Jan–Mar) of year N falls in
 * FY{N} Q4; Q2 of year N is FY{N+1} Q1, and so on.
 */
function fyQuarter(year: number, q: string): { fyYear: number; fyQ: number } {
  switch (q) {
    case "Q1":
      return { fyYear: year, fyQ: 4 };
    case "Q2":
      return { fyYear: year + 1, fyQ: 1 };
    case "Q3":
      return { fyYear: year + 1, fyQ: 2 };
    default:
      return { fyYear: year + 1, fyQ: 3 };
  }
}

/**
 * Compact label for chart axis ticks (e.g. "Jan–Mar '26"). Tight enough for
 * 13 quarter ticks on a single axis but unambiguous about the period.
 */
export function formatQuarterLabel(quarter: string) {
  const [yStr, q] = quarter.split("-");
  const { start, end } = quarterMonthRange(q);
  return `${start}–${end} '${yStr.slice(2)}`;
}

/**
 * Long-form label for subtitles and tooltips (e.g.
 * "FY26 Q4 · Jan–Mar 2026"). Pairs the Indian fiscal-year label with the
 * calendar month range so the period is unambiguous.
 */
export function formatQuarterLabelLong(quarter: string) {
  const [yStr, q] = quarter.split("-");
  const year = Number(yStr);
  const { start, end } = quarterMonthRange(q);
  const { fyYear, fyQ } = fyQuarter(year, q);
  return `FY${String(fyYear).slice(2)} Q${fyQ} · ${start}–${end} ${year}`;
}

/**
 * Compact INR formatter. Input is always treated as ₹ Cr (the dashboard's
 * canonical storage unit), and the output is scaled with Indian-numbering
 * suffixes ("Cr" / "K Cr" / "L Cr"):
 *   value ∈ ₹ Cr    → output
 *   1052            → "₹1.1K Cr"   (1,052 Cr)
 *   952867          → "₹9.53L Cr"  (9.53 lakh Cr ≡ 952,867 Cr)
 *   12500000        → "₹125L Cr"   (industry-scale total AUM)
 * Values < 1,000 Cr render plain. Suffixes never lie about scale —
 * "K Cr" only used for thousand-Cr range, "L Cr" only for lakh-Cr range.
 */
export function formatCompactCr(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L Cr`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K Cr`;
  return `${sign}₹${abs.toFixed(0)} Cr`;
}

export function formatAxisCr(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}K`;
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

/** Share count formatted in millions (e.g. 69,131,134 → "69.1 M"). Used
 *  for per-holding share columns in the Portfolio Tracker. */
export function formatSharesMillions(
  value: number | null | undefined
): string {
  return formatOrUnavailable(value, (v) => `${(v / 1e6).toFixed(1)} M`);
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

/** Grammatically correct ordinal suffix for an integer (1 → "1st",
 *  2 → "2nd", 21 → "21st", 11 → "11th"). */
export function ordinalSuffix(n: number): string {
  const v = Math.abs(n) % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (v % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/**
 * Format a 0–100 percentile rank as plain-English ranking copy. The
 * raw "Nth pct" notation reads as analyst jargon to most users; this
 * rewrites it as "Top X%", "Bottom X%", or the obvious endpoints.
 *
 * Mapping:
 *   100         → "Highest on record"
 *   95–99       → "Top N%" (N = 100 − pct, min 1)
 *   56–94       → "Top N%"
 *   45–55       → "Around median"
 *   6–44        → "Bottom N%"
 *   1–5         → "Bottom N% on record"
 *   0           → "Lowest on record"
 */
export function formatPercentile(pct: number | null | undefined): string {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return "—";
  const rounded = Math.round(pct);
  if (rounded >= 100) return "Highest on record";
  if (rounded <= 0) return "Lowest on record";
  if (rounded >= 45 && rounded <= 55) return "Around median";
  if (rounded > 55) {
    const top = Math.max(1, 100 - rounded);
    return rounded >= 95 ? `Top ${top}% on record` : `Top ${top}%`;
  }
  return rounded <= 5
    ? `Bottom ${rounded}% on record`
    : `Bottom ${rounded}%`;
}

/**
 * Compact pill version of {@link formatPercentile} for tight spaces
 * (KPI-card pills, small chart annotations). Drops the trailing "on
 * record" qualifier and shortens the endpoints.
 */
export function formatPercentilePill(
  pct: number | null | undefined
): string {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return "—";
  const rounded = Math.round(pct);
  if (rounded >= 100) return "Highest";
  if (rounded <= 0) return "Lowest";
  if (rounded >= 45 && rounded <= 55) return "Median";
  if (rounded > 55) {
    const top = Math.max(1, 100 - rounded);
    return `Top ${top}%`;
  }
  return `Bottom ${rounded}%`;
}
