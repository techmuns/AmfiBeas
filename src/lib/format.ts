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
