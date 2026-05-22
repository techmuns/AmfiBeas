export function cagrPct(
  start: number | null | undefined,
  end: number | null | undefined,
  years: number
): number {
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start <= 0 ||
    end <= 0 ||
    years <= 0
  ) {
    return Number.NaN;
  }
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

export function formatCagr(pct: number, digits = 1): string {
  if (!Number.isFinite(pct)) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}% CAGR`;
}
