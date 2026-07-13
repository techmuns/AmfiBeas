/**
 * 2A integration — bridge the direct-from-AMC monthly portfolio disclosures
 * (public/amc-holdings/<slug>.json) onto the MFs Portfolio Tracker's scheme
 * identities, so the tracker's Holdings tab can surface each scheme's complete,
 * ISIN-level, all-asset-class portfolio straight from the AMC's SEBI filing —
 * alongside the existing RupeeVest equity month-over-month view.
 *
 * A tracker scheme is identified by a RupeeVest `schemecode`; an AMC disclosure
 * scheme by its printed name. We match the two by normalized-name similarity
 * (with a small manual overrides file for the ones name-matching can't reach),
 * scoped to the same fund house so lookups stay unambiguous.
 *
 * Outputs:
 *   - src/data/portfolio-tracker/amc-portfolio-crosswalk.json  (bundled; the app
 *     reads it to know which schemecodes have a disclosure + light header meta)
 *   - public/amc-portfolio/<schemecode>.json                   (fetched on demand
 *     by the Holdings-tab panel: allocation summary + full holdings table)
 *
 * Run: npx tsx scripts/build-amc-portfolio-crosswalk.ts
 */
import fs from "node:fs";
import path from "node:path";
import { amcOf } from "../src/data/amc-name-map";
import type { AmcHolding, AmcPortfolioSnapshot, AmcScheme } from "./ingest/amc-factsheets/types";

const ROOT = process.cwd();
const HOLDINGS_DIR = path.join(ROOT, "public/amc-holdings");
const OUT_DIR = path.join(ROOT, "public/amc-portfolio");
const TRACKER_INDEX = path.join(ROOT, "src/data/portfolio-tracker/index.json");
const OVERRIDES = path.join(ROOT, "src/data/portfolio-tracker/amc-portfolio-crosswalk-overrides.json");
const CROSSWALK_OUT = path.join(ROOT, "src/data/portfolio-tracker/amc-portfolio-crosswalk.json");

// ---- tracker index ---------------------------------------------------------
interface TrackerFund {
  schemecode: string;
  name: string;
  fundName: string | null;
  classification: string | null;
  aumTotalCr: number | null;
  file?: string | null;
}
const trackerFunds: TrackerFund[] = (
  JSON.parse(fs.readFileSync(TRACKER_INDEX, "utf8")).funds as TrackerFund[]
).filter((f) => f.file); // only picker-selectable schemes have a holdings file
const trackerName = (f: TrackerFund) => f.fundName ?? f.name;

