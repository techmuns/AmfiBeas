import type { AMC } from "./types";

export interface AMCProfile extends AMC {
  baseAum: number;
  aumCagr: number;
  equityPct: number;
  sipShare: number;
  newInvestorShare: number;
  revenueYieldBps: number;
  opMargin: number;
  patMargin: number;
  nfoLambda: number;
  seed: number;
}

export const AMCS: AMCProfile[] = [
  {
    slug: "sbi",
    name: "SBI Funds Management",
    listed: false,
    baseAum: 1_050_000,
    aumCagr: 0.18,
    equityPct: 0.46,
    sipShare: 0.18,
    newInvestorShare: 0.16,
    revenueYieldBps: 42,
    opMargin: 0.62,
    patMargin: 0.5,
    nfoLambda: 1.2,
    seed: 1,
  },
  {
    slug: "icici-pru",
    name: "ICICI Prudential AMC",
    // Listed on NSE/BSE. Quarterly P&L sourced from
    // https://www.screener.in/company/ICICIAMC/ (the standalone variant —
    // the /consolidated/ variant returns an annual/TTM table). The
    // ingester sanity-checks every page and rejects layouts that would
    // produce out-of-envelope yields, so a future page change can't
    // poison the snapshot.
    ticker: "ICICIAMC",
    listed: true,
    baseAum: 920_000,
    aumCagr: 0.2,
    equityPct: 0.5,
    sipShare: 0.13,
    newInvestorShare: 0.12,
    revenueYieldBps: 46,
    opMargin: 0.6,
    patMargin: 0.48,
    nfoLambda: 1.4,
    seed: 2,
  },
  {
    slug: "hdfc",
    name: "HDFC AMC",
    ticker: "HDFCAMC",
    listed: true,
    baseAum: 800_000,
    aumCagr: 0.21,
    equityPct: 0.55,
    sipShare: 0.12,
    newInvestorShare: 0.11,
    revenueYieldBps: 50,
    opMargin: 0.66,
    patMargin: 0.55,
    nfoLambda: 1.0,
    seed: 3,
  },
  {
    slug: "nippon",
    name: "Nippon Life India AMC",
    ticker: "NAM-INDIA",
    listed: true,
    baseAum: 600_000,
    aumCagr: 0.22,
    equityPct: 0.52,
    sipShare: 0.1,
    newInvestorShare: 0.13,
    revenueYieldBps: 48,
    opMargin: 0.58,
    patMargin: 0.46,
    nfoLambda: 1.3,
    seed: 4,
  },
  {
    slug: "kotak",
    name: "Kotak Mahindra AMC",
    listed: false,
    baseAum: 500_000,
    aumCagr: 0.19,
    equityPct: 0.5,
    sipShare: 0.08,
    newInvestorShare: 0.08,
    revenueYieldBps: 45,
    opMargin: 0.55,
    patMargin: 0.42,
    nfoLambda: 1.1,
    seed: 5,
  },
  {
    slug: "absl",
    name: "Aditya Birla Sun Life AMC",
    ticker: "ABSLAMC",
    listed: true,
    baseAum: 390_000,
    aumCagr: 0.16,
    equityPct: 0.43,
    sipShare: 0.06,
    newInvestorShare: 0.07,
    revenueYieldBps: 44,
    opMargin: 0.5,
    patMargin: 0.4,
    nfoLambda: 0.9,
    seed: 6,
  },
  {
    slug: "axis",
    name: "Axis AMC",
    listed: false,
    baseAum: 340_000,
    aumCagr: 0.15,
    equityPct: 0.5,
    sipShare: 0.06,
    newInvestorShare: 0.07,
    revenueYieldBps: 47,
    opMargin: 0.52,
    patMargin: 0.4,
    nfoLambda: 0.8,
    seed: 7,
  },
  {
    slug: "uti",
    name: "UTI AMC",
    ticker: "UTIAMC",
    listed: true,
    baseAum: 350_000,
    aumCagr: 0.14,
    equityPct: 0.4,
    sipShare: 0.05,
    newInvestorShare: 0.06,
    revenueYieldBps: 43,
    opMargin: 0.48,
    patMargin: 0.38,
    nfoLambda: 0.7,
    seed: 8,
  },
  {
    slug: "mirae",
    name: "Mirae Asset Investment Managers",
    listed: false,
    baseAum: 200_000,
    aumCagr: 0.24,
    equityPct: 0.7,
    sipShare: 0.05,
    newInvestorShare: 0.06,
    revenueYieldBps: 52,
    opMargin: 0.55,
    patMargin: 0.42,
    nfoLambda: 1.0,
    seed: 9,
  },
  {
    slug: "dsp",
    name: "DSP Mutual Fund",
    listed: false,
    baseAum: 180_000,
    aumCagr: 0.17,
    equityPct: 0.55,
    sipShare: 0.04,
    newInvestorShare: 0.05,
    revenueYieldBps: 49,
    opMargin: 0.5,
    patMargin: 0.4,
    nfoLambda: 0.9,
    seed: 10,
  },
  {
    slug: "canara-robeco",
    name: "Canara Robeco AMC",
    // Listed on NSE/BSE (NSE: CRAMC, BSE: 544580). Quarterly P&L sourced
    // from https://www.screener.in/company/CRAMC/consolidated/ (or the
    // standalone /company/CRAMC/ variant — the ingester picks whichever
    // returns the standard Quarterly Results table and rejects layouts
    // that would produce out-of-envelope yields).
    ticker: "CRAMC",
    listed: true,
    baseAum: 117_000,
    aumCagr: 0.18,
    equityPct: 0.6,
    sipShare: 0.04,
    newInvestorShare: 0.05,
    revenueYieldBps: 38,
    opMargin: 0.58,
    patMargin: 0.48,
    nfoLambda: 0.8,
    seed: 11,
  },
];

