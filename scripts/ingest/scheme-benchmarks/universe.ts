/**
 * The master scheme universe for the official-benchmark registry.
 *
 * The universe is NOT a hand-written fund list: it is exactly the rows
 * /api/returns-ranking serves, i.e. every entry in
 * public/nav-data/mf-category-returns.json, enriched with the AMC identity that
 * public/nav-data/mf-latest-nav.json already carries (amfiAmcName / amfiSchemeName
 * / isin, produced by the validated AMFI crosswalk).
 *
 * Plan/option collapsing: the official benchmark belongs to the SCHEME, not to
 * its Direct vs Regular plan or its Growth vs IDCW option. Rows are therefore
 * grouped onto an underlying-scheme key built from the repo's existing
 * name normalizer (scripts/ingest/nav-crosswalk.ts `normalize`), whose token key
 * is plan- and option-free by construction, scoped by AMC. One benchmark is
 * resolved per underlying scheme and materialized back onto every member
 * schemecode. Existing schemecodes are never renamed.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { normalize } from "../nav-crosswalk";
import { slugFor } from "../amc-factsheets/advisorkhoj";

const CATEGORY_RETURNS_PATH = path.resolve(process.cwd(), "public/nav-data/mf-category-returns.json");
const LATEST_NAV_PATH = path.resolve(process.cwd(), "public/nav-data/mf-latest-nav.json");

export interface UniverseRow {
  schemecode: string;
  fundName: string;
  classification: string | null;
  plan: "direct" | "regular" | "unknown";
  option: "growth" | "idcw" | "unknown";
  amc: string;
  amcSlug: string;
  amfiSchemeName: string | null;
  isin: string | null;
}

export interface UnderlyingScheme {
  underlyingKey: string;
  /** Cleanest display name among the member rows. */
  schemeName: string;
  normalizedName: string;
  amc: string;
  amcSlug: string;
  schemeCodes: string[];
  classifications: string[];
  rows: UniverseRow[];
}

export interface Universe {
  asOfDate: string | null;
  generatedAt: string | null;
  rows: UniverseRow[];
  schemes: UnderlyingScheme[];
  byAmcSlug: Map<string, UnderlyingScheme[]>;
}

interface CategoryReturnsFile {
  generatedAt?: string;
  asOfDate?: string | null;
  fundRanks: Array<{
    schemecode: string;
    fundName: string;
    classification: string | null;
    plan: UniverseRow["plan"];
    option: UniverseRow["option"];
  }>;
}
interface LatestNavFile {
  funds: Array<{
    schemecode: string;
    amfiAmcName?: string | null;
    amfiSchemeName?: string | null;
    isin?: string | null;
  }>;
}

/** Strip the plan/option decoration AMFI-style display names carry, so the
 *  underlying scheme reads as a human would name it. */
export function displaySchemeName(fundName: string): string {
  return fundName
    .replace(/\s*-\s*(reg(ular)?|dir(ect)?)\b[^-]*$/i, "")
    .replace(/\((g|growth|idcw|div|dividend)[^)]*\)\s*$/i, "")
    .replace(/\s*-\s*(reg(ular)?|dir(ect)?)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function loadUniverse(): Promise<Universe> {
  const cat = JSON.parse(await fs.readFile(CATEGORY_RETURNS_PATH, "utf8")) as CategoryReturnsFile;
  const latest = JSON.parse(await fs.readFile(LATEST_NAV_PATH, "utf8")) as LatestNavFile;

  const meta = new Map<string, LatestNavFile["funds"][number]>();
  for (const f of latest.funds ?? []) meta.set(f.schemecode, f);

  const rows: UniverseRow[] = [];
  for (const f of cat.fundRanks ?? []) {
    const m = meta.get(f.schemecode);
    // Fall back to the Direct sibling's metadata (same underlying scheme, so the
    // AMC is identical) before giving up on the AMC identity.
    const sibling = m ?? meta.get(f.schemecode.replace(/-D$/, "")) ?? meta.get(`${f.schemecode}-D`);
    const amc = sibling?.amfiAmcName?.trim() || "(unknown AMC)";
    rows.push({
      schemecode: f.schemecode,
      fundName: f.fundName,
      classification: f.classification ?? null,
      plan: f.plan,
      option: f.option,
      amc,
      amcSlug: amc === "(unknown AMC)" ? "unknown" : slugFor(amc),
      amfiSchemeName: sibling?.amfiSchemeName ?? null,
      isin: sibling?.isin ?? null,
    });
  }

  const groups = new Map<string, UnderlyingScheme>();
  for (const r of rows) {
    // `normalize` strips plan ("Direct"/"Regular"/"-Reg") and option
    // ("(G)"/"IDCW") markers and sorts+dedupes tokens, so Direct/Regular and
    // Growth/IDCW variants of one scheme produce the SAME token key.
    const tokenKey = normalize(r.fundName).tokenKey;
    const underlyingKey = `${r.amcSlug}::${tokenKey}`;
    let g = groups.get(underlyingKey);
    if (!g) {
      g = {
        underlyingKey,
        schemeName: displaySchemeName(r.fundName),
        normalizedName: tokenKey,
        amc: r.amc,
        amcSlug: r.amcSlug,
        schemeCodes: [],
        classifications: [],
        rows: [],
      };
      groups.set(underlyingKey, g);
    }
    g.rows.push(r);
    g.schemeCodes.push(r.schemecode);
    if (r.classification && !g.classifications.includes(r.classification)) g.classifications.push(r.classification);
    // Prefer the shortest cleaned display name — the least decorated variant.
    const cand = displaySchemeName(r.fundName);
    if (cand.length > 0 && cand.length < g.schemeName.length) g.schemeName = cand;
  }

  const schemes = [...groups.values()].sort((a, b) => a.underlyingKey.localeCompare(b.underlyingKey));
  for (const s of schemes) {
    s.schemeCodes.sort();
    s.classifications.sort();
  }

  const byAmcSlug = new Map<string, UnderlyingScheme[]>();
  for (const s of schemes) {
    const arr = byAmcSlug.get(s.amcSlug);
    if (arr) arr.push(s);
    else byAmcSlug.set(s.amcSlug, [s]);
  }

  return {
    asOfDate: cat.asOfDate ?? null,
    generatedAt: cat.generatedAt ?? null,
    rows,
    schemes,
    byAmcSlug,
  };
}
