/**
 * Write-time guards for the official scheme-benchmark registry.
 *
 * Same keep-last-good philosophy the benchmark builder already uses: a run that
 * trips any of these does NOT write, the previous snapshot survives, and the
 * job exits non-zero so the workflow's commit step is skipped. A broken scraper
 * must never be able to replace a good snapshot with an empty or degraded one.
 *
 * Shared by the builder (pre-write) and by `npm run validate:scheme-benchmarks`
 * (post-write / CI), so the two can never disagree about what "valid" means.
 */

import { hasFirstPartyEvidence, type SchemeBenchmarkCoverage, type SchemeBenchmarkRegistry } from "../../../src/data/scheme-benchmarks";

/** Guards — a broken scraper must not overwrite a good snapshot. */
const GUARD = {
  minUnderlyingSchemes: 1000,
  minApiRows: 3000,
  /** Absolute percentage points of official coverage we tolerate losing. */
  maxCoverageDropPct: 10,
};

export function runGuards(
  registry: SchemeBenchmarkRegistry,
  coverage: SchemeBenchmarkCoverage,
  prev: { registry: SchemeBenchmarkRegistry | null; coverage: SchemeBenchmarkCoverage | null }
): string[] {
  const failures: string[] = [];

  if (registry.schemes.length === 0) failures.push("generated registry is empty");
  if (registry.totalUnderlyingSchemes < GUARD.minUnderlyingSchemes) {
    failures.push(`underlying schemes ${registry.totalUnderlyingSchemes} below floor ${GUARD.minUnderlyingSchemes}`);
  }
  if (registry.totalApiSchemeRows < GUARD.minApiRows) {
    failures.push(`API scheme rows ${registry.totalApiSchemeRows} below floor ${GUARD.minApiRows}`);
  }
  if (prev.registry && registry.totalUnderlyingSchemes < prev.registry.totalUnderlyingSchemes * 0.9) {
    failures.push(`scheme universe collapsed: ${registry.totalUnderlyingSchemes} vs previous ${prev.registry.totalUnderlyingSchemes}`);
  }
  if (prev.coverage && coverage.coveragePct < prev.coverage.coveragePct - GUARD.maxCoverageDropPct) {
    failures.push(`official coverage collapsed: ${coverage.coveragePct}% vs previous ${prev.coverage.coveragePct}%`);
  }

  // Every row must have exactly one status, and every scheme code must map once.
  const seenCodes = new Map<string, string>();
  const canonicalIdentity = new Map<string, string>();
  for (const e of registry.schemes) {
    if (!["official-mapped", "official-name-only", "unmapped"].includes(e.mappingStatus)) {
      failures.push(`${e.underlyingKey}: invalid mappingStatus ${e.mappingStatus}`);
    }
    for (const c of e.schemeCodes) {
      const prevKey = seenCodes.get(c);
      if (prevKey && prevKey !== e.underlyingKey) failures.push(`schemecode ${c} claimed by ${prevKey} and ${e.underlyingKey}`);
      seenCodes.set(c, e.underlyingKey);
    }
    const rec = e.currentBenchmark;
    if (e.mappingStatus !== "unmapped") {
      if (!rec) failures.push(`${e.underlyingKey}: status ${e.mappingStatus} without a benchmark record`);
      else if (!hasFirstPartyEvidence(rec)) failures.push(`${e.underlyingKey}: official status with no first-party evidence URL`);
    } else if (rec) {
      failures.push(`${e.underlyingKey}: unmapped but carries a benchmark record`);
    }
    if (rec?.canonicalBenchmarkKey) {
      // A canonical key must not resolve to two different index identities.
      const identity = `${rec.benchmarkProvider ?? "?"}`;
      const prevIdentity = canonicalIdentity.get(rec.canonicalBenchmarkKey);
      if (prevIdentity && prevIdentity !== identity) {
        failures.push(`canonical key ${rec.canonicalBenchmarkKey} resolves to two identities: ${prevIdentity} vs ${identity}`);
      }
      canonicalIdentity.set(rec.canonicalBenchmarkKey, identity);
    }
    // Contradictory history: two records covering the same effective window.
    const windows = [...e.benchmarkHistory, ...(rec ? [rec] : [])]
      .filter((r) => r.effectiveFrom)
      .map((r) => `${r.effectiveFrom}`);
    if (new Set(windows).size !== windows.length) {
      failures.push(`${e.underlyingKey}: duplicate benchmark records for the same effective period`);
    }
  }

  for (const n of [coverage.officialMapped, coverage.officialNameOnly, coverage.unmapped, coverage.coveragePct]) {
    if (!Number.isFinite(n)) failures.push("coverage report contains a non-finite number");
  }
  if (coverage.officialMapped + coverage.officialNameOnly + coverage.unmapped !== registry.totalUnderlyingSchemes) {
    failures.push("coverage buckets do not sum to the scheme count");
  }

  return failures;
}

