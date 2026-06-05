import { amfiMonthlyCategorySnapshot } from "@/data/amfi-monthly-category";

/**
 * Fee-tier view of industry net inflows.
 *
 * Splits each month's category net inflows into a HIGH-FEE book (actively
 * managed equity, equity-oriented / balanced-advantage hybrids, and
 * solution-oriented schemes) and a LOW-FEE book (debt & liquid, arbitrage as a
 * cash substitute, and the passive Group V — index funds, ETFs, gold, overseas
 * FoFs). The boundary mirrors the dashboard's existing "active-equity envelope"
 * (Sub II + hybrid-ex-arbitrage + Sub IV) so the two read consistently.
 *
 * This is a FLOW-WEIGHTED FEE-TIER PROXY, not a TER-weighted revenue figure: it
 * answers "what share of net inflows landed in the high-fee book", not "how
 * much fee revenue those flows earn". No per-category TER is applied — a ₹100
 * Cr small-cap inflow and a ₹100 Cr ELSS inflow count the same here.
 */
export type FeeTier = "high" | "low";

const HIGH_FEE_MAJORS = new Set([
  "growth-equity",
  "hybrid",
  "solution",
]);
// Arbitrage sits in the hybrid bucket but is a low-TER cash substitute, so it
// counts as low-fee — the same reason it's excluded from the active-equity
// envelope.
const LOW_FEE_OVERRIDES = new Set(["arbitrage"]);

export function feeTierOf(majorSlug: string, categorySlug: string): FeeTier {
  if (LOW_FEE_OVERRIDES.has(categorySlug)) return "low";
  return HIGH_FEE_MAJORS.has(majorSlug) ? "high" : "low";
}

/** Plain-language description of each tier, for the in-UI caveat. */
export const FEE_TIER_NOTE: Record<FeeTier, string> = {
  high: "Actively-managed equity (large / mid / small / multi / flexi-cap, ELSS, sectoral & thematic, value/contra, dividend-yield, focused, large-&-mid), equity-oriented and balanced-advantage hybrids, and solution-oriented schemes (children's / retirement).",
  low: "Debt & liquid / money-market, arbitrage (a low-fee cash substitute), and the passive Group V — index funds, ETFs (equity / debt / gold) and overseas fund-of-funds.",
};

export interface FeeMixMonth {
  month: string;
  highFeeFlow: number;
  lowFeeFlow: number;
  totalFlow: number;
  /** High-fee flow as a % of total net inflow — only when total > 0 (a
   *  negative total makes "% of inflows" not meaningful; rendered as null). */
  highFeeSharePct: number | null;
  // Component buckets (₹ Cr, signed net inflow):
  activeEquityFlow: number;
  equityHybridFlow: number;
  solutionFlow: number;
  debtFlow: number;
  arbitrageFlow: number;
  passiveOtherFlow: number;
}

function emptyMonth(month: string): FeeMixMonth {
  return {
    month,
    highFeeFlow: 0,
    lowFeeFlow: 0,
    totalFlow: 0,
    highFeeSharePct: null,
    activeEquityFlow: 0,
    equityHybridFlow: 0,
    solutionFlow: 0,
    debtFlow: 0,
    arbitrageFlow: 0,
    passiveOtherFlow: 0,
  };
}

/**
 * Per-month fee-tier split of industry net inflows, oldest → newest, trimmed to
 * the last `lastN` months.
 */
export function feeMixByMonth(lastN = 18): FeeMixMonth[] {
  const byMonth = new Map<string, FeeMixMonth>();
  for (const r of amfiMonthlyCategorySnapshot.rows) {
    const flow =
      typeof r.categoryNetInflow === "number" ? r.categoryNetInflow : 0;
    let m = byMonth.get(r.month);
    if (!m) {
      m = emptyMonth(r.month);
      byMonth.set(r.month, m);
    }
    m.totalFlow += flow;
    if (feeTierOf(r.majorCategorySlug, r.categorySlug) === "high") {
      m.highFeeFlow += flow;
    } else {
      m.lowFeeFlow += flow;
    }
    if (r.majorCategorySlug === "growth-equity") m.activeEquityFlow += flow;
    else if (r.majorCategorySlug === "hybrid" && r.categorySlug !== "arbitrage")
      m.equityHybridFlow += flow;
    else if (r.majorCategorySlug === "solution") m.solutionFlow += flow;
    else if (r.majorCategorySlug === "income-debt") m.debtFlow += flow;
    else if (r.categorySlug === "arbitrage") m.arbitrageFlow += flow;
    else if (r.majorCategorySlug === "other-schemes") m.passiveOtherFlow += flow;
  }
  const out = [...byMonth.values()].sort((a, b) =>
    a.month.localeCompare(b.month)
  );
  for (const m of out) {
    m.highFeeSharePct =
      m.totalFlow > 0 ? (m.highFeeFlow / m.totalFlow) * 100 : null;
  }
  return out.slice(-lastN);
}
