/**
 * Build the OFFICIAL scheme-benchmark registry.
 *
 *   public/nav-data/mf-scheme-benchmarks.json          (the registry)
 *   public/nav-data/mf-scheme-benchmark-coverage.json  (the quality report)
 *
 * Universe: every row /api/returns-ranking serves, collapsed to underlying
 * schemes (Direct/Regular/Growth/IDCW siblings share one benchmark — see
 * universe.ts). Nothing is invented and nothing is inferred from the AMFI
 * category: a scheme only carries an official benchmark when a first-party AMC
 * document said so, and every mapping keeps the URL it was read from.
 *
 * Evidence tiers, highest priority first:
 *   1. manual override   (manual-data/scheme-benchmarks/overrides.json — must
 *                         carry its own first-party evidence URL)
 *   2. labelled "Benchmark:" field in an AMC factsheet / SID / KIM / scheme page
 *   3. SEBI tracked-index descriptor in the AMC's own monthly portfolio
 *      disclosure ("An open ended scheme replicating/tracking <index> (TRI)"),
 *      which for a passive scheme IS its benchmark. Recorded as a distinct
 *      evidenceKind so it is never confused with a labelled field.
 *
 * Statuses: official-mapped / official-name-only / unmapped. No silent
 * fallback — a scheme we could not verify stays unmapped, and the coverage
 * report makes that visible rather than hiding it.
 *
 * Keep-last-good: the snapshot is only written when the run passes the guards
 * (universe size, coverage-vs-previous, evidence presence, canonical-key
 * consistency). Otherwise the previous snapshot survives and the job exits
 * non-zero.
 *
 * Run: npm run build:scheme-benchmarks
 *      SCHEME_BENCHMARKS_OFFLINE=1  → skip network acquisition (tier 3 only)
 *      AMC_ONLY=hdfc,sbi            → restrict acquisition to these AMC slugs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, nowIso, warn } from "../utils";
import { loadUniverse, type UnderlyingScheme, type Universe } from "./universe";
import { extractBenchmarks, type BenchmarkHit, type SchemeAnchorSpec } from "./extract";
import { acquireAmcDocuments, maybeLaunchBrowser, type AcquiredDocument } from "./acquire";
import { HOLDINGS_SLUG_ALIASES, SCHEME_DOC_SOURCES } from "./sources";
import { loadOverrides, type SchemeBenchmarkOverride } from "./overrides";
import { runGuards } from "./guards";
import { CATEGORY_BENCHMARK } from "../../../src/data/benchmark-tri";
import { registryCollisions, resolveBenchmark } from "../../../src/data/benchmark-registry";
import {
  hasFirstPartyEvidence,
  type BenchmarkRecord,
  type BenchmarkSourceType,
  type SchemeBenchmarkCoverage,
  type SchemeBenchmarkEntry,
  type SchemeBenchmarkRegistry,
  type SchemeBenchmarkStatus,
} from "../../../src/data/scheme-benchmarks";

const REGISTRY_PATH = path.resolve(process.cwd(), "public/nav-data/mf-scheme-benchmarks.json");
const COVERAGE_PATH = path.resolve(process.cwd(), "public/nav-data/mf-scheme-benchmark-coverage.json");
const HOLDINGS_DIR = path.resolve(process.cwd(), "public/amc-holdings");

const RULE_VERSION = 1;
const SOURCE_POLICY =
  "official = first-party AMC document only (factsheet > SID > KIM > scheme page > other official). " +
  "Third-party aggregators may be used for discovery but never as evidence. " +
  "AMFI category is never used to infer a benchmark.";

/** Wall-clock budget for network acquisition. The monthly job has a 60-minute
 *  timeout and ~50 AMCs behind it; a handful of slow hosts must not starve the
 *  rest or push the job into a timeout, where NOTHING would be committed. When
 *  the budget runs out the remaining AMCs simply keep their carried-forward
 *  evidence and are re-tried next run. */
const ACQUIRE_BUDGET_MS = Number(process.env.SCHEME_BENCHMARKS_BUDGET_MS ?? 32 * 60_000);

/** Source priority (lower = stronger). */
const SOURCE_RANK: Record<BenchmarkSourceType, number> = {
  "manual-override": 0,
  factsheet: 1,
  SID: 2,
  KIM: 3,
  "scheme-page": 4,
  "other-official": 5,
};

