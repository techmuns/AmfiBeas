/**
 * Shared RupeeVest → AMFI crosswalk engine.
 *
 * Single source of truth for the name-normalization matcher, guards, override
 * application, and the per-fund classification loop. Imported by BOTH
 * scripts/ingest/nav-source-discovery.ts (read-only discovery) and
 * scripts/ingest/nav-latest.ts (production latest-NAV snapshot) so the two
 * never drift. No network or report I/O lives here — callers fetch + parse
 * the AMFI feed and pass the parsed rows into buildCrosswalk().
 *
 * Matching policy (unchanged from Phase 3.0C/3.0D — do not weaken):
 *  - Overrides applied first; an override pointing at an AMFI scheme not in
 *    the current feed is surfaced as rejected, never silently dropped.
 *  - Auto-accept ONLY exact + high tiers. medium/low go to review.
 *  - Guards REJECT (never downgrade) on digit-token, critical-token, ETF/FoF,
 *    and AMC-fingerprint mismatches. False positives are worse than misses.
 *  - Ambiguous (multi-candidate / near-tie) picks are surfaced, never chosen.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { SchemeNav } from "../../src/data/snapshots/types";

export const RULE_VERSION = 4;
export const MEDIUM_MIN = 0.85;
export const LOW_MIN = 0.7;

export const DEFAULT_INDEX_PATH = path.resolve(
  process.cwd(),
  "src/data/portfolio-tracker/index.json"
);
export const DEFAULT_OVERRIDES_PATH = path.resolve(
  process.cwd(),
  "src/data/portfolio-tracker/nav-crosswalk-overrides.json"
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexFund {
  schemecode: string | number;
  name: string;
  fundName: string | null;
  classification: string | null;
  aumTotalCr: number | null;
  rowCount: number;
  file: string | null;
}
export interface IndexFile {
  meta: Record<string, unknown>;
  funds: IndexFund[];
}

export type Plan = "direct" | "regular" | "unknown";
export type Option = "growth" | "idcw" | "unknown";
export type Confidence = "exact" | "high" | "medium" | "low" | "override";

export interface NormalizedName {
  plan: Plan;
  option: Option;
  isEtf: boolean;
  isFof: boolean;
  tokens: string[];
  tokenKey: string;
}

export interface MatchRow {
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
  matchedBy: string;
  jaccard: number;
}

export interface UnmatchedRow {
  schemecode: string;
  fundName: string;
  classification: string | null;
  reason: string;
  bestCandidate?: { amfiSchemeCode: number; amfiSchemeName: string; jaccard: number };
}

export interface RejectedRow {
  schemecode: string;
  fundName: string;
  classification: string | null;
  reason: string;
  rejectedCandidate?: { amfiSchemeCode: number; amfiSchemeName: string; jaccard: number };
}

export interface OverrideEntry {
  schemecode: string | number;
  fundName?: string;
  amfiSchemeCode?: number;
  isin?: string | null;
  amfiSchemeName?: string;
  reason?: string;
  manual?: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
}
export interface OverridesFile {
  meta?: { version?: number; note?: string; lastUpdated?: string };
  overrides: OverrideEntry[];
}

export interface AmfiIndexed {
  nav: SchemeNav;
  norm: NormalizedName;
}

export type MatchOutcome =
  | { kind: "match"; amfi: AmfiIndexed; confidence: Exclude<Confidence, "override">; jaccard: number; matchedBy: string }
  | { kind: "ambiguous"; amfi: AmfiIndexed; jaccard: number; reason: string }
  | { kind: "rejected"; amfi: AmfiIndexed; jaccard: number; reason: string }
  | { kind: "none" };

// ---------------------------------------------------------------------------
// AMC aliases (grounded in committed amc-master.json AMC names)
// ---------------------------------------------------------------------------

const AMC_ALIASES: Array<[RegExp, string]> = [
  [/\bicici pru\b/g, "icici prudential"],
  [/\baditya birla sl\b/g, "aditya birla sun life"],
  [/\babsl\b/g, "aditya birla sun life"],
  [/\bcanara rob\b/g, "canara robeco"],
  [/\bdsp blackrock\b/g, "dsp"],
  [/\bfranklin india\b/g, "franklin templeton"],
  [/\bfranklin\b(?! templeton)/g, "franklin templeton"],
  [/\bl&t\b/g, "hsbc"], // L&T MF was acquired by HSBC; AMFI scheme names use HSBC
  [/\blnt\b/g, "hsbc"],
  [/\bhdfc amc\b/g, "hdfc"],
  [/\bsbi mf\b/g, "sbi"],
  [/\bppfas\b/g, "parag parikh"],
  [/\bpgim india\b/g, "pgim india"],
  [/\bpgim\b(?! india)/g, "pgim india"],
  [/\bwhite oak\b/g, "whiteoak"],
  [/\bwoc\b/g, "whiteoak capital"],
  [/\biifl\b/g, "360 one"],
  [/\bidfc\b/g, "bandhan"],
  [/\bbnp paribas\b/g, "baroda bnp paribas"],
  [/\bbaroda bnp\b(?! paribas)/g, "baroda bnp paribas"],
  [/\bedelweiss mf\b/g, "edelweiss"],
  [/\bsundaram mf\b/g, "sundaram"],
  [/\bboi\b/g, "bank of india"],
  [/\btrustmf\b/g, "trust"],
  [/\btwc\b/g, "the wealth company"],
  [/\bjm financial\b/g, "jm financial"],
  [/\bjm\b(?! financial)/g, "jm financial"],
  // Strip the boilerplate AMC suffix that AMFI adds in some scheme names.
  [/\bmutual fund\b/g, " "],
];

// Strict tokens — must be present on both sides or neither.
const CRITICAL_TOKENS = new Set<string>([
  "next", "alpha", "momentum", "quality", "value", "low", "vol", "volatility",
  "equal", "weighted", "select", "edge",
  "midcap", "smallcap", "largecap", "micro",
  "psu", "private", "public",
  "fof",
  "esg", "shariah",
  "smart", "beta",
  "passive", "active",
  "sdl", "tbill",
  "manufacturing", "consumption",
  "elss",
  "long", "short", "ultra", "medium", "dynamic",
]);

const NOISE_TOKENS = new Set([
  "fund", "scheme", "mutual", "the", "option", "plan", "direct", "regular",
  "reg", "dir", "growth", "g", "idcw", "dividend", "div", "payout",
  "reinvestment", "reinv", "an", "open", "ended", "of", "and", "to",
  "category", "schemes",
]);

const RAW_COMPOUND_REWRITES: Array<[RegExp, string]> = [
  [/\bfinserv\b/g, "financial services"],
  [/\bfin serv\b/g, "financial services"],
  [/\bfin servs\b/g, "financial services"],
];

const TOKEN_EXPANSIONS: Record<string, string> = {
  corp: "corporate",
  opp: "opportunities",
  opps: "opportunities",
  mfg: "manufacturing",
  infra: "infrastructure",
  sav: "savings",
  adv: "advantage",
  serv: "services",
  servs: "services",
  fin: "financial",
};

const AMC_FINGERPRINTS: Array<{ key: string; required: string[] }> = [
  { key: "absl",            required: ["aditya", "birla", "sun", "life"] },
  { key: "icici",           required: ["icici", "prudential"] },
  { key: "baroda-bnp",      required: ["baroda", "bnp"] },
  { key: "franklin",        required: ["franklin", "templeton"] },
  { key: "mahindra-manu",   required: ["mahindra", "manulife"] },
  { key: "mirae",           required: ["mirae"] },
  { key: "motilal",         required: ["motilal"] },
  { key: "parag-parikh",    required: ["parag", "parikh"] },
  { key: "pgim",            required: ["pgim"] },
  { key: "bandhan",         required: ["bandhan"] },
  { key: "canara",          required: ["canara"] },
  { key: "whiteoak",        required: ["whiteoak"] },
  { key: "360one",          required: ["360", "one"] },
  { key: "kotak",           required: ["kotak"] },
  { key: "hsbc",            required: ["hsbc"] },
  { key: "dsp",             required: ["dsp"] },
  { key: "sbi",             required: ["sbi"] },
  { key: "hdfc",            required: ["hdfc"] },
  { key: "uti",             required: ["uti"] },
  { key: "axis",            required: ["axis"] },
  { key: "tata",            required: ["tata"] },
  { key: "nippon",          required: ["nippon"] },
  { key: "edelweiss",       required: ["edelweiss"] },
  { key: "sundaram",        required: ["sundaram"] },
  { key: "invesco",         required: ["invesco"] },
  { key: "lic",             required: ["lic"] },
  { key: "groww",           required: ["groww"] },
  { key: "jm-financial",    required: ["jm", "financial"] },
  { key: "navi",            required: ["navi"] },
  { key: "trust",           required: ["trust"] },
  { key: "quantum",         required: ["quantum"] },
  { key: "quant",           required: ["quant"] },
  { key: "taurus",          required: ["taurus"] },
  { key: "shriram",         required: ["shriram"] },
  { key: "helios",          required: ["helios"] },
  { key: "samco",           required: ["samco"] },
  { key: "zerodha",         required: ["zerodha"] },
  { key: "nj",              required: ["nj"] },
  { key: "ppfas",           required: ["ppfas"] },
  { key: "bajaj-finserv",   required: ["bajaj"] },
  { key: "union",           required: ["union"] },
  { key: "itimf",           required: ["iti"] },
  { key: "old-bridge",      required: ["old", "bridge"] },
  { key: "wealth-co",       required: ["wealth", "company"] },
  { key: "bank-of-india",   required: ["bank", "india"] },
  { key: "jio-blackrock",   required: ["jio"] },
  { key: "angel-one",       required: ["angel", "one"] },
];

// ---------------------------------------------------------------------------
// Normalizer + matcher
// ---------------------------------------------------------------------------

function detectPlan(lower: string): Plan {
  if (/\b(regular plan|regular|-reg\b|-reg\(|\(reg\)|\sreg\s)/.test(lower)) return "regular";
  if (/\b(direct plan|direct|-dir\b|\(dir\))/.test(lower)) return "direct";
  if (/\((g|idcw|dividend)\)/.test(lower)) return "direct";
  return "unknown";
}
function detectOption(lower: string): Option {
  if (/\b(idcw|dividend|div(\b|idend))/.test(lower)) return "idcw";
  if (/\((g|growth)\)/.test(lower) || /\bgrowth\b/.test(lower)) return "growth";
  return "unknown";
}
function detectEtf(lower: string): boolean { return /\b(etf|exchange traded)\b/.test(lower); }
function detectFof(lower: string): boolean { return /\bfof\b|\bfund of funds?\b|\bfund-of-fund\b/.test(lower); }
function detectIndexFund(lower: string): boolean { return /\bindex fund\b/.test(lower); }

/** Identify an AMC fingerprint from a normalized token list. Returns null
 *  when no required-token block fully matches. Order matters: more specific
 *  (multi-token) fingerprints come first. */
