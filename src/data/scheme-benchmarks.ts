/**
 * Scheme-level OFFICIAL benchmark registry — types + join helpers.
 *
 * The distinction this module exists to enforce:
 *
 *   categoryProxyBenchmark  — src/data/benchmark-tri.ts CATEGORY_BENCHMARK.
 *                             A broad index picked for an AMFI CATEGORY. Useful
 *                             context ("did active management beat the market"),
 *                             but it is NOT what the AMC publishes for a scheme.
 *
 *   officialBenchmark       — THIS registry. The index the scheme's own AMC
 *                             names in its own factsheet / SID / KIM / scheme
 *                             page, with the evidence URL retained.
 *
 * A category proxy must never be serialized as an official benchmark. The two
 * travel under different field names all the way to the API.
 *
 * Statuses are exhaustive — every scheme row the API returns carries exactly one:
 *
 *   official-mapped     official AMC benchmark identified AND the canonical
 *                       index resolves to something the return engine supports.
 *   official-name-only  official AMC benchmark identified, but we cannot yet
 *                       compute a return for that index (BSE / CRISIL / blended
 *                       debt-hybrid / global). Identity kept, return withheld.
 *   unmapped            no official benchmark verified from an acceptable
 *                       first-party source. No fallback, no guess.
 *
 * Benchmark identity is versioned: a scheme may change benchmark, so the model
 * carries `currentBenchmark` + `benchmarkHistory[]`. When a performance window
 * opens before the current benchmark's known effective date, the comparison is
 * flagged rather than silently computed — see BenchmarkComparisonStatus.
 */

import type { BenchmarkBasis } from "./benchmark-registry";

export type SchemeBenchmarkStatus = "official-mapped" | "official-name-only" | "unmapped";

/** Which class of first-party AMC document the evidence came from, in the
 *  source priority order the spec fixes. */
export type BenchmarkSourceType =
  | "factsheet"
  | "SID"
  | "KIM"
  | "scheme-page"
  | "other-official"
  | "manual-override";

/** How the benchmark NAME was obtained from that document. Kept separate from
 *  sourceType so "read off a labelled Benchmark: field" is never conflated with
 *  "read off the AMC's own scheme descriptor for a passive scheme". */
export type BenchmarkEvidenceKind =
  /** A labelled "Benchmark"/"Benchmark Index" field in the document. */
  | "labelled-benchmark-field"
  /** The AMC's own SEBI scheme descriptor for a passive scheme, which names the
   *  index the scheme replicates/tracks — and which IS that scheme's benchmark. */
  | "tracked-index-descriptor"
  /** A human-reviewed manual override with its own evidence URL. */
  | "manual-override";

/** One benchmark identity, valid over a window. */
export interface BenchmarkRecord {
  /** Verbatim spelling from the source document. */
  officialBenchmarkName: string;
  /** Canonical key, or null when the spelling did not resolve exactly. */
  canonicalBenchmarkKey: string | null;
  /** Provider of the canonical index (null when unresolved). */
  benchmarkProvider: string | null;
  /** Basis as the source document quoted it. */
  basis: BenchmarkBasis;
  /** ISO date the benchmark became effective, when the document states it. */
  effectiveFrom: string | null;
  /** ISO date it ceased, when known (null = current). */
  effectiveTo: string | null;
  sourceType: BenchmarkSourceType;
  evidenceKind: BenchmarkEvidenceKind;
  /** First-party URL the evidence was read from. REQUIRED for official status. */
  sourceUrl: string | null;
  /** "as on" date of the source document, when the document states it. */
  sourceDocumentDate: string | null;
  checkedAt: string;
}

/** One underlying scheme (plan/option variants collapsed). */
export interface SchemeBenchmarkEntry {
  /** Stable plan/option-independent key for the underlying scheme. */
  underlyingKey: string;
  /** Display name of the underlying scheme (plan/option suffixes stripped). */
  schemeName: string;
  /** Normalized scheme/family name used for matching. */
  normalizedName: string;
  amc: string;
  amcSlug: string;
  /** Every API schemecode that is a plan/option variant of this scheme. */
  schemeCodes: string[];
  classifications: string[];
  mappingStatus: SchemeBenchmarkStatus;
  /** Reason the scheme is unmapped (null when mapped). */
  unmappedReason: string | null;
  currentBenchmark: BenchmarkRecord | null;
  /** Older identities, oldest first. Empty when only the current one is known —
   *  we never fabricate prior history. */
  benchmarkHistory: BenchmarkRecord[];
  /** The category proxy this scheme WOULD have got from CATEGORY_BENCHMARK.
   *  Diagnostic only — never surfaced as the official benchmark. */
  categoryProxyBenchmarkKey: string | null;
  /** True when the official benchmark differs from the category proxy: the
   *  places the old category-proxy model was actually misleading. */
  proxyDisagreesWithOfficial: boolean;
}

