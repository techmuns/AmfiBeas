import * as XLSX from "xlsx";
import * as cheerio from "cheerio";
import type {
  IndustryMonthlyRow,
  IndustryMonthlySnapshot,
} from "../../src/data/snapshots/types";
import {
  fetchBuffer,
  fetchText,
  info,
  nowIso,
  warn,
  writeSnapshot,
} from "./utils";

const AUM_EXCEL_URLS = [
  "https://www.amfiindia.com/Themes/Theme1/downloads/MF-Industry-Performance-since-Inception.xlsx",
  "https://www.amfiindia.com/Themes/Theme1/downloads/Mutual%20Fund%20Industry%20Performance%20since%20Inception.xlsx",
  "https://www.amfiindia.com/Themes/Theme1/downloads/aum-since-inception.xlsx",
];

const SIP_HTML_URLS = [
  "https://www.amfiindia.com/research-information/aum-data/sip",
  "https://www.amfiindia.com/research-information/other-data/mf-sip-data",
];

const MONTHS_LOOKUP: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function parseMonth(s: string): string | null {
  if (!s) return null;
  const cleaned = s.replace(/\s+/g, " ").trim().toLowerCase();
  let m = cleaned.match(/^([a-z]{3,9})[\s\-,]+'?(\d{2,4})$/);
  if (!m) m = cleaned.match(/^([a-z]{3,9})\s*(\d{2,4})$/);
  if (!m) m = cleaned.match(/(\d{4})-(\d{2})/);
  if (m && /^\d{4}$/.test(m[1])) {
    return `${m[1]}-${m[2].padStart(2, "0")}`;
  }
  if (m) {
    const monthName = m[1];
    const yearRaw = m[2];
    const monthNum = MONTHS_LOOKUP[monthName];
    if (!monthNum) return null;
    let year = Number(yearRaw);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    return `${year}-${String(monthNum).padStart(2, "0")}`;
  }
  return null;
}

function parseNumberLoose(s: unknown): number | null {
  if (typeof s === "number" && Number.isFinite(s)) return s;
  if (typeof s !== "string") return null;
  const cleaned = s.replace(/[,₹\s]/g, "").replace(/[ ]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

interface AumRow {
  month: string;
  totalAum: number;
  equityAum?: number;
}

function findColumns(headers: string[]): {
  monthIdx: number;
  totalIdx: number;
  equityIdx: number;
} {
  const norm = headers.map((h) => (h ?? "").toString().toLowerCase());
  const monthIdx = norm.findIndex(
    (h) => /month|period|date/.test(h) && !/year/.test(h)
  );
  let totalIdx = norm.findIndex((h) =>
    /(total|industry|all\s*scheme|aum)/.test(h)
  );
  if (totalIdx === -1)
    totalIdx = norm.findIndex((h) => /aum|asset/i.test(h));
  const equityIdx = norm.findIndex((h) => /equity/.test(h));
  return { monthIdx, totalIdx, equityIdx };
}

export function parseAumExcel(buffer: ArrayBuffer): AumRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const out: AumRow[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];
    if (!rows.length) continue;

    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const r = rows[i].map((c) => String(c ?? "").toLowerCase());
      if (
        r.some((c) => /month|period/.test(c)) &&
        r.some((c) => /aum|asset/.test(c))
      ) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) continue;

    const headers = rows[headerIdx].map((c) => String(c ?? ""));
    const { monthIdx, totalIdx, equityIdx } = findColumns(headers);
    if (monthIdx === -1 || totalIdx === -1) continue;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const month = parseMonth(String(r[monthIdx] ?? ""));
      const total = parseNumberLoose(r[totalIdx]);
      if (!month || total === null) continue;
      const equity =
        equityIdx !== -1 ? parseNumberLoose(r[equityIdx]) : null;
      out.push({
        month,
        totalAum: total,
        equityAum: equity ?? undefined,
      });
    }
    if (out.length) break;
  }
  return out;
}

interface SipRow {
  month: string;
  sipFlow: number;
}

