/**
 * Shared helpers for the mf-data / AMFI NAV pipeline — used by both the
 * historical builder (nav-history-from-mfdata.ts) and the daily forward
 * refresh (nav-daily-refresh.ts), so the CSV parsing, date handling, scheme
 * attribute detection and return-period availability stay identical across
 * the two (and the manifest periodCoverage stays consistent with what
 * nav-returns.ts later recomputes + validates).
 *
 * The parser is HEADER-DRIVEN (columns discovered by name), so it handles both
 * AMFI layouts transparently:
 *   - mf-data bulk history CSV: Scheme Code;Scheme Name;ISIN…;ISIN…;NAV;Repurchase;Sale;Date
 *   - live NAVAll.txt:          Scheme Code;ISIN…;ISIN…;Scheme Name;NAV;Date
 */
import type { SchemeNav } from "../../src/data/snapshots/types";

export type Plan = "direct" | "regular" | "unknown";
export type Option = "growth" | "idcw" | "unknown";
export type PeriodKey = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y" | "10Y";

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "01-Jan-2016" / "20-Jun-2026" → "2016-01-01" / "2026-06-20"; null if malformed. */
export function ddMMMyyyyToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mm = MONTHS[m[2].toLowerCase()];
  if (!mm) return null;
  return `${m[3]}-${String(mm).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
/** ISO "2026-06-20" → "20-Jun-2026". */
export function isoToDDMMMYYYY(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${MONTH_ABBR[Number(m) - 1] ?? m}-${y}`;
}

// ---------------------------------------------------------------------------
// CSV parsing (header-driven)
// ---------------------------------------------------------------------------

const SECTION_LINE_RE = /^(Open|Close|Interval) Ended Schemes.*/i;

export interface ColumnMap {
  schemeCode: number;
  schemeName: number;
  isinGrowth: number;
  isinReinv: number;
  nav: number;
  date: number;
}
export function buildColumnMap(headerCells: string[]): ColumnMap | null {
  const idxOf = (re: RegExp) => headerCells.findIndex((c) => re.test(c));
  const isinIdxs = headerCells.map((c, i) => ({ c, i })).filter((x) => /isin/i.test(x.c)).map((x) => x.i);
  const dateIdxs = headerCells.map((c, i) => ({ c, i })).filter((x) => /date/i.test(x.c)).map((x) => x.i);
  const map: ColumnMap = {
    schemeCode: idxOf(/scheme\s*code/i),
    schemeName: idxOf(/scheme\s*name/i),
    isinGrowth: isinIdxs[0] ?? -1,
    isinReinv: isinIdxs[1] ?? -1,
    nav: idxOf(/net\s*asset\s*value/i),
    date: dateIdxs.length ? dateIdxs[dateIdxs.length - 1] : -1,
  };
  if (map.schemeCode < 0 || map.schemeName < 0 || map.nav < 0 || map.date < 0) return null;
  return map;
}

/** Full parse → SchemeNav[] (carries name + ISIN + AMC + category, for the
 *  crosswalk + plan pairing). */
export function parseNavCsvFull(text: string): SchemeNav[] {
  const out: SchemeNav[] = [];
  let cm: ColumnMap | null = null;
  let amcName = "";
  let category = "";
  const codeMap = new Map<string, number>();
  let nextAmc = 1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (SECTION_LINE_RE.test(line)) { category = line; continue; }
    if (/^scheme\s*code/i.test(line)) {
      cm = buildColumnMap(line.split(";").map((s) => s.trim()));
      continue;
    }
    if (!line.includes(";")) {
      amcName = line;
      if (!codeMap.has(amcName)) codeMap.set(amcName, nextAmc++);
      continue;
    }
    if (!cm) continue;
    const parts = line.split(";").map((s) => s.trim());
    const code = Number(parts[cm.schemeCode]);
    const nav = Number(parts[cm.nav] ?? "");
    const iso = ddMMMyyyyToIso(parts[cm.date] ?? "");
    if (!Number.isFinite(code) || !Number.isFinite(nav) || nav <= 0 || iso === null) continue;
    const isinG = cm.isinGrowth >= 0 ? parts[cm.isinGrowth] : "";
    const isinR = cm.isinReinv >= 0 ? parts[cm.isinReinv] : "";
    const isin = isinG && isinG !== "-" ? isinG : isinR && isinR !== "-" ? isinR : undefined;
    out.push({
      schemeCode: code,
      amcCode: codeMap.get(amcName) ?? 0,
      amcName,
      category,
      schemeName: parts[cm.schemeName] ?? "",
      isin,
      nav,
      date: iso,
    });
  }
  return out;
}

/** Light streaming parse: invoke `onRow(code, nav, isoDate)` for each valid NAV
 *  row. No object allocation per scheme — used for the big history stream and
 *  the daily latest-by-code pass. */
