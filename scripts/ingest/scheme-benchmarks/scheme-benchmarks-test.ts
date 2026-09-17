/**
 * Deterministic regression tests for the official scheme-benchmark feature.
 *
 * These cover the NON-OBVIOUS failure modes — the ones that would quietly
 * produce a wrong-but-plausible alpha number rather than an obvious crash:
 *
 *   A. Direct and Regular variants resolve to the SAME underlying benchmark.
 *   B. Growth and IDCW variants do not fork into two benchmarks.
 *   C. NIFTY 500 is never confused with NIFTY 500 Multicap 50:25:25
 *      (and the other near-neighbour pairs).
 *   D. A Focused/Thematic scheme whose official benchmark is NOT the category
 *      proxy gets its TRUE benchmark, and the disagreement is flagged.
 *   E. An unknown official benchmark keeps its identity, returns null, and is
 *      never substituted with a convenient index.
 *   F. A scheme whose benchmark changed recently gets a comparability warning
 *      on the windows that open before the change.
 *   G. An "official" mapping with no first-party evidence URL is rejected.
 *   H. A benchmark window that does not line up with the fund's window yields a
 *      status, not a silently-computed excess return.
 *   I. The pre-existing /api/returns-ranking response contract still holds for
 *      an old client (every legacy field present, same names, same meanings).
 *
 * Run: npm run test:scheme-benchmarks
 */

