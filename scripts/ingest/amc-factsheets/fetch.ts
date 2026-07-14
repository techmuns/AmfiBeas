/**
 * Latest-month resolver + fetcher for AMCs whose monthly portfolio disclosure
 * lives at a predictable, templatable URL (SBI, Nippon). No browser needed:
 * we build candidate URLs for the most recent months and probe backwards until
 * one exists — which naturally handles the publish lag (a month's file appears
 * ~9th–12th of the following month).
 *
 * Fetching goes through `curl` so it works identically in the dev sandbox
 * (which requires the egress proxy) and on CI runners (open internet).
 */

import { execFileSync } from "node:child_process";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MONTHS_FULL = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_FULL_TC = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}
function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][Math.min(n % 10, 4)] ?? "th"}`;
}
export function monthLabel(year: number, month1: number): string {
  return `${MON3[month1 - 1]}-${String(year).slice(2)}`;
}

/** Candidate download URLs for a given (year, 1-based month), per AMC slug. */
export function candidateUrls(slug: string, year: number, month1: number): string[] {
  const day = lastDayOfMonth(year, month1);
  if (slug === "sbi") {
    const mf = MONTHS_FULL[month1 - 1];
    return [
      `https://www.sbimf.com/docs/default-source/scheme-portfolios/all-schemes-monthly-portfolio---as-on-${ordinal(day)}-${mf}-${year}.xlsx`,
    ];
  }
  if (slug === "nippon") {
    const yy = String(year).slice(2);
    const base = "https://mf.nipponindiaim.com/InvestorServices/FactsheetsDocuments/NIMF-MONTHLY-PORTFOLIO";
    // Month name has appeared both 3-letter and full — probe both.
    return [
      `${base}-${day}-${MON3[month1 - 1]}-${yy}.xls`,
      `${base}-${day}-${MON_FULL_TC[month1 - 1]}-${yy}.xls`,
    ];
  }
  if (slug === "icici-pru") {
    // One monthly ZIP of per-scheme workbooks on ICICI's own (un-walled) blob
    // host. Filename uses the full month name; the path folder is the 3-letter
    // abbreviation EXCEPT June & July, which use the full name (verified).
    const full = MON_FULL_TC[month1 - 1];
    const folder = month1 === 6 || month1 === 7 ? full : MON3[month1 - 1];
    return [
      `https://www.icicipruamc.com/blob/downloads/Files/Monthly%20Portfolio%20Disclosures/${year}/${folder}/Monthly-Portfolio-Disclosure-${full}-${year}.zip`,
    ];
  }
  if (slug === "kotak") {
    // Consolidated (complete) monthly portfolio on Kotak's S3, e.g.
    // .../Consolidated-Portfolio-as-on-May-31,-2026/ConsolidatedSEBIPortfolioMay2026.xlsx
    const mon = MON_FULL_TC[month1 - 1];
    return [
      `https://vatseelabs-s3.kotakmf.com/FAD/Portfolios/Consolidated-Portfolio-as-on-${mon}-${day},-${year}/ConsolidatedSEBIPortfolio${mon}${year}.xlsx`,
    ];
  }
  return [];
}

/** Referer some AMC hosts require. */
function referer(slug: string): string | null {
  if (slug === "nippon") return "https://mf.nipponindiaim.com/";
  if (slug === "sbi") return "https://www.sbimf.com/portfolios";
  return null;
}

function curlBuffer(url: string, ref: string | null): Buffer | null {
  try {
    const args = ["-fsL", "--max-time", "90", "-A", UA];
    if (ref) args.push("-H", `Referer: ${ref}`);
    args.push(url);
    const out = execFileSync("curl", args, { maxBuffer: 64 * 1024 * 1024 });
    return out.length > 1000 ? out : null; // guard against error pages
  } catch {
    return null;
  }
}

export interface FetchedFile {
  slug: string;
  url: string;
  year: number;
  month1: number;
  asOfMonth: string;
  buf: Buffer;
}

/** Fetch a specific (year, 1-based month) directly from the AMC's own host, or
 *  null if that month isn't published. Used by the one-time history backfill. */
export function fetchMonth(slug: string, year: number, month1: number): FetchedFile | null {
  const ref = referer(slug);
  for (const url of candidateUrls(slug, year, month1)) {
    const buf = curlBuffer(url, ref);
    if (buf) return { slug, url, year, month1, asOfMonth: monthLabel(year, month1), buf };
  }
  return null;
}

/** Probe the last `lookback` months (newest first) and return the first file
 *  that exists. `asOf` lets tests pin "now"; defaults to the current date. */
export function fetchLatest(slug: string, lookback = 4, asOf = new Date()): FetchedFile | null {
  // Start from the previous month (the current month's file won't exist yet).
  let year = asOf.getUTCFullYear();
  let month1 = asOf.getUTCMonth(); // 0-based current → 1-based previous
  if (month1 === 0) { month1 = 12; year -= 1; }
  const ref = referer(slug);
  for (let i = 0; i < lookback; i++) {
    for (const url of candidateUrls(slug, year, month1)) {
      const buf = curlBuffer(url, ref);
      if (buf) return { slug, url, year, month1, asOfMonth: monthLabel(year, month1), buf };
    }
    month1 -= 1;
    if (month1 === 0) { month1 = 12; year -= 1; }
  }
  return null;
}
