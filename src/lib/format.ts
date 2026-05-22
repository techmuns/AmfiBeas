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

/**
 * Exhibit-grade compact ₹ formatter used by the benchmark-style
 * archetype components. Promotes to "Lakh Cr" at ≥ 1,00,000 Cr; below
 * that, returns a plain Indian-comma-grouped value with the "Cr"
 * suffix. Never uses "K Cr" — the brief says exhibits should read in
 * ₹ Cr / ₹ Lakh Cr only.
 *
 *   12,500          → "₹ 12,500 Cr"
 *   95,400          → "₹ 95,400 Cr"
 *   1,07,000        → "₹ 1.1 Lakh Cr"
 *   67,40,000       → "₹ 67.4 Lakh Cr"
 */
export function formatCrExhibit(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1e5) return `${sign}₹ ${(abs / 1e5).toFixed(1)} Lakh Cr`;
  return `${sign}₹ ${Math.round(abs).toLocaleString("en-IN")} Cr`;
}

/**
 * Tooltip-precision ₹ formatter — always shows the full Cr amount
 * with Indian comma grouping, no Lakh-Cr promotion. Used in chart
 * tooltips so the reader can see the precise number when hovering.
 */
export function formatCrTooltip(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  return `${sign}₹ ${Math.round(Math.abs(value)).toLocaleString("en-IN")} Cr`;
}

/**
 * Axis-tick formatter that decides on a single unit for the whole
 * axis from the supplied domain max, then renders every tick in that
 * unit. Prevents the "some ticks Cr, some ticks Lakh Cr" jitter the
 * brief calls out as a risk.
 *
 *   axisFormatterCr(8e4)(12345)   → "12,345"   (Cr unit, no suffix on
 *                                                ticks — header carries it)
 *   axisFormatterCr(7e6)(2.4e6)   → "24.0"     (Lakh Cr unit — header
 *                                                still carries "Lakh Cr")
 */
export function axisFormatterCr(domainMax: number): (n: number) => string {
  const useLakhCr = Math.abs(domainMax) >= 1e5;
  if (useLakhCr) {
    return (n: number) =>
      Number.isFinite(n) ? (n / 1e5).toFixed(1) : "—";
  }
  return (n: number) =>
    Number.isFinite(n) ? Math.round(n).toLocaleString("en-IN") : "—";
}

export function axisUnitLabel(domainMax: number): string {
  return Math.abs(domainMax) >= 1e5 ? "₹ Lakh Cr" : "₹ Cr";
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

/** Format a 0-100 percentile as "Xst/Xnd/Xrd/Xth pct". */
export function formatPercentile(pct: number | null | undefined): string {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return "—";
  const rounded = Math.round(pct);
  return `${rounded}${ordinalSuffix(rounded)} pct`;
}
