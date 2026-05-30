/**
 * NAV source-discovery harness (Phase 3.0C: crosswalk repair).
 *
 * READ-ONLY, SAMPLE-SCOPED discovery + repair. Probes AMFI / RupeeVest /
 * MFAPI, then writes a single gitignored report at
 * data/debug/nav-source-discovery-report.json and a smaller review file at
 * data/debug/nav-crosswalk-review.json. No production snapshot is touched.
 *
 * Crosswalk policy (Phase 3.0C):
 *  - Manual overrides from src/data/portfolio-tracker/nav-crosswalk-overrides.json
 *    are applied first; an override that points to an AMFI scheme not in the
 *    current feed is surfaced as a rejected risky entry, never silently dropped.
 *  - Auto-accept ONLY `exact` and `high` confidence tiers. `medium` and `low`
 *    matches are kept in the review list, not the production crosswalk.
 *  - Guards reject (not downgrade) candidates whose digit tokens (e.g. Nifty
 *    50 vs Nifty Next 50) or critical tokens (next/momentum/fof/etc.) differ.
 *  - Ambiguous picks are surfaced as `ambiguous`, never picked silently.
 *
 * Run: npx tsx scripts/ingest/nav-source-discovery.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { parseNavAll } from "./amfi-nav";
import { info, nowIso, warn } from "./utils";
import type { SchemeNav } from "../../src/data/snapshots/types";

const NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt";
const INDEX_PATH = path.resolve(
  process.cwd(),
  "src/data/portfolio-tracker/index.json"
);
const OVERRIDES_PATH = path.resolve(
  process.cwd(),
  "src/data/portfolio-tracker/nav-crosswalk-overrides.json"
);
const REPORT_DIR = path.resolve(process.cwd(), "data/debug");
const REPORT_PATH = path.join(REPORT_DIR, "nav-source-discovery-report.json");
const REVIEW_PATH = path.join(REPORT_DIR, "nav-crosswalk-review.json");

const RULE_VERSION = 3;
const MEDIUM_MIN = 0.85;
const LOW_MIN = 0.7;
const RV_VALIDATION_SAMPLE = 10;
const RV_ENDPOINT_DISCOVERY_SAMPLE = 3;
const MFAPI_SAMPLE = 5;
const POLITE_DELAY_MS = 400;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Shared types
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
interface IndexFile { meta: Record<string, unknown>; funds: IndexFund[] }

type Plan = "direct" | "regular" | "unknown";
type Option = "growth" | "idcw" | "unknown";
type Confidence = "exact" | "high" | "medium" | "low" | "override";

interface NormalizedName {
  plan: Plan;
  option: Option;
  isEtf: boolean;
  isFof: boolean;
  tokens: string[];
  tokenKey: string;
}

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
  matchedBy: string;
  jaccard: number;
}

interface UnmatchedRow {
  schemecode: string;
  fundName: string;
  classification: string | null;
  reason: string;
  bestCandidate?: { amfiSchemeCode: number; amfiSchemeName: string; jaccard: number };
}

interface RejectedRow {
  schemecode: string;
  fundName: string;
  classification: string | null;
  reason: string;
  rejectedCandidate?: { amfiSchemeCode: number; amfiSchemeName: string; jaccard: number };
}

interface OverrideEntry {
  schemecode: string | number;
  fundName?: string;
  amfiSchemeCode?: number;
  isin?: string;
  amfiSchemeName?: string;
  reason?: string;
  manual?: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
}
interface OverridesFile {
  meta?: { version?: number; note?: string; lastUpdated?: string };
  overrides: OverrideEntry[];
}

// ---------------------------------------------------------------------------
// Probe utility (small JSON walker for source-discovery probes)
// ---------------------------------------------------------------------------

interface ProbeResult {
  url: string;
  ok: boolean;
  status: number | null;
  contentType: string | null;
  bytes: number | null;
  jsonParseable: boolean;
  topLevelKeys?: string[];
  fieldHits?: FieldHit[];
  error?: string;
}
interface FieldHit { path: string; sample: string }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function topLevelKeys(v: unknown, limit = 40): string[] {
  if (Array.isArray(v)) {
    const inner = v.length > 0 ? topLevelKeys(v[0], limit) : [];
    return [`[array length=${v.length}]`, ...inner].slice(0, limit);
  }
  if (isRecord(v)) return Object.keys(v).slice(0, limit);
  return [typeof v];
}

const NAV_KEY_RE = /(^|_)nav($|_)|netasset|net_asset|navvalue|latest_nav|nav_date|navdate/i;
const ISIN_KEY_RE = /isin/i;
const AMFI_KEY_RE = /amfi|scheme.?code|schemecode/i;

function scanFields(v: unknown, hits: FieldHit[] = [], prefix = "", depth = 0, maxHits = 16): FieldHit[] {
  if (depth > 4 || hits.length >= maxHits) return hits;
  if (Array.isArray(v)) {
    for (let i = 0; i < Math.min(v.length, 2); i++) scanFields(v[i], hits, `${prefix}[${i}]`, depth + 1, maxHits);
    return hits;
  }
  if (isRecord(v)) {
    for (const [k, val] of Object.entries(v)) {
      if (hits.length >= maxHits) break;
      const here = prefix ? `${prefix}.${k}` : k;
      if (NAV_KEY_RE.test(k) || ISIN_KEY_RE.test(k) || AMFI_KEY_RE.test(k)) {
        const sample = typeof val === "object" && val !== null ? JSON.stringify(val).slice(0, 80) : String(val).slice(0, 80);
        hits.push({ path: here, sample });
      }
      scanFields(val, hits, here, depth + 1, maxHits);
    }
  }
  return hits;
}

async function probe(url: string, timeoutMs = 30_000): Promise<ProbeResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "user-agent": USER_AGENT, accept: "application/json,text/plain,*/*" },
    });
    const contentType = res.headers.get("content-type");
    const text = await res.text();
    let jsonParseable = false;
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); jsonParseable = true; } catch { /* not JSON */ }
    return {
      url, ok: res.ok, status: res.status, contentType, bytes: text.length, jsonParseable,
      topLevelKeys: jsonParseable ? topLevelKeys(parsed) : undefined,
      fieldHits: jsonParseable ? scanFields(parsed) : undefined,
    };
  } catch (e) {
    return { url, ok: false, status: null, contentType: null, bytes: null, jsonParseable: false, error: (e as Error).message };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// AMC aliases (Phase 3.0C: grounded in committed amc-master.json AMC names)
// ---------------------------------------------------------------------------

// Each alias is applied to the LOWERCASED scheme name on BOTH RupeeVest and
// AMFI sides. The goal is to normalize the AMC portion of every scheme name
// to the AMFI canonical spelling (so token sets converge). Aliases are
// regex'd as whole words to avoid mangling unrelated tokens.
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

// Strict tokens — must be present on both sides or neither. They distinguish
// near-identical schemes that fuzzy matching would otherwise collapse.
// (Fund-of-fund vs ETF, momentum-strategy variants, PSU/private theming.)
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
  "long", "short", "ultra", "medium", "dynamic", // duration markers in debt
]);

