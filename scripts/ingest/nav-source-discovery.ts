/**
 * NAV source-discovery harness (Phase 3.0B → 3.0C bridge).
 *
 * READ-ONLY, SAMPLE-SCOPED discovery. Tests which NAV source gives us the
 * cleanest path to latest + historical NAV for our RupeeVest-keyed fund
 * universe, BEFORE any production ingestion, snapshot, workflow schedule,
 * or Trends UI is built.
 *
 * Probes (each independent; a failure in one never aborts the others):
 *   1. AMFI    — fetch NAVAll.txt, run the full RupeeVest→AMFI crosswalk,
 *                report match-rate (overall, with-holdings, by class, by AMC),
 *                unmatched + low-confidence lists.
 *   2. RupeeVest — for a small sample of our schemecodes, probe candidate
 *                NAV endpoints (only the holdings endpoint is confirmed) and
 *                report whether NAV / history / ISIN / AMFI-code are exposed
 *                by our native schemecode (which would avoid the crosswalk).
 *   3. MFAPI   — for a few high-confidence AMFI matches, confirm historical
 *                NAV by AMFI scheme code and cross-check latest NAV vs AMFI.
 *
 * Output: ONE gitignored report at data/debug/nav-source-discovery-report.json
 * plus a concise stdout summary. Writes NOTHING to src/data/** or public/**.
 * Not wired into the ingest orchestrator. Intended to run from the temporary
 * .github/workflows/nav-source-discovery.yml (workflow_dispatch) and upload
 * the report as an artifact.
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
const REPORT_DIR = path.resolve(process.cwd(), "data/debug");
const REPORT_PATH = path.join(REPORT_DIR, "nav-source-discovery-report.json");

const RULE_VERSION = 2;
const MEDIUM_MIN = 0.85;
const LOW_MIN = 0.7;

// Sample sizes for the sample-only (non-AMFI) probes. Kept small + polite —
// discovery, not ingestion.
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
interface IndexFile {
  meta: Record<string, unknown>;
  funds: IndexFund[];
}

type Plan = "direct" | "regular" | "unknown";
type Option = "growth" | "idcw" | "unknown";
type Confidence = "exact" | "high" | "medium" | "low";

interface NormalizedName {
  plan: Plan;
  option: Option;
  isEtf: boolean;
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

// ---------------------------------------------------------------------------
// Small fetch/JSON utilities (permissive — capture status, never throw)
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
interface FieldHit {
  path: string;
  sample: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

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

/** Walk a JSON value (bounded depth/breadth) collecting keys that look like
 *  NAV / ISIN / AMFI-code fields, with a short sample of each value. */
