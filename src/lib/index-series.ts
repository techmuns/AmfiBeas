/**
 * Rebase one or more numeric series in a row collection so each series
 * starts at `base` at its first non-null point. Used by the
 * "Indexed (100)" lens toggle on multi-series charts where one series'
 * volatility was otherwise squashed by another series' larger range
 * (e.g. QAAUM share ~10pp drift vs Net inflow share ~20pp swings).
 *
 * Each key is rebased independently to its OWN first non-null value,
 * so two series with different start months still both start at base.
 * Returns null for a key when:
 *  - its first non-null value is 0 (can't index from zero), or
 *  - the row's value is null / non-finite.
 *
 * Non-numeric row fields (label/x-axis strings) pass through unchanged.
 * Sign is preserved — but this helper is intended for non-negative
 * series. Indexing signed series (e.g. net flows that swing negative)
 * produces values that flip sign without a meaningful baseline; callers
 * should keep those on the levels view.
 */
export function indexSeriesToBase<T extends Record<string, unknown>>(
  rows: T[],
  seriesKeys: string[],
  base = 100
): T[] {
  const firstByKey: Record<string, number | null> = {};
  for (const key of seriesKeys) {
    let f: number | null = null;
    for (const row of rows) {
      const v = row[key];
      if (typeof v === "number" && Number.isFinite(v)) {
        f = v;
        break;
      }
    }
    firstByKey[key] = f !== null && f !== 0 ? f : null;
  }
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row };
    for (const key of seriesKeys) {
      const v = row[key];
      const f = firstByKey[key];
      if (f === null || typeof v !== "number" || !Number.isFinite(v)) {
        out[key] = null;
      } else {
        out[key] = (v / f) * base;
      }
    }
    return out as T;
  });
}
