import { managementYieldsSnapshot } from "./source";
import type {
  ManagementYieldMetric,
  ManagementYieldRow,
} from "./snapshots/types";

/**
 * Look up management-disclosed metrics for an AMC + quarter. Multiple
 * metrics may be returned (operating margin, blended yield, asset-class
 * yields, …) — caller picks what to render.
 */
export function managementYieldsFor(
  slug: string,
  quarter: string
): ManagementYieldRow[] {
  return managementYieldsSnapshot.rows.filter(
    (r) => r.amcSlug === slug && r.quarter === quarter
  );
}

/**
 * Single-metric lookup. Returns the first match (rows for the same metric
 * from different sources are de-duplicated upstream by the merge key).
 */
export function managementMetric(
  slug: string,
  quarter: string,
  metric: ManagementYieldMetric
): ManagementYieldRow | null {
  return (
    managementYieldsSnapshot.rows.find(
      (r) => r.amcSlug === slug && r.quarter === quarter && r.metric === metric
    ) ?? null
  );
}

/**
 * Variance flag against a calculated value. ok ≤ 2 bps · warning ≤ 5 bps ·
 * mismatch otherwise. Always rendered relative to the management value.
 */
export type VarianceFlag = "ok" | "warning" | "mismatch";

export interface YieldComparison {
  calculatedBps: number;
  disclosedBps: number;
  varianceBps: number; // calculated − disclosed
  flag: VarianceFlag;
  source: ManagementYieldRow;
}

export function compareToManagement(
  calculatedBps: number,
  disclosed: ManagementYieldRow | null
): YieldComparison | null {
  if (disclosed === null) return null;
  const variance = calculatedBps - disclosed.valueBps;
  const abs = Math.abs(variance);
  const flag: VarianceFlag =
    abs <= 2 ? "ok" : abs <= 5 ? "warning" : "mismatch";
  return {
    calculatedBps,
    disclosedBps: disclosed.valueBps,
    varianceBps: Number(variance.toFixed(1)),
    flag,
    source: disclosed,
  };
}

/** True iff the management snapshot has any rows at all. */
export function hasManagementYields(): boolean {
  return managementYieldsSnapshot.rows.length > 0;
}