function scanFields(
  v: unknown,
  hits: FieldHit[] = [],
  pathPrefix = "",
  depth = 0,
  maxHits = 16
): FieldHit[] {
  if (depth > 4 || hits.length >= maxHits) return hits;
  if (Array.isArray(v)) {
    for (let i = 0; i < Math.min(v.length, 2); i++) {
      scanFields(v[i], hits, `${pathPrefix}[${i}]`, depth + 1, maxHits);
    }
    return hits;
  }
  if (isRecord(v)) {
    for (const [k, val] of Object.entries(v)) {
      if (hits.length >= maxHits) break;
      const here = pathPrefix ? `${pathPrefix}.${k}` : k;
      if (NAV_KEY_RE.test(k) || ISIN_KEY_RE.test(k) || AMFI_KEY_RE.test(k)) {
        const sample =
          typeof val === "object" && val !== null
            ? JSON.stringify(val).slice(0, 80)
            : String(val).slice(0, 80);
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
    try {
      parsed = JSON.parse(text);
      jsonParseable = true;
    } catch {
      /* not JSON */
    }
    return {
      url,
      ok: res.ok,
      status: res.status,
      contentType,
      bytes: text.length,
      jsonParseable,
      topLevelKeys: jsonParseable ? topLevelKeys(parsed) : undefined,
      fieldHits: jsonParseable ? scanFields(parsed) : undefined,
    };
  } catch (e) {
    return {
      url,
      ok: false,
      status: null,
      contentType: null,
      bytes: null,
      jsonParseable: false,
      error: (e as Error).message,
    };
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Name normalizer + matcher (carried over from the AMFI crosswalk)
// ---------------------------------------------------------------------------

const AMC_ALIASES: Array<[RegExp, string]> = [
  [/\bicici pru\b/g, "icici prudential"],
  [/\baditya birla sl\b/g, "aditya birla sun life"],
  [/\babsl\b/g, "aditya birla sun life"],
  [/\bdsp blackrock\b/g, "dsp"],
  [/\bl&t\b/g, "lnt"],
  [/\bhdfc amc\b/g, "hdfc"],
  [/\bsbi mf\b/g, "sbi"],
];

const NOISE_TOKENS = new Set([
  "fund", "scheme", "mutual", "the", "option", "plan", "direct", "regular",
  "reg", "dir", "growth", "g", "idcw", "dividend", "div", "payout",
  "reinvestment", "reinv", "an", "open", "ended", "of", "and",
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
function detectEtf(lower: string): boolean {
  return /\b(etf|exchange traded|fof|index fund)\b/.test(lower);
}

function normalize(name: string): NormalizedName {
  let s = name.toLowerCase().trim();
  for (const [re, sub] of AMC_ALIASES) s = s.replace(re, sub);
  const plan = detectPlan(s);
  const option = detectOption(s);
  const isEtf = detectEtf(s);
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/[-_/.,&'"]+/g, " ");
  s = s.replace(/[^a-z0-9 ]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  const tokens = s.split(" ").filter((t) => t && !NOISE_TOKENS.has(t)).sort();
  const uniq: string[] = [];
  for (const t of tokens) if (uniq[uniq.length - 1] !== t) uniq.push(t);
  return { plan, option, isEtf, tokens: uniq, tokenKey: uniq.join(" ") };
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
  if (a.isEtf || b.isEtf) {
    return a.plan === b.plan || a.plan === "unknown" || b.plan === "unknown";
  }
  if (a.plan !== "unknown" && b.plan !== "unknown" && a.plan !== b.plan) return false;
  if (a.option !== "unknown" && b.option !== "unknown" && a.option !== b.option) return false;
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

function findBestMatch(rv: NormalizedName, amfi: AmfiIndexed[]): BestMatch | null {
  const exactKey = amfi.filter(
    (a) => a.norm.tokenKey === rv.tokenKey && planOptionCompatible(a.norm, rv)
  );
  if (exactKey.length === 1) {
    return { amfi: exactKey[0], confidence: "exact", jaccard: 1, matchedBy: "exact tokens + plan + option", ambiguous: false };
  }
  if (exactKey.length > 1) {
    const tighter = exactKey.filter(
      (a) => a.norm.plan === rv.plan && a.norm.option === rv.option && a.norm.plan !== "unknown" && a.norm.option !== "unknown"
    );
    if (tighter.length === 1) {
      return { amfi: tighter[0], confidence: "exact", jaccard: 1, matchedBy: "exact tokens + strict plan + strict option", ambiguous: false };
    }
    return { amfi: exactKey[0], confidence: "low", jaccard: 1, matchedBy: `ambiguous: ${exactKey.length} AMFI schemes share this normalized name`, ambiguous: true };
  }
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

function pct(matched: number, total: number): number {
  return total === 0 ? 0 : Math.round((matched / total) * 10000) / 100;
}

function amcPrefix(fundName: string): string {
  const cleaned = fundName.toLowerCase().replace(/[-_/.,&'"]+/g, " ").trim();
  const parts = cleaned.split(/\s+/);
  const first = parts[0] ?? "unknown";
  const second = parts[1] ?? "";
  const compound = `${first} ${second}`;
  const knownCompounds = [
    "aditya birla", "nippon india", "icici pru", "icici prudential",
    "franklin india", "edelweiss mf", "sundaram mf", "white oak",
    "old bridge", "bandhan mutual", "navi mutual", "tata mutual",
    "kotak mahindra", "lic mf", "dsp blackrock",
  ];
  return knownCompounds.includes(compound) ? compound : first;
}

// ---------------------------------------------------------------------------
// Probe 1: AMFI crosswalk (full universe)
// ---------------------------------------------------------------------------

interface AmfiProbeResult {
  reachable: boolean;
  error?: string;
  feedDate?: string;
  navRowsFromFeed?: number;
  summary?: {
    totalFunds: number;
    fundsWithHoldings: number;
    matched: number;
    unmatched: number;
    matchRateOverallPct: number;
    matchRateWithHoldingsPct: number;
    byTier: Record<Confidence, number>;
    lowConfidenceCount: number;
  };
  coverageByClassification?: unknown[];
  coverageByAmc?: unknown[];
  matchesSample?: MatchRow[];
  lowConfidence?: MatchRow[];
  unmatched?: UnmatchedRow[];
  // retained for downstream MFAPI probe (not all serialized verbosely)
  _matches?: MatchRow[];
}

async function runAmfiProbe(funds: IndexFund[]): Promise<AmfiProbeResult> {
  info(`[amfi] fetching ${NAV_URL}`);
  let text: string;
  try {
    const r = await probe(NAV_URL, 60_000);
    if (!r.ok || r.bytes === null || r.bytes < 1000) {
      return { reachable: false, error: r.error ?? `HTTP ${r.status ?? "?"} (bytes=${r.bytes ?? 0})` };
    }
    // probe() already consumed the body for status; refetch text directly.
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

  const matches: MatchRow[] = [];
  const unmatched: UnmatchedRow[] = [];
  const coverageByClass = new Map<string, { total: number; matched: number; totalWithHoldings: number; matchedWithHoldings: number }>();
  const coverageByAmc = new Map<string, { total: number; matched: number }>();
  const tierCounts: Record<Confidence, number> = { exact: 0, high: 0, medium: 0, low: 0 };
  let matchedWithHoldings = 0;

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

    const rv = normalize(fundName);
    const best = findBestMatch(rv, amfiIndexed);

    if (!best || best.ambiguous) {
      let bestCandidate: UnmatchedRow["bestCandidate"];
      if (best?.amfi) {
        bestCandidate = { amfiSchemeCode: best.amfi.nav.schemeCode, amfiSchemeName: best.amfi.nav.schemeName, jaccard: best.jaccard };
      } else {
        let bj = 0;
        let bc: AmfiIndexed | null = null;
        for (const a of amfiIndexed) {
          if (!planOptionCompatible(a.norm, rv)) continue;
          const j = jaccard(a.norm.tokens, rv.tokens);
          if (j > bj) { bj = j; bc = a; }
        }
        if (bc) bestCandidate = { amfiSchemeCode: bc.nav.schemeCode, amfiSchemeName: bc.nav.schemeName, jaccard: bj };
      }
      unmatched.push({
        schemecode, fundName, classification,
        reason: !best
          ? rv.tokens.length === 0 ? "rupeevest name normalized to empty token set" : "no AMFI candidate above Jaccard 0.70 in same plan+option"
          : best.matchedBy,
        bestCandidate,
      });
      continue;
    }

    matches.push({
      schemecode, fundName, classification,
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
    clsB.matched += 1;
    if (hasHoldings) { clsB.matchedWithHoldings += 1; matchedWithHoldings += 1; }
    amcB.matched += 1;
  }

  const totalFunds = funds.length;
  const fundsWithHoldings = funds.filter((f) => f.file).length;
  const coverageByClassification = Array.from(coverageByClass.entries())
    .map(([k, v]) => ({
      classification: k, total: v.total, matched: v.matched, pct: pct(v.matched, v.total),
      totalWithHoldings: v.totalWithHoldings, matchedWithHoldings: v.matchedWithHoldings, pctWithHoldings: pct(v.matchedWithHoldings, v.totalWithHoldings),
    }))
    .sort((a, b) => a.pct - b.pct);
  const coverageByAmcOut = Array.from(coverageByAmc.entries())
    .map(([k, v]) => ({ amc: k, total: v.total, matched: v.matched, pct: pct(v.matched, v.total) }))
    .sort((a, b) => a.pct - b.pct);
  const lowConfidence = matches.filter((m) => m.confidence === "low" || m.confidence === "medium");

  return {
    reachable: true,
    feedDate,
    navRowsFromFeed: navs.length,
    summary: {
      totalFunds, fundsWithHoldings,
      matched: matches.length, unmatched: unmatched.length,
      matchRateOverallPct: pct(matches.length, totalFunds),
      matchRateWithHoldingsPct: pct(matchedWithHoldings, fundsWithHoldings),
      byTier: tierCounts, lowConfidenceCount: lowConfidence.length,
    },
    coverageByClassification,
    coverageByAmc: coverageByAmcOut,
    matchesSample: matches.slice(0, 50),
    lowConfidence,
    unmatched,
    _matches: matches,
  };
}

// ---------------------------------------------------------------------------
// Probe 2: RupeeVest (sample-only, by our native schemecode)
// ---------------------------------------------------------------------------

const RV_BASE = "https://www.rupeevest.com/home";
interface RvCandidate {
  name: string;
  confirmed: boolean;
  build: (code: string) => string;
}
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

  // If a NAV-bearing endpoint was found, validate it across a wider sample.
  const validation: Array<{ schemecode: string; result: ProbeResult }> = [];
  const firstWorking = RV_CANDIDATES.find((c) => workingNavEndpoints.has(c.name));
  if (firstWorking) {
    const validationSet = withHoldings.slice(0, RV_VALIDATION_SAMPLE);
    info(`[rupeevest] validating "${firstWorking.name}" across ${validationSet.length} schemecodes`);
    for (const f of validationSet) {
      const code = String(f.schemecode);
      const result = await probe(firstWorking.build(code), 30_000);
      validation.push({ schemecode: code, result });
      if (result.ok && result.jsonParseable) {
        const hits = result.fieldHits ?? [];
        if (hits.some((h) => /hist/i.test(h.path))) exposesHistory = true;
        if (hits.some((h) => ISIN_KEY_RE.test(h.path) || AMFI_KEY_RE.test(h.path))) exposesIsinOrAmfi = true;
      }
      await sleep(POLITE_DELAY_MS);
    }
    endpointDiscovery.push(
      ...validation.map((v) => ({ schemecode: v.schemecode, candidate: `${firstWorking.name} [validation]`, confirmed: false, result: v.result }))
    );
  }

  const avoidsCrosswalk = exposesNav; // native schemecode → NAV ⇒ no AMFI crosswalk needed
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
// Probe 3: MFAPI (sample-only, by AMFI scheme code from the crosswalk)
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
  let within = 0;
  let comparable = 0;
  for (const m of highConf) {
    const r = await probe(`${MFAPI_BASE}/${m.amfiSchemeCode}/latest`, 30_000);
    let mfapiNav: number | null = null;
    let mfapiDate: string | null = null;
    if (r.ok && r.jsonParseable) {
      // MFAPI latest shape: { meta:{...}, data:[{ date, nav }], status }
      const hits = scanFields(r); // reuse generic walk
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
    let points: number | null = null;
    let firstDate: string | null = null;
    let lastDate: string | null = null;
    if (r.ok && r.jsonParseable) {
      // We avoided full parse; re-fetch and parse minimally for counts.
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
  const verdict =
    base.historyAvailable
      ? `MFAPI serves historical NAV by AMFI scheme code (sample confirmed). Latest NAV cross-check vs AMFI: ${comparable > 0 ? `${within}/${comparable} within tolerance` : "not comparable"}. Suitable as the historical-NAV fallback once the crosswalk is solved.`
      : `MFAPI did not return usable history in this sample (status/availability recorded). Latest cross-check: ${comparable > 0 ? `${within}/${comparable} within tolerance` : "not comparable"}.`;

  return { ...base, matchesAmfiLatest, verdict };
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

  // Probes — independent; per-probe failure is captured, never fatal.
  let amfi: AmfiProbeResult = { reachable: false, error: "probe not run" };
  let rupeevest: RvProbeResult | { error: string };
  let mfapi: MfapiProbeResult | { error: string };

  try {
    amfi = await runAmfiProbe(indexFile.funds);
  } catch (e) {
    amfi = { reachable: false, error: (e as Error).message };
  }
  try {
    rupeevest = await runRupeeVestProbe(indexFile.funds);
  } catch (e) {
    rupeevest = { error: (e as Error).message };
  }
  try {
    mfapi = await runMfapiProbe(amfi._matches);
  } catch (e) {
    mfapi = { error: (e as Error).message };
  }

  // Strip the internal _matches before serializing.
  const amfiOut = { ...amfi };
  delete amfiOut._matches;

  const report = {
    meta: {
      generatedAt: nowIso(),
      dryRun: true,
      ruleVersion: RULE_VERSION,
      indexPath: "src/data/portfolio-tracker/index.json",
      thresholds: { MEDIUM_MIN, LOW_MIN },
      samples: { RV_ENDPOINT_DISCOVERY_SAMPLE, RV_VALIDATION_SAMPLE, MFAPI_SAMPLE },
      note: "Read-only NAV source discovery. Not a production snapshot. Not wired to the dashboard or the ingest orchestrator. Sample-scoped for RupeeVest/MFAPI.",
    },
    recommendation: buildRecommendation(amfi, rupeevest, mfapi),
    amfi: amfiOut,
    rupeevest,
    mfapi,
  };

  await fs.mkdir(REPORT_DIR, { recursive: true });
  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  info(`wrote ${path.relative(process.cwd(), REPORT_PATH)}`);

  printSummary(amfi, rupeevest, mfapi);
}

function buildRecommendation(
  amfi: AmfiProbeResult,
  rv: RvProbeResult | { error: string },
  mf: MfapiProbeResult | { error: string }
): string {
  const parts: string[] = [];
  if (amfi.reachable && amfi.summary) {
    const r = amfi.summary.matchRateWithHoldingsPct;
    parts.push(
      r >= 95
        ? `AMFI reachable; crosswalk match-rate for funds-with-holdings = ${r}% (≥95% → AMFI viable as primary).`
        : `AMFI reachable; crosswalk match-rate for funds-with-holdings = ${r}% (<95% → needs manual overrides or ISIN join before AMFI is primary).`
    );
  } else {
    parts.push(`AMFI NOT reachable from this runner (${amfi.error ?? "unknown"}). Re-evaluate primary source.`);
  }
  if ("avoidsCrosswalk" in rv) {
    parts.push(rv.avoidsCrosswalk ? "RupeeVest can serve NAV by our native schemecode → crosswalk-free path available." : "RupeeVest NAV-by-schemecode NOT established by probe.");
  } else parts.push(`RupeeVest probe errored (${rv.error}).`);
  if ("historyAvailable" in mf) {
    parts.push(mf.historyAvailable ? "MFAPI confirmed for historical NAV fallback." : (mf.skipped ?? "MFAPI history not confirmed in sample."));
  } else parts.push(`MFAPI probe errored (${mf.error}).`);
  return parts.join(" ");
}

function printSummary(
  amfi: AmfiProbeResult,
  rv: RvProbeResult | { error: string },
  mf: MfapiProbeResult | { error: string }
): void {
  info("================= NAV SOURCE DISCOVERY SUMMARY =================");
  if (amfi.reachable && amfi.summary) {
    const s = amfi.summary;
    info(`AMFI: reachable · feedDate=${amfi.feedDate ?? "?"} · navRows=${amfi.navRowsFromFeed}`);
    info(`  match overall: ${s.matched}/${s.totalFunds} (${s.matchRateOverallPct}%)`);
    info(`  match w/holdings: ${s.matchRateWithHoldingsPct}% · tiers exact=${s.byTier.exact} high=${s.byTier.high} medium=${s.byTier.medium} low=${s.byTier.low}`);
    info(`  unmatched=${s.unmatched} · low/medium-confidence=${s.lowConfidenceCount}`);
    const worst = (amfi.coverageByClassification ?? []).slice(0, 5) as Array<{ classification: string; matched: number; total: number; pct: number }>;
    for (const c of worst) info(`    worst-class ${c.classification}: ${c.matched}/${c.total} (${c.pct}%)`);
  } else {
    info(`AMFI: NOT reachable — ${amfi.error ?? "unknown"}`);
  }
  if ("verdict" in rv) {
    info(`RupeeVest: exposesNav=${rv.exposesNav} history=${rv.exposesHistory} isin/amfi=${rv.exposesIsinOrAmfi} avoidsCrosswalk=${rv.avoidsCrosswalk}`);
    info(`  ${rv.verdict}`);
  } else info(`RupeeVest: ERROR ${rv.error}`);
  if ("verdict" in mf) {
    info(`MFAPI: historyAvailable=${mf.historyAvailable} matchesAmfiLatest=${mf.matchesAmfiLatest ?? "n/a"}`);
    info(`  ${mf.skipped ?? mf.verdict}`);
  } else info(`MFAPI: ERROR ${mf.error}`);
  info("===============================================================");
  info(`Full report: ${path.relative(process.cwd(), REPORT_PATH)}`);
}

main().catch((e) => {
  warn(`discovery harness failed: ${(e as Error).message}`);
  process.exit(1);
});