import fs from "node:fs";
import path from "node:path";
import { extractBenchmarks } from "./extract";
import { runGuards } from "./guards";
import { loadUniverse } from "./universe";
import {
  matchLongestBenchmark,
  registryCollisions,
  resolveBenchmark,
} from "../../../src/data/benchmark-registry";
import { periodBenchmark, officialBenchmarkView, indexRegistry } from "../../../src/lib/official-benchmark";
import type { BenchmarkTriSnapshot } from "../../../src/data/benchmark-tri";
import type {
  BenchmarkRecord,
  SchemeBenchmarkCoverage,
  SchemeBenchmarkEntry,
  SchemeBenchmarkRegistry,
} from "../../../src/data/scheme-benchmarks";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { passed += 1; process.stdout.write(`  ✓ ${name}\n`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); process.stdout.write(`  ✗ ${name}${detail ? ` — ${detail}` : ""}\n`); }
}
function section(title: string): void {
  process.stdout.write(`\n${title}\n`);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHECKED_AT = "2026-09-17T00:00:00.000Z";

function record(over: Partial<BenchmarkRecord> = {}): BenchmarkRecord {
  return {
    officialBenchmarkName: "NIFTY Midcap 150 TRI",
    canonicalBenchmarkKey: "NIFTY_MIDCAP_150",
    benchmarkProvider: "NSE Indices",
    basis: "TRI",
    effectiveFrom: null,
    effectiveTo: null,
    sourceType: "factsheet",
    evidenceKind: "labelled-benchmark-field",
    sourceUrl: "https://www.example-amc.com/factsheet-aug-2026.pdf",
    sourceDocumentDate: "2026-08-31",
    checkedAt: CHECKED_AT,
    ...over,
  };
}

function entry(over: Partial<SchemeBenchmarkEntry> = {}): SchemeBenchmarkEntry {
  return {
    underlyingKey: "demo::demo fund",
    schemeName: "Demo Fund",
    normalizedName: "demo fund",
    amc: "Demo Mutual Fund",
    amcSlug: "demo",
    schemeCodes: ["1", "1-D"],
    classifications: ["Equity : Mid Cap"],
    mappingStatus: "official-mapped",
    unmappedReason: null,
    currentBenchmark: record(),
    benchmarkHistory: [],
    categoryProxyBenchmarkKey: "NIFTY_MIDCAP_150",
    proxyDisagreesWithOfficial: false,
    ...over,
  };
}

const BENCH: BenchmarkTriSnapshot = {
  generatedAt: CHECKED_AT,
  source: "test",
  method: "test",
  returnMethod: "estimated-tri-from-pri-plus-dividend-yield",
  isEstimate: true,
  latestDate: "2026-09-16",
  indices: {
    NIFTY_MIDCAP_150: {
      label: "NIFTY Midcap 150 TRI",
      asOf: "2026-09-16",
      priClose: 23252.7,
      divYieldPct: 0.59,
      periods: {
        "1Y": { returnPct: 10.92, priReturnPct: 10.14, divYieldAvgPct: 0.71, fromDate: "2025-09-16", toDate: "2026-09-16", returnMethod: "estimated-tri-from-pri-plus-dividend-yield", isEstimate: true, triEstCagrPct: 10.92, priCagrPct: 10.14 },
        "5Y": { returnPct: 17.45, priReturnPct: 16.6, divYieldAvgPct: 0.74, fromDate: "2021-09-16", toDate: "2026-09-16", returnMethod: "estimated-tri-from-pri-plus-dividend-yield", isEstimate: true, triEstCagrPct: 17.45, priCagrPct: 16.6 },
      },
    },
    // Deliberately stale: its window ends months before the fund's.
    NIFTY_500: {
      label: "NIFTY 500 TRI",
      asOf: "2026-05-29",
      priClose: 23000,
      divYieldPct: 1,
      periods: {
        "1Y": { returnPct: 3.87, priReturnPct: 2.76, divYieldAvgPct: 1.09, fromDate: "2025-05-29", toDate: "2026-05-29", returnMethod: "estimated-tri-from-pri-plus-dividend-yield", isEstimate: true, triEstCagrPct: 3.87, priCagrPct: 2.76 },
      },
    },
  },
};

function emptyCoverage(over: Partial<SchemeBenchmarkCoverage> = {}): SchemeBenchmarkCoverage {
  return {
    generatedAt: CHECKED_AT,
    universeAsOfDate: "2026-09-16",
    totalApiSchemeRows: 3439,
    totalUnderlyingSchemes: 1771,
    officialMapped: 1,
    officialNameOnly: 0,
    unmapped: 1770,
    returnAvailable: 1,
    returnUnavailable: 1770,
    benchmarkHistoryInsufficient: 0,
    staleSource: 0,
    coveragePct: 0.06,
    rows: { officialMapped: 2, officialNameOnly: 0, unmapped: 3437, returnAvailable: 2 },
    byAmc: [],
    byClassification: [],
    byProvider: [],
    byCanonicalKey: [],
    unsupportedBenchmarkFamilies: [],
    proxyDisagreements: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// C. Near-neighbour index names must stay distinct
// ---------------------------------------------------------------------------

function testDistinctIndices(): void {
  section("C. Near-neighbour indices stay distinct");
  check("canonical registry has no alias collisions", registryCollisions().length === 0, registryCollisions().join("; "));

  const pairs: Array<[string, string]> = [
    ["NIFTY 500 TRI", "NIFTY 500 Multicap 50:25:25 TRI"],
    ["NIFTY 100 TRI", "NIFTY 100 Equal Weight TRI"],
    ["NIFTY 200 TRI", "NIFTY 200 Momentum 30 TRI"],
    ["NIFTY 50 TRI", "NIFTY 50 Value 20 TRI"],
    ["NIFTY Midcap 150 TRI", "NIFTY Midcap150 Quality 50 TRI"],
  ];
  for (const [a, b] of pairs) {
    const ra = resolveBenchmark(a);
    const rb = resolveBenchmark(b);
    check(
      `"${a}" ≠ "${b}"`,
      !!ra && !!rb && ra.canonical.key !== rb.canonical.key,
      `${ra?.canonical.key ?? "null"} vs ${rb?.canonical.key ?? "null"}`
    );
  }

  // Spelling variants of ONE index must converge.
  const variants = ["NIFTY Midcap 150 TRI", "Nifty Midcap 150 Total Return Index", "NIFTY MIDCAP 150 TRI", "nifty midcap150 (TRI)"];
  const keys = new Set(variants.map((v) => resolveBenchmark(v)?.canonical.key ?? "null"));
  check("all NIFTY Midcap 150 spellings converge on one key", keys.size === 1 && keys.has("NIFTY_MIDCAP_150"), [...keys].join("; "));

  // A longer index name must never be truncated to a broad-index prefix.
  check(
    "'Nifty 500 Low Volatility 50' is NOT read as 'Nifty 500'",
    matchLongestBenchmark("Benchmark: Nifty 500 Low Volatility 50 Index") === null
  );
  check(
    "'Nifty 500 Multicap 50:25:25' beats the 'Nifty 500' prefix",
    matchLongestBenchmark("Benchmark: Nifty 500 Multicap 50:25:25 TRI")?.canonical.key === "NIFTY_500_MULTICAP_50_25_25"
  );
}

// ---------------------------------------------------------------------------
// D. A scheme whose official benchmark is NOT the category proxy
// ---------------------------------------------------------------------------

const FACTSHEET = `
Demo Focused Fund
(An open ended equity scheme investing in maximum 30 stocks)
Inception Date: 17-Sep-2004   Benchmark: NIFTY 500 Multicap 50:25:25 Total Return Index
Fund Manager: A N Other

Demo Mid Cap Fund
(An open ended equity scheme predominantly investing in mid cap stocks)
Inception Date: 25-Jun-2007   Benchmark: NIFTY Midcap 150 TRI
Fund Manager: Someone Else

Demo Corporate Bond Fund
Benchmark: CRISIL Corporate Bond Index
Fund Manager: Third Person

Demo Nifty 10 yr Benchmark G-Sec ETF
Benchmark: Nifty 10 yr Benchmark G-Sec Index
`;

const FACTSHEET_SPECS = [
  { id: "focused", names: ["Demo Focused Fund-Reg(G)"] },
  { id: "midcap", names: ["Demo Mid Cap Fund-Reg(G)"] },
  { id: "corp-bond", names: ["Demo Corp Bond Fund(G)"] },
  { id: "gsec-etf", names: ["Demo Nifty 10 yr Benchmark G-Sec ETF"] },
  { id: "largecap", names: ["Demo Large Cap Fund-Reg(G)"] },
];

function testProxyDisagreement(): void {
  section("D. Official benchmark overrides the category proxy");
  const res = extractBenchmarks(FACTSHEET, FACTSHEET_SPECS);
  const byScheme = new Map(res.hits.filter((h) => h.resolved).map((h) => [h.schemeId, h.resolved!.canonical.key]));

  check("contradiction detector is quiet on a clean factsheet", res.contradictory.length === 0, res.contradictory.join(","));
  check(
    "Focused fund → NIFTY 500 Multicap 50:25:25 (category proxy would have said NIFTY 500)",
    byScheme.get("focused") === "NIFTY_500_MULTICAP_50_25_25",
    String(byScheme.get("focused"))
  );
  check("Mid Cap fund → NIFTY Midcap 150", byScheme.get("midcap") === "NIFTY_MIDCAP_150", String(byScheme.get("midcap")));
  check("Corporate Bond fund → CRISIL Corporate Bond (unsupported, kept by name)", byScheme.get("corp-bond") === "CRISIL_CORPORATE_BOND", String(byScheme.get("corp-bond")));
  check(
    "a scheme NAME containing the word 'Benchmark' is not read as a labelled field",
    byScheme.get("gsec-etf") === "NIFTY_10_YR_BENCHMARK_GSEC",
    String(byScheme.get("gsec-etf"))
  );
  check("a scheme absent from the document gets no benchmark", !byScheme.has("largecap"));

  const e = entry({
    classifications: ["Equity : Focused"],
    categoryProxyBenchmarkKey: "NIFTY_500",
    currentBenchmark: record({ canonicalBenchmarkKey: "NIFTY_500_MULTICAP_50_25_25", officialBenchmarkName: "NIFTY 500 Multicap 50:25:25 TRI" }),
    proxyDisagreesWithOfficial: true,
  });
  const view = officialBenchmarkView(e);
  check("API view surfaces the official key, not the proxy", view.key === "NIFTY_500_MULTICAP_50_25_25");
  check("API view keeps the proxy as a separate diagnostic field", view.categoryProxyBenchmarkKey === "NIFTY_500");
  check("API view flags the disagreement", view.proxyDisagreesWithOfficial === true);
}

// ---------------------------------------------------------------------------
// E. Unknown / unsupported benchmark: identity kept, return withheld
// ---------------------------------------------------------------------------

function testUnsupported(): void {
  section("E. Unsupported benchmark keeps its name and returns null");
  const e = entry({
    mappingStatus: "official-name-only",
    currentBenchmark: record({
      officialBenchmarkName: "CRISIL Hybrid 35+65 - Aggressive Index",
      canonicalBenchmarkKey: "CRISIL_HYBRID_35_65_AGGRESSIVE",
      benchmarkProvider: "CRISIL",
    }),
    categoryProxyBenchmarkKey: "NIFTY_500",
  });
  const r = periodBenchmark("1Y", 12.5, "2026-09-16", e, BENCH);
  check("status is unsupported-return-source", r.benchmarkComparisonStatus === "unsupported-return-source", r.benchmarkComparisonStatus);
  check("benchmark return is null", r.officialBenchmarkReturn === null);
  check("no excess is computed", r.excessVsOfficialBenchmark === null);
  check("official name is still exposed", officialBenchmarkView(e).name === "CRISIL Hybrid 35+65 - Aggressive Index");
  check("the category proxy is NOT substituted as the return", r.officialBenchmarkReturn === null && officialBenchmarkView(e).key !== "NIFTY_500");

  const unmapped = entry({ mappingStatus: "unmapped", currentBenchmark: null, unmappedReason: "no official AMC evidence found" });
  const u = periodBenchmark("1Y", 12.5, "2026-09-16", unmapped, BENCH);
  check("unmapped scheme gets benchmark-not-official", u.benchmarkComparisonStatus === "benchmark-not-official", u.benchmarkComparisonStatus);
  check("unmapped scheme exposes its reason", officialBenchmarkView(unmapped).reason === "no official AMC evidence found");
}

// ---------------------------------------------------------------------------
// F. Benchmark changed inside the window
// ---------------------------------------------------------------------------

function testBenchmarkHistory(): void {
  section("F. A benchmark change inside the window is flagged, not ignored");
  // Current benchmark effective 2024-04-01; the 5Y window opens 2021-09-16.
  const changedNoHistory = entry({
    currentBenchmark: record({ effectiveFrom: "2024-04-01" }),
    benchmarkHistory: [],
  });
  const a = periodBenchmark("5Y", 20, "2026-09-16", changedNoHistory, BENCH);
  check("5Y with no prior evidence → benchmark-history-insufficient", a.benchmarkComparisonStatus === "benchmark-history-insufficient", a.benchmarkComparisonStatus);
  check("…and no excess is computed", a.excessVsOfficialBenchmark === null);
  check("…but the benchmark return is still reported for transparency", a.officialBenchmarkReturn === 17.45);

  const changedWithHistory = entry({
    currentBenchmark: record({ effectiveFrom: "2024-04-01" }),
    benchmarkHistory: [record({ canonicalBenchmarkKey: "NIFTY_500", officialBenchmarkName: "NIFTY 500 TRI", effectiveFrom: "2018-01-01", effectiveTo: "2024-03-31" })],
  });
  const b = periodBenchmark("5Y", 20, "2026-09-16", changedWithHistory, BENCH);
  check("5Y with prior evidence → benchmark-changed-within-period", b.benchmarkComparisonStatus === "benchmark-changed-within-period", b.benchmarkComparisonStatus);
  check("…still no fabricated excess", b.excessVsOfficialBenchmark === null);

  // A 1Y window that opens entirely AFTER the change is comparable.
  const c = periodBenchmark("1Y", 20, "2026-09-16", changedWithHistory, BENCH);
  check("1Y window after the change is comparable", c.benchmarkComparisonStatus === "available", c.benchmarkComparisonStatus);
  check("…and the excess is computed", c.excessVsOfficialBenchmark !== null && Math.abs(c.excessVsOfficialBenchmark - (20 - 10.92)) < 1e-9);
}

// ---------------------------------------------------------------------------
// G. No evidence URL → not official
// ---------------------------------------------------------------------------

function testEvidenceRequired(): void {
  section("G. An official status without first-party evidence is rejected");
  const bad: SchemeBenchmarkRegistry = {
    generatedAt: CHECKED_AT,
    universeAsOfDate: "2026-09-16",
    universeGeneratedAt: CHECKED_AT,
    ruleVersion: 1,
    sourcePolicy: "test",
    totalApiSchemeRows: 3439,
    totalUnderlyingSchemes: 1771,
    schemes: [entry({ currentBenchmark: record({ sourceUrl: null }) })],
    bySchemeCode: { "1": "demo::demo fund", "1-D": "demo::demo fund" },
  };
  // Pad to the guard floor so we isolate the evidence rule.
  while (bad.schemes.length < 1771) {
    bad.schemes.push(entry({ underlyingKey: `pad::${bad.schemes.length}`, schemeCodes: [`p${bad.schemes.length}`], mappingStatus: "unmapped", currentBenchmark: null, unmappedReason: "pad" }));
  }
  const fails = runGuards(bad, emptyCoverage({ officialMapped: 1, unmapped: 1770 }), { registry: null, coverage: null });
  check("guard rejects official status with no evidence URL", fails.some((f) => /no first-party evidence URL/.test(f)), fails.slice(0, 3).join(" | "));

  const notUrl = entry({ currentBenchmark: record({ sourceUrl: "read it in the factsheet" }) });
  check("a non-URL 'source' is not evidence", officialBenchmarkView(notUrl).sourceUrl === "read it in the factsheet");
  const bad2 = { ...bad, schemes: [notUrl, ...bad.schemes.slice(1)] };
  check(
    "guard rejects a non-URL evidence string too",
    runGuards(bad2, emptyCoverage({ officialMapped: 1, unmapped: 1770 }), { registry: null, coverage: null }).some((f) => /no first-party evidence URL/.test(f))
  );

  // An empty registry must never overwrite a good one.
  const empty: SchemeBenchmarkRegistry = { ...bad, schemes: [], totalUnderlyingSchemes: 0, bySchemeCode: {} };
  check(
    "guard rejects an empty registry",
    runGuards(empty, emptyCoverage({ totalUnderlyingSchemes: 0, officialMapped: 0, officialNameOnly: 0, unmapped: 0 }), { registry: null, coverage: null }).some((f) => /empty/.test(f))
  );
  // A coverage collapse must not be committed.
  const collapsed = runGuards(bad, emptyCoverage({ coveragePct: 5 }), {
    registry: null,
    coverage: emptyCoverage({ coveragePct: 90 }),
  });
  check("guard rejects a material coverage collapse", collapsed.some((f) => /coverage collapsed/.test(f)), collapsed.join(" | "));
}

// ---------------------------------------------------------------------------
// H. Date mismatch → no silent comparison
// ---------------------------------------------------------------------------

function testDateMismatch(): void {
  section("H. Mismatched windows do not produce an alpha");
  const e = entry({ currentBenchmark: record({ canonicalBenchmarkKey: "NIFTY_500", officialBenchmarkName: "NIFTY 500 TRI" }) });
  const stale = periodBenchmark("1Y", 12, "2026-09-16", e, BENCH); // benchmark ends 2026-05-29
  check("stale benchmark window → benchmark-date-mismatch", stale.benchmarkComparisonStatus === "benchmark-date-mismatch", stale.benchmarkComparisonStatus);
  check("…and no excess", stale.excessVsOfficialBenchmark === null);
  check("…but the dates are reported so the caller can see why", stale.benchmarkFromDate === "2025-05-29" && stale.benchmarkToDate === "2026-05-29");

  const aligned = periodBenchmark("1Y", 12, "2026-09-16", entry(), BENCH);
  check("aligned window → available", aligned.benchmarkComparisonStatus === "available", aligned.benchmarkComparisonStatus);
  check("…excess = fund − benchmark", aligned.excessVsOfficialBenchmark !== null && Math.abs(aligned.excessVsOfficialBenchmark - (12 - 10.92)) < 1e-9);
  check("…and the return is labelled an estimate", aligned.benchmarkReturnIsEstimate === true && aligned.benchmarkReturnMethod === "estimated-tri-from-pri-plus-dividend-yield");

  const noFundReturn = periodBenchmark("1Y", null, "2026-09-16", entry(), BENCH);
  check("a fund with no return for the period → fund-return-missing", noFundReturn.benchmarkComparisonStatus === "fund-return-missing", noFundReturn.benchmarkComparisonStatus);

  const missingPeriod = periodBenchmark("10Y", 12, "2026-09-16", entry(), BENCH);
  check("a period the benchmark snapshot lacks → benchmark-return-missing", missingPeriod.benchmarkComparisonStatus === "benchmark-return-missing", missingPeriod.benchmarkComparisonStatus);
}

// ---------------------------------------------------------------------------
// A + B. Plan / option siblings share one benchmark (against the REAL registry)
// ---------------------------------------------------------------------------

async function testSiblings(): Promise<void> {
  section("A + B. Direct/Regular and Growth/IDCW siblings share one benchmark");
  const registryPath = path.resolve(process.cwd(), "public/nav-data/mf-scheme-benchmarks.json");
  if (!fs.existsSync(registryPath)) {
    check("registry snapshot exists", false, "run npm run build:scheme-benchmarks first");
    return;
  }
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")) as SchemeBenchmarkRegistry;
  const byCode = indexRegistry(registry);
  const universe = await loadUniverse();

  check("every API row has a registry entry", universe.rows.every((r) => byCode.has(r.schemecode)));
  check(
    "every entry has exactly one explicit status",
    registry.schemes.every((s) => ["official-mapped", "official-name-only", "unmapped"].includes(s.mappingStatus))
  );

  // Direct/Regular pairs: "<code>" and "<code>-D" are the repo's plan convention.
  let pairs = 0;
  let mismatches = 0;
  for (const r of universe.rows) {
    if (!r.schemecode.endsWith("-D")) continue;
    const base = r.schemecode.slice(0, -2);
    const a = byCode.get(r.schemecode);
    const b = byCode.get(base);
    if (!a || !b) continue;
    pairs += 1;
    if (a.underlyingKey !== b.underlyingKey || a.currentBenchmark?.canonicalBenchmarkKey !== b.currentBenchmark?.canonicalBenchmarkKey) mismatches += 1;
  }
  check(`Direct/Regular pairs resolve identically (${pairs} pairs)`, pairs > 500 && mismatches === 0, `${mismatches} mismatched`);

  // Growth/IDCW: rows of one underlying scheme differing only by option.
  let optionGroups = 0;
  let optionMismatches = 0;
  for (const s of registry.schemes) {
    const opts = new Set(universe.rows.filter((r) => s.schemeCodes.includes(r.schemecode)).map((r) => r.option));
    if (opts.size < 2) continue;
    optionGroups += 1;
    const keys = new Set(s.schemeCodes.map((c) => byCode.get(c)?.currentBenchmark?.canonicalBenchmarkKey ?? "null"));
    if (keys.size > 1) optionMismatches += 1;
  }
  check(`Growth/IDCW siblings share one benchmark (${optionGroups} groups)`, optionMismatches === 0, `${optionMismatches} forked`);

  const coveragePath = path.resolve(process.cwd(), "public/nav-data/mf-scheme-benchmark-coverage.json");
  if (fs.existsSync(coveragePath)) {
    const cov = JSON.parse(fs.readFileSync(coveragePath, "utf8")) as SchemeBenchmarkCoverage;
    check(
      "coverage buckets sum to the scheme count",
      cov.officialMapped + cov.officialNameOnly + cov.unmapped === registry.totalUnderlyingSchemes
    );
  }
}

// ---------------------------------------------------------------------------
// I. Legacy API contract
// ---------------------------------------------------------------------------

async function testApiContract(): Promise<void> {
  section("I. /api/returns-ranking stays backwards compatible");
  const publicDir = path.resolve(process.cwd(), "public");
  const realFetch = globalThis.fetch;
  // Serve the static assets the route reads from the local filesystem.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const p = new URL(url, "http://localhost").pathname;
    const file = path.join(publicDir, p);
    if (fs.existsSync(file)) {
      return new Response(fs.readFileSync(file, "utf8"), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;

  try {
    const { GET } = await import("../../../src/app/api/returns-ranking/route");
    const res = await GET(new Request("http://localhost/api/returns-ranking?limit=5&fields=full"));
    check("responds 200", res.status === 200, String(res.status));
    check("CORS stays open", res.headers.get("access-control-allow-origin") === "*");
    const body = (await res.json()) as Record<string, unknown> & { funds: Array<Record<string, unknown>> };

    for (const k of ["asOfDate", "generatedAt", "source", "cohortKey", "rankingBasis", "minPeerCount", "periods", "fields", "total", "count", "offset", "limit", "funds"]) {
      check(`legacy top-level field "${k}" present`, k in body);
    }
    const f = body.funds[0];
    for (const k of ["schemecode", "fundName", "classification", "plan", "option", "cohortKey", "returns"]) {
      check(`legacy fund field "${k}" present`, k in f);
    }
    const r1y = (f.returns as Record<string, Record<string, unknown>>)["1Y"];
    for (const k of ["return", "rank", "peerCount", "percentile", "quartile", "statsAvailable", "categoryAverage", "categoryMedian", "excessVsAverage", "excessVsMedian"]) {
      check(`legacy period field "${k}" present at fields=full`, k in r1y);
    }
    check("new officialBenchmark block present", "officialBenchmark" in f);
    const ob = f.officialBenchmark as Record<string, unknown>;
    for (const k of ["status", "name", "key", "provider", "basis", "sourceType", "sourceUrl", "sourceDocumentDate", "effectiveFrom", "checkedAt", "categoryProxyBenchmarkKey", "proxyDisagreesWithOfficial"]) {
      check(`officialBenchmark.${k} present`, k in ob);
    }
    check(
      "every returned fund has an explicit benchmark status",
      body.funds.every((x) => ["official-mapped", "official-name-only", "unmapped"].includes((x.officialBenchmark as Record<string, unknown>).status as string))
    );
    for (const k of ["officialBenchmarkReturn", "excessVsOfficialBenchmark", "benchmarkFromDate", "benchmarkToDate", "benchmarkReturnMethod", "benchmarkReturnIsEstimate", "benchmarkComparisonStatus"]) {
      check(`period field "${k}" present`, k in r1y);
    }
    check(
      "a category proxy is never serialized as the official benchmark",
      body.funds.every((x) => {
        const o = x.officialBenchmark as Record<string, unknown>;
        return o.status !== "unmapped" || (o.key === null && o.name === null);
      })
    );

    // compact stays minimal — no benchmark bloat in the small payload.
    const compact = await GET(new Request("http://localhost/api/returns-ranking?limit=2&fields=compact&period=1Y"));
    const cbody = (await compact.json()) as { funds: Array<{ returns: Record<string, Record<string, unknown>> }> };
    check("compact keeps its three period fields", Object.keys(cbody.funds[0].returns["1Y"]).length === 3);

    // CSV: legacy column order preserved.
    const csv = await GET(new Request("http://localhost/api/returns-ranking?limit=2&format=csv&fields=standard&period=1Y"));
    const header = (await csv.text()).split("\r\n")[0];
    check(
      "standard CSV header is unchanged",
      header === "schemecode,fundName,classification,plan,option,cohortKey,1Y_return,1Y_rank,1Y_peerCount,1Y_percentile,1Y_quartile",
      header
    );
    const csvFull = await GET(new Request("http://localhost/api/returns-ranking?limit=2&format=csv&fields=full&period=1Y"));
    const headerFull = (await csvFull.text()).split("\r\n")[0];
    check(
      "full CSV keeps every legacy column in place and appends the new ones",
      headerFull.startsWith("schemecode,fundName,classification,plan,option,cohortKey,1Y_return,1Y_rank,1Y_peerCount,1Y_percentile,1Y_quartile,1Y_categoryAverage,1Y_categoryMedian,1Y_excessVsAverage,1Y_excessVsMedian,officialBenchmark_status"),
      headerFull.slice(0, 200)
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  process.stdout.write("=== scheme-benchmarks regression tests ===\n");
  testDistinctIndices();
  testProxyDisagreement();
  testUnsupported();
  testBenchmarkHistory();
  testEvidenceRequired();
  testDateMismatch();
  await testSiblings();
  await testApiContract();

  process.stdout.write(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length > 0) {
    for (const f of failures) process.stdout.write(`  FAIL: ${f}\n`);
    process.exit(1);
  }
}

main().catch((e) => {
  process.stderr.write(`test harness crashed: ${(e as Error).stack}\n`);
  process.exit(1);
});
