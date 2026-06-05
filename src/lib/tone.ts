import type { CSSProperties } from "react";

/**
 * Shared heatmap tint helpers for signed-value analyst tables.
 *
 * `toneBg` returns a faint green (positive) / red (negative) cell background
 * whose opacity scales with |value| / the column's own max, so a column of
 * signed numbers reads as a heatmap the way a returns grid does. `toneText`
 * returns the matching foreground colour class. Near-zero / null values are
 * left untinted (muted text, no background).
 *
 * Extracted from MonthlyFlowsTable and FundwiseTable, which carried identical
 * implementations; kept here so every table tints on one shared scale.
 */

/** Faint tone background, intensity ∝ |value| / column max. */
export function toneBg(value: number | null, maxAbs: number): CSSProperties {
  if (value === null || !Number.isFinite(value) || Math.abs(value) < 1e-9) {
    return {};
  }
  const t = maxAbs > 0 ? Math.min(1, Math.abs(value) / maxAbs) : 0;
  const alpha = (0.08 + 0.42 * t).toFixed(3);
  const tone = value > 0 ? "--positive" : "--negative";
  return { backgroundColor: `hsl(var(${tone}) / ${alpha})` };
}

/** Foreground colour class matching the sign (muted when ~zero / null). */
export function toneText(value: number | null): string {
  if (value === null || !Number.isFinite(value) || Math.abs(value) < 1e-9) {
    return "text-muted-foreground";
  }
  return value > 0 ? "text-positive" : "text-negative";
}
