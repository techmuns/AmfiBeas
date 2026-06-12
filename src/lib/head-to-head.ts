/**
 * Pure (React-free) helpers for the scheme-wise Head-to-head comparison.
 *
 * Lives in lib/ so both the interactive table (PortfolioHeadToHead) and the
 * styled Excel export (portfolio-tracker-export) build the exact same compare
 * rows from one source of truth — the dashboard and the spreadsheet can never
 * drift apart.
 *
 * "A" / "B" are positional only (A = the selected fund, B = the comparison
 * fund). They are never shown to the user: every label resolves to the fund's
 * own short fund-house name via shortFundLabel().
 */
import { amcOf } from "@/data/amc-name-map";
import { type FundDirectoryEntry, type FundPortfolio, monthSlug } from "@/data/portfolio-tracker";

// Same neutral band the rest of the dashboard uses for pp-comparisons —
// stocks within ±0.1pp of the comparison fund count as "In line".
export const NEUTRAL_BAND_PP = 0.1;

/** Positional, never-rendered classification of a joined holding. */
export type Signal =
  | "overweight" // A holds a bigger weight than B
  | "underweight" // A holds a smaller weight than B
  | "in-line" // both hold, within the neutral band
  | "only-a" // only the selected fund holds it
  | "only-b"; // only the comparison fund holds it

export interface CompareRow {
  fincode: string;
  name: string;
  a: number | null;
  b: number | null;
  delta: number;
  signal: Signal;
}

/** True when both funds hold the stock (the intersection — "mutual"). */
export function isMutual(signal: Signal): boolean {
  return signal === "overweight" || signal === "underweight" || signal === "in-line";
}

/** A few fund-house tokens read as acronyms; prefer the natural display name
 *  so the table shows "Parag Parikh" rather than the internal "PPFAS" key. */
const SHORT_LABEL_ALIAS: Record<string, string> = {
  PPFAS: "Parag Parikh",
};

/** Short, human label for a fund — its fund-house brand (HDFC, SBI, ICICI Pru,
 *  Parag Parikh …). Used everywhere "A"/"B" would otherwise appear. */
export function shortFundLabel(fund: string): string {
  const house = amcOf(fund);
  return SHORT_LABEL_ALIAS[house] ?? house;
}

export function cleanCompanyName(s: string): string {
  return s
    .replace(/^eq\s*-\s*/i, "")
    .replace(/^[\s^*#~]+/, "")
    .replace(/[£@*#~]+$/, "")
    .trim();
}

export function classify(
  a: number | null,
  b: number | null
): { delta: number; signal: Signal } {
  if (a === null && b !== null) return { delta: -b, signal: "only-b" };
  if (a !== null && b === null) return { delta: a, signal: "only-a" };
  const delta = (a ?? 0) - (b ?? 0);
  if (Math.abs(delta) <= NEUTRAL_BAND_PP) return { delta, signal: "in-line" };
  if (delta > 0) return { delta, signal: "overweight" };
  return { delta, signal: "underweight" };
}

/**
 * Outer-join A and B's latest-month holdings by fincode. Holdings present in
 * only one fund land with a null on the missing side. Sorted by |Δ| desc.
 */
export function buildCompareRows(
  aPortfolio: FundPortfolio,
  bPortfolio: FundPortfolio | undefined | null
): CompareRow[] {
  if (!bPortfolio) return [];
  const slugA = monthSlug(aPortfolio.meta.months[0]?.label ?? "");
  const slugB = monthSlug(bPortfolio.meta.months[0]?.label ?? "");
  if (!slugA || !slugB) return [];

  const map = new Map<string, { name: string; a: number | null; b: number | null }>();
  for (const r of aPortfolio.rows) {
    const w = r.months[slugA]?.aum_pct_num ?? null;
    if (w === null) continue;
    map.set(r.fincode, { name: cleanCompanyName(r.company_name), a: w, b: null });
  }
  for (const r of bPortfolio.rows) {
    const w = r.months[slugB]?.aum_pct_num ?? null;
    if (w === null) continue;
    const ex = map.get(r.fincode);
    if (ex) ex.b = w;
    else map.set(r.fincode, { name: cleanCompanyName(r.company_name), a: null, b: w });
  }

  const rows: CompareRow[] = [];
  for (const [fincode, { name, a, b }] of map) {
    const { delta, signal } = classify(a, b);
    rows.push({ fincode, name, a, b, delta, signal });
  }
  rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  return rows;
}

/** Split joined rows into mutual (both hold) and exclusive (only one holds). */
export function partitionCompareRows(rows: CompareRow[]): {
  mutual: CompareRow[];
  exclusive: CompareRow[];
} {
  const mutual: CompareRow[] = [];
  const exclusive: CompareRow[] = [];
  for (const r of rows) (isMutual(r.signal) ? mutual : exclusive).push(r);
  return { mutual, exclusive };
}

/** Largest A>B and largest A<B amongst mutually-held stocks — the headline
 *  extremes. Only mutual rows can be over/under-weight, so this is implicitly
 *  the intersection. */
export function compareHeadline(rows: CompareRow[]): {
  over: CompareRow | null;
  under: CompareRow | null;
} {
  let over: CompareRow | null = null;
  let under: CompareRow | null = null;
  for (const r of rows) {
    if (r.signal === "overweight" && (!over || r.delta > over.delta)) over = r;
    if (r.signal === "underweight" && (!under || r.delta < under.delta)) under = r;
  }
  return { over, under };
}

/** Human label for a signal, using the two funds' short fund-house names. */
export function signalLabel(signal: Signal, shortA: string, shortB: string): string {
  switch (signal) {
    case "overweight":
      return `${shortA} overweight`;
    case "underweight":
      return `${shortA} underweight`;
    case "in-line":
      return "In line";
    case "only-a":
      return `Only ${shortA}`;
    case "only-b":
      return `Only ${shortB}`;
  }
}

export type SignalTone = "positive" | "negative" | "muted";

export function signalTone(signal: Signal): SignalTone {
  if (signal === "overweight") return "positive";
  if (signal === "underweight") return "negative";
  return "muted";
}

/** ----- Variant-skip heuristic for the default comparison fund ----------- */

/**
 * Normalise a fund name for the variant-skip default-B heuristic. Strips
 * parenthetical plan suffixes ("(G)", "(IDCW)"), separator chars, common plan
 * tokens, and the noise word "fund"; then lowercases and collapses whitespace.
 * Two names that match after this scrub are treated as variants of the same
 * underlying scheme.
 */
export function normalizeSchemeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[-_/]+/g, " ")
    .replace(
      /\b(direct|dir|regular|reg|growth|g|idcw|dividend|div|payout|reinvestment|reinv|plan)\b/g,
      " "
    )
    .replace(/\bfund\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when `a` and `b` look like variants of the same scheme (Direct/Reg,
 *  Growth/IDCW, …). Used only by the default-B selector — the picker itself
 *  still lists every same-category fund so users can pick variants manually. */
export function isLikelySameScheme(
  a: FundDirectoryEntry,
  b: FundDirectoryEntry
): boolean {
  const ka = normalizeSchemeKey(a.fund);
  const kb = normalizeSchemeKey(b.fund);
  if (!ka || !kb) return false;
  return ka === kb;
}
