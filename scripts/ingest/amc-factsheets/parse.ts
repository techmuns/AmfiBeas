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
    const r = rows[i].map(low);
    const isin = r.findIndex((c) => c === "isin" || c.includes("isin"));
    const pct = r.findIndex((c) => c.includes("% to") || c.includes("%to") || (c.includes("%") && (c.includes("nav") || c.includes("aum"))));
    if (isin < 0 || pct < 0) continue;
    const name = r.findIndex((c) => c.includes("name of the instrument") || c.includes("instrument") || c.includes("issuer"));
    const industry = r.findIndex((c) => c.includes("industry") || c.includes("rating"));
    const qty = r.findIndex((c) => c.includes("quantity"));
    const value = r.findIndex((c) => c.includes("market") || c.includes("fair value") || c.includes("market value"));
    if (name < 0 || qty < 0 || value < 0) continue;
    return { headerIdx: i, cols: { name, isin, industry, qty, value, pct } };
  }
  return null;
}

/** Scheme name: first non-empty cell in the top rows that looks like a fund
 *  name ("… Fund"), else the cell after a "SCHEME NAME" label, else the first
 *  longish text cell. */
function findSchemeName(rows: Row[]): string {
  for (let i = 0; i < Math.min(rows.length, 6); i++) {
    for (let j = 0; j < rows[i].length; j++) {
      const cell = s(rows[i][j]);
      if (/scheme name/i.test(cell)) {
        const next = s(rows[i][j + 1]) || s(rows[i + 1]?.[j]);
        if (next) return next;
      }
    }
  }
  for (let i = 0; i < Math.min(rows.length, 4); i++) {
    for (const cell of rows[i]) {
      const t = s(cell);
      if (/\bfund\b/i.test(t) && t.length > 6) return t.replace(/\s*\(.*$/, "").trim();
    }
  }
  return "";
}

function findAsOf(rows: Row[]): string | null {
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
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
    holdings.push({
      isin: isinRaw,
      name: s(r[cols.name]),
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
      const scheme = parseScheme(sheetName, rows, opts);
      if (scheme) out.push(scheme);
    } catch {
      /* skip unparseable sheet */
    }
  }
  return out;
}
