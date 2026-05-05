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

const SEED_URLS = [
  "https://www.amfiindia.com/",
  "https://www.amfiindia.com/research-information",
  "https://www.amfiindia.com/data",
  "https://portal.amfiindia.com/",
];

const FOLLOW_KEYWORDS =
  /(aum|data|research|sip|industry|trend|monthly|asset|disclosure|category)/i;

const DOWNLOAD_EXT_RE = /\.(xlsx|xls|csv|pdf)(\?.*)?$/i;

interface Candidate {
  url: string;
  text: string;
  page: string;
}

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
  const cleaned = s.replace(/[,₹\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function absolutize(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

interface PageScan {
  downloads: Candidate[];
  follow: string[];
  title: string;
}

function isAmfiHost(u: string): boolean {
  try {
    const url = new URL(u);
    return /(^|\.)amfiindia\.com$/.test(url.hostname);
  } catch {
    return false;
  }
}

async function scanPage(pageUrl: string): Promise<PageScan | null> {
  try {
    const html = await fetchText(pageUrl);
    const $ = cheerio.load(html);
    const title = $("title").first().text().trim().slice(0, 120);
    const downloads: Candidate[] = [];
    const follow: string[] = [];
    const seenFollow = new Set<string>();

    $("a[href]").each((_, el) => {
      const href = String($(el).attr("href") ?? "").trim();
      if (!href || href.startsWith("#") || href.startsWith("mailto:"))
        return;
      const abs = absolutize(href, pageUrl);
      const text = $(el).text().trim().replace(/\s+/g, " ");

      if (DOWNLOAD_EXT_RE.test(abs)) {
        downloads.push({ url: abs, text, page: pageUrl });
        return;
      }

      if (!isAmfiHost(abs)) return;
      const matches =
        FOLLOW_KEYWORDS.test(abs) || FOLLOW_KEYWORDS.test(text);
      if (!matches) return;
      if (seenFollow.has(abs)) return;
      seenFollow.add(abs);
      follow.push(abs);
    });

    return { downloads, follow, title };
  } catch (err) {
    warn(`discovery: ${pageUrl} → ${(err as Error).message}`);
    return null;
  }
}

export async function discoverDownloads(): Promise<Candidate[]> {
  const downloads: Candidate[] = [];
  const seenDownload = new Set<string>();
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = SEED_URLS.map((u) => ({
    url: u,
    depth: 0,
  }));
  const MAX_PAGES = 30;

  while (queue.length && visited.size < MAX_PAGES) {
    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    info(`discovery: scanning ${url} (depth ${depth})`);
    const scan = await scanPage(url);
    if (!scan) continue;
    info(
      `discovery: ${url} → "${scan.title}" · ${scan.downloads.length} files · ${scan.follow.length} follow`
    );
    if (scan.follow.length && depth === 0) {
      const sample = scan.follow.slice(0, 8).map((u) => `    ${u}`).join("\n");
      info(`  first follow links from ${url}:\n${sample}`);
    }

    for (const d of scan.downloads) {
      if (seenDownload.has(d.url)) continue;
      seenDownload.add(d.url);
      downloads.push(d);
    }

    if (depth < 1) {
      for (const f of scan.follow) {
        if (visited.has(f)) continue;
        if (queue.some((q) => q.url === f)) continue;
        queue.push({ url: f, depth: depth + 1 });
      }
    }
  }

  info(
    `discovery: visited ${visited.size} pages, queued was ${queue.length} more (cap ${MAX_PAGES})`
  );
  return downloads;
}

function isAumCandidate(c: Candidate): boolean {
  const t = (c.text + " " + c.url).toLowerCase();
  return (
    /\.xlsx?$/i.test(c.url) &&
    (/(industry|aaum|aum|asset)/.test(t) ||
      /(monthly|trend|since\s*inception|categorywise)/.test(t))
  );
}

function isSipCandidate(c: Candidate): boolean {
  const t = (c.text + " " + c.url).toLowerCase();
  return /sip/.test(t);
}

interface AumRow {
  month: string;
  totalAum: number;
  equityAum?: number;
}

function findAumColumns(headers: string[]): {
  monthIdx: number;
  totalIdx: number;
  equityIdx: number;
} {
  const norm = headers.map((h) => (h ?? "").toString().toLowerCase());
  const monthIdx = norm.findIndex(
    (h) => /month|period|date/.test(h) && !/year/.test(h)
  );
  let totalIdx = norm.findIndex((h) =>
    /(total|industry|grand\s*total|all\s*scheme)/.test(h)
  );
  if (totalIdx === -1)
    totalIdx = norm.findIndex((h) => /aum|asset/.test(h));
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
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const r = rows[i].map((c) => String(c ?? "").toLowerCase());
      if (
        r.some((c) => /month|period/.test(c)) &&
        r.some((c) => /aum|asset|total/.test(c))
      ) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) continue;

    const headers = rows[headerIdx].map((c) => String(c ?? ""));
    const { monthIdx, totalIdx, equityIdx } = findAumColumns(headers);
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
        if (i === 0) {
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

function parseSipExcel(buffer: ArrayBuffer): SipRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const out: SipRow[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const r = rows[i].map((c) => String(c ?? "").toLowerCase());
      if (
        r.some((c) => /month|period/.test(c)) &&
        r.some((c) => /sip|amount|total/.test(c))
      ) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) continue;
    const headers = rows[headerIdx].map((c) => String(c ?? "").toLowerCase());
    const monthIdx = headers.findIndex((h) => /month|period/.test(h));
    const sipIdx = headers.findIndex((h) =>
      /sip\s*contribution|sip\s*amount|sip|amount|total/.test(h)
    );
    if (monthIdx === -1 || sipIdx === -1) continue;
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const month = parseMonth(String(rows[i][monthIdx] ?? ""));
      const sip = parseNumberLoose(rows[i][sipIdx]);
      if (!month || sip === null) continue;
      out.push({ month, sipFlow: sip });
    }
    if (out.length) break;
  }
  return out;
}

async function tryAumCandidates(candidates: Candidate[]): Promise<AumRow[]> {
  for (const c of candidates) {
    try {
      info(`AUM: trying ${c.url} ("${c.text}")`);
      const buf = await fetchBuffer(c.url);
      const rows = parseAumExcel(buf);
      info(`AUM: parsed ${rows.length} rows from ${c.url}`);
      if (rows.length > 0) return rows;
    } catch (err) {
      warn(`AUM: ${c.url} → ${(err as Error).message}`);
    }
  }
  return [];
}

async function trySipCandidates(candidates: Candidate[]): Promise<SipRow[]> {
  for (const c of candidates) {
    try {
      info(`SIP: trying ${c.url} ("${c.text}")`);
      const isExcel = /\.xlsx?(\?|$)/i.test(c.url);
      let rows: SipRow[];
      if (isExcel) {
        const buf = await fetchBuffer(c.url);
        rows = parseSipExcel(buf);
      } else {
        const html = await fetchText(c.url);
        rows = parseSipHtml(html);
      }
      info(`SIP: parsed ${rows.length} rows from ${c.url}`);
      if (rows.length > 0) return rows;
    } catch (err) {
      warn(`SIP: ${c.url} → ${(err as Error).message}`);
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
  if (aum.length) sources.push("AMFI industry AUM");
  if (sip.length) sources.push("AMFI SIP");
  return { rows, sources };
}

export async function ingestAmfiIndustryMonthly(): Promise<void> {
  const all = await discoverDownloads();
  info(`discovery: found ${all.length} unique download links overall`);
  const sample = all.slice(0, 25).map((c) => `  - ${c.url}  «${c.text}»`);
  if (sample.length) {
    info(`discovery sample (up to 25):\n${sample.join("\n")}`);
  }

  const aumCandidates = all.filter(isAumCandidate);
  const sipCandidates = all.filter(isSipCandidate);
  info(
    `candidates: ${aumCandidates.length} AUM, ${sipCandidates.length} SIP`
  );

  const aum = await tryAumCandidates(aumCandidates);
  const sip = await trySipCandidates(sipCandidates);

  if (aum.length === 0 && sip.length === 0) {
    warn(
      "no industry data could be extracted from any discovered link — keeping previous snapshot"
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
        "AUM in ₹ Cr (industry total + equity where available). SIP in ₹ Cr. Folios not yet populated.",
    },
    rows,
  };
  await writeSnapshot("industry-monthly.json", snapshot);
  info("wrote industry-monthly.json");
}
