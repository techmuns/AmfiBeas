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
  // Client formatting rules: one decimal place; negatives in brackets.
  const abs = Math.abs(value).toFixed(1);
  return value < 0 ? `(${abs}%)` : `+${abs}%`;
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

const MONTH_NAMES_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-04" → "April 2026". Falls back to the raw string when the month
 *  index is out of range. */
export function formatMonthLong(month: string) {
  const [yStr, mStr] = month.split("-");
  const idx = Number(mStr) - 1;
  if (!(idx >= 0 && idx < 12) || !yStr) return month;
  return `${MONTH_NAMES_LONG[idx]} ${yStr}`;
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
 * INR (₹ Cr) formatter. Input is always treated as ₹ Cr (the dashboard's
 * canonical storage unit). Per the client formatting rules the output is a
 * FULL Indian-grouped number — never "K"/"L" compaction — with negatives in
 * brackets: 1052 → "₹1,052 Cr"; 952867 → "₹9,52,867 Cr"; −64000 →
 * "(₹64,000 Cr)". The historical name is kept so existing callers pick the
 * new behaviour up without churn.
 */
export function formatCompactCr(value: number) {
  // Client formatting rules: no K/L compaction — full Indian-grouped numbers
  // ("22,400" not "22.4K"); negatives in brackets rather than a minus sign.
  const abs = Math.round(Math.abs(value)).toLocaleString("en-IN");
  return value < 0 ? `(₹${abs} Cr)` : `₹${abs} Cr`;
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

/** Share count formatted in Indian units (e.g. 289,500,000 → "28.9 Cr",
 *  450,000 → "4.5 L"). Values >= 1 crore render as Cr; smaller values render
 *  as L. Used for per-holding share columns in the Portfolio Tracker. */
export function formatSharesIndian(
  value: number | null | undefined
): string {
  return formatOrUnavailable(value, (v) => {
    const abs = Math.abs(v);
    if (abs >= 1e7) return `${(v / 1e7).toFixed(1)} Cr`;
    return `${(v / 1e5).toFixed(1)} L`;
  });
}

/** Percentage with safe fallback. */
export function formatPctSafe(
  value: number | null | undefined,
  digits = 1
): string {
  // Negatives render in brackets per the client formatting rules.
  return formatOrUnavailable(value, (v) =>
    v < 0 ? `(${Math.abs(v).toFixed(digits)}%)` : `${v.toFixed(digits)}%`
  );
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
