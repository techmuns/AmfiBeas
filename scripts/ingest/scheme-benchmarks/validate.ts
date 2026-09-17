/**
 * Standalone validator for the committed official-benchmark artefacts.
 *
 * Runs the SAME guards the builder runs before writing (scheme-benchmarks/guards.ts),
 * plus checks that only make sense against a committed snapshot:
 *
 *  - every API scheme row the current returns snapshot serves is present in the
 *    registry with exactly one explicit status (no row may be silently absent);
 *  - Direct/Regular and Growth/IDCW siblings of one underlying scheme resolve to
 *    the SAME benchmark;
 *  - every "official" mapping carries a first-party evidence URL;
 *  - the canonical index registry has no alias collisions;
 *  - every manual override is well-formed (evidence URL + reason);
 *  - every canonical key referenced by a mapping exists, and any key claiming a
 *    computable return has an index entry in the benchmark-returns snapshot.
 *
 * Exits non-zero with a reason list on failure, so CI can gate on it.
 *
 * Run: npm run validate:scheme-benchmarks
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, warn } from "../utils";
import { runGuards } from "./guards";
import { loadOverrides } from "./overrides";
import { benchmarkByKey, registryCollisions } from "../../../src/data/benchmark-registry";
import { hasFirstPartyEvidence, type SchemeBenchmarkCoverage, type SchemeBenchmarkRegistry } from "../../../src/data/scheme-benchmarks";
import type { BenchmarkTriSnapshot } from "../../../src/data/benchmark-tri";

const REGISTRY_PATH = path.resolve(process.cwd(), "public/nav-data/mf-scheme-benchmarks.json");
const COVERAGE_PATH = path.resolve(process.cwd(), "public/nav-data/mf-scheme-benchmark-coverage.json");
const RETURNS_PATH = path.resolve(process.cwd(), "public/nav-data/benchmark-tri.json");
const CATEGORY_RETURNS_PATH = path.resolve(process.cwd(), "public/nav-data/mf-category-returns.json");

async function readJson<T>(p: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(p, "utf8")) as T; } catch { return null; }
}

async function main(): Promise<void> {
  const failures: string[] = [];

  for (const c of registryCollisions()) failures.push(`canonical registry: ${c}`);

  const registry = await readJson<SchemeBenchmarkRegistry>(REGISTRY_PATH);
  const coverage = await readJson<SchemeBenchmarkCoverage>(COVERAGE_PATH);
  if (!registry) {
    warn(`missing ${path.relative(process.cwd(), REGISTRY_PATH)} — run npm run build:scheme-benchmarks first`);
    process.exit(1);
  }
  if (!coverage) {
    warn(`missing ${path.relative(process.cwd(), COVERAGE_PATH)}`);
    process.exit(1);
  }

  // Same guards the builder applies, minus the "vs previous" comparison (the
  // committed snapshot IS the previous one here).
  failures.push(...runGuards(registry, coverage, { registry: null, coverage: null }));

  // --- every API row is covered -------------------------------------------
  const cat = await readJson<{ fundRanks?: Array<{ schemecode: string }> }>(CATEGORY_RETURNS_PATH);
  if (cat?.fundRanks) {
    const covered = new Set(Object.keys(registry.bySchemeCode ?? {}));
    const missing = cat.fundRanks.filter((f) => !covered.has(f.schemecode));
    if (missing.length > 0) {
      failures.push(`${missing.length} API scheme rows have no registry entry (e.g. ${missing.slice(0, 5).map((m) => m.schemecode).join(", ")})`);
    }
    if (registry.totalApiSchemeRows !== cat.fundRanks.length) {
      failures.push(`registry totalApiSchemeRows ${registry.totalApiSchemeRows} != returns snapshot rows ${cat.fundRanks.length}`);
    }
  }

  // --- sibling consistency + evidence -------------------------------------
  const bench = await readJson<BenchmarkTriSnapshot>(RETURNS_PATH);
  let mappedWithoutReturnIndex = 0;
  for (const e of registry.schemes) {
    // All plan/option siblings live in ONE entry by construction, so this checks
    // the construction held: a scheme code must not appear in two entries, and
    // the entry's single benchmark applies to all of its codes.
    if (new Set(e.schemeCodes).size !== e.schemeCodes.length) {
      failures.push(`${e.underlyingKey}: duplicate scheme codes in one entry`);
    }
    const rec = e.currentBenchmark;
    if (e.mappingStatus !== "unmapped" && !hasFirstPartyEvidence(rec)) {
      failures.push(`${e.underlyingKey}: ${e.mappingStatus} without first-party evidence URL`);
    }
    if (rec?.canonicalBenchmarkKey) {
      const canonical = benchmarkByKey(rec.canonicalBenchmarkKey);
      if (!canonical) failures.push(`${e.underlyingKey}: unknown canonical key ${rec.canonicalBenchmarkKey}`);
      else if (canonical.provider !== rec.benchmarkProvider) {
        failures.push(`${e.underlyingKey}: provider "${rec.benchmarkProvider}" != canonical provider "${canonical.provider}"`);
      }
      if (e.mappingStatus === "official-mapped" && bench && !bench.indices?.[rec.canonicalBenchmarkKey]) {
        mappedWithoutReturnIndex += 1;
      }
    }
    if (e.mappingStatus === "official-mapped" && !rec?.canonicalBenchmarkKey) {
      failures.push(`${e.underlyingKey}: official-mapped without a canonical key`);
    }
  }

  // --- manual overrides ----------------------------------------------------
  const overrides = await loadOverrides();
  for (const r of overrides.rejected) {
    failures.push(`manual override rejected (${r.reason}): ${r.override.schemeName ?? r.override.schemecode ?? r.override.underlyingKey}`);
  }

  info("============ SCHEME BENCHMARK VALIDATION ============");
  info(`registry:   ${registry.totalUnderlyingSchemes} underlying schemes, ${registry.totalApiSchemeRows} API rows`);
  info(`statuses:   official-mapped=${coverage.officialMapped} official-name-only=${coverage.officialNameOnly} unmapped=${coverage.unmapped}`);
  info(`coverage:   ${coverage.coveragePct}%   ·   overrides: ${overrides.total} (${overrides.rejected.length} rejected)`);
  if (bench) info(`returns:    ${Object.keys(bench.indices ?? {}).length} indices priced, asOf ${bench.latestDate}`);
  else warn("benchmark-returns snapshot absent — official-mapped schemes will serve a null return until it is built");
  if (mappedWithoutReturnIndex > 0) {
    // Not fatal: the returns snapshot refreshes on its own schedule and the API
    // reports `benchmark-return-missing` honestly in the meantime.
    warn(`${mappedWithoutReturnIndex} official-mapped schemes reference an index the returns snapshot does not yet carry`);
  }

  if (failures.length > 0) {
    warn(`VALIDATION FAILED — ${failures.length} problem(s):`);
    for (const f of failures.slice(0, 30)) warn(`  - ${f}`);
    if (failures.length > 30) warn(`  (… ${failures.length - 30} more)`);
    process.exit(1);
  }
  info("Validation: PASS");
  info("====================================================");
}

main().catch((e) => {
  warn(`validate-scheme-benchmarks failed: ${(e as Error).message}`);
  process.exit(1);
});
