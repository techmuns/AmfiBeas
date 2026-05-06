import * as XLSX from "xlsx";
import {
  fetchBuffer,
  info,
  nowIso,
  parseNumberLoose,
  warn,
  writeSnapshot,
} from "./utils";
import { amfiNameToSlug } from "../../src/data/amcs";
import type {
  AmcAaumQuarterlyRow,
  AmcAaumQuarterlySnapshot,
} from "../../src/data/snapshots/types";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

interface QuarterSpec {
  quarter: string; // calendar YYYY-Qx (e.g., 2026-Q1)
  endMon: string;  // last month of the quarter, e.g., "Mar"
  endYY: string;   // last 2 digits of year
  endYear: number;
  fyQ: number;     // Indian FY quarter (1=Apr-Jun, 2=Jul-Sep, 3=Oct-Dec, 4=Jan-Mar)
  fyEndYY: string; // last 2 digits of Indian FY end year
}

function recentQuarters(n: number): QuarterSpec[] {
  const out: QuarterSpec[] = [];
  const now = new Date();
  // Walk backwards from "current calendar quarter - 1" (the most recent COMPLETE quarter)
  const curMonth = now.getMonth();
  let curYear = now.getFullYear();
  let endMonthIdx = Math.floor(curMonth / 3) * 3 - 1; // last month of the previous quarter
  if (endMonthIdx < 0) {
    endMonthIdx = 11;
    curYear -= 1;
  }
  for (let i = 0; i < n; i++) {
    const monthIdx = endMonthIdx; // 0-based
    const year = curYear;
    const calQ = Math.floor(monthIdx / 3) + 1; // 1..4
    const fyQ = monthIdx <= 2 ? 4 : monthIdx <= 5 ? 1 : monthIdx <= 8 ? 2 : 3;
    const fyEndYear = monthIdx <= 2 ? year : year + 1;
    out.push({
      quarter: `${year}-Q${calQ}`,
      endMon: MONTH_ABBR[monthIdx],
      endYY: String(year).slice(-2),
      endYear: year,
      fyQ,
      fyEndYY: String(fyEndYear).slice(-2),
    });
    endMonthIdx -= 3;
    if (endMonthIdx < 0) {
      endMonthIdx = 11;
      curYear -= 1;
    }
  }
  return out;
}

function buildUrlCandidates(q: QuarterSpec): string[] {
  const m = q.endMon;
  const ml = m.toLowerCase();
  const yy = q.endYY;
  const fy = q.fyEndYY;
  const fyQ = q.fyQ;
  return [
    // Single-file naming variants seen on AMFI portal
    `https://portal.amfiindia.com/spages/AAUM-${m}${yy}.xlsx`,
    `https://portal.amfiindia.com/spages/AAUM-${ml}${yy}.xlsx`,
    `https://portal.amfiindia.com/spages/AAUM-${m}-${yy}.xlsx`,
    `https://portal.amfiindia.com/spages/AAUM-${m}-${q.endYear}.xlsx`,
    `https://portal.amfiindia.com/spages/AAUM-Q${fyQ}-FY${fy}.xlsx`,
    `https://portal.amfiindia.com/spages/AAUM-${m}-Q${fyQ}-FY${fy}.xlsx`,
    `https://portal.amfiindia.com/spages/Disclosure-AAUM-${m}${yy}.xlsx`,
    `https://portal.amfiindia.com/spages/Disclosure-of-AAUM-${m}${yy}.xlsx`,
    `https://portal.amfiindia.com/spages/Average-AUM-${m}${yy}.xlsx`,
    `https://portal.amfiindia.com/spages/Avg-AUM-${m}${yy}.xlsx`,
    `https://portal.amfiindia.com/spages/MF-AAUM-${m}${yy}.xlsx`,
  ];
}

interface ParsedAaumRow {
  amcNameAsReported: string;
  amcSlug: string;
  avgAum: number;
}

interface ParseResult {
  rows: ParsedAaumRow[];
  structure: string[];
}

/**
 * Parse an AMFI Disclosure of AAUM Excel. The file format is non-trivial — AMFI
 * publishes a multi-sheet workbook (one sheet per AMC, plus an index). We fall
 * back to scanning every sheet for a "total AAUM" row keyed off the AMC name
 * found in the sheet header.
 *
 * Returns parsed rows + a debug structure log so the first run can tell us
 * exactly what AMFI is shipping today.
 */
