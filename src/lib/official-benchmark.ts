/**
 * Join layer: official scheme benchmark identity + estimated benchmark return
 * → the per-period comparison /api/returns-ranking serves.
 *
 * Pure functions over already-loaded snapshots. Nothing here fetches anything:
 * all external acquisition happens at build time, and the runtime only joins
 * two small static assets onto the returns feed.
 *
 * The rules this encodes, in one place so they cannot drift:
 *
 *  - A scheme with no verified AMC evidence gets `benchmark-not-official`, not
 *    a category proxy dressed up as an official benchmark.
 *  - A benchmark whose index we cannot price gets `unsupported-return-source`:
 *    official name kept, return null, no Nifty substitute.
 *  - A benchmark window that does not line up with the fund's own window gets
 *    `benchmark-date-mismatch` and NO alpha, rather than a number computed
 *    across two different periods.
 *  - A window that opens before the current benchmark became effective gets
 *    `benchmark-changed-within-period` (we hold the earlier identity) or
 *    `benchmark-history-insufficient` (we do not), never a silent comparison.
 */

import {
  PERIOD_SPECS,
  daysBetween,
  subPeriod,
  type PeriodKey,
} from "./return-periods";
import type { BenchmarkTriSnapshot } from "@/data/benchmark-tri";
import type {
  BenchmarkComparisonStatus,
  OfficialBenchmarkApiView,
  SchemeBenchmarkEntry,
  SchemeBenchmarkRegistry,
} from "@/data/scheme-benchmarks";
import { UNMAPPED_API_VIEW } from "@/data/scheme-benchmarks";

/** How far the benchmark's END anchor may sit from the fund's, in calendar
 *  days, before the two windows stop being comparable. One trading week covers
 *  a weekend plus a holiday cluster; beyond that the snapshots are out of sync. */
export const END_DATE_TOLERANCE_DAYS = 7;
/** Same, for the START anchor. Slightly looser: the fund and the index resolve
 *  nearest-prior on their own calendars and can legitimately land a few days
 *  apart around a long holiday. */
export const START_DATE_TOLERANCE_DAYS = 12;

const SPEC_BY_KEY = new Map<PeriodKey, (typeof PERIOD_SPECS)[number]>(PERIOD_SPECS.map((p) => [p.key, p]));

export interface PeriodBenchmarkResult {
  officialBenchmarkReturn: number | null;
  excessVsOfficialBenchmark: number | null;
  benchmarkFromDate: string | null;
  benchmarkToDate: string | null;
  benchmarkReturnMethod: string | null;
  benchmarkReturnIsEstimate: boolean | null;
  benchmarkComparisonStatus: BenchmarkComparisonStatus;
}

export const NO_BENCHMARK_PERIOD: PeriodBenchmarkResult = {
  officialBenchmarkReturn: null,
  excessVsOfficialBenchmark: null,
  benchmarkFromDate: null,
  benchmarkToDate: null,
  benchmarkReturnMethod: null,
  benchmarkReturnIsEstimate: null,
  benchmarkComparisonStatus: "benchmark-not-official",
};

/** Index the registry for O(1) lookup by API schemecode. */
export function indexRegistry(registry: SchemeBenchmarkRegistry | null): Map<string, SchemeBenchmarkEntry> {
  const map = new Map<string, SchemeBenchmarkEntry>();
  if (!registry) return map;
  const byKey = new Map(registry.schemes.map((s) => [s.underlyingKey, s]));
  for (const [code, underlyingKey] of Object.entries(registry.bySchemeCode ?? {})) {
    const entry = byKey.get(underlyingKey);
    if (entry) map.set(code, entry);
  }
  return map;
}

