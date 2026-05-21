/**
 * AMC Narrative accessors — typed reads over the
 * `src/data/snapshots/amc-narratives.json` snapshot. The snapshot is
 * built by `scripts/ingest/amc-narratives.ts` from per-AMC-per-quarter
 * JSONs in `manual-data/amc-narratives/extracted/`.
 *
 * Powers:
 *   - Concall Digest panel on `/amc/[slug]`
 *   - Strategic Moves Timeline on `/amc/[slug]` and `/compare`
 *   - Unique Investor Share trend chart on `/amc/[slug]`
 *   - Strategic Posture Radar on `/amc/[slug]` and `/compare`
 *   - Cohort views on `/amc`
 *
 * Every consumer must handle `null` / missing values — most AMCs don't
 * disclose every metric every quarter.
 */

import amcNarrativesRaw from "./snapshots/amc-narratives.json";

export type ThemeCategory =
  | "growth"
  | "margins"
  | "regulatory"
  | "strategy"
  | "risk"
  | "cost";

export interface NarrativeTheme {
  category: ThemeCategory;
  headline: string;
  detail?: string;
  metricRef?: string;
}

export type NarrativeMetricField =
  | "uniqueInvestorShare"
  | "digitalTransactionPct"
  | "p30InflowShare"
  | "headcount"
  | "dividendPerShare"
  | "payoutRatio"
  | "berImpactBps"
  | "sipBookMillions"
  | "operatingMarginPct";

export interface NarrativeMetric {
  field: NarrativeMetricField | string;
  value: number | null;
  unit: "pct" | "bps" | "inr" | "count" | "millions" | "bn";
}

export interface ChannelMix {
  directPct: number | null;
  bankPct: number | null;
  nationalDistPct: number | null;
  mfdPct: number | null;
  fintechPct: number | null;
  note?: string;
}

export type StrategicEventType =
  | "mandate_win"
  | "fund_launch"
  | "board_change"
  | "international"
  | "regulatory"
  | "technology"
  | "partnership";

export interface StrategicEvent {
  type: StrategicEventType;
  label: string;
  impactBps?: number;
}

export interface NarrativeQuote {
  text: string;
  speaker?: string;
}

export interface AmcNarrativeRow {
  amcSlug: string;
  fiscalPeriod: string;       // "FY26-Q4"
  callDate: string | null;    // ISO yyyy-mm-dd
  sourcePdf: string;
  themes: NarrativeTheme[];
  metrics: NarrativeMetric[];
  channelMix?: ChannelMix;
  events: StrategicEvent[];
  quotes: NarrativeQuote[];
  initiatives: string[];
}

export interface AmcNarrativesSnapshot {
  generatedAt: string;
  rows: AmcNarrativeRow[];
}

const amcNarrativesSnapshot = amcNarrativesRaw as AmcNarrativesSnapshot;

function rows(): AmcNarrativeRow[] {
  return amcNarrativesSnapshot?.rows ?? [];
}

/** Fiscal-period ordering helper: FY25-Q1 < FY25-Q2 < … < FY26-Q4. */
export function fiscalPeriodSortKey(period: string): number {
  const m = /^FY(\d{2})-Q([1-4])$/.exec(period);
  if (!m) return 0;
  return Number(m[1]) * 10 + Number(m[2]);
}

/** All narrative rows for a given AMC, sorted oldest → newest. */
export function amcNarrativesAll(slug: string): AmcNarrativeRow[] {
  return rows()
    .filter((r) => r.amcSlug === slug)
    .sort(
      (a, b) =>
        fiscalPeriodSortKey(a.fiscalPeriod) - fiscalPeriodSortKey(b.fiscalPeriod)
    );
}

/** The most recent narrative row for a given AMC, or null. */
export function amcNarrativeLatest(slug: string): AmcNarrativeRow | null {
  const all = amcNarrativesAll(slug);
  return all.length > 0 ? all[all.length - 1] : null;
}