function parseAaumExcel(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: "array" });
  const structure: string[] = [`sheets: ${wb.SheetNames.join(" | ")}`];
  const out: ParsedAaumRow[] = [];
  const seen = new Set<string>();

  // Strategy A: an index sheet with all AMCs in a single table.
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];
    if (sheetName === wb.SheetNames[0]) {
      for (let i = 0; i < Math.min(8, rows.length); i++) {
        const preview = rows[i]
          .slice(0, 8)
          .map((c) => String(c ?? "").slice(0, 28))
          .join(" | ");
        structure.push(`  [${sheetName}] row ${i}: ${preview}`);
      }
    }
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const lc = rows[i].map((c) => String(c ?? "").toLowerCase());
      const hasAmc = lc.some((c) =>
        /(amc|fund\s*house|mutual\s*fund\s*name|name\s*of\s*the\s*amc)/.test(c)
      );
      const hasAaum = lc.some((c) => /(aaum|average\s*aum|avg\.\s*aum)/.test(c));
      if (hasAmc && hasAaum) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) continue;

    const headers = rows[headerIdx].map((c) => String(c ?? "").toLowerCase());
    const nameIdx = headers.findIndex((c) =>
      /amc|fund\s*house|mutual\s*fund/.test(c)
    );
    // Prefer "total aaum" or "grand total"; fall back to any aaum/avg column.
    let aaumIdx = headers.findIndex((c) =>
      /(grand\s*total|total\s*aaum|total\s*average\s*aum)/.test(c)
    );
    if (aaumIdx === -1)
      aaumIdx = headers.findIndex((c) =>
        /(aaum|average\s*aum|avg\.\s*aum|avg\s*aum)/.test(c)
      );
    structure.push(
      `  → [${sheetName}] header at row ${headerIdx}: name=${nameIdx} aaum=${aaumIdx}`
    );
    if (nameIdx === -1 || aaumIdx === -1) continue;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const name = String(rows[i][nameIdx] ?? "").trim();
      if (!name) continue;
      if (
        /^(total|grand\s*total|sub\s*total|industry|note|\*)/i.test(name)
      )
        continue;
      const aaum = parseNumberLoose(rows[i][aaumIdx]);
      if (aaum === null || aaum <= 0) continue;
      const slug = amfiNameToSlug(name);
      if (!slug) continue; // only retain mapped slugs (the 4 listed for now)
      const key = `${slug}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ amcNameAsReported: name, amcSlug: slug, avgAum: aaum });
    }

    if (out.length > 0) break; // single sheet sufficient
  }

  return { rows: out, structure };
}

interface DiscoveredUrl {
  url: string;
  text: string;
}

/**
 * Last-resort discovery via Playwright on the AMFI Disclosure of Average AUM
 * landing page (which we already know is JS-rendered). Returns any .xls / .xlsx
 * URL whose text or href looks AAUM-related.
 */
async function discoverViaPlaywright(): Promise<DiscoveredUrl[]> {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    warn(`playwright not available: ${(err as Error).message}`);
    return [];
  }
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  const seedPages = [
    "https://www.amfiindia.com/research-information/aum-data/disclosure-of-average-aum",
    "https://www.amfiindia.com/research-information/aum-data",
    "https://www.amfiindia.com/research-information",
  ];
  const found = new Map<string, DiscoveredUrl>();
  for (const seed of seedPages) {
    try {
      info(`playwright: ${seed}`);
      const resp = await page.goto(seed, {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
      if (!resp || !resp.ok()) {
        warn(`  HTTP ${resp?.status() ?? "no-response"}`);
        continue;
      }
      await page.waitForTimeout(1500);
      const links = await page.$$eval("a[href]", (els) =>
        els.map((el) => {
          const a = el as HTMLAnchorElement;
          return { href: a.href, text: (a.textContent ?? "").trim() };
        })
      );
      for (const { href, text } of links) {
        if (!/\.(xlsx|xls)(\?.*)?$/i.test(href)) continue;
        const blob = (text + " " + href).toLowerCase();
        if (
          /(aaum|average\s*aum|avg\s*aum|disclosure\s*of\s*aum)/.test(blob)
        ) {
          if (!found.has(href)) found.set(href, { url: href, text });
        }
      }
    } catch (err) {
      warn(`  ${seed} → ${(err as Error).message}`);
    }
  }
  await browser.close();
  return Array.from(found.values());
}

interface FetchOutcome {
  url: string;
  rows: ParsedAaumRow[];
}

async function tryUrl(
  url: string,
  loggedStructure: { logged: boolean }
): Promise<FetchOutcome | null> {
  try {
    info(`AAUM: ${url}`);
    const buf = await fetchBuffer(url);
    const { rows, structure } = parseAaumExcel(buf);
    info(`  → parsed ${rows.length} mapped AMC rows`);
    if (!loggedStructure.logged && structure.length > 0) {
      info(
        `  file structure (first hit):\n${structure
          .map((s) => `    ${s}`)
          .join("\n")}`
      );
      loggedStructure.logged = true;
    }
    if (rows.length === 0) return null;
    return { url, rows };
  } catch (err) {
    warn(`  ${url} → ${(err as Error).message}`);
    return null;
  }
}

export async function ingestAmfiAaum(): Promise<void> {
  const quarters = recentQuarters(8);
  const outRows: AmcAaumQuarterlyRow[] = [];
  const fetchedAt = nowIso();
  const loggedStructure = { logged: false };

  for (const q of quarters) {
    info(`AAUM: probing quarter ${q.quarter} (${q.endMon} ${q.endYear})`);
    const candidates = buildUrlCandidates(q);
    let outcome: FetchOutcome | null = null;
    for (const url of candidates) {
      outcome = await tryUrl(url, loggedStructure);
      if (outcome) break;
    }
    if (!outcome) {
      info(`AAUM: no direct URL hit for ${q.quarter}`);
      continue;
    }
    for (const r of outcome.rows) {
      // Validation: AAUM > 0, slug mapping known, quarter known
      if (!Number.isFinite(r.avgAum) || r.avgAum <= 0) continue;
      if (!r.amcSlug) continue;
      outRows.push({
        amcSlug: r.amcSlug,
        amcNameAsReported: r.amcNameAsReported,
        quarter: q.quarter,
        avgAum: r.avgAum,
        source: outcome.url,
        fetchedAt,
        status: "ok",
      });
    }
  }

  if (outRows.length === 0) {
    info("AAUM: direct probing yielded nothing — running playwright discovery");
    const discovered = await discoverViaPlaywright();
    if (discovered.length === 0) {
      warn(
        "AAUM: playwright found no candidate URLs — keeping previous snapshot"
      );
      return;
    }
    info(
      `AAUM: discovered ${discovered.length} candidate URL(s) via playwright`
    );
    discovered
      .slice(0, 25)
      .forEach((d) => info(`  - ${d.url}  «${d.text.slice(0, 60)}»`));
    // Best-effort: try the first candidate against each quarter (the file name
    // typically encodes quarter, so we associate one file → one quarter).
    for (const d of discovered) {
      const outcome = await tryUrl(d.url, loggedStructure);
      if (!outcome) continue;
      // Heuristic: detect quarter from URL/filename; default to most recent.
      const q = inferQuarterFromUrl(d.url) ?? quarters[0];
      for (const r of outcome.rows) {
        outRows.push({
          amcSlug: r.amcSlug,
          amcNameAsReported: r.amcNameAsReported,
          quarter: q.quarter,
          avgAum: r.avgAum,
          source: d.url,
          fetchedAt,
          status: "ok",
        });
      }
    }
  }

  if (outRows.length === 0) {
    warn(
      "AAUM: no rows extracted from any source — keeping previous snapshot"
    );
    return;
  }

  const slugsCovered = new Set(outRows.map((r) => r.amcSlug));
  const quartersCovered = Array.from(
    new Set(outRows.map((r) => r.quarter))
  ).sort();
  info(
    `AAUM: ${outRows.length} rows · ${slugsCovered.size} AMCs · ${quartersCovered.length} quarters · range ${quartersCovered[0]}…${quartersCovered[quartersCovered.length - 1]}`
  );

  const snapshot: AmcAaumQuarterlySnapshot = {
    meta: {
      generatedAt: fetchedAt,
      source:
        "AMFI Disclosure of Average AUM (per-AMC quarterly AAUM, ₹ Cr)",
      notes:
        "Per-row provenance carried in source/fetchedAt fields. Only AMCs with an explicit slug mapping (AMFI_NAME_TO_SLUG) are retained.",
    },
    rows: outRows,
  };
  await writeSnapshot("amc-aaum-quarterly.json", snapshot);
  info("wrote amc-aaum-quarterly.json");
}

function inferQuarterFromUrl(url: string): QuarterSpec | null {
  // Match patterns like Mar26 / Mar-26 / mar26 / Mar2026
  const m = url.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[-_]?(\d{2,4})/i);
  if (!m) return null;
  const monAbbr = m[1].slice(0, 3);
  const monIdx = MONTH_ABBR.findIndex(
    (x) => x.toLowerCase() === monAbbr.toLowerCase()
  );
  if (monIdx === -1) return null;
  let year = Number(m[2]);
  if (year < 100) year += year < 50 ? 2000 : 1900;
  const calQ = Math.floor(monIdx / 3) + 1;
  const fyQ = monIdx <= 2 ? 4 : monIdx <= 5 ? 1 : monIdx <= 8 ? 2 : 3;
  const fyEndYear = monIdx <= 2 ? year : year + 1;
  return {
    quarter: `${year}-Q${calQ}`,
    endMon: MONTH_ABBR[monIdx],
    endYY: String(year).slice(-2),
    endYear: year,
    fyQ,
    fyEndYY: String(fyEndYear).slice(-2),
  };
}