export function officialBenchmarkView(entry: SchemeBenchmarkEntry | undefined): OfficialBenchmarkApiView {
  if (!entry) return { ...UNMAPPED_API_VIEW };
  const rec = entry.currentBenchmark;
  if (!rec) {
    return {
      ...UNMAPPED_API_VIEW,
      categoryProxyBenchmarkKey: entry.categoryProxyBenchmarkKey,
      reason: entry.unmappedReason ?? UNMAPPED_API_VIEW.reason,
    };
  }
  return {
    status: entry.mappingStatus,
    name: rec.officialBenchmarkName,
    key: rec.canonicalBenchmarkKey,
    provider: rec.benchmarkProvider,
    basis: rec.basis,
    sourceType: rec.sourceType,
    sourceUrl: rec.sourceUrl,
    sourceDocumentDate: rec.sourceDocumentDate,
    effectiveFrom: rec.effectiveFrom,
    checkedAt: rec.checkedAt,
    historyCount: entry.benchmarkHistory.length,
    categoryProxyBenchmarkKey: entry.categoryProxyBenchmarkKey,
    proxyDisagreesWithOfficial: entry.proxyDisagreesWithOfficial,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Resolve one period's benchmark comparison for one fund.
 *
 * `fundAsOfNavDate` is the fund's OWN window end (mf-category-returns carries
 * it per row). The fund's nominal window start is re-derived with the same
 * calendar arithmetic nav-returns used, so the check compares like with like.
 */
export function periodBenchmark(
  period: PeriodKey,
  fundReturn: number | null,
  fundAsOfNavDate: string | null,
  entry: SchemeBenchmarkEntry | undefined,
  bench: BenchmarkTriSnapshot | null
): PeriodBenchmarkResult {
  const base: PeriodBenchmarkResult = { ...NO_BENCHMARK_PERIOD };
  if (!entry || entry.mappingStatus === "unmapped" || !entry.currentBenchmark) return base;

  const rec = entry.currentBenchmark;
  const key = rec.canonicalBenchmarkKey;
  if (!key || entry.mappingStatus === "official-name-only") {
    return { ...base, benchmarkComparisonStatus: "unsupported-return-source" };
  }

  const idx = bench?.indices?.[key];
  const cell = idx?.periods?.[period];
  if (!idx || !cell) {
    return { ...base, benchmarkComparisonStatus: "benchmark-return-missing" };
  }

  const value = typeof cell.returnPct === "number" ? cell.returnPct : cell.triEstCagrPct;
  const out: PeriodBenchmarkResult = {
    officialBenchmarkReturn: Number.isFinite(value) ? value : null,
    excessVsOfficialBenchmark: null,
    benchmarkFromDate: cell.fromDate ?? null,
    benchmarkToDate: cell.toDate ?? idx.asOf ?? null,
    benchmarkReturnMethod: cell.returnMethod ?? bench?.returnMethod ?? null,
    benchmarkReturnIsEstimate: cell.isEstimate ?? bench?.isEstimate ?? true,
    benchmarkComparisonStatus: "available",
  };
  if (out.officialBenchmarkReturn === null) {
    return { ...out, benchmarkComparisonStatus: "benchmark-return-missing" };
  }

  // ---- date comparability -------------------------------------------------
  const spec = SPEC_BY_KEY.get(period);
  if (fundAsOfNavDate && spec) {
    const fundWindowStart = subPeriod(fundAsOfNavDate, spec.months, spec.years);
    if (out.benchmarkToDate && Math.abs(daysBetween(out.benchmarkToDate, fundAsOfNavDate)) > END_DATE_TOLERANCE_DAYS) {
      return { ...out, excessVsOfficialBenchmark: null, benchmarkComparisonStatus: "benchmark-date-mismatch" };
    }
    if (out.benchmarkFromDate && Math.abs(daysBetween(out.benchmarkFromDate, fundWindowStart)) > START_DATE_TOLERANCE_DAYS) {
      return { ...out, excessVsOfficialBenchmark: null, benchmarkComparisonStatus: "benchmark-date-mismatch" };
    }

    // ---- benchmark history comparability ---------------------------------
    // A window that opens before the current benchmark took effect cannot be
    // compared against it without evidence of what came before.
    if (rec.effectiveFrom && fundWindowStart < rec.effectiveFrom) {
      const covered = entry.benchmarkHistory.some(
        (h) => (!h.effectiveFrom || h.effectiveFrom <= fundWindowStart) && (!h.effectiveTo || h.effectiveTo >= fundWindowStart)
      );
      return {
        ...out,
        excessVsOfficialBenchmark: null,
        benchmarkComparisonStatus: covered ? "benchmark-changed-within-period" : "benchmark-history-insufficient",
      };
    }
    // A prior identity that ENDED inside the window is a change within it, even
    // when the current record carries no effectiveFrom of its own.
    const changedInside = entry.benchmarkHistory.some((h) => h.effectiveTo && h.effectiveTo > fundWindowStart);
    if (changedInside) {
      return { ...out, excessVsOfficialBenchmark: null, benchmarkComparisonStatus: "benchmark-changed-within-period" };
    }
  }

  if (fundReturn === null || !Number.isFinite(fundReturn)) {
    return { ...out, excessVsOfficialBenchmark: null, benchmarkComparisonStatus: "fund-return-missing" };
  }
  return { ...out, excessVsOfficialBenchmark: round4(fundReturn - out.officialBenchmarkReturn) };
}