export function streamNavRows(
  text: string,
  onRow: (code: number, nav: number, iso: string) => void
): void {
  let cm: ColumnMap | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (SECTION_LINE_RE.test(line)) continue;
    if (/^scheme\s*code/i.test(line)) {
      cm = buildColumnMap(line.split(";").map((s) => s.trim()));
      continue;
    }
    if (!line.includes(";") || !cm) continue;
    const parts = line.split(";");
    const code = Number(parts[cm.schemeCode]);
    if (!Number.isFinite(code)) continue;
    const nav = Number(parts[cm.nav]);
    const iso = ddMMMyyyyToIso((parts[cm.date] ?? "").trim());
    if (!Number.isFinite(nav) || nav <= 0 || iso === null) continue;
    onRow(code, nav, iso);
  }
}

// ---------------------------------------------------------------------------
// Name-derived scheme attributes
// ---------------------------------------------------------------------------

export function inferPlan(name: string): Plan {
  const s = name.toLowerCase();
  if (/-reg|\(reg\)|\bregular\b/.test(s)) return "regular";
  if (/-dir|\(dir\)|\bdirect\b/.test(s)) return "direct";
  if (/\((g|idcw|dividend)\)/.test(s)) return "direct";
  return "unknown";
}
export function inferOption(name: string): Option {
  const s = name.toLowerCase();
  if (/\b(idcw|dividend|div\b)/.test(s)) return "idcw";
  // "Cumulative" is ICICI's label for the growth option.
  if (/\bgrowth\b|\bcumulative\b|\((g|growth)\)/.test(s)) return "growth";
  return "unknown";
}
export function isEtfName(name: string, cls: string | null): boolean {
  return /\b(etf|exchange traded)\b/i.test(name) || (cls ?? "").includes("ETF");
}
export function isFofName(name: string, cls: string | null): boolean {
  return /\bfof\b|\bfund of funds?\b/i.test(name) || (cls ?? "").includes("FoFs");
}

// ---------------------------------------------------------------------------
// Return-period availability — MUST mirror scripts/ingest/nav-returns.ts so the
// manifest's periodCoverage matches what that script later recomputes (it
// validates exact equality before writing the returns snapshot).
// ---------------------------------------------------------------------------

function subPeriod(iso: string, months: number, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  let ny = y - years;
  let nm = m - months;
  while (nm <= 0) { nm += 12; ny -= 1; }
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, dim);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}
function nearestPrior(series: Array<[string, number]>, target: string): [string, number] | null {
  for (let i = series.length - 1; i >= 0; i--) if (series[i][0] <= target) return series[i];
  return null;
}
function elapsedYears(startIso: string, endIso: string): number {
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  return (Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / (86400_000 * 365.25);
}
const PERIODS: Array<{ key: PeriodKey; months: number; years: number; cagr: boolean }> = [
  { key: "1M", months: 1, years: 0, cagr: false },
  { key: "3M", months: 3, years: 0, cagr: false },
  { key: "6M", months: 6, years: 0, cagr: false },
  { key: "1Y", months: 0, years: 1, cagr: false },
  { key: "3Y", months: 0, years: 3, cagr: true },
  { key: "5Y", months: 0, years: 5, cagr: true },
  { key: "10Y", months: 0, years: 10, cagr: true },
];
export function availablePeriods(series: Array<[string, number]>): PeriodKey[] {
  const out: PeriodKey[] = [];
  if (series.length < 2) return out;
  const end = series[series.length - 1];
  const firstDate = series[0][0];
  for (const p of PERIODS) {
    const target = subPeriod(end[0], p.months, p.years);
    if (firstDate > target) continue;
    const start = nearestPrior(series, target);
    if (!start || start[1] <= 0) continue;
    if (p.cagr) {
      const years = elapsedYears(start[0], end[0]);
      if (!(years > 0) || !(end[1] > 0) || !(start[1] > 0)) continue;
    }
    out.push(p.key);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Output file shapes (byte-compatible with the API backfill's output)
// ---------------------------------------------------------------------------

export interface HistoryMeta {
  schemecode: string;
  amfiSchemeCode: number;
  isin: string | null;
  fundName: string;
  amfiSchemeName: string | null;
  amfiAmcName: string | null;
  classification: string | null;
  plan: Plan;
  option: Option;
  isEtf: boolean;
  isFof: boolean;
  firstDate: string | null;
  lastDate: string | null;
  points: number;
  stage: number;
  ruleVersion: number;
  parserVersion: number;
  generatedAt: string;
  lastForwardAppendAt: string | null;
  provenance: {
    backfillSource: string;
    source: string;
    parser: string;
    parserVersion: number;
    firstFile?: string;
    lastFile?: string;
    forwardSource?: string;
  };
}
export interface HistoryFile {
  meta: HistoryMeta;
  series: Array<[string, number]>;
}
export interface ManifestFund {
  schemecode: string;
  amfiSchemeCode: number;
  fundName: string;
  classification: string | null;
  firstDate: string | null;
  lastDate: string | null;
  points: number;
  available: boolean;
  availablePeriods: PeriodKey[];
  path: string;
}

/** Stable plan-key sort: numeric base ascending, Regular ("{code}") before its
 *  Direct sibling ("{code}-D"). */
export function planKeyRank(k: string): [number, number] {
  const isD = k.endsWith("-D");
  const n = Number(isD ? k.slice(0, -2) : k);
  return [Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER, isD ? 1 : 0];
}

export async function atomicWriteJson(
  fs: typeof import("node:fs/promises"),
  p: string,
  data: unknown
): Promise<void> {
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tmp, p);
}
