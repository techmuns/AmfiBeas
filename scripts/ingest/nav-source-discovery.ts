/**
 * NAV source-discovery harness (read-only, sample-scoped).
 *
 * Probes AMFI / RupeeVest / MFAPI, then writes a gitignored report at
 * data/debug/nav-source-discovery-report.json and a smaller review file at
 * data/debug/nav-crosswalk-review.json. No production snapshot is touched.
 *
 * The crosswalk matcher itself lives in ./nav-crosswalk.ts and is shared with
 * the production latest-NAV ingest (scripts/ingest/nav-latest.ts) so the two
 * never drift. This file only adds: live-feed fetch, the RupeeVest/MFAPI
 * source probes, and the debug-report assembly.
 *
 * Run: npx tsx scripts/ingest/nav-source-discovery.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { parseNavAll } from "./amfi-nav";
import { info, nowIso, warn } from "./utils";
import {
  RULE_VERSION,
  MEDIUM_MIN,
  LOW_MIN,
  DEFAULT_INDEX_PATH,
  DEFAULT_OVERRIDES_PATH,
  buildCrosswalk,
  loadOverrides,
  pct,
  type IndexFile,
  type IndexFund,
  type MatchRow,
  type UnmatchedRow,
  type RejectedRow,
  type OverrideEntry,
} from "./nav-crosswalk";

const NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt";
const REPORT_DIR = path.resolve(process.cwd(), "data/debug");
const REPORT_PATH = path.join(REPORT_DIR, "nav-source-discovery-report.json");
const REVIEW_PATH = path.join(REPORT_DIR, "nav-crosswalk-review.json");

const RV_VALIDATION_SAMPLE = 10;
const RV_ENDPOINT_DISCOVERY_SAMPLE = 3;
const MFAPI_SAMPLE = 5;
const POLITE_DELAY_MS = 400;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

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
// Probe 1: AMFI + crosswalk (full universe, via shared buildCrosswalk)
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

  const cw = buildCrosswalk(funds, navs, overrides);
  const totalMatched = cw.autoMatches.length + cw.overrideMatches.length;

  const summary: AmfiProbeSummary = {
    totalFunds: cw.totalFunds,
    fundsWithHoldings: cw.fundsWithHoldings,
    autoMatched: cw.autoMatches.length,
    overrideMatched: cw.overrideMatches.length,
    totalMatched,
    reviewMatches: {
      medium: cw.reviewMatches.filter((m) => m.confidence === "medium").length,
      low: cw.reviewMatches.filter((m) => m.confidence === "low").length,
    },
    ambiguous: cw.ambiguous.length,
    rejectedRisky: cw.rejectedRisky.length,
    unmatched: cw.unmatched.length,
    invalidOverrides: cw.invalidOverrides.length,
    matchRateOverallPct: pct(totalMatched, cw.totalFunds),
    matchRateWithHoldingsPct: pct(cw.matchedWithHoldings, cw.fundsWithHoldings),
    autoOnlyMatchRateWithHoldingsPct: pct(cw.autoMatchedWithHoldings, cw.fundsWithHoldings),
  };

  return {
    reachable: true,
    feedDate, navRowsFromFeed: navs.length,
    overridesLoaded: overrides.size,
    summary,
    coverageByClassification: cw.coverageByClassification,
    coverageByAmc: cw.coverageByAmc,
    autoMatchesSample: cw.autoMatches.slice(0, 50),
    overrideMatches: cw.overrideMatches,
    reviewMatches: cw.reviewMatches,
    ambiguous: cw.ambiguous,
    rejectedRisky: cw.rejectedRisky,
    unmatched: cw.unmatched,
    _autoMatches: cw.autoMatches,
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
  info(`reading ${DEFAULT_INDEX_PATH}`);
  const indexFile = JSON.parse(await fs.readFile(DEFAULT_INDEX_PATH, "utf8")) as IndexFile;
  const totalFunds = indexFile.funds.length;
  const fundsWithHoldings = indexFile.funds.filter((f) => f.file).length;
  info(`index: ${totalFunds} funds (${fundsWithHoldings} with holdings)`);

  const overrides = await loadOverrides(DEFAULT_OVERRIDES_PATH);
  info(`overrides: ${overrides.size} loaded from ${path.relative(process.cwd(), DEFAULT_OVERRIDES_PATH)}`);

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