export const OTHERS_BASE_AUM = 1_400_000;
export const OTHERS_CAGR = 0.17;
export const OTHERS_SIP_SHARE = 0.13;
export const OTHERS_INVESTOR_SHARE = 0.14;

export function getAMC(slug: string): AMCProfile | undefined {
  return AMCS.find((a) => a.slug === slug);
}

const AMFI_NAME_TO_SLUG: Record<string, string> = {
  "ICICI Prudential Mutual Fund": "icici-pru",
  "Nippon India Mutual Fund": "nippon",
  "UTI Mutual Fund": "uti",
  "Kotak Mahindra Mutual Fund": "kotak",
  "HDFC Mutual Fund": "hdfc",
  "SBI Mutual Fund": "sbi",
  "Aditya Birla Sun Life Mutual Fund": "absl",
  "Axis Mutual Fund": "axis",
  "Mirae Asset Mutual Fund": "mirae",
  "DSP Mutual Fund": "dsp",
  "Canara Robeco Mutual Fund": "canara-robeco",
};

export function amfiNameToSlug(name: string): string | undefined {
  return AMFI_NAME_TO_SLUG[name];
}

/**
 * Positive AMC-name guard for AMFI Fundwise AAUM rows. Returns true
 * only when the supplied name plausibly looks like an AMC label —
 * either matches the curated AMFI_NAME_TO_SLUG entry exactly, or
 * carries a recognisable "Mutual Fund" / "Asset Management" / "AMC"
 * / "MF" suffix.
 *
 * Rejects:
 *   - empty / whitespace-only strings
 *   - numeric-only / comma-numeric / dash-numeric strings (caused
 *     the 52 garbage rows / quarter regression after PR #72 dropped
 *     the implicit curated-map filter — a footnote / summary row
 *     whose first cell was a numeric string was being parsed as an
 *     AMC name with `slugifyAmfiName` producing slugs like
 *     "1-379-300-81")
 *   - "Total" / "Grand Total" / "Sub Total" / "Industry" / "Note"
 *     / "*" / footnote markers
 *
 * Designed to be applied at the extractor's row-acceptance step so
 * the snapshot writer never sees an invalid name; downstream helpers
 * can then trust `amcNameAsReported`. */