export function extractAmcKey(tokens: string[]): string | null {
  const set = new Set(tokens);
  for (const f of AMC_FINGERPRINTS) {
    if (f.required.every((t) => set.has(t))) return f.key;
  }
  return null;
}

export function normalize(name: string): NormalizedName {
  let s = name.toLowerCase().trim();
  for (const [re, sub] of AMC_ALIASES) s = s.replace(re, sub);
  for (const [re, sub] of RAW_COMPOUND_REWRITES) s = s.replace(re, sub);
  const plan = detectPlan(s);
  const option = detectOption(s);
  const isEtf = detectEtf(s);
  const isFof = detectFof(s);
  const isIndexFund = detectIndexFund(s);
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/[-_/.,&'"]+/g, " ");
  s = s.replace(/[^a-z0-9 ]+/g, " ");
  // Split letter↔digit transitions so "Nifty50" and "Nifty 50" tokenize the
  // same way.
  s = s.replace(/([a-z])(\d)/g, "$1 $2");
  s = s.replace(/(\d)([a-z])/g, "$1 $2");
  // Canonicalize size-cap tokens so "Large Cap" and "Largecap" converge,
  // while "Large & Mid Cap" stays distinct from plain "Large Cap".
  s = s.replace(/\b(mid|small|large|micro|mega) cap\b/g, "$1cap");
  s = s.replace(/\s+/g, " ").trim();
  const raw = s.split(" ").filter((t) => t && !NOISE_TOKENS.has(t));
  const expanded = raw.map((t) => TOKEN_EXPANSIONS[t] ?? t);
  if (isFof) expanded.push("fof");
  if (isEtf && !expanded.includes("etf")) expanded.push("etf");
  if (isIndexFund && !expanded.includes("indexfund")) expanded.push("indexfund");
  expanded.sort();
  const uniq: string[] = [];
  for (const t of expanded) if (uniq[uniq.length - 1] !== t) uniq.push(t);
  return { plan, option, isEtf, isFof, tokens: uniq, tokenKey: uniq.join(" ") };
}

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function planOptionCompatible(a: NormalizedName, b: NormalizedName): boolean {
  if (a.isEtf || b.isEtf || a.isFof || b.isFof) {
    return a.plan === b.plan || a.plan === "unknown" || b.plan === "unknown";
  }
  if (a.plan !== "unknown" && b.plan !== "unknown" && a.plan !== b.plan) return false;
  if (a.option !== "unknown" && b.option !== "unknown" && a.option !== b.option) return false;
  return true;
}

/** Guards REJECT (do not downgrade). False positives are worse than misses. */
export function passesGuards(rv: NormalizedName, am: NormalizedName): { ok: boolean; reason?: string } {
  // Guard A: digit-token sets must be identical.
  const rvD = rv.tokens.filter((t) => /^\d+$/.test(t));
  const amD = am.tokens.filter((t) => /^\d+$/.test(t));
  if (rvD.length !== amD.length) {
    return { ok: false, reason: `digit-token count mismatch (rv=[${rvD.join(",")}] amfi=[${amD.join(",")}])` };
  }
  const rvSet = new Set(rvD);
  for (const d of amD) if (!rvSet.has(d)) return { ok: false, reason: `digit token "${d}" only on amfi side` };
  // Guard B: critical tokens must match symmetrically.
  for (const t of CRITICAL_TOKENS) {
    const inR = rv.tokens.includes(t);
    const inA = am.tokens.includes(t);
    if (inR !== inA) return { ok: false, reason: `critical token "${t}" present on ${inR ? "rupeevest" : "amfi"} side only` };
  }
  // Guard C: ETF↔ETF, FoF↔FoF.
  if (rv.isEtf !== am.isEtf) return { ok: false, reason: "ETF flag mismatch" };
  if (rv.isFof !== am.isFof) return { ok: false, reason: "FoF flag mismatch" };
  // Guard D: AMC fingerprint mismatch (only when BOTH sides identify an AMC).
  const amcRv = extractAmcKey(rv.tokens);
  const amcAm = extractAmcKey(am.tokens);
  if (amcRv && amcAm && amcRv !== amcAm) {
    return { ok: false, reason: `AMC fingerprint mismatch (rupeevest=${amcRv} amfi=${amcAm})` };
  }
  return { ok: true };
}

export function findBestMatch(rv: NormalizedName, amfi: AmfiIndexed[]): MatchOutcome {
  const exactKey = amfi.filter(
    (a) => a.norm.tokenKey === rv.tokenKey && planOptionCompatible(a.norm, rv)
  );
  const exactSafe = exactKey.filter((a) => passesGuards(rv, a.norm).ok);
  if (exactSafe.length === 1) {
    return { kind: "match", amfi: exactSafe[0], confidence: "exact", jaccard: 1, matchedBy: "exact tokens + plan + option" };
  }
  if (exactSafe.length > 1) {
    const tighter = exactSafe.filter(
      (a) => a.norm.plan === rv.plan && a.norm.option === rv.option && a.norm.plan !== "unknown" && a.norm.option !== "unknown"
    );
    if (tighter.length === 1) {
      return { kind: "match", amfi: tighter[0], confidence: "exact", jaccard: 1, matchedBy: "exact tokens + strict plan + strict option" };
    }
    return { kind: "ambiguous", amfi: exactSafe[0], jaccard: 1, reason: `${exactSafe.length} AMFI schemes share this normalized name` };
  }

  let best: AmfiIndexed | null = null;
  let bestJ = 0;
  let runnerJ = 0;
  let rejected: { am: AmfiIndexed; j: number; reason: string } | null = null;

  for (const a of amfi) {
    if (!planOptionCompatible(a.norm, rv)) continue;
    const j = jaccard(a.norm.tokens, rv.tokens);
    if (j < LOW_MIN) continue;
    const g = passesGuards(rv, a.norm);
    if (!g.ok) {
      if (!rejected || j > rejected.j) rejected = { am: a, j, reason: g.reason! };
      continue;
    }
    if (j > bestJ) { runnerJ = bestJ; bestJ = j; best = a; }
    else if (j > runnerJ) { runnerJ = j; }
  }

  if (!best) {
    return rejected
      ? { kind: "rejected", amfi: rejected.am, jaccard: rejected.j, reason: rejected.reason }
      : { kind: "none" };
  }

  if (bestJ - runnerJ < 0.05 && runnerJ >= LOW_MIN) {
    return { kind: "ambiguous", amfi: best, jaccard: bestJ, reason: `near-tie with runner-up (Δ=${(bestJ - runnerJ).toFixed(3)})` };
  }

  let confidence: Exclude<Confidence, "override">;
  let matchedBy: string;
  if (bestJ >= 1) {
    confidence = "high";
    matchedBy = "tokens identical (plan/option marker missing on one side)";
  } else if (bestJ >= MEDIUM_MIN) {
    confidence = "medium";
    matchedBy = `Jaccard ${bestJ.toFixed(3)} (plan+option compatible)`;
  } else {
    confidence = "low";
    matchedBy = `Jaccard ${bestJ.toFixed(3)} (plan+option compatible)`;
  }
  return { kind: "match", amfi: best, confidence, jaccard: bestJ, matchedBy };
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

export async function loadOverrides(
  overridesPath: string = DEFAULT_OVERRIDES_PATH
): Promise<{ map: Map<string, OverrideEntry>; meta: OverridesFile["meta"] | undefined; size: number }> {
  try {
    const text = await fs.readFile(overridesPath, "utf8");
    const data = JSON.parse(text) as OverridesFile;
    const map = new Map<string, OverrideEntry>();
    for (const o of data.overrides ?? []) map.set(String(o.schemecode), o);
    return { map, meta: data.meta, size: map.size };
  } catch {
    return { map: new Map(), meta: undefined, size: 0 };
  }
}

export function applyOverride(
  fund: IndexFund,
  override: OverrideEntry,
  amfi: AmfiIndexed[]
): { kind: "match"; match: MatchRow } | { kind: "rejected"; row: RejectedRow } | { kind: "invalid"; row: RejectedRow } {
  const fundName = fund.fundName ?? fund.name;
  const schemecode = String(fund.schemecode);
  const hasCode = typeof override.amfiSchemeCode === "number";
  const hasIsin = typeof override.isin === "string" && override.isin.length > 0;
  if (!hasCode && !hasIsin) {
    return {
      kind: "invalid",
      row: { schemecode, fundName, classification: fund.classification, reason: "override missing both amfiSchemeCode and isin" },
    };
  }
  // If both keys are supplied, they MUST point at the same AMFI row.
  const byCode = hasCode ? amfi.find((a) => a.nav.schemeCode === override.amfiSchemeCode) : undefined;
  const byIsin = hasIsin ? amfi.find((a) => a.nav.isin === override.isin) : undefined;
  if (byCode && byIsin && byCode !== byIsin) {
    return {
      kind: "invalid",
      row: {
        schemecode, fundName, classification: fund.classification,
        reason: `override amfiSchemeCode=${override.amfiSchemeCode} and isin=${override.isin} point to different AMFI rows`,
      },
    };
  }
  const target = byCode ?? byIsin;
  if (!target) {
    return {
      kind: "rejected",
      row: {
        schemecode, fundName, classification: fund.classification,
        reason: `override points to AMFI scheme code=${override.amfiSchemeCode ?? "?"} isin=${override.isin ?? "?"} not present in current feed`,
      },
    };
  }
  return {
    kind: "match",
    match: {
      schemecode, fundName, classification: fund.classification,
      amfiSchemeCode: target.nav.schemeCode,
      amfiSchemeName: target.nav.schemeName,
      amfiAmcName: target.nav.amcName,
      isin: target.nav.isin ?? null,
      nav: target.nav.nav, navDate: target.nav.date,
      confidence: "override",
      matchedBy: override.reason ?? "manual override",
      jaccard: 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Coverage helpers + full crosswalk build
// ---------------------------------------------------------------------------

export function pct(matched: number, total: number): number {
  return total === 0 ? 0 : Math.round((matched / total) * 10000) / 100;
}

export function amcPrefix(fundName: string): string {
  const cleaned = fundName.toLowerCase().replace(/[-_/.,&'"]+/g, " ").trim();
  const parts = cleaned.split(/\s+/);
  const first = parts[0] ?? "unknown";
  const second = parts[1] ?? "";
  const compound = `${first} ${second}`;
  const known = [
    "aditya birla", "nippon india", "icici pru", "icici prudential",
    "franklin india", "franklin templeton", "edelweiss mf", "sundaram mf",
    "white oak", "whiteoak capital", "old bridge", "bandhan mutual",
    "navi mutual", "tata mutual", "kotak mahindra", "lic mf", "dsp blackrock",
    "baroda bnp", "bank of", "the wealth", "jm financial", "jio blackrock",
    "mahindra manulife", "mirae asset", "motilal oswal", "pgim india",
    "bajaj finserv", "360 one",
  ];
  return known.includes(compound) ? compound : first;
}

export interface ClassCoverageRow {
  classification: string;
  total: number;
  matched: number;
  pct: number;
  totalWithHoldings: number;
  matchedWithHoldings: number;
  pctWithHoldings: number;
}
export interface AmcCoverageRow {
  amc: string;
  total: number;
  matched: number;
  pct: number;
}

export interface CrosswalkResult {
  autoMatches: MatchRow[];
  overrideMatches: MatchRow[];
  reviewMatches: MatchRow[];
  ambiguous: UnmatchedRow[];
  rejectedRisky: RejectedRow[];
  unmatched: UnmatchedRow[];
  invalidOverrides: RejectedRow[];
  coverageByClassification: ClassCoverageRow[];
  coverageByAmc: AmcCoverageRow[];
  totalFunds: number;
  fundsWithHoldings: number;
  matchedWithHoldings: number;
  autoMatchedWithHoldings: number;
}

/** Classify every index fund against the parsed AMFI feed. Identical logic
 *  to what produced the validated 95.91% result; the discovery harness and
 *  the production latest-NAV script both call this. */
export function buildCrosswalk(
  funds: IndexFund[],
  navs: SchemeNav[],
  overrides: Map<string, OverrideEntry>
): CrosswalkResult {
  const amfiIndexed: AmfiIndexed[] = navs.map((n) => ({ nav: n, norm: normalize(n.schemeName) }));

  const autoMatches: MatchRow[] = [];
  const overrideMatches: MatchRow[] = [];
  const reviewMatches: MatchRow[] = [];
  const ambiguous: UnmatchedRow[] = [];
  const rejectedRisky: RejectedRow[] = [];
  const unmatched: UnmatchedRow[] = [];
  const invalidOverrides: RejectedRow[] = [];

  const coverageByClass = new Map<string, { total: number; matched: number; totalWithHoldings: number; matchedWithHoldings: number }>();
  const coverageByAmc = new Map<string, { total: number; matched: number }>();
  let matchedWithHoldings = 0;
  let autoMatchedWithHoldings = 0;

  for (const f of funds) {
    const fundName = f.fundName ?? f.name;
    const schemecode = String(f.schemecode);
    const classification = f.classification;
    const hasHoldings = Boolean(f.file);
    const cls = classification ?? "(unclassified)";
    if (!coverageByClass.has(cls)) coverageByClass.set(cls, { total: 0, matched: 0, totalWithHoldings: 0, matchedWithHoldings: 0 });
    const clsB = coverageByClass.get(cls)!;
    clsB.total += 1;
    if (hasHoldings) clsB.totalWithHoldings += 1;
    const amc = amcPrefix(fundName);
    if (!coverageByAmc.has(amc)) coverageByAmc.set(amc, { total: 0, matched: 0 });
    const amcB = coverageByAmc.get(amc)!;
    amcB.total += 1;

    // 1. Override path takes precedence.
    const ovr = overrides.get(schemecode);
    if (ovr) {
      const r = applyOverride(f, ovr, amfiIndexed);
      if (r.kind === "match") {
        overrideMatches.push(r.match);
        clsB.matched += 1;
        if (hasHoldings) { clsB.matchedWithHoldings += 1; matchedWithHoldings += 1; }
        amcB.matched += 1;
        continue;
      }
      if (r.kind === "invalid") invalidOverrides.push(r.row);
      else rejectedRisky.push(r.row);
      continue;
    }

    // 2. Name-normalized matching.
    const rv = normalize(fundName);
    const outcome = findBestMatch(rv, amfiIndexed);

    if (outcome.kind === "match") {
      const row: MatchRow = {
        schemecode, fundName, classification,
        amfiSchemeCode: outcome.amfi.nav.schemeCode,
        amfiSchemeName: outcome.amfi.nav.schemeName,
        amfiAmcName: outcome.amfi.nav.amcName,
        isin: outcome.amfi.nav.isin ?? null,
        nav: outcome.amfi.nav.nav, navDate: outcome.amfi.nav.date,
        confidence: outcome.confidence,
        matchedBy: outcome.matchedBy, jaccard: outcome.jaccard,
      };
      if (outcome.confidence === "exact" || outcome.confidence === "high") {
        autoMatches.push(row);
        clsB.matched += 1;
        if (hasHoldings) { clsB.matchedWithHoldings += 1; matchedWithHoldings += 1; autoMatchedWithHoldings += 1; }
        amcB.matched += 1;
      } else {
        reviewMatches.push(row);
      }
      continue;
    }
    if (outcome.kind === "ambiguous") {
      ambiguous.push({
        schemecode, fundName, classification,
        reason: outcome.reason,
        bestCandidate: { amfiSchemeCode: outcome.amfi.nav.schemeCode, amfiSchemeName: outcome.amfi.nav.schemeName, jaccard: outcome.jaccard },
      });
      continue;
    }
    if (outcome.kind === "rejected") {
      rejectedRisky.push({
        schemecode, fundName, classification,
        reason: outcome.reason,
        rejectedCandidate: { amfiSchemeCode: outcome.amfi.nav.schemeCode, amfiSchemeName: outcome.amfi.nav.schemeName, jaccard: outcome.jaccard },
      });
      continue;
    }
    // none — capture best-but-below-threshold candidate for diagnostics.
    let bj = 0; let bc: AmfiIndexed | null = null;
    for (const a of amfiIndexed) {
      if (!planOptionCompatible(a.norm, rv)) continue;
      const j = jaccard(a.norm.tokens, rv.tokens);
      if (j > bj) { bj = j; bc = a; }
    }
    unmatched.push({
      schemecode, fundName, classification,
      reason: rv.tokens.length === 0 ? "rupeevest name normalized to empty token set" : "no AMFI candidate above Jaccard 0.70 in same plan+option",
      bestCandidate: bc ? { amfiSchemeCode: bc.nav.schemeCode, amfiSchemeName: bc.nav.schemeName, jaccard: bj } : undefined,
    });
  }

  for (const inv of invalidOverrides) rejectedRisky.push(inv);

  const coverageByClassification = Array.from(coverageByClass.entries())
    .map(([k, v]) => ({
      classification: k, total: v.total, matched: v.matched, pct: pct(v.matched, v.total),
      totalWithHoldings: v.totalWithHoldings, matchedWithHoldings: v.matchedWithHoldings,
      pctWithHoldings: pct(v.matchedWithHoldings, v.totalWithHoldings),
    }))
    .sort((a, b) => a.pct - b.pct);
  const coverageByAmcOut = Array.from(coverageByAmc.entries())
    .map(([k, v]) => ({ amc: k, total: v.total, matched: v.matched, pct: pct(v.matched, v.total) }))
    .sort((a, b) => a.pct - b.pct);

  return {
    autoMatches, overrideMatches, reviewMatches, ambiguous, rejectedRisky, unmatched, invalidOverrides,
    coverageByClassification, coverageByAmc: coverageByAmcOut,
    totalFunds: funds.length,
    fundsWithHoldings: funds.filter((f) => f.file).length,
    matchedWithHoldings,
    autoMatchedWithHoldings,
  };
}
