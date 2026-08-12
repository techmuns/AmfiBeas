/**
 * Canonical disclosure-month handling for the AMC-direct pipeline.
 *
 * Two problems this module exists to solve:
 *
 * 1. LABEL DRIFT. Each fetch tier used to mint its own month label — "Jul-26"
 *    (direct template), "Jul 2026" (modal from scheme as-on dates), "June 2026"
 *    (AdvisorKhoj listing text). Since a month is the merge key for a scheme's
 *    month-over-month panel, three spellings of July meant three "months".
 *    Everything now goes through `ymOf()` → "YYYY-MM" and is displayed via
 *    `labelOfYm()` → "Jul-26".
 *
 * 2. GARBAGE MONTHS. The generic workbook parser reads the "as on" date out of
 *    the sheet's header band, and in a debt scheme that band can hold a bond
 *    maturity instead ("15-Apr-2053"), producing months like Apr-53 or Jul-98.
 *    A real monthly disclosure is never dated in the future and never more than
 *    a year and a half old when we fetch it, so `isPlausibleYm()` rejects those
 *    outright rather than letting them define a scheme's newest "month".
 *
 * It also owns `mergeMonthBuckets`, the merge that keeps a monthly fetch from
 * throwing away the history the previous fetches accumulated.
 */
import type { AmcScheme } from "./types";

export const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MON_FULL: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** How many months of history a per-AMC snapshot keeps (latest included).
 *  Matches the 12 months the tracker's month-over-month panel renders. */
export const MAX_SNAPSHOT_MONTHS = 12;

/** Oldest disclosure we treat as a plausible "as on" date at fetch time. The
 *  history backfill reaches ~12 months back, so 18 leaves margin without
 *  admitting the decade-old dates a mis-read maturity column produces. */
const MAX_AGE_MONTHS = 18;

function score(ym: string): number {
  return +ym.slice(0, 4) * 12 + +ym.slice(5, 7);
}

/**
 * Any month spelling → "YYYY-MM", or null when there is no month in the input.
 * Understands the shapes our tiers actually produce: "Jul-26", "Jul 2026",
 * "July 2026", "2026-07", "2026-07-31", "31-Jul-2026", "May 31, 2026".
 */
export function ymOf(input: string | null | undefined): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;

  // ISO first: "2026-07" / "2026-07-31".
  const iso = s.match(/^(\d{4})-(\d{2})(?:-\d{2})?/);
  if (iso) {
    const m = +iso[2];
    return m >= 1 && m <= 12 ? `${iso[1]}-${iso[2]}` : null;
  }

  // "<Mon> <YYYY>" / "<Mon>-<YY>" / "<Mon> 31, 2026".
  const named = s.match(/([A-Za-z]{3,9})[\s,-]+(?:\d{1,2}[\s,-]+)?(\d{2,4})\b/);
  if (named) {
    const m = MON_FULL[named[1].slice(0, 3).toLowerCase()];
    const yRaw = +named[2];
    if (m) {
      const y = yRaw < 100 ? 2000 + yRaw : yRaw;
      return `${y}-${String(m).padStart(2, "0")}`;
    }
  }

  // "31-Jul-2026" (day leads).
  const dayLed = s.match(/\d{1,2}[\s/-]([A-Za-z]{3,9})[\s/-](\d{2,4})/);
  if (dayLed) {
    const m = MON_FULL[dayLed[1].slice(0, 3).toLowerCase()];
    const yRaw = +dayLed[2];
    if (m) {
      const y = yRaw < 100 ? 2000 + yRaw : yRaw;
      return `${y}-${String(m).padStart(2, "0")}`;
    }
  }

  return null;
}

/**
 * True when `ym` could be a real disclosure month for a fetch made at `now`.
 *
 * The ceiling is the last month that has ENDED, not the current one: a monthly
 * portfolio is dated the last day of its month, so on the 11th of August an
 * "Aug-26" disclosure cannot exist yet. Without that, a treasury bill maturing
 * next month reads as a perfectly plausible as-on date, and a fetch on the 11th
 * files July's holdings under August — which then blocks July from ever becoming
 * the newest month. (On the last day of a month, that month is allowed.)
 */