export function parseSipHtml(html: string): SipRow[] {
  const $ = cheerio.load(html);
  const tables = $("table");
  const out: SipRow[] = [];
  tables.each((_, tbl) => {
    const headers = $(tbl)
      .find("thead tr th, tr:first-child th, tr:first-child td")
      .map((_, el) => $(el).text().trim().toLowerCase())
      .get();
    const monthIdx = headers.findIndex(
      (h) => /month|period/.test(h) && !/year/.test(h)
    );
    const sipIdx = headers.findIndex((h) =>
      /sip\s*contribution|sip\s*amount|amount|total/.test(h)
    );
    if (monthIdx === -1 || sipIdx === -1) return;
    $(tbl)
      .find("tbody tr, tr")
      .each((i, row) => {
        if (i === 0 && monthIdx >= 0) {
          const first = $(row).find("th, td").first().text().trim();
          if (/month|period/i.test(first)) return;
        }
        const cells = $(row)
          .find("td")
          .map((_, td) => $(td).text().trim())
          .get();
        if (cells.length === 0) return;
        const month = parseMonth(cells[monthIdx] ?? "");
        const sip = parseNumberLoose(cells[sipIdx] ?? "");
        if (!month || sip === null) return;
        out.push({ month, sipFlow: sip });
      });
  });
  return out;
}

async function tryFetchAumExcel(): Promise<AumRow[]> {
  for (const url of AUM_EXCEL_URLS) {
    try {
      info(`AUM: trying ${url}`);
      const buf = await fetchBuffer(url);
      const rows = parseAumExcel(buf);
      info(`AUM: parsed ${rows.length} rows from ${url}`);
      if (rows.length > 0) return rows;
    } catch (err) {
      warn(`AUM: ${url} → ${(err as Error).message}`);
    }
  }
  return [];
}

async function tryFetchSip(): Promise<SipRow[]> {
  for (const url of SIP_HTML_URLS) {
    try {
      info(`SIP: trying ${url}`);
      const html = await fetchText(url);
      const rows = parseSipHtml(html);
      info(`SIP: parsed ${rows.length} rows from ${url}`);
      if (rows.length > 0) return rows;
    } catch (err) {
      warn(`SIP: ${url} → ${(err as Error).message}`);
    }
  }
  return [];
}

function mergeRows(
  aum: AumRow[],
  sip: SipRow[]
): { rows: IndustryMonthlyRow[]; sources: string[] } {
  const map = new Map<string, IndustryMonthlyRow>();
  for (const a of aum) {
    map.set(a.month, {
      month: a.month,
      totalAum: a.totalAum,
      equityAum: a.equityAum ?? 0,
      sipFlow: 0,
      folios: 0,
    });
  }
  for (const s of sip) {
    const existing = map.get(s.month);
    if (existing) existing.sipFlow = s.sipFlow;
    else
      map.set(s.month, {
        month: s.month,
        totalAum: 0,
        equityAum: 0,
        sipFlow: s.sipFlow,
        folios: 0,
      });
  }
  const rows = Array.from(map.values()).sort((a, b) =>
    a.month.localeCompare(b.month)
  );
  const sources: string[] = [];
  if (aum.length) sources.push("AMFI industry AUM Excel");
  if (sip.length) sources.push("AMFI SIP page");
  return { rows, sources };
}

export async function ingestAmfiIndustryMonthly(): Promise<void> {
  const aum = await tryFetchAumExcel();
  const sip = await tryFetchSip();

  if (aum.length === 0 && sip.length === 0) {
    warn(
      "no industry data could be fetched from any candidate URL — keeping previous snapshot"
    );
    return;
  }

  const { rows, sources } = mergeRows(aum, sip);
  info(
    `industry-monthly: ${rows.length} rows merged · sources: ${sources.join(
      ", "
    )}`
  );

  const snapshot: IndustryMonthlySnapshot = {
    meta: {
      generatedAt: nowIso(),
      source: sources.join(" + "),
      notes:
        "AUM in ₹ Cr (industry total + equity where available). SIP in ₹ Cr. Folios are not yet populated.",
    },
    rows,
  };
  await writeSnapshot("industry-monthly.json", snapshot);
  info("wrote industry-monthly.json");
}
