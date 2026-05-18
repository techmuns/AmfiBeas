/**
 * Category Resilience Through Drawdowns
 *
 * For each IIFL Active-Equity category, compute how investors
 * actually behaved during historical Correction-phase months:
 *   - % of those months where the category saw POSITIVE net inflow
 *     (the "stickiness rate")
 *   - average net inflow magnitude during those months
 *
 * This is the cleanest cross-product of the dashboard's existing
 * cycle-phase classifier and the IIFL category flow snapshot —
 * answers "did investors keep buying X during the last drawdown,
 * or did they bail?" in a single horizontal bar.
 *
 * Pure data layer — no UI imports.
 */
import {
  categoryRowsForSlug,
  IIFL_ACTIVE_EQUITY_CATEGORIES,
} from "./amfi-monthly-category";
import { cyclePhaseHistory } from "./market-indices";
import type { AmfiMonthlyCategorySlug } from "./snapshots/types";

export interface CategoryResilienceRow {
  slug: AmfiMonthlyCategorySlug;
  label: string;
  /** # of Correction-phase months for which the category has a
   *  non-null categoryNetInflow value. */
  correctionMonthCount: number;
  /** % of those Correction months with positive (inflow > 0)
   *  flow. 0-100. */
  positiveFlowRatePct: number;
  /** Average net inflow (₹ Cr) during the Correction months. May
   *  be negative when the average month saw outflows. */
  avgFlowDuringCorrection: number;
  /** Latest Correction month that contributed to the read — gives
   *  the reader a sense of how recent the evidence is. Empty when
   *  no Correction months exist for the category. */
  latestCorrectionMonth: string | null;
}

/**
 * Build per-category resilience reads. Categories with fewer than
 * `minCorrectionMonths` Correction-phase data points are excluded
 * to keep the read meaningful (need enough sample size).
 */
export function categoryDrawdownResilience(
  minCorrectionMonths = 3
): CategoryResilienceRow[] {
  // Build month → phase lookup once.
  const phaseByMonth = new Map<string, string>();
  for (const p of cyclePhaseHistory()) {
    phaseByMonth.set(p.month, p.phase);
  }
  if (phaseByMonth.size === 0) return [];

  const out: CategoryResilienceRow[] = [];
  for (const c of IIFL_ACTIVE_EQUITY_CATEGORIES) {
    // Pull the FULL history (not last-24) so we get every Correction
    // month in the snapshot — 100 lookback is well over the full
    // monthly window we have.
    const rows = categoryRowsForSlug(c.slug, 100);
    let correctionMonths = 0;
    let positiveMonths = 0;
    let flowSum = 0;
    let latestCorrectionMonth: string | null = null;
    for (const r of rows) {
      if (phaseByMonth.get(r.month) !== "Correction") continue;
      if (typeof r.categoryNetInflow !== "number") continue;
      correctionMonths += 1;
      flowSum += r.categoryNetInflow;
      if (r.categoryNetInflow > 0) positiveMonths += 1;
      if (
        latestCorrectionMonth === null ||
        r.month.localeCompare(latestCorrectionMonth) > 0
      ) {
        latestCorrectionMonth = r.month;
      }
    }
    if (correctionMonths < minCorrectionMonths) continue;
    out.push({
      slug: c.slug,
      label: c.label,
      correctionMonthCount: correctionMonths,
      positiveFlowRatePct: (positiveMonths / correctionMonths) * 100,
      avgFlowDuringCorrection: flowSum / correctionMonths,
      latestCorrectionMonth,
    });
  }
  // Sort most-resilient first.
  out.sort((a, b) => b.positiveFlowRatePct - a.positiveFlowRatePct);
  return out;
}
