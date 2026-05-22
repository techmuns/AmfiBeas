export function monthToFy(month: string): number {
  const [yStr, mStr] = month.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return Number.NaN;
  return m >= 4 ? y + 1 : y;
}

export function fyEndMonth(fy: number): string {
  return `${fy}-03`;
}

export function fyLabel(fy: number): string {
  return `FY${String(fy).slice(2)}`;
}

export function monthsToFyAverage<T extends Record<string, unknown>>(
  rows: T[],
  monthField: keyof T,
  valueField: keyof T
): Array<{ fy: number; value: number; months: number }> {
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const row of rows) {
    const month = row[monthField];
    const value = row[valueField];
    if (typeof month !== "string") continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const fy = monthToFy(month);
    if (!Number.isFinite(fy)) continue;
    const entry = buckets.get(fy) ?? { sum: 0, n: 0 };
    entry.sum += value;
    entry.n += 1;
    buckets.set(fy, entry);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([fy, { sum, n }]) => ({ fy, value: sum / n, months: n }));
}

export function monthsToFyEndOfPeriod<T extends Record<string, unknown>>(
  rows: T[],
  monthField: keyof T,
  valueField: keyof T
): Array<{ fy: number; value: number }> {
  const byFy = new Map<number, { month: string; value: number }>();
  for (const row of rows) {
    const month = row[monthField];
    const value = row[valueField];
    if (typeof month !== "string") continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const fy = monthToFy(month);
    if (!Number.isFinite(fy)) continue;
    const existing = byFy.get(fy);
    if (!existing || month > existing.month) {
      byFy.set(fy, { month, value });
    }
  }
  return Array.from(byFy.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([fy, { value }]) => ({ fy, value }));
}