/** A single narrative row for an exact (slug, period) pair, or null. */
export function amcNarrative(
  slug: string,
  period: string
): AmcNarrativeRow | null {
  return (
    rows().find(
      (r) => r.amcSlug === slug && r.fiscalPeriod === period
    ) ?? null
  );
}

/** All events for an AMC, flattened across quarters and stamped with the
 *  fiscal period in which they were disclosed. Newest first. */
export function amcEventsTimeline(
  slug: string
): Array<StrategicEvent & { fiscalPeriod: string }> {
  return amcNarrativesAll(slug)
    .flatMap((r) =>
      r.events.map((e) => ({ ...e, fiscalPeriod: r.fiscalPeriod }))
    )
    .reverse();
}

/** Events from a cohort of AMCs, grouped by quarter. Returns an
 *  array sorted oldest → newest with quarter-key + per-AMC events. */
export function amcEventsAcrossCohort(slugs: string[]): Array<{
  fiscalPeriod: string;
  bySlug: Record<string, StrategicEvent[]>;
}> {
  const byPeriod = new Map<string, Record<string, StrategicEvent[]>>();
  for (const slug of slugs) {
    for (const row of amcNarrativesAll(slug)) {
      if (!byPeriod.has(row.fiscalPeriod)) {
        byPeriod.set(row.fiscalPeriod, {});
      }
      const bucket = byPeriod.get(row.fiscalPeriod)!;
      bucket[slug] = (bucket[slug] ?? []).concat(row.events);
    }
  }
  return Array.from(byPeriod.entries())
    .sort(([a], [b]) => fiscalPeriodSortKey(a) - fiscalPeriodSortKey(b))
    .map(([fiscalPeriod, bySlug]) => ({ fiscalPeriod, bySlug }));
}

/** Time-series of a specific metric for an AMC. Returns a chart-shaped
 *  series with `null` values omitted (the chart helpers handle missing
 *  trailing-window math on their own). */
export function amcMetricTrend(
  slug: string,
  field: NarrativeMetricField | string
): { label: string; value: number }[] {
  return amcNarrativesAll(slug)
    .map((r) => {
      const m = r.metrics.find((x) => x.field === field);
      const v = m?.value;
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      return { label: r.fiscalPeriod, value: v };
    })
    .filter((x): x is { label: string; value: number } => x !== null);
}

/** All initiatives the AMC has ever mentioned across the available
 *  concalls, deduped (case-insensitive). Powers the Forward Bets table. */
export function amcInitiativesUnion(slug: string): string[] {
  const seen = new Map<string, string>();
  for (const r of amcNarrativesAll(slug)) {
    for (const i of r.initiatives) {
      const k = i.toLowerCase().trim();
      if (k && !seen.has(k)) seen.set(k, i);
    }
  }
  return Array.from(seen.values()).sort();
}

/** Union of initiatives across an entire cohort — for the column set in
 *  the Forward Bets register. */
export function cohortInitiativesUnion(slugs: string[]): string[] {
  const seen = new Map<string, string>();
  for (const slug of slugs) {
    for (const i of amcInitiativesUnion(slug)) {
      const k = i.toLowerCase().trim();
      if (k && !seen.has(k)) seen.set(k, i);
    }
  }
  return Array.from(seen.values()).sort();
}

/** Score the AMC on the 5 posture-radar axes, 0–100, using the latest
 *  available narrative row. Returns `null` for axes the AMC doesn't
 *  disclose (the radar renders these as dashed grid lines).
 *
 *  Scoring rules:
 *   - digitalMaturity   : digitalTransactionPct          (0-100 → 0-100)
 *   - geographicDepth   : p30InflowShare                 (0-100 → 0-100)
 *   - channelDiversity  : 1 - HHI(channelMix shares)     (0-1 → 0-100)
 *   - pipelineBreadth   : initiatives.length             (curve: 1→20, 3→60, 5+→100)
 *   - cohortBreadth     : uniqueInvestorShare            (0-35% → 0-100)
 */