// ---- name normalization + similarity ---------------------------------------
/** Strip plan/option/house noise and reduce a scheme name to comparable tokens. */
function normTokens(raw: string): Set<string> {
  const s = raw
    .toLowerCase()
    .replace(/\r?\n/g, " ")
    .replace(/\(.*?\)/g, " ") // "(An open ended … scheme)" etc.
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    // plan / option / house words that never distinguish two schemes ("sl" is
    // the tracker's abbreviation for the "Sun Life" the disclosure spells out).
    // NB: strip "reg" (the tracker's plan abbreviation) but KEEP "regular" — it
    // is a scheme word ("Regular Savings Fund"), distinct from "Savings Fund".
    .replace(/\b(reg|dir|direct|growth|idcw|payout|reinvest(ment)?|plan|option|mutual|fund|scheme|open|ended|end|sl|woc|an|the|of|for)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Fold synonyms + cap-family compounds so "opp"~"opportunities" and
  // "mid cap"~"midcap" don't split a true match across differing tokenizations.
  // NOTE: "etf" / "index" / "fof" are deliberately KEPT as tokens — an ETF, an
  // Index Fund, and a Fund-of-Fund on the same benchmark are distinct schemes.
  const folded = s
    .replace(/\bopp\b/g, "opportunities")
    .replace(/\bmgmt\b/g, "management")
    .replace(/\bserv\b/g, "services")
    .replace(/\bsvc\b/g, "services")
    .replace(/\bfin\b/g, "financial")
    .replace(/\bres\b/g, "resources")
    .replace(/\binfra\b/g, "infrastructure")
    .replace(/\btech\b/g, "technology")
    .replace(/\bcorp\b/g, "corporate")
    .replace(/\bmfg\b/g, "manufacturing")
    .replace(/\bgovt\b/g, "government")
    .replace(/\bintl\b/g, "international")
    .replace(/\b(mid|large|small|flexi|multi|micro|blue) cap\b/g, "$1cap")
    .replace(/\blarge and mid\b/g, "largeandmid");
  return new Set(folded.split(" ").filter(Boolean));
}
function minus(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const t of a) if (!b.has(t)) out.add(t);
  return out;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
/** Tokens common to most of a fund house's scheme names — its brand words
 *  ("aditya birla sun life"). Stripping them before matching leaves only the
 *  distinguishing scheme tokens, so "SL" vs "Sun Life" stops hurting. */
function brandTokens(schemes: { schemeName: string }[]): Set<string> {
  const freq = new Map<string, number>();
  for (const s of schemes) for (const t of new Set(normTokens(s.schemeName))) freq.set(t, (freq.get(t) ?? 0) + 1);
  const brand = new Set<string>();
  const threshold = Math.max(2, schemes.length * 0.6);
  for (const [t, n] of freq) if (n >= threshold) brand.add(t);
  return brand;
}
type Confidence = "override" | "exact" | "high" | "low";

/** Tidy an AMC scheme name for display — collapse newlines and drop a trailing
 *  "(An open-ended … scheme)" descriptor, keeping short suffixes intact. */
function cleanDisplayName(raw: string): string {
  const s = raw.replace(/\s+/g, " ").trim();
  const m = s.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  return m && (m[2].length > 15 || /\b(scheme|open[\s-]?end|investing|fund|risk)\b/i.test(m[2])) ? m[1].trim() : s;
}

/** amcOf() is tuned for the tracker's scheme names; a few fund houses the
 *  tracker abbreviates ("Aditya Birla SL", "Franklin India") reduce to a label
 *  that the "<AMC> Mutual Fund" disclosure display name does not. Bridge those
 *  tracker labels to the disclosure's amc-holdings slug explicitly. */
const LABEL_TO_SLUG_ALIASES: Record<string, string> = {
  "Aditya Birla": "absl",
  "Franklin Templeton": "franklin-templeton",
  "Mahindra Manulife": "mahindra",
  "LIC MF": "lic",
};

// ---- asset-class classifier ------------------------------------------------
export type AssetClass = "Equity" | "Debt" | "Cash & equiv" | "Gold" | "Silver" | "Other";
const ASSET_ORDER: AssetClass[] = ["Equity", "Debt", "Cash & equiv", "Gold", "Silver", "Other"];

function classifyHolding(h: AmcHolding): AssetClass {
  const name = (h.name || "").toLowerCase();
  const ind = (h.industry || "").toLowerCase();
  const isin = (h.isin || "").toUpperCase();
  const hay = `${name} ${ind}`;
  if (/\bsilver\b/.test(hay)) return "Silver";
  if (/\bgold\b/.test(hay)) return "Gold";
  if (/\b(treps?|repo|reverse repo|cblo|net receivab|net payab|net current asset|current asset|cash|clearing corporation|margin|deposit|call money)\b/.test(name))
    return "Cash & equiv";
  // A credit rating in the industry/rating column, or a debt-instrument name.
  if (/\b(aaa|aa\+?|aa-|a1\+?|a\+?|sov|sovereign|crisil|icra|care|ind a|fitch|brickwork)\b/.test(ind))
    return "Debt";
  if (/\b(government of india|govt of india|g[- ]?sec|gsec|state development loan|\bsdl\b|treasury bill|t[- ]?bill|gilt|bond|debenture|\bncd\b|commercial paper|certificate of deposit|floating rate note|zero coupon|strips)\b/.test(name))
    return "Debt";
  // Mutual-fund / ETF units (FOF underlying) carry an INF ISIN.
  if (/^INF/.test(isin)) return "Other";
  // A listed equity ISIN with a sector-looking industry.
  if (/^INE/.test(isin)) return "Equity";
  return "Other";
}

// ---- per-scheme panel payload (month-over-month) ---------------------------
const MAX_MONTHS = 12;
const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

interface AllocationSlice { class: AssetClass; pct: number }
interface PanelHolding { name: string; isin: string | null; industry: string | null; assetClass: AssetClass; pctToNav: number | null; marketValueCr: number | null }
interface MonthMeta { key: string; label: string; coveragePct: number; fetchedAt: string; allocation: AllocationSlice[] }
interface PanelRow { name: string; isin: string | null; industry: string | null; assetClass: AssetClass; months: Record<string, { pctToNav: number | null; marketValueCr: number | null }> }
interface PanelBase { schemecode: string; amc: string; amcSlug: string; amcSchemeName: string; amcSchemeCode: string; sourceUrl: string; confidence: Confidence }
interface Panel extends PanelBase { months: MonthMeta[]; rows: PanelRow[] }

/** YYYY-MM key + human label for a scheme's disclosure month. */
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_PLAUSIBLE_YEAR = new Date().getUTCFullYear() + 1;
/** Parse a "Mon YYYY" / "Mon-YY" / "Mon 'YY" label → YYYY-MM, else null. */
function labelToKey(s: string | null | undefined): string | null {
  const m = /([A-Za-z]{3,})[\s-]*'?(\d{2,4})/.exec(s || "");
  if (!m) return null;
  const mo = MON[m[1].slice(0, 3).toLowerCase()];
  if (!mo) return null;
  const y = +m[2] < 100 ? 2000 + +m[2] : +m[2];
  return `${y}-${String(mo).padStart(2, "0")}`;
}
/** A disclosure month is plausible only within [2015, this year + 1]; anything
 *  outside is a mis-parsed per-holding date (bond maturity, index reset). */
function plausibleKey(key: string | null): key is string {
  if (!key) return false;
  const y = +key.slice(0, 4);
  return y >= 2015 && y <= MAX_PLAUSIBLE_YEAR;
}
/** Canonical "Mon YYYY" from a YYYY-MM key, so a direct-tier "Jun-26" and a
 *  page-scrape "Jun 2026" render identically in the month-over-month header. */
function labelFromKey(key: string, fallback: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  return m ? `${MON3[+m[2] - 1]} ${m[1]}` : fallback;
}
function monthKeyOf(scheme: AmcScheme, snap: AmcPortfolioSnapshot): { key: string; label: string } {
  const raw = snap.asOfMonth || scheme.asOf || "latest";
  // The disclosure month is authoritative at the snapshot level (an AMC files
  // one as-on month for every scheme); a per-scheme asOf is only a fallback,
  // because the generic parser sometimes reads a holding's maturity / index
  // date (Kotak index funds, JM) as the as-on and lands decades away.
  const snapKey = labelToKey(snap.asOfMonth);
  const schemeKey = scheme.asOf && /^\d{4}-\d{2}/.test(scheme.asOf) ? scheme.asOf.slice(0, 7) : null;
  const key =
    (plausibleKey(snapKey) && snapKey) ||
    (plausibleKey(schemeKey) && schemeKey) ||
    snapKey || schemeKey || "unknown";
  return { key, label: labelFromKey(key, raw) };
}
/** Row identity across months — ISIN when present, else normalized name. */
function rowKeyOf(h: { isin: string | null; name: string }): string {
  return h.isin ? h.isin.toUpperCase().replace(/\s+/g, "") : "n:" + h.name.toLowerCase().replace(/\s+/g, " ").trim();
}

/** One month's allocation + holdings for a scheme. */
function buildMonth(snap: AmcPortfolioSnapshot, scheme: AmcScheme): { meta: MonthMeta; holdings: PanelHolding[] } {
  const alloc = new Map<AssetClass, number>();
  const holdings: PanelHolding[] = [];
  let coverage = 0;
  for (const h of scheme.holdings) {
    const cls = classifyHolding(h);
    const pct = h.pctToNav ?? 0;
    alloc.set(cls, (alloc.get(cls) ?? 0) + pct);
    coverage += pct;
    holdings.push({ name: h.name, isin: h.isin, industry: h.industry, assetClass: cls, pctToNav: h.pctToNav, marketValueCr: h.marketValueCr });
  }
  const allocation = ASSET_ORDER.map((c) => ({ class: c, pct: Math.round((alloc.get(c) ?? 0) * 100) / 100 })).filter((s) => s.pct > 0.005);
  const { key, label } = monthKeyOf(scheme, snap);
  return { meta: { key, label, coveragePct: Math.round(coverage * 100) / 100, fetchedAt: snap.fetchedAt, allocation }, holdings };
}

/** Merge a freshly-fetched month into the scheme's existing panel (history grows
 *  forward, newest-first, capped at MAX_MONTHS; re-fetching a month replaces it).
 *  Rows are aligned by ISIN/name so the same instrument reads left-to-right. */
function mergePanel(existing: Panel | null, base: PanelBase, meta: MonthMeta, holdings: PanelHolding[]): Panel {
  // Migrate legacy months written before month keys were derived from the
  // authoritative disclosure month: prefer the label-derived key, and drop a
  // month whose key AND label are both implausible (a mis-parsed per-scheme
  // date, e.g. Kotak → "Nov 2117"). Row data is remapped to the corrected keys.
  const remap = new Map<string, string>();
  const dropped = new Set<string>();
  const exMonths: MonthMeta[] = [];
  for (const m of existing?.months ?? []) {
    const lk = labelToKey(m.label);
    const nk = plausibleKey(lk) ? lk : plausibleKey(m.key) ? m.key : null;
    if (!nk) { dropped.add(m.key); continue; }
    if (nk !== m.key) remap.set(m.key, nk);
    exMonths.push(nk === m.key ? m : { ...m, key: nk });
  }
  const exRows: PanelRow[] = (existing?.rows ?? []).map((r) => {
    const mm: PanelRow["months"] = {};
    for (const [k, v] of Object.entries(r.months)) {
      if (dropped.has(k)) continue;
      mm[remap.get(k) ?? k] = v;
    }
    return { ...r, months: mm };
  });

  const months = [meta, ...exMonths.filter((m) => m.key !== meta.key)]
    .sort((a, b) => (a.key < b.key ? 1 : -1))
    .slice(0, MAX_MONTHS);
  const keptKeys = new Set(months.map((m) => m.key));

  const rowMap = new Map<string, PanelRow>();
  for (const r of exRows) rowMap.set(rowKeyOf(r), { ...r, months: { ...r.months } });
  for (const h of holdings) {
    const k = rowKeyOf(h);
    const r = rowMap.get(k) ?? { name: h.name, isin: h.isin, industry: h.industry, assetClass: h.assetClass, months: {} };
    r.name = h.name; r.isin = h.isin; r.industry = h.industry; r.assetClass = h.assetClass; // latest descriptors
    r.months[meta.key] = { pctToNav: h.pctToNav, marketValueCr: h.marketValueCr };
    rowMap.set(k, r);
  }
  const rows: PanelRow[] = [];
  for (const r of rowMap.values()) {
    for (const mk of Object.keys(r.months)) if (!keptKeys.has(mk)) delete r.months[mk];
    if (Object.keys(r.months).length) rows.push(r);
  }
  const latest = months[0].key;
  rows.sort((a, b) => (b.months[latest]?.pctToNav ?? -1) - (a.months[latest]?.pctToNav ?? -1));
  return { ...base, months, rows };
}

// ---- main ------------------------------------------------------------------
function main() {
  // Load every AMC disclosure bucket, keyed by its own amc-holdings slug. A
  // label→slug map (from each file's display name, plus the abbreviation
  // aliases) resolves a tracker fund's amcOf() label to the right bucket.
  type Bucket = { snap: AmcPortfolioSnapshot; byNorm: Map<string, AmcScheme[]>; schemes: AmcScheme[]; brand: Set<string> };
  const bySlug = new Map<string, Bucket>();
  const labelToSlug = new Map<string, string>();
  for (const file of fs.readdirSync(HOLDINGS_DIR)) {
    if (!file.endsWith(".json") || file === "index.json") continue;
    const snap = JSON.parse(fs.readFileSync(path.join(HOLDINGS_DIR, file), "utf8")) as AmcPortfolioSnapshot;
    if (!snap.schemes?.length) continue;
    const brand = brandTokens(snap.schemes);
    const byNorm = new Map<string, AmcScheme[]>();
    for (const sc of snap.schemes) {
      const key = [...minus(normTokens(sc.schemeName), brand)].sort().join(" ");
      if (!byNorm.has(key)) byNorm.set(key, []);
      byNorm.get(key)!.push(sc);
    }
    bySlug.set(snap.amcSlug, { snap, byNorm, schemes: snap.schemes, brand });
    labelToSlug.set(amcOf(snap.amc), snap.amcSlug);
  }
  for (const [label, slug] of Object.entries(LABEL_TO_SLUG_ALIASES)) labelToSlug.set(label, slug);
  const bucketFor = (label: string): Bucket | undefined => {
    const slug = labelToSlug.get(label);
    return slug ? bySlug.get(slug) : undefined;
  };

  const overrides: Record<string, { amcSlug: string; amcSchemeCode: string }> = fs.existsSync(OVERRIDES)
    ? (JSON.parse(fs.readFileSync(OVERRIDES, "utf8")).overrides ?? {})
    : {};

  // Do NOT wipe OUT_DIR — per-scheme panels accumulate month-over-month history
  // across runs. Stale panels (schemes no longer matched) are pruned at the end.
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const entries: Record<string, { amcSlug: string; amcSchemeName: string; asOfMonth: string; holdings: number; confidence: Confidence }> = {};
  const counts = { override: 0, exact: 0, high: 0 };
  let skippedLow = 0;
  const perAmc = new Map<string, { matched: number; total: number }>();

  for (const f of trackerFunds) {
    const label = amcOf(trackerName(f));
    const bucket = bucketFor(label);
    const stat = perAmc.get(label) ?? { matched: 0, total: 0 };
    stat.total++;
    perAmc.set(label, stat);
    if (!bucket) continue;

    let scheme: AmcScheme | null = null;
    let confidence: Confidence | null = null;

    const ov = overrides[f.schemecode];
    if (ov && ov.amcSlug === bucket.snap.amcSlug) {
      scheme = bucket.schemes.find((s) => s.schemeCode === ov.amcSchemeCode) ?? null;
      if (scheme) confidence = "override";
    }
    if (!scheme) {
      // Strip both the fund house's brand tokens and the tracker's own label
      // tokens (e.g. "aditya birla sl"), leaving only distinguishing words.
      const drop = new Set([...bucket.brand, ...normTokens(label)]);
      const want = minus(normTokens(trackerName(f)), drop);
      if (want.size > 0) {
        const wantKey = [...want].sort().join(" ");
        const exact = bucket.byNorm.get(wantKey);
        if (exact && exact.length === 1) {
          scheme = exact[0];
          confidence = "exact";
        } else {
          // best token-similarity match in the same fund house
          let best: AmcScheme | null = null;
          let bestScore = 0;
          for (const s of bucket.schemes) {
            const sc = jaccard(want, minus(normTokens(s.schemeName), bucket.brand));
            if (sc > bestScore) { bestScore = sc; best = s; }
          }
          if (best && bestScore >= 0.8) { scheme = best; confidence = "high"; }
          else if (best && bestScore >= 0.6) { scheme = best; confidence = "low"; }
        }
      }
    }

    if (!scheme || !confidence) continue;
    if (confidence === "low") { skippedLow++; continue; } // too risky to surface a portfolio on
    counts[confidence]++;
    stat.matched++;
    const { meta, holdings } = buildMonth(bucket.snap, scheme);
    const file = path.join(OUT_DIR, `${f.schemecode}.json`);
    let existing: Panel | null = null;
    try {
      const prev = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(prev.months)) existing = prev as Panel; // ignore the pre-history single-month shape
    } catch { /* no existing panel */ }
    const base: PanelBase = {
      schemecode: f.schemecode, amc: bucket.snap.amc, amcSlug: bucket.snap.amcSlug,
      amcSchemeName: cleanDisplayName(scheme.schemeName), amcSchemeCode: scheme.schemeCode,
      sourceUrl: bucket.snap.sourceUrl, confidence,
    };
    fs.writeFileSync(file, JSON.stringify(mergePanel(existing, base, meta, holdings)) + "\n", "utf8");
    entries[f.schemecode] = {
      amcSlug: bucket.snap.amcSlug,
      amcSchemeName: base.amcSchemeName,
      asOfMonth: meta.label,
      holdings: holdings.length,
      confidence,
    };
  }

  // Prune stale panels — but ONLY for AMCs we actually refreshed this run. If an
  // AMC's monthly fetch transiently failed (no bucket loaded), its panels are
  // kept untouched so their accumulated month-over-month history survives the
  // outage rather than being wiped and having to rebuild from one month again.
  const refreshedSlugs = new Set(bySlug.keys());
  for (const file of fs.readdirSync(OUT_DIR)) {
    if (!file.endsWith(".json")) continue;
    const code = file.slice(0, -5);
    if (entries[code]) continue; // matched this run — keep
    const fp = path.join(OUT_DIR, file);
    let amcSlug: string | null = null;
    try { amcSlug = JSON.parse(fs.readFileSync(fp, "utf8")).amcSlug ?? null; } catch { /* unreadable */ }
    // Delete only when this AMC was refreshed (scheme genuinely gone), or the
    // panel is unreadable/unattributable; preserve history through fetch failures.
    if (!amcSlug || refreshedSlugs.has(amcSlug)) fs.rmSync(fp);
  }

  const matched = Object.keys(entries).length;
  const crosswalk = {
    meta: {
      generatedAt: new Date().toISOString(),
      source: "Direct-from-AMC monthly portfolio disclosures (public/amc-holdings) matched to RupeeVest tracker schemecodes by scheme name.",
      trackerSchemes: trackerFunds.length,
      matched,
      byConfidence: counts,
    },
    entries,
  };
  fs.writeFileSync(CROSSWALK_OUT, JSON.stringify(crosswalk, null, 0) + "\n", "utf8");

  // report
  console.log(`Tracker schemes (with holdings file): ${trackerFunds.length}`);
  console.log(`Matched to an AMC disclosure:          ${matched} (${Math.round((100 * matched) / trackerFunds.length)}%)`);
  console.log(`  by confidence: ${JSON.stringify(counts)}`);
  console.log(`  low-confidence matches skipped (not surfaced): ${skippedLow}`);
  console.log(`Per-scheme panels written to public/amc-portfolio/: ${matched}`);
  const rows = [...perAmc.entries()]
    .filter(([, s]) => s.total > 0)
    .sort((a, b) => b[1].matched - a[1].matched);
  console.log(`\nCoverage by fund house (matched/total tracker schemes):`);
  for (const [label, s] of rows) {
    if (s.matched === 0) continue;
    console.log(`  ${label.padEnd(18)} ${String(s.matched).padStart(3)}/${String(s.total).padStart(3)}`);
  }
}
main();