export interface SchemeBenchmarkRegistry {
  generatedAt: string;
  /** mf-category-returns snapshot this universe was built from. */
  universeAsOfDate: string | null;
  universeGeneratedAt: string | null;
  ruleVersion: number;
  sourcePolicy: string;
  totalApiSchemeRows: number;
  totalUnderlyingSchemes: number;
  schemes: SchemeBenchmarkEntry[];
  /** schemecode → underlyingKey, materialized so the API joins in O(1). */
  bySchemeCode: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Coverage report
// ---------------------------------------------------------------------------

export interface CoverageCount {
  key: string;
  count: number;
}

export interface SchemeBenchmarkCoverage {
  generatedAt: string;
  universeAsOfDate: string | null;
  totalApiSchemeRows: number;
  totalUnderlyingSchemes: number;
  officialMapped: number;
  officialNameOnly: number;
  unmapped: number;
  returnAvailable: number;
  returnUnavailable: number;
  benchmarkHistoryInsufficient: number;
  staleSource: number;
  coveragePct: number;
  /** Row-level (API schemecode) versions of the same buckets. */
  rows: {
    officialMapped: number;
    officialNameOnly: number;
    unmapped: number;
    returnAvailable: number;
  };
  byAmc: Array<{ amc: string; total: number; officialMapped: number; officialNameOnly: number; unmapped: number; pct: number }>;
  byClassification: Array<{ classification: string; total: number; officialMapped: number; officialNameOnly: number; unmapped: number; pct: number }>;
  byProvider: CoverageCount[];
  byCanonicalKey: CoverageCount[];
  unsupportedBenchmarkFamilies: CoverageCount[];
  proxyDisagreements: number;
  /** The schemes where the OLD category-proxy model was actually misleading:
   *  the AMC publishes a different index than the category proxy would have
   *  assigned. Listed in full — this is the list that justifies the feature. */
  proxyDisagreementList: Array<{
    schemeName: string;
    amc: string;
    classification: string | null;
    officialBenchmarkName: string;
    officialBenchmarkKey: string | null;
    categoryProxyBenchmarkKey: string | null;
    schemeCodes: string[];
  }>;
}

// ---------------------------------------------------------------------------
// API-facing shapes
// ---------------------------------------------------------------------------

/** Per-period comparability verdict — why a benchmark number is or isn't
 *  comparable to the fund's number for that window. */
export type BenchmarkComparisonStatus =
  | "available"
  | "fund-return-missing"
  | "benchmark-not-official"
  | "unsupported-return-source"
  | "benchmark-return-missing"
  | "benchmark-date-mismatch"
  | "benchmark-changed-within-period"
  | "benchmark-history-insufficient";

export interface OfficialBenchmarkApiView {
  status: SchemeBenchmarkStatus;
  name: string | null;
  key: string | null;
  provider: string | null;
  basis: BenchmarkBasis | null;
  sourceType: BenchmarkSourceType | null;
  sourceUrl: string | null;
  sourceDocumentDate: string | null;
  effectiveFrom: string | null;
  checkedAt: string | null;
  /** Number of prior benchmark identities on record (0 = current only). */
  historyCount: number;
  /** Diagnostic: the category proxy, explicitly NOT the official benchmark. */
  categoryProxyBenchmarkKey: string | null;
  /** Diagnostic: official benchmark differs from the category proxy. */
  proxyDisagreesWithOfficial: boolean;
  /** Set when status is "unmapped". */
  reason?: string | null;
}

export const UNMAPPED_API_VIEW: OfficialBenchmarkApiView = {
  status: "unmapped",
  name: null,
  key: null,
  provider: null,
  basis: null,
  sourceType: null,
  sourceUrl: null,
  sourceDocumentDate: null,
  effectiveFrom: null,
  checkedAt: null,
  historyCount: 0,
  categoryProxyBenchmarkKey: null,
  proxyDisagreesWithOfficial: false,
  reason: "scheme not present in the official benchmark registry",
};

/** An official mapping is only official if it has first-party evidence. */
export function hasFirstPartyEvidence(rec: BenchmarkRecord | null): boolean {
  return !!rec && typeof rec.sourceUrl === "string" && /^https?:\/\//i.test(rec.sourceUrl);
}