export function isLikelyAmcName(name: string): boolean {
  const s = (name ?? "").trim();
  if (!s) return false;
  // Reject anything that's only digits / commas / dots / dashes /
  // spaces / asterisks / em-dashes — i.e. pure-numeric or
  // dash-only / placeholder rows. Note: "-" alone is rejected here.
  if (/^[\d\s,.\-—*+()]+$/.test(s)) return false;
  // Reject summary / header / footer markers. The match is anchored
  // at the start so substrings inside legitimate names (e.g. "Sub-
  // Account") aren't accidentally rejected.
  if (
    /^(s\.?\s*no\b|sr\.?\s*no\b|total\b|grand\s+total\b|sub\s+total\b|industry\b|note\b|footnote\b|all\s+open\b|all\s+close\b|\*)/i.test(
      s
    )
  ) {
    return false;
  }
  // Curated map → always accept. Cheaper than the regex below, and
  // covers all 10 dashboard peers.
  if (AMFI_NAME_TO_SLUG[s] !== undefined) return true;
  // Generic AMC-name suffix heuristic. Every legitimate AMFI AMC
  // entry includes one of these tokens — verified across the
  // ~50-AMC industry list. Conservative on purpose: missing a real
  // AMC is preferable to admitting a numeric footnote.
  if (
    /\b(?:Mutual\s+Fund|Asset\s+Management|Investment\s+Managers?|AMC|MF)\b/i.test(
      s
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Deterministic slug derivation for AMCs not present in the curated
 * AMFI_NAME_TO_SLUG map. Strips common AMFI suffixes ("Mutual Fund",
 * "Asset Management", etc.) and produces a kebab-case slug.
 *
 * Examples:
 *   "Quant Mutual Fund"               → "quant"
 *   "Tata Mutual Fund"                → "tata"
 *   "Bandhan Mutual Fund"             → "bandhan"
 *   "Bank of India Mutual Fund"       → "bank-of-india"
 *   "Edelweiss Asset Management Ltd." → "edelweiss"
 *   "Franklin Templeton Mutual Fund"  → "franklin-templeton"
 *
 * Used by the AMFI Fundwise AAUM extractor to retain rows for AMCs
 * that aren't in the dashboard's curated peer list (so /AMCs can
 * later browse the full universe). Curated slugs (AMFI_NAME_TO_SLUG)
 * are preferred when present so HDFC stays "hdfc" and ICICI Pru
 * stays "icici-pru" — never collides with this auto-slugifier.
 */
export function slugifyAmfiName(name: string): string {
  let s = name.trim();
  // Strip common suffixes (case-insensitive). Order matters — longer
  // suffixes first so "Asset Management Ltd" doesn't leave a stray
  // "Ltd" after removing "Asset Management".
  const suffixes = [
    /\s*\(\s*India\s*\)\s*$/i,
    /\s+Asset\s+Management\s+Co(?:mpany)?\s+Limited\s*$/i,
    /\s+Asset\s+Management\s+Co(?:mpany)?\s+Ltd\.?\s*$/i,
    /\s+Asset\s+Management\s+Limited\s*$/i,
    /\s+Asset\s+Management\s+Ltd\.?\s*$/i,
    /\s+Asset\s+Management\s*$/i,
    /\s+Investment\s+Managers\s+(?:India\s+)?(?:Pvt\.?|Private)?\s*(?:Ltd\.?|Limited)?\s*$/i,
    /\s+Investment\s+Managers\s*$/i,
    /\s+Mutual\s+Fund\s*$/i,
    /\s+MF\s*$/i,
    /\s+AMC\s*$/i,
    /\s+Limited\s*$/i,
    /\s+Ltd\.?\s*$/i,
  ];
  for (const re of suffixes) s = s.replace(re, "");
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