interface Candidate {
  record: BenchmarkRecord;
  /** Priority tuple: source rank, then evidence kind, then document recency. */
  rank: number;
  documentDate: string | null;
}

// ---------------------------------------------------------------------------
// Tier 3 — tracked-index descriptors from the committed AMC disclosures
// ---------------------------------------------------------------------------

interface HoldingsSnapshot {
  amc?: string;
  amcSlug?: string;
  sourceUrl?: string;
  schemes?: Array<{ schemeName?: string; asOf?: string | null }>;
}

/**
 * The AMC's own monthly portfolio workbook names each passive scheme with its
 * SEBI descriptor ("An open ended scheme replicating/tracking NIFTY Midcap 150
 * Index (TRI)"). For a passive scheme that index IS the benchmark, and the
 * sentence comes from the AMC's own filing — so it is first-party evidence.
 * Read offline from files the monthly job already commits.
 */
async function descriptorDocuments(
  universe: Universe,
  knownPages?: Map<string, string>
): Promise<Map<string, AcquiredDocument[]>> {
  const out = new Map<string, AcquiredDocument[]>();
  let files: string[];
  try {
    files = (await fs.readdir(HOLDINGS_DIR)).filter((f) => f.endsWith(".json") && f !== "index.json");
  } catch {
    return out;
  }
  const holdingsSlugToUniverse = new Map<string, string>();
  for (const s of universe.byAmcSlug.keys()) holdingsSlugToUniverse.set(HOLDINGS_SLUG_ALIASES[s] ?? s, s);

  for (const f of files) {
    let snap: HoldingsSnapshot;
    try {
      snap = JSON.parse(await fs.readFile(path.join(HOLDINGS_DIR, f), "utf8")) as HoldingsSnapshot;
    } catch {
      continue;
    }
    const holdingsSlug = snap.amcSlug ?? f.replace(/\.json$/, "");
    const slug = holdingsSlugToUniverse.get(holdingsSlug) ?? holdingsSlug;
    const url = snap.sourceUrl ?? "";
    if (!/^https?:\/\//i.test(url)) continue; // no first-party URL → no evidence
    // The disclosure page this repo already resolves for the AMC is a page we
    // KNOW is reachable; hand it to the acquisition tier as an extra candidate.
    if (knownPages && !/\.(xlsx?|zip|pdf)(\?|#|$)/i.test(url)) knownPages.set(slug, url);
    const names = (snap.schemes ?? []).map((s) => (s.schemeName ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
    if (names.length === 0) continue;
    const asOf = (snap.schemes ?? []).find((s) => s.asOf)?.asOf ?? null;
    out.set(slug, [
      {
        url,
        // One scheme per line: the extractor's anchor/label proximity rules then
        // cannot bridge two schemes.
        text: names.join("\n"),
        sourceType: "other-official",
        documentDate: asOf ?? null,
        via: "curl",
        // One scheme per line, and a name list carries no labelled benchmark
        // fields — only the SEBI tracked-index descriptor is evidence here.
        anchorMode: "same-line",
        scans: ["descriptor"],
      },
    ]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Evidence → candidate records
// ---------------------------------------------------------------------------

function recordFromHit(hit: BenchmarkHit, doc: AcquiredDocument, checkedAt: string): BenchmarkRecord | null {
  const resolved = hit.resolved;
  const name = resolved?.rawName ?? extractNameFallback(hit.rawText);
  if (!name) return null;
  return {
    officialBenchmarkName: name,
    canonicalBenchmarkKey: resolved?.canonical.key ?? null,
    benchmarkProvider: resolved?.canonical.provider ?? null,
    basis: resolved?.basis ?? "unknown",
    effectiveFrom: null,
    effectiveTo: null,
    sourceType: doc.sourceType,
    evidenceKind: hit.evidenceKind,
    sourceUrl: doc.url,
    sourceDocumentDate: doc.documentDate,
    checkedAt,
  };
}

/** An unresolved benchmark still has a NAME worth keeping, as long as the text
 *  looks like an index name rather than stray prose. */
function extractNameFallback(rawText: string): string | null {
  const cleaned = rawText.replace(/^[\s:,.-]+/, "").split(/\s{3,}|\||;/)[0].trim();
  if (cleaned.length < 4 || cleaned.length > 90) return null;
  if (!/(index|tri|nifty|sensex|bse|crisil|msci|s&p|nasdaq|gold|silver)/i.test(cleaned)) return null;
  return cleaned;
}

function candidateFrom(record: BenchmarkRecord): Candidate {
  const kindPenalty = record.evidenceKind === "labelled-benchmark-field" ? 0 : record.evidenceKind === "manual-override" ? -1 : 1;
  return {
    record,
    rank: SOURCE_RANK[record.sourceType] * 10 + kindPenalty,
    documentDate: record.sourceDocumentDate,
  };
}

function overrideRecords(o: SchemeBenchmarkOverride, checkedAt: string): { current: BenchmarkRecord; history: BenchmarkRecord[] } {
  const mk = (
    name: string,
    url: string,
    sourceType: BenchmarkSourceType,
    docDate: string | null,
    from: string | null,
    to: string | null
  ): BenchmarkRecord => {
    const resolved = resolveBenchmark(name);
    return {
      officialBenchmarkName: name.trim(),
      canonicalBenchmarkKey: resolved?.canonical.key ?? null,
      benchmarkProvider: resolved?.canonical.provider ?? null,
      basis: resolved?.basis ?? "unknown",
      effectiveFrom: from,
      effectiveTo: to,
      sourceType,
      evidenceKind: "manual-override",
      sourceUrl: url,
      sourceDocumentDate: docDate,
      checkedAt,
    };
  };
  return {
    current: mk(
      o.officialBenchmarkName,
      o.evidenceUrl,
      o.sourceType ?? "manual-override",
      o.sourceDocumentDate ?? null,
      o.effectiveFrom ?? null,
      o.effectiveTo ?? null
    ),
    history: (o.history ?? []).map((h) =>
      mk(h.officialBenchmarkName, h.evidenceUrl, h.sourceType ?? "manual-override", h.sourceDocumentDate ?? null, h.effectiveFrom ?? null, h.effectiveTo ?? null)
    ),
  };
}

// ---------------------------------------------------------------------------
// Status resolution
// ---------------------------------------------------------------------------

function statusFor(record: BenchmarkRecord | null): { status: SchemeBenchmarkStatus; reason: string | null } {
  if (!record) return { status: "unmapped", reason: "no official AMC evidence found" };
  if (!hasFirstPartyEvidence(record)) {
    return { status: "unmapped", reason: "evidence had no first-party AMC URL — cannot be called official" };
  }
  if (!record.canonicalBenchmarkKey) {
    return { status: "official-name-only", reason: null };
  }
  const canonical = resolveBenchmark(record.officialBenchmarkName);
  const support = canonical?.canonical.returnSupport ?? "unsupported";
  return support === "nse-ind-close-all"
    ? { status: "official-mapped", reason: null }
    : { status: "official-name-only", reason: null };
}

function categoryProxyFor(scheme: UnderlyingScheme): string | null {
  for (const c of scheme.classifications) {
    const key = CATEGORY_BENCHMARK[c];
    if (key) return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const checkedAt = nowIso();
  const collisions = registryCollisions();
  if (collisions.length > 0) {
    warn("canonical benchmark registry is inconsistent — refusing to build:");
    for (const c of collisions) warn(`  - ${c}`);
    process.exit(1);
  }

  const universe = await loadUniverse();
  info(`universe: ${universe.rows.length} API rows → ${universe.schemes.length} underlying schemes across ${universe.byAmcSlug.size} AMCs`);

  const offline = process.env.SCHEME_BENCHMARKS_OFFLINE === "1";
  const only = (process.env.AMC_ONLY ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // --- gather documents per AMC -------------------------------------------
  const knownPages = new Map<string, string>();
  const docsByAmc = await descriptorDocuments(universe, knownPages);
  info(`tier 3 (committed AMC disclosures): ${docsByAmc.size} AMCs with scheme descriptors`);

  if (!offline) {
    const wanted = SCHEME_DOC_SOURCES.filter((s) => (only.length === 0 || only.includes(s.slug)) && universe.byAmcSlug.has(s.slug));
    const browser = await maybeLaunchBrowser(wanted.some((s) => s.browser));
    const deadline = Date.now() + ACQUIRE_BUDGET_MS;
    let skippedForBudget = 0;
    try {
      for (const source of wanted) {
        if (Date.now() > deadline) {
          skippedForBudget += 1;
          continue;
        }
        try {
          const known = knownPages.get(source.slug);
          const docs = await acquireAmcDocuments(source, {
            browser,
            debug: process.env.AMC_BROWSER_DEBUG === "1",
            extraPages: known ? [known] : [],
          });
          if (docs.length === 0) {
            warn(`[${source.slug}] no official document acquired`);
            continue;
          }
          docsByAmc.set(source.slug, [...docs, ...(docsByAmc.get(source.slug) ?? [])]);
        } catch (e) {
          warn(`[${source.slug}] acquisition failed: ${(e as Error).message}`);
        }
      }
      if (skippedForBudget > 0) {
        warn(`acquisition budget exhausted — ${skippedForBudget} AMCs keep their existing evidence and are re-tried next run`);
      }
    } finally {
      await browser?.close().catch(() => undefined);
    }
  } else {
    info("SCHEME_BENCHMARKS_OFFLINE=1 — skipping network acquisition");
  }

  // --- extract per AMC ------------------------------------------------------
  /** underlyingKey → candidates, newest/strongest first after sorting. */
  const candidates = new Map<string, Candidate[]>();
  const contradictoryKeys = new Set<string>();
  const extractionLog: Array<{ amcSlug: string; documents: number; anchors: number; labels: number; mapped: number }> = [];

  for (const [slug, schemes] of universe.byAmcSlug) {
    const docs = docsByAmc.get(slug) ?? [];
    if (docs.length === 0) continue;
    const specs: SchemeAnchorSpec[] = schemes.map((s) => ({
      id: s.underlyingKey,
      names: [s.schemeName, ...new Set(s.rows.map((r) => r.amfiSchemeName ?? "").filter(Boolean))].slice(0, 4),
    }));
    let anchors = 0;
    let labels = 0;
    let mapped = 0;
    for (const doc of docs) {
      const res = extractBenchmarks(doc.text, specs, { anchorMode: doc.anchorMode, scans: doc.scans });
      anchors += res.anchorCount;
      labels += res.labelCount;
      for (const id of res.contradictory) contradictoryKeys.add(id);
      // One benchmark per (scheme, document): a document that says two different
      // things about one scheme has already been flagged contradictory above.
      const perScheme = new Map<string, BenchmarkHit>();
      for (const hit of res.hits) {
        if (!hit.resolved && perScheme.has(hit.schemeId)) continue;
        const existing = perScheme.get(hit.schemeId);
        if (!existing || (!existing.resolved && hit.resolved)) perScheme.set(hit.schemeId, hit);
      }
      for (const [id, hit] of perScheme) {
        const record = recordFromHit(hit, doc, checkedAt);
        if (!record) continue;
        const arr = candidates.get(id) ?? [];
        arr.push(candidateFrom(record));
        candidates.set(id, arr);
        mapped += 1;
      }
    }
    extractionLog.push({ amcSlug: slug, documents: docs.length, anchors, labels, mapped });
  }

  // --- overrides (applied last, they win) ----------------------------------
  const overrides = await loadOverrides();
  const overrideHistory = new Map<string, BenchmarkRecord[]>();
  const schemeByCode = new Map<string, UnderlyingScheme>();
  for (const s of universe.schemes) for (const c of s.schemeCodes) schemeByCode.set(c, s);
  let overridesApplied = 0;
  for (const [key, o] of overrides.byUnderlyingKey) {
    const { current, history } = overrideRecords(o, checkedAt);
    candidates.set(key, [candidateFrom(current)]);
    if (history.length > 0) overrideHistory.set(key, history);
    contradictoryKeys.delete(key);
    overridesApplied += 1;
  }
  for (const [code, o] of overrides.bySchemecode) {
    const scheme = schemeByCode.get(code);
    if (!scheme) continue;
    const { current, history } = overrideRecords(o, checkedAt);
    candidates.set(scheme.underlyingKey, [candidateFrom(current)]);
    if (history.length > 0) overrideHistory.set(scheme.underlyingKey, history);
    contradictoryKeys.delete(scheme.underlyingKey);
    overridesApplied += 1;
  }
  info(`manual overrides: ${overridesApplied} applied, ${overrides.rejected.length} rejected of ${overrides.total}`);

  // --- carry-forward -------------------------------------------------------
  // Evidence is durable: a factsheet read last month still says what it said.
  // A run that could not reach an AMC (offline mode, AMC_ONLY, a bot wall that
  // day) must therefore KEEP that AMC's existing mappings rather than silently
  // demoting them to unmapped — otherwise the daily pipeline would erase what
  // the monthly pipeline verified. Status is recomputed so a change in return
  // support still takes effect.
  const prev = await readPrevious();
  const prevByKey = new Map((prev.registry?.schemes ?? []).map((e) => [e.underlyingKey, e]));
  let carriedForward = 0;

  // --- resolve each underlying scheme --------------------------------------
  const entries: SchemeBenchmarkEntry[] = [];
  for (const scheme of universe.schemes) {
    const proxy = categoryProxyFor(scheme);
    const cands = (candidates.get(scheme.underlyingKey) ?? []).slice().sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      // Newer document wins within the same tier.
      return (b.documentDate ?? "").localeCompare(a.documentDate ?? "");
    });

    let current: BenchmarkRecord | null = null;
    let history: BenchmarkRecord[] = overrideHistory.get(scheme.underlyingKey) ?? [];
    let unmappedReason: string | null = null;

    if (contradictoryKeys.has(scheme.underlyingKey)) {
      unmappedReason = "contradictory benchmark evidence in one source document — not resolvable safely";
    } else if (cands.length === 0) {
      const carried = prevByKey.get(scheme.underlyingKey);
      if (carried?.currentBenchmark) {
        current = carried.currentBenchmark;
        history = carried.benchmarkHistory ?? [];
        carriedForward += 1;
      }
    } else {
      current = cands[0].record;
      // A DIFFERENT canonical key seen in an OLDER document of the same tier is
      // a benchmark change, not a contradiction — record it as history.
      if (history.length === 0) {
        const seen = new Set<string>([current.canonicalBenchmarkKey ?? current.officialBenchmarkName]);
        for (const c of cands.slice(1)) {
          const id = c.record.canonicalBenchmarkKey ?? c.record.officialBenchmarkName;
          if (seen.has(id)) continue;
          if (!c.documentDate || !current.sourceDocumentDate) continue;
          if (c.documentDate >= current.sourceDocumentDate) continue;
          seen.add(id);
          history.push({ ...c.record, effectiveTo: current.sourceDocumentDate });
        }
        history = history.sort((a, b) => (a.sourceDocumentDate ?? "").localeCompare(b.sourceDocumentDate ?? ""));
      }
    }

    const { status, reason } = current ? statusFor(current) : { status: "unmapped" as SchemeBenchmarkStatus, reason: unmappedReason ?? "no official AMC evidence found" };
    const finalStatus: SchemeBenchmarkStatus = unmappedReason ? "unmapped" : status;
    const finalReason = unmappedReason ?? reason;

    entries.push({
      underlyingKey: scheme.underlyingKey,
      schemeName: scheme.schemeName,
      normalizedName: scheme.normalizedName,
      amc: scheme.amc,
      amcSlug: scheme.amcSlug,
      schemeCodes: scheme.schemeCodes,
      classifications: scheme.classifications,
      mappingStatus: finalStatus,
      unmappedReason: finalStatus === "unmapped" ? finalReason ?? "no official AMC evidence found" : null,
      currentBenchmark: finalStatus === "unmapped" ? null : current,
      benchmarkHistory: finalStatus === "unmapped" ? [] : history,
      categoryProxyBenchmarkKey: proxy,
      proxyDisagreesWithOfficial:
        finalStatus !== "unmapped" && !!proxy && !!current?.canonicalBenchmarkKey && current.canonicalBenchmarkKey !== proxy,
    });
  }

  const bySchemeCode: Record<string, string> = {};
  for (const e of entries) for (const c of e.schemeCodes) bySchemeCode[c] = e.underlyingKey;

  const registry: SchemeBenchmarkRegistry = {
    generatedAt: checkedAt,
    universeAsOfDate: universe.asOfDate,
    universeGeneratedAt: universe.generatedAt,
    ruleVersion: RULE_VERSION,
    sourcePolicy: SOURCE_POLICY,
    totalApiSchemeRows: universe.rows.length,
    totalUnderlyingSchemes: entries.length,
    schemes: entries,
    bySchemeCode,
  };

  const coverage = buildCoverage(registry, universe);

  // --- guards ---------------------------------------------------------------
  const failures = runGuards(registry, coverage, prev);
  if (failures.length > 0) {
    warn("validation FAILED — keeping the previous snapshot, nothing written:");
    for (const f of failures.slice(0, 20)) warn(`  - ${f}`);
    if (failures.length > 20) warn(`  (… ${failures.length - 20} more)`);
    process.exit(1);
  }

  await atomicWriteJson(REGISTRY_PATH, registry);
  await atomicWriteJson(COVERAGE_PATH, coverage);
  info(`wrote ${path.relative(process.cwd(), REGISTRY_PATH)}`);
  info(`wrote ${path.relative(process.cwd(), COVERAGE_PATH)}`);

  printSummary(coverage, extractionLog, carriedForward);
}

// ---------------------------------------------------------------------------
// Coverage report
// ---------------------------------------------------------------------------

function buildCoverage(registry: SchemeBenchmarkRegistry, universe: Universe): SchemeBenchmarkCoverage {
  const byAmc = new Map<string, { total: number; officialMapped: number; officialNameOnly: number; unmapped: number }>();
  const byClassification = new Map<string, { total: number; officialMapped: number; officialNameOnly: number; unmapped: number }>();
  const byProvider = new Map<string, number>();
  const byKey = new Map<string, number>();
  const unsupportedFamilies = new Map<string, number>();

  let officialMapped = 0;
  let officialNameOnly = 0;
  let unmapped = 0;
  let proxyDisagreements = 0;
  const proxyDisagreementList: SchemeBenchmarkCoverage["proxyDisagreementList"] = [];
  let staleSource = 0;
  let historyInsufficient = 0;
  const rows = { officialMapped: 0, officialNameOnly: 0, unmapped: 0, returnAvailable: 0 };

  const sixMonthsAgo = new Date(Date.now() - 200 * 86400_000).toISOString().slice(0, 10);

  for (const e of registry.schemes) {
    const n = e.schemeCodes.length;
    if (e.mappingStatus === "official-mapped") { officialMapped += 1; rows.officialMapped += n; rows.returnAvailable += n; }
    else if (e.mappingStatus === "official-name-only") { officialNameOnly += 1; rows.officialNameOnly += n; }
    else { unmapped += 1; rows.unmapped += n; }
    if (e.proxyDisagreesWithOfficial) {
      proxyDisagreements += 1;
      proxyDisagreementList.push({
        schemeName: e.schemeName,
        amc: e.amc,
        classification: e.classifications[0] ?? null,
        officialBenchmarkName: e.currentBenchmark?.officialBenchmarkName ?? "",
        officialBenchmarkKey: e.currentBenchmark?.canonicalBenchmarkKey ?? null,
        categoryProxyBenchmarkKey: e.categoryProxyBenchmarkKey,
        schemeCodes: e.schemeCodes,
      });
    }

    const rec = e.currentBenchmark;
    if (rec) {
      if (rec.sourceDocumentDate && rec.sourceDocumentDate < sixMonthsAgo) staleSource += 1;
      // A scheme with a known effectiveFrom but no prior history cannot support
      // a window that opens before it.
      if (rec.effectiveFrom && e.benchmarkHistory.length === 0) historyInsufficient += 1;
      if (rec.benchmarkProvider) byProvider.set(rec.benchmarkProvider, (byProvider.get(rec.benchmarkProvider) ?? 0) + 1);
      if (rec.canonicalBenchmarkKey) byKey.set(rec.canonicalBenchmarkKey, (byKey.get(rec.canonicalBenchmarkKey) ?? 0) + 1);
      if (e.mappingStatus === "official-name-only") {
        const fam = rec.benchmarkProvider ?? "(unresolved index name)";
        unsupportedFamilies.set(fam, (unsupportedFamilies.get(fam) ?? 0) + 1);
      }
    }

    const a = byAmc.get(e.amc) ?? { total: 0, officialMapped: 0, officialNameOnly: 0, unmapped: 0 };
    a.total += 1;
    if (e.mappingStatus === "official-mapped") a.officialMapped += 1;
    else if (e.mappingStatus === "official-name-only") a.officialNameOnly += 1;
    else a.unmapped += 1;
    byAmc.set(e.amc, a);

    for (const c of e.classifications.length > 0 ? e.classifications : ["(unclassified)"]) {
      const cc = byClassification.get(c) ?? { total: 0, officialMapped: 0, officialNameOnly: 0, unmapped: 0 };
      cc.total += 1;
      if (e.mappingStatus === "official-mapped") cc.officialMapped += 1;
      else if (e.mappingStatus === "official-name-only") cc.officialNameOnly += 1;
      else cc.unmapped += 1;
      byClassification.set(c, cc);
    }
  }

  const total = registry.totalUnderlyingSchemes || 1;
  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 10000) / 100);
  const sortCounts = (m: Map<string, number>) =>
    [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  return {
    generatedAt: registry.generatedAt,
    universeAsOfDate: registry.universeAsOfDate,
    totalApiSchemeRows: universe.rows.length,
    totalUnderlyingSchemes: registry.totalUnderlyingSchemes,
    officialMapped,
    officialNameOnly,
    unmapped,
    returnAvailable: officialMapped,
    returnUnavailable: officialNameOnly + unmapped,
    benchmarkHistoryInsufficient: historyInsufficient,
    staleSource,
    coveragePct: pct(officialMapped + officialNameOnly, total),
    rows,
    byAmc: [...byAmc.entries()]
      .map(([amc, v]) => ({ amc, ...v, pct: pct(v.officialMapped + v.officialNameOnly, v.total) }))
      .sort((a, b) => a.pct - b.pct || b.total - a.total),
    byClassification: [...byClassification.entries()]
      .map(([classification, v]) => ({ classification, ...v, pct: pct(v.officialMapped + v.officialNameOnly, v.total) }))
      .sort((a, b) => a.pct - b.pct || b.total - a.total),
    byProvider: sortCounts(byProvider),
    byCanonicalKey: sortCounts(byKey),
    unsupportedBenchmarkFamilies: sortCounts(unsupportedFamilies),
    proxyDisagreements,
    proxyDisagreementList: proxyDisagreementList.sort((a, b) => a.amc.localeCompare(b.amc) || a.schemeName.localeCompare(b.schemeName)),
  };
}

// ---------------------------------------------------------------------------
// Previous snapshot (keep-last-good)
// ---------------------------------------------------------------------------

async function readPrevious(): Promise<{ registry: SchemeBenchmarkRegistry | null; coverage: SchemeBenchmarkCoverage | null }> {
  const read = async <T>(p: string): Promise<T | null> => {
    try { return JSON.parse(await fs.readFile(p, "utf8")) as T; } catch { return null; }
  };
  return {
    registry: await read<SchemeBenchmarkRegistry>(REGISTRY_PATH),
    coverage: await read<SchemeBenchmarkCoverage>(COVERAGE_PATH),
  };
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function printSummary(
  coverage: SchemeBenchmarkCoverage,
  log: Array<{ amcSlug: string; documents: number; anchors: number; labels: number; mapped: number }>,
  carriedForward: number
): void {
  info("=========== OFFICIAL SCHEME BENCHMARK REGISTRY ===========");
  info(`TOTAL SCHEMES:                 ${coverage.totalUnderlyingSchemes} underlying (${coverage.totalApiSchemeRows} API rows)`);
  info(`OFFICIAL BENCHMARK IDENTIFIED: ${coverage.officialMapped + coverage.officialNameOnly}`);
  info(`BENCHMARK RETURN AVAILABLE:    ${coverage.returnAvailable}`);
  info(`OFFICIAL NAME ONLY:            ${coverage.officialNameOnly}`);
  info(`UNMAPPED:                      ${coverage.unmapped}`);
  info(`COVERAGE %:                    ${coverage.coveragePct}%`);
  info(`CARRIED FORWARD (not re-read): ${carriedForward}`);
  info("----------------------------------------------------------");
  const worst = coverage.byAmc.slice(0, 8);
  for (const a of worst) info(`  weakest AMC: ${a.amc.padEnd(38)} ${a.pct}% of ${a.total}`);
  for (const l of log.filter((x) => x.mapped === 0).slice(0, 8)) {
    info(`  no mappings from: ${l.amcSlug} (docs=${l.documents} anchors=${l.anchors} labels=${l.labels})`);
  }
  info("==========================================================");
}

async function atomicWriteJson(target: string, payload: unknown): Promise<void> {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.tmp-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
    await fs.rename(tmp, target);
  } catch (e) {
    try { await fs.unlink(tmp); } catch { /* ignore */ }
    throw e;
  }
}

main().catch((e) => {
  warn(`build-scheme-benchmarks failed: ${(e as Error).message}`);
  process.exit(1);
});