export interface PostureScores {
  digitalMaturity: number | null;
  geographicDepth: number | null;
  channelDiversity: number | null;
  pipelineBreadth: number | null;
  cohortBreadth: number | null;
  asOf: string;       // fiscalPeriod that fed the scores
}

export function amcPostureScores(slug: string): PostureScores | null {
  const latest = amcNarrativeLatest(slug);
  if (!latest) return null;
  const metricVal = (field: string): number | null => {
    const m = latest.metrics.find((x) => x.field === field);
    const v = m?.value;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const digital = metricVal("digitalTransactionPct");
  const p30 = metricVal("p30InflowShare");
  const cohort = metricVal("uniqueInvestorShare");
  const cm = latest.channelMix;
  const channelShares = cm
    ? [cm.directPct, cm.bankPct, cm.nationalDistPct, cm.mfdPct, cm.fintechPct]
    : [];
  const channelDiv = (() => {
    if (channelShares.some((v) => v === null || v === undefined)) return null;
    const total = channelShares.reduce<number>((s, v) => s + (v ?? 0), 0);
    if (total <= 0) return null;
    // Herfindahl on shares (normalised), inverted: higher diversity = higher score.
    const shares = channelShares.map((v) => (v ?? 0) / total);
    const hhi = shares.reduce((s, x) => s + x * x, 0);
    return Math.max(0, Math.min(100, (1 - hhi) * 100));
  })();
  const pipeline = (() => {
    const n = latest.initiatives.length;
    if (n === 0) return null;
    if (n >= 5) return 100;
    return Math.round((n / 5) * 100);
  })();
  return {
    digitalMaturity: digital,
    geographicDepth: p30,
    channelDiversity: channelDiv,
    pipelineBreadth: pipeline,
    cohortBreadth:
      cohort !== null ? Math.max(0, Math.min(100, (cohort / 35) * 100)) : null,
    asOf: latest.fiscalPeriod,
  };
}

/** Category-styling map used by the Concall Digest pills. */
export const THEME_CATEGORY_PILL: Record<
  ThemeCategory,
  { label: string; cls: string }
> = {
  growth: {
    label: "Growth",
    cls: "border-positive/40 bg-positive/10 text-positive",
  },
  margins: {
    label: "Margins",
    cls: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  regulatory: {
    label: "Regulatory",
    cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  strategy: {
    label: "Strategy",
    cls: "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-400",
  },
  risk: {
    label: "Risk",
    cls: "border-negative/40 bg-negative/10 text-negative",
  },
  cost: {
    label: "Cost",
    cls: "border-foreground/30 bg-muted text-muted-foreground",
  },
};

/** Posture-radar axis labels in the order the radar renders them. */
export const POSTURE_AXES = [
  { key: "digitalMaturity", label: "Digital maturity" },
  { key: "geographicDepth", label: "Geographic depth" },
  { key: "channelDiversity", label: "Channel diversity" },
  { key: "pipelineBreadth", label: "Pipeline breadth" },
  { key: "cohortBreadth", label: "Cohort breadth" },
] as const;

export type PostureAxisKey = (typeof POSTURE_AXES)[number]["key"];

/** Event-type styling map used by the Strategic Moves Timeline. */
export const EVENT_TYPE_BADGE: Record<
  StrategicEventType,
  { label: string; cls: string }
> = {
  mandate_win: {
    label: "Mandate",
    cls: "border-positive/40 bg-positive/10 text-positive",
  },
  fund_launch: {
    label: "Launch",
    cls: "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  board_change: {
    label: "Board",
    cls: "border-purple-500/40 bg-purple-500/10 text-purple-700 dark:text-purple-400",
  },
  international: {
    label: "International",
    cls: "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  },
  regulatory: {
    label: "Regulatory",
    cls: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  technology: {
    label: "Tech / AI",
    cls: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400",
  },
  partnership: {
    label: "Partnership",
    cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
};
