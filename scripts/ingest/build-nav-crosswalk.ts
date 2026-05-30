/**
 * Phase 3.0B — RupeeVest schemecode ↔ AMFI scheme code/ISIN crosswalk
 * (dry-run report only; live snapshots are not touched).
 *
 * Reads the existing fund directory (RupeeVest-keyed) and the live AMFI
 * NAVAll.txt feed, matches funds by normalized scheme name + plan + option,
 * and emits a single coverage report at data/debug/nav-crosswalk-report.json.
 *
 * Run with: tsx scripts/ingest/build-nav-crosswalk.ts
 *
 * Output is gitignored (see .gitignore: data/debug/). This script does
 * NOT write to src/data/**, does NOT modify any committed data, and does
 * NOT wire into the existing ingest orchestrator.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { parseNavAll } from "./amfi-nav";
import { fetchText, info, nowIso, warn } from "./utils";
import type { SchemeNav } from "../../src/data/snapshots/types";

const NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt";
const INDEX_PATH = path.resolve(
  process.cwd(),
  "src/data/portfolio-tracker/index.json"
);
const REPORT_DIR = path.resolve(process.cwd(), "data/debug");
const REPORT_PATH = path.join(REPORT_DIR, "nav-crosswalk-report.json");

// Match rule version. Bump when normalization or tiering rules change.
const RULE_VERSION = 1;

// Jaccard thresholds for fuzzy tiers. Anything below LOW_MIN is dropped.
const MEDIUM_MIN = 0.85;
const LOW_MIN = 0.7;

// ---------------------------------------------------------------------------
// I/O shapes
// ---------------------------------------------------------------------------

interface IndexFund {
  schemecode: string | number;
  name: string;
  fundName: string | null;
  classification: string | null;
  aumTotalCr: number | null;
  rowCount: number;
  file: string | null;
}

interface IndexFile {
  meta: Record<string, unknown>;
  funds: IndexFund[];
}

type Plan = "direct" | "regular" | "unknown";
type Option = "growth" | "idcw" | "unknown";

interface NormalizedName {
  plan: Plan;
  option: Option;
  isEtf: boolean;
  tokens: string[]; // sorted, deduped
  tokenKey: string; // canonical join key
  rawCleaned: string;
}

type Confidence = "exact" | "high" | "medium" | "low";

interface MatchRow {
  schemecode: string;
  fundName: string;
  classification: string | null;
  amfiSchemeCode: number;
  amfiSchemeName: string;
  amfiAmcName: string;
  isin: string | null;
  nav: number;
  navDate: string;
  confidence: Confidence;
  matchedBy: string; // human-readable reason e.g. "exact plan+option+tokens"
  jaccard: number; // 1.0 for exact/high
}

interface UnmatchedRow {
  schemecode: string;
  fundName: string;
  classification: string | null;
  reason: string;
  bestCandidate?: {
    amfiSchemeCode: number;
    amfiSchemeName: string;
    jaccard: number;
  };
}

// ---------------------------------------------------------------------------
// Normalizer
// ---------------------------------------------------------------------------

// RupeeVest abbreviates AMC names; AMFI spells them out. Map RupeeVest →
// AMFI canonical spelling. Applied as a leading-prefix substitution on the
// lowercased raw string BEFORE tokenization so the rest of the pipeline
// sees a single canonical AMC string.
const AMC_ALIASES: Array<[RegExp, string]> = [
  [/\bicici pru\b/g, "icici prudential"],
  [/\baditya birla sl\b/g, "aditya birla sun life"],
  [/\babsl\b/g, "aditya birla sun life"],
  [/\bdsp blackrock\b/g, "dsp"],
  [/\bl&t\b/g, "lnt"],
  [/\bhdfc amc\b/g, "hdfc"],
  [/\bsbi mf\b/g, "sbi"],
  [/\bnippon india\b/g, "nippon india"], // pass-through anchor
  [/\bfranklin india\b/g, "franklin india"], // pass-through anchor
];

// Noise words: scheme/plan/option metadata that shows up on one side only.
// Stripped AFTER plan and option are captured. "fund" / "scheme" / "the" are
// pure noise; the plan/option tokens are kept here as a safety net.
const NOISE_TOKENS = new Set([
  "fund",
  "scheme",
  "mutual",
  "the",
  "option",
  "plan",
  "direct",
  "regular",
  "reg",
  "dir",
  "growth",
  "g",
  "idcw",
  "dividend",
  "div",
  "payout",
  "reinvestment",
  "reinv",
  "an",
  "open",
  "ended",
  "of",
  "and",
]);

function detectPlan(lower: string): Plan {
  // RupeeVest: "-reg(" or " reg " marks Regular; absence (with a plan-bearing
  // option like "(g)" or "(idcw)") marks Direct.
  // AMFI: " - direct plan -" / " - regular plan -" / " direct plan " / etc.
  if (/\b(regular plan|regular|-reg\b|-reg\(|\(reg\)|\sreg\s)/.test(lower)) {
    return "regular";
  }
  if (/\b(direct plan|direct|-dir\b|\(dir\))/.test(lower)) {
    return "direct";
  }
  // RupeeVest convention: "(G)" or "(IDCW)" with no Reg implies Direct.
  if (/\((g|idcw|dividend)\)/.test(lower)) return "direct";
  return "unknown";
}

function detectOption(lower: string): Option {
  if (/\b(idcw|dividend|div(\b|idend))/.test(lower)) return "idcw";
  if (/\((g|growth)\)/.test(lower) || /\bgrowth\b/.test(lower)) return "growth";
  return "unknown";
}

function detectEtf(lower: string): boolean {
  return /\b(etf|exchange traded|fof|index fund)\b/.test(lower);
}

function normalize(name: string): NormalizedName {
  let s = name.toLowerCase().trim();
  // Apply AMC aliases first (before separator stripping mangles them).
  for (const [re, sub] of AMC_ALIASES) s = s.replace(re, sub);

  // Capture plan/option before stripping their markers.
  const plan = detectPlan(s);
  const option = detectOption(s);
  const isEtf = detectEtf(s);

  // Strip parenthetical chunks, separator punctuation.
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/[-_/.,&'"]+/g, " ");
  // Collapse non-alphanumeric to space.
  s = s.replace(/[^a-z0-9 ]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  const tokens = s
    .split(" ")
    .filter((t) => t && !NOISE_TOKENS.has(t))
    .sort();
  // Dedupe.
  const uniq: string[] = [];
  for (const t of tokens) if (uniq[uniq.length - 1] !== t) uniq.push(t);

  return {
    plan,
    option,
    isEtf,
    tokens: uniq,
    tokenKey: uniq.join(" "),
    rawCleaned: s,
  };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function planOptionCompatible(a: NormalizedName, b: NormalizedName): boolean {
  // ETFs and other passive/unconventional schemes carry unknown plan+option
  // legitimately on both sides; treat as compatible if both ends are unknown
  // (token match must then carry the burden).
  if (a.isEtf || b.isEtf) {
    return a.plan === b.plan || a.plan === "unknown" || b.plan === "unknown";
  }
  if (a.plan !== "unknown" && b.plan !== "unknown" && a.plan !== b.plan) {
    return false;
  }
  if (
    a.option !== "unknown" &&
    b.option !== "unknown" &&
    a.option !== b.option
  ) {
    return false;
  }
  return true;
}

interface AmfiIndexed {
  nav: SchemeNav;
  norm: NormalizedName;
}

interface BestMatch {
  amfi: AmfiIndexed;
  confidence: Confidence;
  jaccard: number;
  matchedBy: string;
  ambiguous: boolean;
}

function findBestMatch(
  rv: NormalizedName,
  amfi: AmfiIndexed[]
): BestMatch | null {
  // Pass 1: exact tokenKey + compatible plan/option, with uniqueness check.
  const exactKey = amfi.filter(
    (a) => a.norm.tokenKey === rv.tokenKey && planOptionCompatible(a.norm, rv)
  );
  if (exactKey.length === 1) {
    return {
      amfi: exactKey[0],
      confidence: "exact",
      jaccard: 1,
      matchedBy: "exact tokens + plan + option",
      ambiguous: false,
    };
  }
  if (exactKey.length > 1) {
    // Multiple AMFI schemes with the same normalized name + compatible plan
    // + compatible option. This happens when one side has plan=unknown and
    // matches both direct AND regular variants on the other side. Try to
    // tighten with strict plan equality.
    const tighter = exactKey.filter(
      (a) =>
        a.norm.plan === rv.plan &&
        a.norm.option === rv.option &&
        a.norm.plan !== "unknown" &&
        a.norm.option !== "unknown"
    );
    if (tighter.length === 1) {
      return {
        amfi: tighter[0],
        confidence: "exact",
        jaccard: 1,
        matchedBy: "exact tokens + strict plan + strict option",
        ambiguous: false,
      };
    }
    return {
      amfi: exactKey[0],
      confidence: "low",
      jaccard: 1,
      matchedBy: `ambiguous: ${exactKey.length} AMFI schemes share this normalized name`,
      ambiguous: true,
    };
  }

  // Pass 2: fuzzy Jaccard amongst plan/option-compatible candidates.
  let best: AmfiIndexed | null = null;
  let bestJ = 0;
  let runnerJ = 0;
  for (const a of amfi) {
    if (!planOptionCompatible(a.norm, rv)) continue;
    const j = jaccard(a.norm.tokens, rv.tokens);
    if (j > bestJ) {
      runnerJ = bestJ;
      bestJ = j;
      best = a;
    } else if (j > runnerJ) {
      runnerJ = j;
    }
  }
  if (!best || bestJ < LOW_MIN) return null;

  // If the gap between best and runner-up is tiny, flag as ambiguous.
  const ambiguous = bestJ - runnerJ < 0.05 && runnerJ >= LOW_MIN;

  let confidence: Confidence;
  let matchedBy: string;
  if (bestJ >= 1) {
    confidence = "high";
    matchedBy = "tokens identical (no plan/option marker on one side)";
  } else if (bestJ >= MEDIUM_MIN) {
    confidence = "medium";
    matchedBy = `Jaccard ${bestJ.toFixed(3)} (plan+option compatible)`;
  } else {
    confidence = "low";
    matchedBy = `Jaccard ${bestJ.toFixed(3)} (plan+option compatible)`;
  }
  return { amfi: best, confidence, jaccard: bestJ, matchedBy, ambiguous };
}

// ---------------------------------------------------------------------------
// Coverage aggregation
// ---------------------------------------------------------------------------

function pct(matched: number, total: number): number {
  return total === 0 ? 0 : Math.round((matched / total) * 10000) / 100;
}

function amcPrefix(fundName: string): string {
  // First 1–2 tokens before the scheme name; used purely to bucket coverage
  // reports, not for matching. Keep this dumb on purpose.
  const cleaned = fundName.toLowerCase().replace(/[-_/.,&'"]+/g, " ").trim();
  const parts = cleaned.split(/\s+/);
  const first = parts[0] ?? "unknown";
  const second = parts[1] ?? "";
  // Two-word AMC names that are common.
  const compound = `${first} ${second}`;
  if (
    [
      "aditya birla",
      "nippon india",
      "icici pru",
      "icici prudential",
      "franklin india",
      "edelweiss mf",
      "sundaram mf",
      "principal pnb",
      "white oak",
      "old bridge",
      "bandhan mutual",
      "navi mutual",
      "shriram mutual",
      "tata mutual",
      "kotak mahindra",
      "lic mf",
      "dsp blackrock",
    ].includes(compound)
  ) {
    return compound;
  }
  return first;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  info(`reading ${INDEX_PATH}`);
  const indexRaw = await fs.readFile(INDEX_PATH, "utf8");
  const indexFile = JSON.parse(indexRaw) as IndexFile;
  const totalFunds = indexFile.funds.length;
  const fundsWithHoldings = indexFile.funds.filter((f) => f.file).length;
  info(`index has ${totalFunds} funds (${fundsWithHoldings} with holdings)`);

  info(`fetching ${NAV_URL}`);
  const navText = await fetchText(NAV_URL);
  const navs = parseNavAll(navText);
  info(`parsed ${navs.length} AMFI scheme NAV rows`);
  if (navs.length === 0) {
    warn("AMFI parse returned zero schemes — aborting dry-run");
    process.exit(2);
  }

  // The NAV feed's reporting date is usually identical across all rows in a
  // given run (the latest publication day). Capture the mode for the report.
  const dateCounts = new Map<string, number>();
  for (const n of navs) {
    dateCounts.set(n.date, (dateCounts.get(n.date) ?? 0) + 1);
  }
  const feedDate = Array.from(dateCounts.entries()).sort(
    (a, b) => b[1] - a[1]
  )[0]?.[0];

  // Pre-normalize AMFI side once.
  const amfiIndexed: AmfiIndexed[] = navs.map((n) => ({
    nav: n,
    norm: normalize(n.schemeName),
  }));

  // Per-RupeeVest matching.
  const matches: MatchRow[] = [];
  const unmatched: UnmatchedRow[] = [];

  const coverageByClass = new Map<
    string,
    { total: number; matched: number; totalWithHoldings: number; matchedWithHoldings: number }
  >();
  const coverageByAmc = new Map<
    string,
    { total: number; matched: number }
  >();
  const tierCounts: Record<Confidence, number> = {
    exact: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  let matchedWithHoldings = 0;

  for (const f of indexFile.funds) {
    const fundName = f.fundName ?? f.name;
    const schemecode = String(f.schemecode);
    const classification = f.classification;
    const hasHoldings = Boolean(f.file);

    const cls = classification ?? "(unclassified)";
    if (!coverageByClass.has(cls)) {
      coverageByClass.set(cls, {
        total: 0,
        matched: 0,
        totalWithHoldings: 0,
        matchedWithHoldings: 0,
      });
    }
    const clsBucket = coverageByClass.get(cls)!;
    clsBucket.total += 1;
    if (hasHoldings) clsBucket.totalWithHoldings += 1;

    const amc = amcPrefix(fundName);
    if (!coverageByAmc.has(amc)) {
      coverageByAmc.set(amc, { total: 0, matched: 0 });
    }
    const amcBucket = coverageByAmc.get(amc)!;
    amcBucket.total += 1;

    const rv = normalize(fundName);
    const best = findBestMatch(rv, amfiIndexed);

    if (!best || best.ambiguous) {
      const reason = !best
        ? rv.tokens.length === 0
          ? "rupeevest name normalized to empty token set"
          : "no AMFI candidate above Jaccard 0.70 in same plan+option"
        : best.matchedBy;
      // Capture best-candidate diagnostic even when we refuse to match.
      let bestCandidate: UnmatchedRow["bestCandidate"];
      if (best && best.amfi) {
        bestCandidate = {
          amfiSchemeCode: best.amfi.nav.schemeCode,
          amfiSchemeName: best.amfi.nav.schemeName,
          jaccard: best.jaccard,
        };
      } else {
        let bj = 0;
        let bc: AmfiIndexed | null = null;
        for (const a of amfiIndexed) {
          if (!planOptionCompatible(a.norm, rv)) continue;
          const j = jaccard(a.norm.tokens, rv.tokens);
          if (j > bj) {
            bj = j;
            bc = a;
          }
        }
        if (bc) {
          bestCandidate = {
            amfiSchemeCode: bc.nav.schemeCode,
            amfiSchemeName: bc.nav.schemeName,
            jaccard: bj,
          };
        }
      }
      unmatched.push({
        schemecode,
        fundName,
        classification,
        reason,
        bestCandidate,
      });
      continue;
    }

    matches.push({
      schemecode,
      fundName,
      classification,
      amfiSchemeCode: best.amfi.nav.schemeCode,
      amfiSchemeName: best.amfi.nav.schemeName,
      amfiAmcName: best.amfi.nav.amcName,
      isin: best.amfi.nav.isin ?? null,
      nav: best.amfi.nav.nav,
      navDate: best.amfi.nav.date,
      confidence: best.confidence,
      matchedBy: best.matchedBy,
      jaccard: best.jaccard,
    });
    tierCounts[best.confidence] += 1;
    clsBucket.matched += 1;
    if (hasHoldings) {
      clsBucket.matchedWithHoldings += 1;
      matchedWithHoldings += 1;
    }
    amcBucket.matched += 1;
  }

  const matchedTotal = matches.length;
  const unmatchedTotal = unmatched.length;

  // Aggregated coverage objects (sorted, with computed percentages).
  const coverageByClassificationOut = Array.from(coverageByClass.entries())
    .map(([k, v]) => ({
      classification: k,
      total: v.total,
      matched: v.matched,
      pct: pct(v.matched, v.total),
      totalWithHoldings: v.totalWithHoldings,
      matchedWithHoldings: v.matchedWithHoldings,
      pctWithHoldings: pct(v.matchedWithHoldings, v.totalWithHoldings),
    }))
    .sort((a, b) => a.pct - b.pct);

  const coverageByAmcOut = Array.from(coverageByAmc.entries())
    .map(([k, v]) => ({
      amc: k,
      total: v.total,
      matched: v.matched,
      pct: pct(v.matched, v.total),
    }))
    .sort((a, b) => a.pct - b.pct);

  const lowConfidence = matches.filter(
    (m) => m.confidence === "low" || m.confidence === "medium"
  );

  const matchesSample = matches.slice(0, 50);

  const report = {
    meta: {
      generatedAt: nowIso(),
      source: NAV_URL,
      indexPath: "src/data/portfolio-tracker/index.json",
      dryRun: true,
      ruleVersion: RULE_VERSION,
      feedDate,
      navRowsFromFeed: navs.length,
      thresholds: { MEDIUM_MIN, LOW_MIN },
      note:
        "Phase 3.0B dry-run: RupeeVest schemecode → AMFI scheme code / ISIN " +
        "crosswalk via normalized scheme-name matching with plan+option " +
        "compatibility. NOT a live snapshot. NOT wired into the dashboard.",
    },
    summary: {
      totalFunds,
      fundsWithHoldings,
      matched: matchedTotal,
      unmatched: unmatchedTotal,
      matchRateOverallPct: pct(matchedTotal, totalFunds),
      matchRateWithHoldingsPct: pct(matchedWithHoldings, fundsWithHoldings),
      byTier: tierCounts,
      lowConfidenceCount: lowConfidence.length,
    },
    coverageByClassification: coverageByClassificationOut,
    coverageByAmc: coverageByAmcOut,
    matchesSample,
    lowConfidence,
    unmatched,
  };

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  info(`wrote ${REPORT_PATH}`);

  // --- stdout summary -------------------------------------------------------
  info("==================== CROSSWALK SUMMARY ====================");
  info(`AMFI feed date (mode): ${feedDate ?? "(none)"}`);
  info(`AMFI NAV rows parsed:  ${navs.length}`);
  info(`RupeeVest funds total: ${totalFunds} (with holdings: ${fundsWithHoldings})`);
  info(`Matched:               ${matchedTotal}  (${pct(matchedTotal, totalFunds)}%)`);
  info(`  of which w/ holdings:${matchedWithHoldings} (${pct(matchedWithHoldings, fundsWithHoldings)}%)`);
  info(`Unmatched:             ${unmatchedTotal}`);
  info(`Tiers — exact: ${tierCounts.exact} · high: ${tierCounts.high} · medium: ${tierCounts.medium} · low: ${tierCounts.low}`);
  info(`Low/medium confidence (review): ${lowConfidence.length}`);

  info("--- worst-5 classifications by coverage% ---");
  for (const c of coverageByClassificationOut.slice(0, 5)) {
    info(
      `  ${c.classification}: ${c.matched}/${c.total} (${c.pct}%) · w/holdings ${c.matchedWithHoldings}/${c.totalWithHoldings} (${c.pctWithHoldings}%)`
    );
  }

  info("--- sample 5 matched (with-holdings) rows ---");
  const sampleMatched = matches.filter((m) => {
    const f = indexFile.funds.find((x) => String(x.schemecode) === m.schemecode);
    return f && f.file;
  }).slice(0, 5);
  for (const m of sampleMatched) {
    info(
      `  [${m.confidence}] ${m.schemecode} "${m.fundName}" → ${m.amfiSchemeCode} "${m.amfiSchemeName}" · ISIN=${m.isin ?? "—"} · NAV=${m.nav} (${m.navDate}) · J=${m.jaccard.toFixed(3)}`
    );
  }

  info("--- sample 5 unmatched (with-holdings) rows ---");
  const sampleUnmatched = unmatched.filter((u) => {
    const f = indexFile.funds.find((x) => String(x.schemecode) === u.schemecode);
    return f && f.file;
  }).slice(0, 5);
  for (const u of sampleUnmatched) {
    const bc = u.bestCandidate
      ? ` · best=${u.bestCandidate.amfiSchemeCode} "${u.bestCandidate.amfiSchemeName}" (J=${u.bestCandidate.jaccard.toFixed(3)})`
      : "";
    info(`  ${u.schemecode} "${u.fundName}" — ${u.reason}${bc}`);
  }

  info("==========================================================");
  info(`Full report: ${path.relative(process.cwd(), REPORT_PATH)}`);
}

main().catch((e) => {
  warn(`crosswalk dry-run failed: ${(e as Error).message}`);
  process.exit(1);
});