const NOISE_TOKENS = new Set([
  "fund", "scheme", "mutual", "the", "option", "plan", "direct", "regular",
  "reg", "dir", "growth", "g", "idcw", "dividend", "div", "payout",
  "reinvestment", "reinv", "an", "open", "ended", "of", "and", "to",
  "category", "schemes",
]);

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

function normalize(name: string): NormalizedName {
  let s = name.toLowerCase().trim();
  for (const [re, sub] of AMC_ALIASES) s = s.replace(re, sub);
  const plan = detectPlan(s);
  const option = detectOption(s);
  const isEtf = detectEtf(s);
  const isFof = detectFof(s);
  const isIndexFund = detectIndexFund(s);
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/[-_/.,&'"]+/g, " ");
  s = s.replace(/[^a-z0-9 ]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  const raw = s.split(" ").filter((t) => t && !NOISE_TOKENS.has(t));
  // Inject typed markers so they survive noise filtering and participate in
  // both tokenKey equality AND guard checks.
  if (isFof) raw.push("fof");
  if (isEtf && !raw.includes("etf")) raw.push("etf");
  if (isIndexFund && !raw.includes("indexfund")) raw.push("indexfund");
  raw.sort();
  const uniq: string[] = [];
  for (const t of raw) if (uniq[uniq.length - 1] !== t) uniq.push(t);
  return { plan, option, isEtf, isFof, tokens: uniq, tokenKey: uniq.join(" ") };
}

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
  // ETFs/FoFs carry plan=unknown legitimately on both sides; tolerate that.
  if (a.isEtf || b.isEtf || a.isFof || b.isFof) {
    return a.plan === b.plan || a.plan === "unknown" || b.plan === "unknown";
  }
  if (a.plan !== "unknown" && b.plan !== "unknown" && a.plan !== b.plan) return false;
  if (a.option !== "unknown" && b.option !== "unknown" && a.option !== b.option) return false;
  return true;
}

/** Returns { ok: true } if the pair clears the false-positive guards; else
 *  returns the reason. Guards REJECT (the candidate is not picked); they do
 *  not downgrade tier. False positives are worse than unmatched funds. */
function passesGuards(rv: NormalizedName, am: NormalizedName): { ok: boolean; reason?: string } {
  // Guard A: digit-token sets must be identical (catches Nifty 50 vs Nifty
  // Next 50, Nifty 100 vs Nifty 500, etc.).
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
  // Guard C: ETF must match ETF; FoF must match FoF; index fund must match
  // index fund. Captured via isEtf/isFof flags as a belt-and-braces check on
  // top of the "etf"/"fof"/"indexfund" tokens.
  if (rv.isEtf !== am.isEtf) return { ok: false, reason: "ETF flag mismatch" };
  if (rv.isFof !== am.isFof) return { ok: false, reason: "FoF flag mismatch" };
  return { ok: true };
}

interface AmfiIndexed { nav: SchemeNav; norm: NormalizedName }

type MatchOutcome =
  | { kind: "match"; amfi: AmfiIndexed; confidence: Exclude<Confidence, "override">; jaccard: number; matchedBy: string }
  | { kind: "ambiguous"; amfi: AmfiIndexed; jaccard: number; reason: string }
  | { kind: "rejected"; amfi: AmfiIndexed; jaccard: number; reason: string }
  | { kind: "none" };

function findBestMatch(rv: NormalizedName, amfi: AmfiIndexed[]): MatchOutcome {
  // Pass 1: exact tokenKey + plan/option compatible.
  const exactKey = amfi.filter(
    (a) => a.norm.tokenKey === rv.tokenKey && planOptionCompatible(a.norm, rv)
  );
  // Exact-tokenKey candidates have identical token sets, so digit/critical
  // guards always pass; only ETF/FoF flags could still disagree. Filter.
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

  // Pass 2: fuzzy. Score every plan/option-compatible candidate. Apply
  // guards before considering for the best slot — guard failures go to a
  // "rejected" slot so we can surface them even if we end up unmatched.
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

async function loadOverrides(): Promise<{ map: Map<string, OverrideEntry>; meta: OverridesFile["meta"] | undefined; size: number }> {
  try {
    const text = await fs.readFile(OVERRIDES_PATH, "utf8");
    const data = JSON.parse(text) as OverridesFile;
    const map = new Map<string, OverrideEntry>();
    for (const o of data.overrides ?? []) map.set(String(o.schemecode), o);
    return { map, meta: data.meta, size: map.size };
  } catch {
    return { map: new Map(), meta: undefined, size: 0 };
  }
}

function applyOverride(
  fund: IndexFund,
  override: OverrideEntry,
  amfi: AmfiIndexed[]
): { kind: "match"; match: MatchRow } | { kind: "rejected"; row: RejectedRow } | { kind: "invalid"; row: RejectedRow } {
  const fundName = fund.fundName ?? fund.name;
  const schemecode = String(fund.schemecode);
  if (!override.amfiSchemeCode && !override.isin) {
    return {
      kind: "invalid",
      row: { schemecode, fundName, classification: fund.classification, reason: "override missing both amfiSchemeCode and isin" },
    };
  }
  const target = amfi.find(
    (a) =>
      (override.amfiSchemeCode !== undefined && a.nav.schemeCode === override.amfiSchemeCode) ||
      (override.isin !== undefined && a.nav.isin === override.isin)
  );
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
// Probe 1: AMFI + crosswalk (full universe)
// ---------------------------------------------------------------------------

interface AmfiProbeSummary {
  totalFunds: number;
  fundsWithHoldings: number;
  autoMatched: number;
  overrideMatched: number;
  totalMatched: number;
  reviewMatches: { medium: number; low: number };
  ambiguous: number;
  rejectedRisky: number;
  unmatched: number;
  invalidOverrides: number;
  matchRateOverallPct: number;
  matchRateWithHoldingsPct: number;
  autoOnlyMatchRateWithHoldingsPct: number;
}

interface AmfiProbeResult {
  reachable: boolean;
  error?: string;
  feedDate?: string;
  navRowsFromFeed?: number;
  overridesLoaded?: number;
  summary?: AmfiProbeSummary;
  coverageByClassification?: unknown[];
  coverageByAmc?: unknown[];
  autoMatchesSample?: MatchRow[];
  overrideMatches?: MatchRow[];
  reviewMatches?: MatchRow[];
  ambiguous?: UnmatchedRow[];
  rejectedRisky?: RejectedRow[];
  unmatched?: UnmatchedRow[];
  _autoMatches?: MatchRow[]; // internal, stripped before serialization
}

function pct(matched: number, total: number): number {
  return total === 0 ? 0 : Math.round((matched / total) * 10000) / 100;
}

function amcPrefix(fundName: string): string {
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

async function runAmfiProbe(funds: IndexFund[], overrides: Map<string, OverrideEntry>): Promise<AmfiProbeResult> {
  info(`[amfi] fetching ${NAV_URL}`);
  let text: string;
  try {
    const r = await probe(NAV_URL, 60_000);
    if (!r.ok || r.bytes === null || r.bytes < 1000) {
      return { reachable: false, error: r.error ?? `HTTP ${r.status ?? "?"} (bytes=${r.bytes ?? 0})` };
    }
    const res = await fetch(NAV_URL, { headers: { "user-agent": USER_AGENT } });
    if (!res.ok) return { reachable: false, error: `HTTP ${res.status}` };
    text = await res.text();
  } catch (e) {
    return { reachable: false, error: (e as Error).message };
  }

  const navs = parseNavAll(text);
  info(`[amfi] parsed ${navs.length} scheme NAV rows`);
  if (navs.length === 0) return { reachable: true, navRowsFromFeed: 0, error: "zero schemes parsed" };

  const dateCounts = new Map<string, number>();
  for (const n of navs) dateCounts.set(n.date, (dateCounts.get(n.date) ?? 0) + 1);
  const feedDate = Array.from(dateCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];

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
        // medium / low — NOT auto-accepted; surfaced for review.
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

  // Move invalid overrides into rejectedRisky for visibility too (with type tag).
  for (const inv of invalidOverrides) rejectedRisky.push(inv);

  const totalFunds = funds.length;
  const fundsWithHoldings = funds.filter((f) => f.file).length;
  const totalMatched = autoMatches.length + overrideMatches.length;
  const coverageByClassificationOut = Array.from(coverageByClass.entries())
    .map(([k, v]) => ({
      classification: k, total: v.total, matched: v.matched, pct: pct(v.matched, v.total),
      totalWithHoldings: v.totalWithHoldings, matchedWithHoldings: v.matchedWithHoldings,
      pctWithHoldings: pct(v.matchedWithHoldings, v.totalWithHoldings),
    }))
    .sort((a, b) => a.pct - b.pct);
  const coverageByAmcOut = Array.from(coverageByAmc.entries())
    .map(([k, v]) => ({ amc: k, total: v.total, matched: v.matched, pct: pct(v.matched, v.total) }))
    .sort((a, b) => a.pct - b.pct);

  const summary: AmfiProbeSummary = {
    totalFunds, fundsWithHoldings,
    autoMatched: autoMatches.length,
    overrideMatched: overrideMatches.length,
    totalMatched,
    reviewMatches: {
      medium: reviewMatches.filter((m) => m.confidence === "medium").length,
      low: reviewMatches.filter((m) => m.confidence === "low").length,
    },
    ambiguous: ambiguous.length,
    rejectedRisky: rejectedRisky.length,
    unmatched: unmatched.length,
    invalidOverrides: invalidOverrides.length,
    matchRateOverallPct: pct(totalMatched, totalFunds),
    matchRateWithHoldingsPct: pct(matchedWithHoldings, fundsWithHoldings),
    autoOnlyMatchRateWithHoldingsPct: pct(autoMatchedWithHoldings, fundsWithHoldings),
  };

  return {
    reachable: true,
    feedDate, navRowsFromFeed: navs.length,
    overridesLoaded: overrides.size,
    summary, coverageByClassification: coverageByClassificationOut, coverageByAmc: coverageByAmcOut,
    autoMatchesSample: autoMatches.slice(0, 50),
    overrideMatches, reviewMatches, ambiguous, rejectedRisky, unmatched,
    _autoMatches: autoMatches,
  };
}

// ---------------------------------------------------------------------------
// Probe 2: RupeeVest (sample-only, by our native schemecode)
// ---------------------------------------------------------------------------

const RV_BASE = "https://www.rupeevest.com/home";
interface RvCandidate { name: string; confirmed: boolean; build: (code: string) => string }
const RV_CANDIDATES: RvCandidate[] = [
  { name: "get_mf_portfolio_tracker (CONFIRMED holdings endpoint)", confirmed: true, build: (c) => `${RV_BASE}/get_mf_portfolio_tracker?schemecode=${c}` },
  { name: "get_mf_nav (candidate)", confirmed: false, build: (c) => `${RV_BASE}/get_mf_nav?schemecode=${c}` },
  { name: "get_nav_details (candidate)", confirmed: false, build: (c) => `${RV_BASE}/get_nav_details?schemecode=${c}` },
  { name: "get_mf_returns (candidate)", confirmed: false, build: (c) => `${RV_BASE}/get_mf_returns?schemecode=${c}` },
  { name: "get_scheme_details (candidate)", confirmed: false, build: (c) => `${RV_BASE}/get_scheme_details?schemecode=${c}` },
  { name: "get_mf_nav_history (candidate)", confirmed: false, build: (c) => `${RV_BASE}/get_mf_nav_history?schemecode=${c}` },
];

interface RvProbeResult {
  note: string;
  endpointDiscovery: Array<{ schemecode: string; candidate: string; confirmed: boolean; result: ProbeResult }>;
  workingNavEndpoints: string[];
  exposesNav: boolean;
  exposesHistory: boolean;
  exposesIsinOrAmfi: boolean;
  avoidsCrosswalk: boolean;
  verdict: string;
}

async function runRupeeVestProbe(funds: IndexFund[]): Promise<RvProbeResult> {
  const withHoldings = funds.filter((f) => f.file);
  const discoverySet = withHoldings.slice(0, RV_ENDPOINT_DISCOVERY_SAMPLE);
  const endpointDiscovery: RvProbeResult["endpointDiscovery"] = [];
  const workingNavEndpoints = new Set<string>();
  let exposesNav = false;
  let exposesHistory = false;
  let exposesIsinOrAmfi = false;

  info(`[rupeevest] endpoint discovery on ${discoverySet.length} schemecodes × ${RV_CANDIDATES.length} candidates`);
  for (const f of discoverySet) {
    const code = String(f.schemecode);
    for (const cand of RV_CANDIDATES) {
      const url = cand.build(code);
      const result = await probe(url, 30_000);
      endpointDiscovery.push({ schemecode: code, candidate: cand.name, confirmed: cand.confirmed, result });
      if (result.ok && result.jsonParseable) {
        const hits = result.fieldHits ?? [];
        const navHit = hits.some((h) => NAV_KEY_RE.test(h.path));
        const isinHit = hits.some((h) => ISIN_KEY_RE.test(h.path) || AMFI_KEY_RE.test(h.path));
        if (navHit) { exposesNav = true; workingNavEndpoints.add(cand.name); }
        if (isinHit) exposesIsinOrAmfi = true;
        if (hits.some((h) => /hist/i.test(h.path))) exposesHistory = true;
      }
      await sleep(POLITE_DELAY_MS);
    }
  }

  const firstWorking = RV_CANDIDATES.find((c) => workingNavEndpoints.has(c.name));
  if (firstWorking) {
    const validationSet = withHoldings.slice(0, RV_VALIDATION_SAMPLE);
    info(`[rupeevest] validating "${firstWorking.name}" across ${validationSet.length} schemecodes`);
    for (const f of validationSet) {
      const code = String(f.schemecode);
      const result = await probe(firstWorking.build(code), 30_000);
      endpointDiscovery.push({ schemecode: code, candidate: `${firstWorking.name} [validation]`, confirmed: false, result });
      if (result.ok && result.jsonParseable) {
        const hits = result.fieldHits ?? [];
        if (hits.some((h) => /hist/i.test(h.path))) exposesHistory = true;
        if (hits.some((h) => ISIN_KEY_RE.test(h.path) || AMFI_KEY_RE.test(h.path))) exposesIsinOrAmfi = true;
      }
      await sleep(POLITE_DELAY_MS);
    }
  }

  const avoidsCrosswalk = exposesNav;
  const verdict = exposesNav
    ? `RupeeVest exposes NAV by our native schemecode via "${[...workingNavEndpoints].join(", ")}" — this can AVOID the AMFI crosswalk.${exposesHistory ? " History fields detected." : " No obvious history fields detected (may need a separate endpoint)."}`
    : "No candidate RupeeVest NAV endpoint returned NAV-bearing JSON. Only the holdings endpoint is confirmed; RupeeVest-by-schemecode NAV is NOT established by this probe. Crosswalk path (AMFI/MFAPI) remains necessary unless a real RupeeVest NAV endpoint is identified.";

  return {
    note: "Sample-only RupeeVest probe. Only get_mf_portfolio_tracker is a confirmed endpoint; others are unverified candidates whose actual HTTP responses are recorded here, not assumed.",
    endpointDiscovery, workingNavEndpoints: [...workingNavEndpoints],
    exposesNav, exposesHistory, exposesIsinOrAmfi, avoidsCrosswalk, verdict,
  };
}

// ---------------------------------------------------------------------------
// Probe 3: MFAPI (sample-only, by AMFI scheme code)
// ---------------------------------------------------------------------------

const MFAPI_BASE = "https://api.mfapi.in/mf";
interface MfapiProbeResult {
  note: string;
  skipped?: string;
  latest: Array<{ schemecode: string; amfiSchemeCode: number; mfapiLatestNav: number | null; mfapiDate: string | null; amfiNav: number; navDiffAbs: number | null; withinTolerance: boolean | null; status: number | null }>;
  history: Array<{ schemecode: string; amfiSchemeCode: number; points: number | null; firstDate: string | null; lastDate: string | null; status: number | null }>;
  historyAvailable: boolean;
  matchesAmfiLatest: boolean | null;
  verdict: string;
}

function extractNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}

async function runMfapiProbe(matches: MatchRow[] | undefined): Promise<MfapiProbeResult> {
  const base: MfapiProbeResult = {
    note: "Sample-only MFAPI probe (api.mfapi.in), keyed by AMFI scheme code from the AMFI crosswalk.",
    latest: [], history: [], historyAvailable: false, matchesAmfiLatest: null, verdict: "",
  };
  const highConf = (matches ?? []).filter((m) => m.confidence === "exact" || m.confidence === "high").slice(0, MFAPI_SAMPLE);
  if (highConf.length === 0) {
    return { ...base, skipped: "No high-confidence AMFI matches available (AMFI probe unreachable or zero matches); cannot key MFAPI by AMFI scheme code.", verdict: "Skipped — depends on AMFI crosswalk." };
  }
  info(`[mfapi] latest cross-check on ${highConf.length} AMFI codes`);
  let within = 0; let comparable = 0;
  for (const m of highConf) {
    const r = await probe(`${MFAPI_BASE}/${m.amfiSchemeCode}/latest`, 30_000);
    let mfapiNav: number | null = null;
    let mfapiDate: string | null = null;
    if (r.ok && r.jsonParseable) {
      const hits = scanFields(r);
      const navHit = hits.find((h) => /(^|\.)nav$/i.test(h.path) || /\.nav$/i.test(h.path));
      const dateHit = hits.find((h) => /date/i.test(h.path));
      mfapiNav = navHit ? extractNumber(navHit.sample.replace(/"/g, "")) : null;
      mfapiDate = dateHit ? dateHit.sample.replace(/"/g, "") : null;
    }
    const navDiffAbs = mfapiNav !== null ? Math.abs(mfapiNav - m.nav) : null;
    const withinTolerance = navDiffAbs !== null ? navDiffAbs <= Math.max(0.01, m.nav * 0.005) : null;
    if (withinTolerance !== null) { comparable += 1; if (withinTolerance) within += 1; }
    base.latest.push({
      schemecode: m.schemecode, amfiSchemeCode: m.amfiSchemeCode,
      mfapiLatestNav: mfapiNav, mfapiDate, amfiNav: m.nav, navDiffAbs, withinTolerance, status: r.status,
    });
    await sleep(POLITE_DELAY_MS);
  }
  info(`[mfapi] history check on ${Math.min(2, highConf.length)} AMFI codes`);
  for (const m of highConf.slice(0, 2)) {
    const r = await probe(`${MFAPI_BASE}/${m.amfiSchemeCode}`, 45_000);
    let points: number | null = null; let firstDate: string | null = null; let lastDate: string | null = null;
    if (r.ok && r.jsonParseable) {
      try {
        const res = await fetch(`${MFAPI_BASE}/${m.amfiSchemeCode}`, { headers: { "user-agent": USER_AGENT } });
        const j = (await res.json()) as { data?: Array<{ date?: string; nav?: string }> };
        const data = Array.isArray(j.data) ? j.data : [];
        points = data.length;
        if (data.length > 0) { lastDate = data[0]?.date ?? null; firstDate = data[data.length - 1]?.date ?? null; }
      } catch { /* leave nulls */ }
    }
    if ((points ?? 0) > 0) base.historyAvailable = true;
    base.history.push({ schemecode: m.schemecode, amfiSchemeCode: m.amfiSchemeCode, points, firstDate, lastDate, status: r.status });
    await sleep(POLITE_DELAY_MS);
  }
  const matchesAmfiLatest = comparable > 0 ? within === comparable : null;
  const verdict = base.historyAvailable
    ? `MFAPI serves historical NAV by AMFI scheme code (sample confirmed). Latest NAV cross-check vs AMFI: ${comparable > 0 ? `${within}/${comparable} within tolerance` : "not comparable"}. Suitable as the historical-NAV fallback once the crosswalk is reliable.`
    : `MFAPI did not return usable history in this sample (status/availability recorded). Latest cross-check: ${comparable > 0 ? `${within}/${comparable} within tolerance` : "not comparable"}.`;
  return { ...base, matchesAmfiLatest, verdict };
}

// ---------------------------------------------------------------------------
// Recommendation + summary
// ---------------------------------------------------------------------------

function buildRecommendation(
  amfi: AmfiProbeResult, rv: RvProbeResult | { error: string }, mf: MfapiProbeResult | { error: string }
): string {
  const parts: string[] = [];
  if (amfi.reachable && amfi.summary) {
    const r = amfi.summary.matchRateWithHoldingsPct;
    const aor = amfi.summary.autoOnlyMatchRateWithHoldingsPct;
    parts.push(
      r >= 95
        ? `AMFI reachable; total match-rate (auto+override) for funds-with-holdings = ${r}% (auto-only ${aor}%; ≥95% → AMFI viable as primary).`
        : `AMFI reachable; total match-rate (auto+override) for funds-with-holdings = ${r}% (auto-only ${aor}%; <95% → keep filling overrides / improving normalization before AMFI is primary).`
    );
  } else {
    parts.push(`AMFI NOT reachable from this runner (${amfi.error ?? "unknown"}). Re-evaluate primary source.`);
  }
  if ("avoidsCrosswalk" in rv) parts.push(rv.avoidsCrosswalk ? "RupeeVest serves NAV by native schemecode → crosswalk-free path available." : "RupeeVest NAV-by-schemecode NOT established.");
  else parts.push(`RupeeVest probe errored (${rv.error}).`);
  if ("historyAvailable" in mf) parts.push(mf.historyAvailable ? "MFAPI confirmed for historical NAV fallback." : (mf.skipped ?? "MFAPI history not confirmed in sample."));
  else parts.push(`MFAPI probe errored (${mf.error}).`);
  return parts.join(" ");
}

function printSummary(amfi: AmfiProbeResult, rv: RvProbeResult | { error: string }, mf: MfapiProbeResult | { error: string }, overridesLoaded: number): void {
  info("================= NAV SOURCE DISCOVERY SUMMARY =================");
  info(`Overrides loaded: ${overridesLoaded}`);
  if (amfi.reachable && amfi.summary) {
    const s = amfi.summary;
    info(`AMFI: reachable · feedDate=${amfi.feedDate ?? "?"} · navRows=${amfi.navRowsFromFeed}`);
    info(`  auto-matched (exact+high):       ${s.autoMatched}`);
    info(`  override-matched:                ${s.overrideMatched}`);
    info(`  TOTAL matched (auto+override):   ${s.totalMatched} / ${s.totalFunds} = ${s.matchRateOverallPct}%`);
    info(`  match-rate funds-with-holdings:  ${s.matchRateWithHoldingsPct}%  (auto-only ${s.autoOnlyMatchRateWithHoldingsPct}%)`);
    info(`  review (medium/low, NOT auto):   medium=${s.reviewMatches.medium} low=${s.reviewMatches.low}`);
    info(`  ambiguous:                       ${s.ambiguous}`);
    info(`  rejected-risky (incl. invalid overrides=${s.invalidOverrides}): ${s.rejectedRisky}`);
    info(`  unmatched:                       ${s.unmatched}`);
    const worst = (amfi.coverageByClassification ?? []).slice(0, 5) as Array<{ classification: string; matchedWithHoldings: number; totalWithHoldings: number; pctWithHoldings: number }>;
    info("  worst-5 classifications by w/holdings coverage:");
    for (const c of worst) info(`    ${c.classification}: ${c.matchedWithHoldings}/${c.totalWithHoldings} (${c.pctWithHoldings}%)`);
  } else {
    info(`AMFI: NOT reachable — ${amfi.error ?? "unknown"}`);
  }
  if ("verdict" in rv) info(`RupeeVest: ${rv.verdict}`);
  else info(`RupeeVest: ERROR ${rv.error}`);
  if ("verdict" in mf) info(`MFAPI: ${mf.skipped ?? mf.verdict}`);
  else info(`MFAPI: ERROR ${mf.error}`);
  info("===============================================================");
  info(`Full report:  ${path.relative(process.cwd(), REPORT_PATH)}`);
  info(`Review file:  ${path.relative(process.cwd(), REVIEW_PATH)}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  info(`reading ${INDEX_PATH}`);
  const indexFile = JSON.parse(await fs.readFile(INDEX_PATH, "utf8")) as IndexFile;
  const totalFunds = indexFile.funds.length;
  const fundsWithHoldings = indexFile.funds.filter((f) => f.file).length;
  info(`index: ${totalFunds} funds (${fundsWithHoldings} with holdings)`);

  const overrides = await loadOverrides();
  info(`overrides: ${overrides.size} loaded from ${path.relative(process.cwd(), OVERRIDES_PATH)}`);

  let amfi: AmfiProbeResult = { reachable: false, error: "probe not run" };
  let rupeevest: RvProbeResult | { error: string };
  let mfapi: MfapiProbeResult | { error: string };

  try { amfi = await runAmfiProbe(indexFile.funds, overrides.map); }
  catch (e) { amfi = { reachable: false, error: (e as Error).message }; }
  try { rupeevest = await runRupeeVestProbe(indexFile.funds); }
  catch (e) { rupeevest = { error: (e as Error).message }; }
  try { mfapi = await runMfapiProbe(amfi._autoMatches); }
  catch (e) { mfapi = { error: (e as Error).message }; }

  const amfiOut = { ...amfi };
  delete amfiOut._autoMatches;

  const report = {
    meta: {
      generatedAt: nowIso(),
      dryRun: true,
      ruleVersion: RULE_VERSION,
      indexPath: "src/data/portfolio-tracker/index.json",
      overridesPath: "src/data/portfolio-tracker/nav-crosswalk-overrides.json",
      thresholds: { MEDIUM_MIN, LOW_MIN },
      samples: { RV_ENDPOINT_DISCOVERY_SAMPLE, RV_VALIDATION_SAMPLE, MFAPI_SAMPLE },
      autoAcceptPolicy: "Auto-accept ONLY exact+high tiers. Medium/low go to review.",
      note: "Read-only NAV source discovery + crosswalk repair. Not a production snapshot. Not wired to dashboard or ingest orchestrator. Sample-scoped for RupeeVest/MFAPI.",
    },
    recommendation: buildRecommendation(amfi, rupeevest, mfapi),
    amfi: amfiOut,
    rupeevest,
    mfapi,
  };

  // Smaller human-actionable review file: just what a reviewer needs to fill
  // overrides / fix names. No coverage breakdowns, no probe-3 detail.
  const review = {
    meta: {
      generatedAt: nowIso(),
      ruleVersion: RULE_VERSION,
      summary: amfi.summary,
      note: "Items requiring human review before they can become production crosswalk entries. Use these to fill src/data/portfolio-tracker/nav-crosswalk-overrides.json.",
    },
    reviewMatches: amfi.reviewMatches ?? [],
    ambiguous: amfi.ambiguous ?? [],
    rejectedRisky: amfi.rejectedRisky ?? [],
    unmatched: amfi.unmatched ?? [],
  };

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  await fs.writeFile(REVIEW_PATH, JSON.stringify(review, null, 2) + "\n", "utf8");
  info(`wrote ${path.relative(process.cwd(), REPORT_PATH)}`);
  info(`wrote ${path.relative(process.cwd(), REVIEW_PATH)}`);

  printSummary(amfi, rupeevest, mfapi, overrides.size);
}

main().catch((e) => {
  warn(`discovery harness failed: ${(e as Error).message}`);
  process.exit(1);
});
