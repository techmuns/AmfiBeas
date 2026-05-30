/**
 * Phase 3.1A — latest NAV snapshot ingestion (production-safe).
 *
 * Fetches the AMFI latest NAV feed (NAVAll.txt), runs the SHARED crosswalk
 * engine (./nav-crosswalk.ts) + curated overrides, and writes a latest-NAV
 * snapshot for matched MFs Portfolio Tracker funds to
 * src/data/snapshots/mf-latest-nav.json.
 *
 * Production-safety rules:
 *  - Includes ONLY production-ready matches: exact + high (auto) + override.
 *  - Excludes medium / low / review / ambiguous / unmatched / rejected-risky.
 *    False positives are worse than missing NAV.
 *  - Keep-last-good: if the feed is unreachable or yields zero rows, the
 *    existing snapshot is left untouched (the script exits non-zero without
 *    writing) so a bad fetch can never blank a good snapshot.
 *
 * Run: npm run ingest:nav:latest   (tsx scripts/ingest/nav-latest.ts)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { parseNavAll } from "./amfi-nav";
import { info, nowIso, warn } from "./utils";
import {
  RULE_VERSION,
  DEFAULT_INDEX_PATH,
  DEFAULT_OVERRIDES_PATH,
  buildCrosswalk,
  loadOverrides,
  pct,
  type IndexFile,
  type MatchRow,
} from "./nav-crosswalk";

const NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt";
const OUTPUT_PATH = path.resolve(process.cwd(), "src/data/snapshots/mf-latest-nav.json");
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

interface LatestNavRow {
  schemecode: string;
  fundName: string;
  classification: string | null;
  amfiSchemeCode: number;
  amfiSchemeName: string;
  amfiAmcName: string;
  isin: string | null;
  nav: number;
  navDate: string;
  matchConfidence: "exact" | "high" | "override";
  matchedBy: string;
  hasHoldings: boolean;
}

async function fetchFeed(): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await fetch(NAV_URL, { signal: ctrl.signal, headers: { "user-agent": USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${NAV_URL}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function main(): Promise<void> {
  const fetchedAt = nowIso();

  info(`reading ${path.relative(process.cwd(), DEFAULT_INDEX_PATH)}`);
  const indexFile = JSON.parse(await fs.readFile(DEFAULT_INDEX_PATH, "utf8")) as IndexFile;
  const holdingsByCode = new Map<string, boolean>();
  for (const f of indexFile.funds) holdingsByCode.set(String(f.schemecode), Boolean(f.file));

  const overrides = await loadOverrides(DEFAULT_OVERRIDES_PATH);
  info(`overrides: ${overrides.size} loaded`);

  info(`fetching ${NAV_URL}`);
  let text: string;
  try {
    text = await fetchFeed();
  } catch (e) {
    // Keep-last-good: do not overwrite the existing snapshot on a bad fetch.
    warn(`AMFI feed fetch failed (${(e as Error).message}). Keeping previous snapshot; not writing.`);
    process.exit(1);
  }

  const navs = parseNavAll(text);
  info(`parsed ${navs.length} AMFI scheme NAV rows`);
  if (navs.length === 0) {
    warn("AMFI parse returned zero schemes. Keeping previous snapshot; not writing.");
    process.exit(1);
  }

  const dateCounts = new Map<string, number>();
  for (const n of navs) dateCounts.set(n.date, (dateCounts.get(n.date) ?? 0) + 1);
  const feedDate = Array.from(dateCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const cw = buildCrosswalk(indexFile.funds, navs, overrides.map);

  // Production set = auto (exact + high) + override only.
  const production: MatchRow[] = [...cw.autoMatches, ...cw.overrideMatches];

  const funds: LatestNavRow[] = production
    .map((m) => ({
      schemecode: m.schemecode,
      fundName: m.fundName,
      classification: m.classification,
      amfiSchemeCode: m.amfiSchemeCode,
      amfiSchemeName: m.amfiSchemeName,
      amfiAmcName: m.amfiAmcName,
      isin: m.isin,
      nav: m.nav,
      navDate: m.navDate,
      matchConfidence: m.confidence as "exact" | "high" | "override",
      matchedBy: m.matchedBy,
      hasHoldings: holdingsByCode.get(m.schemecode) ?? false,
    }))
    // Deterministic ordering for stable, reviewable git diffs.
    .sort((a, b) => Number(a.schemecode) - Number(b.schemecode));

  const productionWithHoldings = funds.filter((f) => f.hasHoldings).length;
  const totalMatched = production.length;

  const snapshot = {
    generatedAt: nowIso(),
    source: "AMFI",
    feedDate,
    navRowsFromFeed: navs.length,
    ruleVersion: RULE_VERSION,
    crosswalkCoverage: {
      totalFunds: cw.totalFunds,
      fundsWithHoldings: cw.fundsWithHoldings,
      autoMatched: cw.autoMatches.length,
      overrideMatched: cw.overrideMatches.length,
      matchedWithHoldings: cw.matchedWithHoldings,
      matchRateWithHoldingsPct: pct(cw.matchedWithHoldings, cw.fundsWithHoldings),
      excludedReviewCount: cw.reviewMatches.length,
      excludedAmbiguousCount: cw.ambiguous.length,
      excludedUnmatchedCount: cw.unmatched.length,
      rejectedRiskyCount: cw.rejectedRisky.length,
    },
    funds,
    excluded: {
      note: "Funds deliberately excluded from the production snapshot. Counts are authoritative; samples are first-5 previews for context (full lists live in the discovery debug report, not here).",
      reviewCount: cw.reviewMatches.length,
      ambiguousCount: cw.ambiguous.length,
      unmatchedCount: cw.unmatched.length,
      rejectedRiskyCount: cw.rejectedRisky.length,
      reviewSample: cw.reviewMatches.slice(0, 5).map((m) => ({ schemecode: m.schemecode, fundName: m.fundName, confidence: m.confidence })),
      ambiguousSample: cw.ambiguous.slice(0, 5).map((u) => ({ schemecode: u.schemecode, fundName: u.fundName, reason: u.reason })),
      unmatchedSample: cw.unmatched.slice(0, 5).map((u) => ({ schemecode: u.schemecode, fundName: u.fundName })),
      rejectedRiskySample: cw.rejectedRisky.slice(0, 5).map((r) => ({ schemecode: r.schemecode, fundName: r.fundName, reason: r.reason })),
    },
    provenance: {
      sourceUrl: NAV_URL,
      fetchedAt,
      parser: "scripts/ingest/amfi-nav.ts:parseNavAll",
      crosswalk: "scripts/ingest/nav-crosswalk.ts:buildCrosswalk",
      crosswalkRuleVersion: RULE_VERSION,
      overridesPath: "src/data/portfolio-tracker/nav-crosswalk-overrides.json",
      overridesLoaded: overrides.size,
      policy: "Production set = exact + high (auto) + override only. medium/low/ambiguous/unmatched/rejected excluded.",
    },
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  info(`wrote ${path.relative(process.cwd(), OUTPUT_PATH)}`);

  info("================= LATEST NAV SNAPSHOT SUMMARY =================");
  info(`AMFI feed date: ${feedDate ?? "?"} · navRows: ${navs.length}`);
  info(`Production NAV rows written: ${totalMatched} (auto=${cw.autoMatches.length} + override=${cw.overrideMatches.length})`);
  info(`  of which with holdings:   ${productionWithHoldings}`);
  info(`Crosswalk coverage (with holdings): ${cw.matchedWithHoldings}/${cw.fundsWithHoldings} = ${pct(cw.matchedWithHoldings, cw.fundsWithHoldings)}%`);
  info(`Excluded — review:${cw.reviewMatches.length} ambiguous:${cw.ambiguous.length} unmatched:${cw.unmatched.length} rejected:${cw.rejectedRisky.length}`);
  info("==============================================================");
}

main().catch((e) => {
  warn(`nav-latest failed: ${(e as Error).message}`);
  process.exit(1);
});
