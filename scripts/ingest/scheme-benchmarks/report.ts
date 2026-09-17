/**
 * Human-readable coverage report for the official scheme-benchmark registry.
 *
 * Reads the committed artefacts and prints the review table: how much of the
 * universe carries an AMC-verified benchmark, which AMCs are weakest, which
 * providers we still cannot price, and — the list that justifies this whole
 * feature — the schemes where the old CATEGORY PROXY disagreed with the
 * benchmark the AMC actually publishes.
 *
 * Read-only. Run: npm run report:scheme-benchmarks
 */

import fs from "node:fs/promises";
import path from "node:path";
import { warn } from "../utils";
import type { SchemeBenchmarkCoverage, SchemeBenchmarkRegistry } from "../../../src/data/scheme-benchmarks";
import type { BenchmarkTriSnapshot } from "../../../src/data/benchmark-tri";

const REGISTRY_PATH = path.resolve(process.cwd(), "public/nav-data/mf-scheme-benchmarks.json");
const COVERAGE_PATH = path.resolve(process.cwd(), "public/nav-data/mf-scheme-benchmark-coverage.json");
const RETURNS_PATH = path.resolve(process.cwd(), "public/nav-data/benchmark-tri.json");

const out = (s = "") => process.stdout.write(`${s}\n`);

async function readJson<T>(p: string): Promise<T | null> {
  try { return JSON.parse(await fs.readFile(p, "utf8")) as T; } catch { return null; }
}

function pct(n: number, d: number): string {
  return d === 0 ? "0.0%" : `${((n / d) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const registry = await readJson<SchemeBenchmarkRegistry>(REGISTRY_PATH);
  const coverage = await readJson<SchemeBenchmarkCoverage>(COVERAGE_PATH);
  if (!registry || !coverage) {
    warn("registry or coverage report missing — run npm run build:scheme-benchmarks first");
    process.exit(1);
  }
  const bench = await readJson<BenchmarkTriSnapshot>(RETURNS_PATH);

  const rows = coverage.totalApiSchemeRows;
  const total = coverage.totalUnderlyingSchemes;

  out(`Official scheme-benchmark coverage — universe as of ${coverage.universeAsOfDate ?? "?"}, built ${coverage.generatedAt}`);
  out();
  out("| Metric | Count | % |");
  out("|---|---:|---:|");
  out(`| API scheme rows | ${rows} | 100.0% |`);
  out(`| Unique underlying schemes | ${total} | — |`);
  out(`| Official benchmark verified | ${coverage.officialMapped + coverage.officialNameOnly} | ${pct(coverage.officialMapped + coverage.officialNameOnly, total)} |`);
  out(`| Benchmark return available | ${coverage.returnAvailable} | ${pct(coverage.returnAvailable, total)} |`);
  out(`| Official benchmark name only | ${coverage.officialNameOnly} | ${pct(coverage.officialNameOnly, total)} |`);
  out(`| Unmapped | ${coverage.unmapped} | ${pct(coverage.unmapped, total)} |`);
  out();

  out("## 1. Most-used official benchmarks (by scheme count)");
  if (coverage.byCanonicalKey.length === 0) out("_none yet_");
  for (const b of coverage.byCanonicalKey.slice(0, 20)) out(`- ${b.key} — ${b.count}`);
  out();

  out("## 2. AMCs with the weakest mapping coverage");
  for (const a of coverage.byAmc.slice(0, 15)) {
    out(`- ${a.amc}: ${a.pct}% of ${a.total} schemes (mapped ${a.officialMapped}, name-only ${a.officialNameOnly}, unmapped ${a.unmapped})`);
  }
  out();

  out("## 3. Benchmark providers we still cannot calculate returns for");
  if (coverage.unsupportedBenchmarkFamilies.length === 0) out("_none_");
  for (const f of coverage.unsupportedBenchmarkFamilies) out(`- ${f.key} — ${f.count} scheme(s)`);
  out();

  out("## 4. Schemes where the CATEGORY PROXY disagreed with the OFFICIAL benchmark");
  if (coverage.proxyDisagreementList.length === 0) out("_none_");
  for (const d of coverage.proxyDisagreementList) {
    out(`- ${d.schemeName} (${d.amc}, ${d.classification ?? "unclassified"}): proxy ${d.categoryProxyBenchmarkKey} → official ${d.officialBenchmarkKey ?? d.officialBenchmarkName}`);
  }
  out();

  out("## 5. Schemes with benchmark-history / comparability problems");
  const historyIssues = registry.schemes.filter((s) => s.currentBenchmark?.effectiveFrom && s.benchmarkHistory.length === 0);
  out(`benchmark-history-insufficient: ${historyIssues.length}`);
  for (const s of historyIssues.slice(0, 20)) {
    out(`- ${s.schemeName} (${s.amc}) — current benchmark effective from ${s.currentBenchmark?.effectiveFrom}, no prior identity on record`);
  }
  const withHistory = registry.schemes.filter((s) => s.benchmarkHistory.length > 0);
  out(`benchmark changed with history on record: ${withHistory.length}`);
  for (const s of withHistory.slice(0, 20)) {
    out(`- ${s.schemeName} (${s.amc}) — ${s.benchmarkHistory.map((h) => h.canonicalBenchmarkKey ?? h.officialBenchmarkName).join(" → ")} → ${s.currentBenchmark?.canonicalBenchmarkKey ?? "?"}`);
  }
  out(`stale source documents (older than ~200 days): ${coverage.staleSource}`);
  out();

  out("## Benchmark returns");
  if (!bench) out("_benchmark-tri snapshot absent_");
  else {
    out(`- asOf ${bench.latestDate} (NAV as-of ${bench.navAsOfDate ?? "?"}), method ${bench.returnMethod ?? "?"}, isEstimate ${bench.isEstimate ?? true}`);
    out(`- indices priced: ${Object.keys(bench.indices ?? {}).length}`);
  }
}

main().catch((e) => {
  warn(`report failed: ${(e as Error).message}`);
  process.exit(1);
});
