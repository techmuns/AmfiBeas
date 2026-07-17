/**
 * Generic, header-driven parser for AMC monthly-portfolio workbooks.
 *
 * Both SBI and Nippon (and, we expect, the others) publish one workbook with an
 * index sheet + one sheet per scheme. Each scheme sheet has, near the top, a
 * scheme name, an "as on" date, and a header row identifying the holdings
 * columns (Name / ISIN / Industry / Quantity / Market value / % to NAV). Column
 * ORDER differs between AMCs, so we locate columns by fuzzy header match rather
 * than fixed positions — one parser covers every AMC, with only pctScale /
 * value unit differing (see AmcParseOptions).
 */

import * as XLSX from "xlsx";
import type { AmcHolding, AmcParseOptions, AmcScheme } from "./types";

type Cell = string | number | boolean | null;
type Row = Cell[];

const ISIN_RE = /^IN[EF0-9][0-9A-Z]{9}$/; // INE/INF… equity+debt, and IN0…/IN9…
const s = (v: Cell): string => (v == null ? "" : String(v)).trim();
const low = (v: Cell): string => s(v).toLowerCase();

function num(v: Cell): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Excel serial or "May 31,2026" / "31-May-2026" → ISO date. */
function toIso(v: Cell): string | null {
  if (typeof v === "number" && v > 20000 && v < 90000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const str = s(v);
  const m1 = str.match(/([A-Za-z]{3,})\s+(\d{1,2})\s*,?\s*(\d{4})/); // May 31,2026
  const m2 = str.match(/(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{2,4})/); // 31-May-2026
  const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const mk = (y: number, mo: number, d: number) => `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (m1) { const mo = MON[m1[1].slice(0, 3).toLowerCase()]; if (mo) return mk(+m1[3], mo, +m1[2]); }
  if (m2) { const mo = MON[m2[2].slice(0, 3).toLowerCase()]; const y = +m2[3] < 100 ? 2000 + +m2[3] : +m2[3]; if (mo) return mk(y, mo, +m2[1]); }
  return null;
}

interface ColMap { name: number; isin: number; industry: number; qty: number; value: number; pct: number }

/** Find the holdings header row + column indices in the first ~15 rows. */
function findColumns(rows: Row[]): { headerIdx: number; cols: ColMap } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    // Collapse internal whitespace runs so headers like "%  to Net Assets" or
    // "Name of  Instrument" (AMCs pad with double spaces) match the same way as
    // their single-spaced siblings.
    const r = rows[i].map((c) => low(c).replace(/\s+/g, " "));
    const isin = r.findIndex((c) => c === "isin" || c.includes("isin"));
    // "% to NAV/AUM" (SBI, Nippon, …) and the spelled-out "% to Net Assets"
    // (Shriram) name the same weight column.
    const pct = r.findIndex((c) => c.includes("% to") || c.includes("%to") || (c.includes("%") && (c.includes("nav") || c.includes("aum") || c.includes("net asset"))));
    if (isin < 0 || pct < 0) continue;
    const name = r.findIndex((c) => c.includes("name of the instrument") || c.includes("instrument") || c.includes("issuer"));
    const industry = r.findIndex((c) => c.includes("industry") || c.includes("rating"));
    const qty = r.findIndex((c) => c.includes("quantity"));
    const value = r.findIndex((c) => {
      const t = c.replace(/[.\s]/g, "");
      // "Market value" / "Fair value" (SBI, Nippon, Kotak) and the abbreviated
      // "MKT VAL(Rs. Lacs)" (Tata) — same column, different wording.
      return c.includes("market") || c.includes("fair value") || t.includes("mktval") || t.includes("marketval");
    });
    if (name < 0 || qty < 0 || value < 0) continue;
    return { headerIdx: i, cols: { name, isin, industry, qty, value, pct } };
  }
  return null;
}

// A cell that is exactly the fund HOUSE name ("<AMC> Mutual Fund", optionally
// behind a "Name of Mutual Fund :" label) — the banner that tops each scheme
// sheet for many AMCs. It is NOT a scheme name and must never be returned as
// one; it's the reason every ICICI/quant/Invesco scheme used to share a name.
const HOUSE_RE = /(^|:\s*)[a-z][a-z0-9 .&'-]*\bmutual fund\b\s*(\(.*\))?\s*$/i;

/** Tidy a raw title cell: drop a "Portfolio of" prefix, an "as on …" tail, and
 *  a trailing "(An open-ended …)" scheme-type qualifier. Only a *trailing*
 *  descriptor parenthetical is removed — a mid-name token like the "(FMP)" in
 *  "SBI Fixed Maturity Plan (FMP)- Series 34" must survive so those 19 series
 *  don't collapse to one name. */
function cleanSchemeName(t: string): string {
  let out = t
    .replace(/^portfolio of\s+/i, "") // Kotak: "Portfolio of X Fund as on …"
    .replace(/\s+as on\b.*$/i, "") // "… as on May 31, 2026"
    .trim();
  const m = out.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (m && (m[2].length > 15 || /\b(scheme|open[\s-]?end|investing|fund|risk)\b/i.test(m[2]))) {
    out = m[1]; // a trailing category descriptor, e.g. "(An Open Ended … Scheme)"
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Does a top-row cell read like an actual scheme title (vs. a house header,
 *  column header, banner, bullet, or one-line scheme-type description)? */
function looksLikeSchemeName(t: string): boolean {
  if (t.length < 5) return false;
  if (t.endsWith(":")) return false; // a label ("SCHEME NAME :")
  if (HOUSE_RE.test(t)) return false; // the fund-house name
  if (/^[•\-*·]/.test(t)) return false; // bullet / note line
  // Column headers and top-of-sheet banners.
  if (/^(isin|coupon|quantity|rating|industry|% to|exposure|market|fair value|yield|sr\.?\s*no|serial|s\.?\s*no|company|issuer|instrument|name of the|portfolio|monthly portfolio|portfolio statement|scheme name|as on|as at|note|product labelling|disclaimer|back to index|index|derivative)\b/i.test(t)) return false;
  // Asset-class SECTION headers inside the holdings table, not scheme names.
  if (/\b(equity\s*&\s*equity\s*related|listed\s*\/\s*awaiting|debt\s+instruments?\b|money\s+market\b|cash\s*&\s*(cash\s*)?equiv|net\s+(current\s+asset|receivabl|payabl))/i.test(t)) return false;
  // A one-line scheme-type description ("An open ended scheme investing in …").
  if (/^(an?|the)\s+open[\s-]?end/i.test(t) || /\b(scheme|fund)\s+(investing|predominantly|that)\b/i.test(t) || /risk[\s-]?o[\s-]?meter/i.test(t)) return false;
  // A bare sheet-code with no words (e.g. "RLMF001") — real names have a space
  // or an asset-class word.
  if (!/\s/.test(t) && !/fund|etf|plan|scheme/i.test(t)) return false;
  return true;
}

/** Scheme name, in priority order:
 *   1. the cell after an explicit "SCHEME NAME :" label (SBI);
 *   2. the first scheme-like line directly below the "<AMC> Mutual Fund" house
 *      header that tops the sheet (ICICI, quant, Invesco, Bank of India, …) —
 *      this is what fixes the "every scheme shares the house name" bug and also
 *      catches ETFs whose name has no "Fund" in it (e.g. "BHARAT 22 ETF");
 *   3. the first "… Fund" cell that is not itself the house name (Nippon, …). */
function findSchemeName(rows: Row[]): string {
  // 1) Explicit label.
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    for (let j = 0; j < rows[i].length; j++) {
      const cell = s(rows[i][j]);
      if (/^scheme name\b/i.test(cell)) {
        const next = s(rows[i][j + 1]) || s(rows[i + 1]?.[j]);
        if (next && !HOUSE_RE.test(next)) return cleanSchemeName(next);
      }
    }
  }
  // 1b) "(Monthly) Portfolio Statement of <Scheme> as on <date>" — or "… for
  //      <Month> <Year>" (Zerodha) — names the scheme inline (SAMCO, LIC, …).
  //      Grab it before the banner is rejected below.
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    for (const cell of rows[i]) {
      const m = s(cell).match(/portfolio(?:\s+statement)?\s+of\s+(.+?)\s+(?:as\s+on|as\s+at|for\s+the\b|(?:for\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b)/i);
      if (m && m[1] && /\b(fund|fof|etf|plan|scheme)\b/i.test(m[1]) && !HOUSE_RE.test(m[1])) return cleanSchemeName(m[1]);
    }
  }
  // 1c) The scheme name is the first scheme-like line after a "MONTHLY PORTFOLIO
  //     STATEMENT AS ON <date>" banner (Motilal Oswal, whose sheets carry no
  //     house banner ending in "Mutual Fund" and name the fund several rows down).
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (!rows[i].some((c) => /(monthly\s+)?portfolio\s+statement\b[\s\S]*\bas\s+on\b/i.test(s(c)))) continue;
    for (let k = i + 1; k <= Math.min(i + 3, rows.length - 1); k++) {
      for (const cell of rows[k]) {
        if (looksLikeSchemeName(s(cell))) return cleanSchemeName(s(cell));
      }
    }
    break;
  }
  // 2) House-anchored: the title sits just under the fund-house banner.
  for (let i = 0; i < Math.min(rows.length, 4); i++) {
    if (!rows[i].some((c) => HOUSE_RE.test(s(c)))) continue;
    for (let k = i + 1; k <= Math.min(i + 3, rows.length - 1); k++) {
      for (const cell of rows[k]) {
        const t = s(cell);
        if (looksLikeSchemeName(t)) return cleanSchemeName(t);
      }
    }
    break; // found the house banner; don't fall through and re-grab it below
  }
  // 3) Fallback: first "… Fund" cell that isn't the house name.
  for (let i = 0; i < Math.min(rows.length, 4); i++) {
    for (const cell of rows[i]) {
      const t = s(cell);
      if (/\bfund\b/i.test(t) && t.length > 6 && !HOUSE_RE.test(t)) {
        return cleanSchemeName(t);
      }
    }
  }
  return "";
}

function findAsOf(rows: Row[]): string | null {
  // Scan through the header-row band: some AMCs (Shriram) print "Portfolio
  // Statement as on <date>" on the line just above the column header at row ~11.
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    for (let j = 0; j < rows[i].length; j++) {
      const cell = rows[i][j];
      if (/as on|statement as|portfolio statement/i.test(s(cell))) {
        const iso = toIso(cell) || toIso(rows[i][j + 1]) || toIso(rows[i + 1]?.[j]);
        if (iso) return iso;
      }
      const iso = toIso(cell);
      if (iso && s(cell).length < 30) return iso;
    }
  }
  return null;
}

/** Parse one scheme sheet → holdings (rows that carry an ISIN). */
function parseScheme(name: string, rows: Row[], opts: AmcParseOptions): AmcScheme | null {
  const found = findColumns(rows);
  if (!found) return null;
  const { headerIdx, cols } = found;
  const holdings: AmcHolding[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const isinRaw = s(r[cols.isin]).toUpperCase().replace(/\s+/g, "");
    if (!ISIN_RE.test(isinRaw)) continue; // only real securities
    const value = num(r[cols.value]);
    const pct = num(r[cols.pct]);
    // Name: usually cols.name, but some AMCs (Kotak) merge the "Name of
    // Instrument" header across cells while the value sits a column or two
    // over — fall forward to the first non-empty, non-ISIN text cell.
    let name = s(r[cols.name]);
    if (!name) {
      for (let c = cols.name + 1; c <= Math.min(cols.name + 3, r.length - 1); c++) {
        if (c === cols.isin) continue;
        const v = s(r[c]);
        if (v && !ISIN_RE.test(v.toUpperCase().replace(/\s+/g, ""))) { name = v; break; }
      }
    }
    holdings.push({
      isin: isinRaw,
      name,
      industry: cols.industry >= 0 ? s(r[cols.industry]) || null : null,
      quantity: num(r[cols.qty]),
      marketValueCr: value == null ? null : Math.round((value / opts.valueToCr) * 100) / 100,
      pctToNav: pct == null ? null : Math.round(pct * opts.pctScale * 10000) / 10000,
    });
  }
  if (holdings.length === 0) return null;
  return {
    schemeCode: name,
    schemeName: findSchemeName(rows) || name,
    asOf: findAsOf(rows),
    holdings,
  };
}

/** Parse a whole AMC workbook buffer → schemes. */
export function parseAmcWorkbook(buf: ArrayBuffer | Buffer, opts: AmcParseOptions): AmcScheme[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const out: AmcScheme[] = [];
  for (const sheetName of wb.SheetNames) {
    if (/^index$/i.test(sheetName)) continue;
    if (opts.skipSheets?.(sheetName)) continue;
    try {
      const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheetName], { header: 1, blankrows: false, defval: null });
      // Some AMCs (UTI) pack EVERY scheme into ONE sheet, each block introduced by
      // a "SCHEME: <name>" row. Split on those markers so each fund parses on its
      // own; with 0–1 markers, parse the whole sheet as before (no behaviour change
      // for the one-scheme-per-sheet AMCs).
      const marks: { i: number; name: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const m = /^\s*scheme\s*[:\-]\s*(.+\S)/i.exec(s(rows[i]?.[0]));
        if (m) marks.push({ i, name: m[1].replace(/[.\s]+$/, "").trim() });
      }
      if (marks.length >= 2) {
        for (let k = 0; k < marks.length; k++) {
          const seg = rows.slice(marks[k].i + 1, k + 1 < marks.length ? marks[k + 1].i : rows.length);
          const scheme = parseScheme(marks[k].name, seg, opts);
          if (scheme) out.push(scheme);
        }
      } else {
        const scheme = parseScheme(sheetName, rows, opts);
        if (scheme) out.push(scheme);
      }
    } catch {
      /* skip unparseable sheet */
    }
  }
  return out;
}