export function isPlausibleYm(ym: string | null | undefined, now: Date = new Date()): ym is string {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return false;
  const ceil = score(latestDisclosureYm(now));
  const s = score(ym);
  return s <= ceil && s >= ceil - MAX_AGE_MONTHS;
}

/** The newest month an AMC could possibly have disclosed by `now` — the last
 *  month that has ended. What a healthy monthly fetch should come back with, so
 *  it doubles as the "is this AMC up to date?" yardstick. */
export function latestDisclosureYm(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1-based current month
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (now.getUTCDate() === lastDay) return `${y}-${String(m).padStart(2, "0")}`;
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** "2026-07" → "Jul-26" (the one label spelling the dashboard shows). */
export function labelOfYm(ym: string): string {
  const m = +ym.slice(5, 7);
  return `${MON3[m - 1] ?? "???"}-${ym.slice(2, 4)}`;
}

/** Whatever a tier called the month → canonical "Jul-26" (input kept verbatim
 *  if it carries no recognisable month, so nothing is silently renamed). */
export function normalizeMonthLabel(label: string): string {
  const ym = ymOf(label);
  return ym ? labelOfYm(ym) : label;
}

/** "2026-07" → "2026-07-31" (the as-on date a monthly disclosure carries). */
export function isoEndOfMonth(ym: string): string {
  const y = +ym.slice(0, 4);
  const m = +ym.slice(5, 7);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(d).padStart(2, "0")}`;
}

/**
 * The month a parsed file is actually about: the month most of its schemes
 * declare, counting only plausible dates so one mis-read maturity cell can't
 * win a mode of 1. Ties break to the newer month.
 */
export function modalYm(schemes: AmcScheme[], now: Date = new Date()): string | null {
  const counts = new Map<string, number>();
  for (const s of schemes) {
    const ym = ymOf(s.asOf);
    if (!isPlausibleYm(ym, now)) continue;
    counts.set(ym, (counts.get(ym) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = -1;
  for (const [ym, c] of counts) {
    if (c > bestCount || (c === bestCount && ym > (best ?? ""))) { bestCount = c; best = ym; }
  }
  return best;
}

/**
 * The newest plausible disclosure month named anywhere in a string — a file URL
 * or link text: "…monthly-portfolio---31-july-2026.xlsx" → "2026-07",
 * "ZNFTY - Monthly Portfolio July 2026.xlsx" → "2026-07".
 *
 * Only plausible months count, so a scheme name that happens to carry a year
 * ("Nifty SDL Apr 2032 Index Fund") cannot be mistaken for the month.
 */
export function ymFromText(text: string, now: Date = new Date()): string | null {
  let decoded = text;
  try { decoded = decodeURIComponent(text); } catch { /* keep raw */ }

  // Evidence tiers, strongest first. A URL routinely carries BOTH the as-on date
  // and the month it was PUBLISHED in — UTI's July zip lives at
  // "…/s3fs-public/2026-08/fw_uti_mf_scheme_portfolios_31.07.2026.zip" — so a
  // bare "YYYY-MM" path segment must never outrank a full date or a named month,
  // or a July disclosure gets filed as August.
  const numericDate: string[] = []; // 31.07.2026
  const namedMonth: string[] = []; // "July 2026", "31-july-2026"
  const bareStamp: string[] = []; // "…/2026-08/"

  for (const m of decoded.matchAll(/(?<![\d])(\d{1,2})[.\-/](\d{1,2})[.\-/](20\d{2})(?![\d])/g)) {
    const mo = +m[2];
    if (mo >= 1 && mo <= 12) numericDate.push(`${m[3]}-${String(mo).padStart(2, "0")}`);
  }
  // Two-digit years are allowed: Nippon names its file "…-31-July-26.xls".
  const named = /([A-Za-z]{3,9})[^A-Za-z0-9]{0,4}(?:\d{1,2}(?:st|nd|rd|th)?[^A-Za-z0-9]{0,4})?(\d{4}|\d{2})(?!\d)/gi;
  const dayLed = /(?:\d{1,2})(?:st|nd|rd|th)?[^A-Za-z0-9]{0,3}([A-Za-z]{3,9})[^A-Za-z0-9]{0,3}(\d{4}|\d{2})(?!\d)/gi;
  for (const re of [named, dayLed]) {
    for (const m of decoded.matchAll(re)) {
      const mo = MON_FULL[m[1].slice(0, 3).toLowerCase()];
      if (!mo) continue;
      const yRaw = +m[2];
      namedMonth.push(`${yRaw < 100 ? 2000 + yRaw : yRaw}-${String(mo).padStart(2, "0")}`);
    }
  }
  // Not \b before the year: an underscore is a word character, so "\b" would
  // refuse to match "portfolio_2026-07.xlsx".
  for (const m of decoded.matchAll(/(?<!\d)(20\d{2})[-_](0[1-9]|1[0-2])(?!\d)/g)) bareStamp.push(`${m[1]}-${m[2]}`);

  for (const tier of [numericDate, namedMonth, bareStamp]) {
    let best: string | null = null;
    for (const ym of tier) {
      if (!isPlausibleYm(ym, now)) continue;
      if (!best || ym > best) best = ym;
    }
    if (best) return best;
  }
  return null;
}

/**
 * Reconcile parsed as-on dates with the disclosure month the downloaded file
 * NAMES (its URL or the listing's own label for it), and return that month.
 *
 * Two failure modes this handles, both seen in production:
 *   - No usable date at all. UTI, Zerodha and JM print no as-on date the parser
 *     can trust anywhere in the workbook, so those schemes take the file's month.
 *   - A date in ANY other month. Once implausible dates were rejected, sheets
 *     still offered up dates that are plausible and simply wrong: a treasury
 *     bill maturing next month (UTI), or an NFO date from last year
 *     (Capitalmind, whose July workbook was filed as Mar-26 on the strength of
 *     one such cell). The file the AMC publishes as "July 2026" IS the July
 *     disclosure, so its month wins over anything read out of a sheet.
 *
 * This applies to tiers whose link month comes from the AMC's own listing or a
 * month-stamped filename. The direct-template tier does the opposite (see
 * resolveMonth): there the URL is a guess we probed, so content wins and an AMC
 * serving last month's workbook from this month's URL stays visible as stale.
 */
export function stampAsOfFromLinks(
  schemes: AmcScheme[],
  links: { url: string; text?: string }[],
  now: Date = new Date(),
): string | null {
  let ym: string | null = null;
  for (const l of links) {
    const cand = ymFromText(`${l.url} ${l.text ?? ""}`, now);
    if (cand && (!ym || cand > ym)) ym = cand;
  }
  if (!ym) return null;
  const iso = isoEndOfMonth(ym);
  for (const s of schemes) {
    if (ymOf(s.asOf) !== ym) s.asOf = iso;
  }
  return ym;
}

/** One disclosure month of an AMC's portfolio. Mirrors AmcMonthSnapshot. */
export interface MonthBucket {
  asOfMonth: string;
  asOf: string | null;
  schemes: AmcScheme[];
}

/**
 * Merge freshly fetched months into the months a snapshot already holds.
 *
 * The monthly run used to write only what it just downloaded, so every run
 * silently deleted the accumulated history — a fund's month-over-month panel
 * collapsed to a single column the morning after the cron fired. Merging keeps
 * each month exactly once (fresh data wins a month we already had, since a
 * restated disclosure is the better copy), newest first, capped at `cap`.
 *
 * Months that aren't a plausible disclosure month are dropped: "Jul 1973" and
 * "May 2021" are what a mis-read maturity date looks like once it has won a
 * modal vote, and keeping such a bucket would both pin the tracker's newest
 * month decades away and occupy a slot in the 12-month window forever.
 */
export function mergeMonthBuckets(
  fresh: MonthBucket[],
  existing: MonthBucket[],
  cap: number = MAX_SNAPSHOT_MONTHS,
  now: Date = new Date(),
): MonthBucket[] {
  const byYm = new Map<string, MonthBucket>();
  // Existing first, then fresh overwrites the months it covers.
  for (const b of [...existing, ...fresh]) {
    if (!b?.schemes?.length) continue;
    const ym = ymOf(b.asOfMonth) ?? ymOf(b.asOf);
    if (!isPlausibleYm(ym, now)) continue;
    byYm.set(ym, { asOfMonth: labelOfYm(ym), asOf: b.asOf ?? isoEndOfMonth(ym), schemes: b.schemes });
  }
  return [...byYm.keys()]
    .sort()
    .reverse()
    .slice(0, cap)
    .map((ym) => byYm.get(ym)!);
}
