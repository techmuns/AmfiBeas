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
    .replace(/\b(reg|dir|direct|growth|idcw|payout|reinvest(ment)?|plan|option|mutual|fund|scheme|open|ended|end|sl|an|the|of|for)\b/g, " ")
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

// ---- per-scheme panel payload ----------------------------------------------
interface AllocationSlice {
  class: AssetClass;
  pct: number;
}
interface PanelHolding {
  name: string;
  isin: string | null;
  industry: string | null;
  assetClass: AssetClass;
  pctToNav: number | null;
  marketValueCr: number | null;
}
function buildPanel(schemecode: string, snap: AmcPortfolioSnapshot, scheme: AmcScheme) {
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
  holdings.sort((a, b) => (b.pctToNav ?? 0) - (a.pctToNav ?? 0));
  const allocation: AllocationSlice[] = ASSET_ORDER
    .map((c) => ({ class: c, pct: Math.round((alloc.get(c) ?? 0) * 100) / 100 }))
    .filter((s) => s.pct > 0.005);
  return {
    schemecode,
    amc: snap.amc,
    amcSlug: snap.amcSlug,
    amcSchemeName: cleanDisplayName(scheme.schemeName),
    amcSchemeCode: scheme.schemeCode,
    sourceUrl: snap.sourceUrl,
    asOfMonth: snap.asOfMonth,
    asOf: scheme.asOf,
    fetchedAt: snap.fetchedAt,
    coveragePct: Math.round(coverage * 100) / 100,
    allocation,
    holdings,
  };
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

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
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
    const panel = buildPanel(f.schemecode, bucket.snap, scheme);
    fs.writeFileSync(path.join(OUT_DIR, `${f.schemecode}.json`), JSON.stringify(panel) + "\n", "utf8");
    entries[f.schemecode] = {
      amcSlug: bucket.snap.amcSlug,
      amcSchemeName: cleanDisplayName(scheme.schemeName),
      asOfMonth: bucket.snap.asOfMonth,
      holdings: scheme.holdings.length,
      confidence,
    };
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
