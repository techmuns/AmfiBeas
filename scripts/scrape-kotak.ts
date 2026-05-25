/**
 * ONE-OFF throwaway scraper (not part of the ingest pipeline).
 *
 * RupeeVest's Portfolio Tracker is driven by two public JSON endpoints that
 * the page itself calls:
 *   GET /home/get_search_data            -> { search_data:[{schemecode,s_name1}], search_data_nfo:[...] }
 *   GET /home/get_mf_portfolio_tracker?schemecode=CODE
 *        -> { fund_info:[{s_name,aumtotal,aumdate,classification}],
 *             month_name:[m0,m1,m2,m3],            // m0 = most recent
 *             MonthwiseAUM:[{aum},...],
 *             stock_data:[ [ {fincode,noshares,percent_aum}, ... ] (per month) ],
 *             stock_mapping:{ fincode: companyName }, ... (debt fields ignored) }
 *
 * The change arrows shown in the UI are NOT in the data; the page derives them
 * by comparing each month's share count to the next-older month
 * (incr / decr / nochange), and shows no arrow on the oldest column. We
 * replicate that exactly. EQUITY HOLDINGS ONLY.
 *
 * Claude's container can't reach rupeevest (network allowlist), so this runs on
 * a GitHub Actions runner. We load the page once for cookies, then fetch the
 * endpoints via the browser context's request (shares cookies/origin). The raw
 * tracker JSON is always dumped to ./scrape-debug so parsing can be redone
 * locally with no further network access. Exits 0 even on partial failure.
 */
import { chromium, type APIRequestContext } from "playwright";
import fs from "node:fs";
import path from "node:path";

const FUND = process.env.FUND_NAME ?? "Kotak Arbitrage Fund(G)";
const ORIGIN = "https://www.rupeevest.com";
const PAGE_URL = `${ORIGIN}/Mutual-Fund-Portfolio-Tracker`;
const OUT_DIR = process.cwd();
const DEBUG_DIR = path.join(OUT_DIR, "scrape-debug");
const CSV_FILE = path.join(OUT_DIR, "kotak-arbitrage-fund-g-equity-holdings.csv");
const JSON_FILE = path.join(OUT_DIR, "kotak-arbitrage-fund-g-equity-holdings.json");

fs.mkdirSync(DEBUG_DIR, { recursive: true });
const logLines: string[] = [];
const L = (msg: string) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
};
const dump = (name: string, content: string) => {
  fs.writeFileSync(path.join(DEBUG_DIR, name), content);
  L(`dumped scrape-debug/${name} (${content.length} bytes)`);
};

const AJAX_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  Referer: PAGE_URL,
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const slugMonth = (label: string) =>
  label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function toNumOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[,\s₹%]/g, "");
  if (s === "" || s === "-" || s.toLowerCase() === "null") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Indian digit grouping: 36165750 -> "3,61,65,750" (matches the tracker UI).
function indianFmt(n: number): string {
  const neg = n < 0;
  let s = String(Math.abs(Math.round(n)));
  if (s.length > 3) {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    s = `${rest},${last3}`;
  }
  return neg ? `-${s}` : s;
}

type Arrow = "up" | "down" | "flat/none" | "missing" | "unknown";

// Faithful replication of the page's incr/decr/nochange logic.
// shares[0] = most recent month ... shares[3] = oldest. i is the month index.
function arrowFor(shares: (number | null)[], i: number): Arrow {
  const cur = shares[i];
  if (cur == null) return "missing"; // no holding reported that month
  if (i >= shares.length - 1) return "flat/none"; // oldest column: UI shows no arrow
  const prev = shares[i + 1]; // next-older month
  if (prev == null) return "up"; // had none before, has now -> incr
  if (cur > prev) return "up";
  if (cur < prev) return "down";
  return "flat/none"; // nochange
}

interface SearchEntry {
  schemecode: string | number;
  s_name1: string;
}

async function getJson(req: APIRequestContext, url: string, tag: string): Promise<any | null> {
  try {
    const res = await req.get(url, { headers: AJAX_HEADERS, timeout: 60000 });
    L(`${tag}: HTTP ${res.status()} ${res.statusText()}`);
    const body = await res.text();
    if (!res.ok()) {
      dump(`${tag}-error-body.txt`, body.slice(0, 2000));
      return null;
    }
    try {
      return JSON.parse(body);
    } catch {
      dump(`${tag}-nonjson-body.txt`, body.slice(0, 4000));
      L(`${tag}: response was not JSON`);
      return null;
    }
  } catch (e) {
    L(`${tag}: request failed: ${(e as Error).message}`);
    return null;
  }
}

function findScheme(search: any): { code: string; name: string } | null {
  const pools: SearchEntry[] = [
    ...(Array.isArray(search?.search_data) ? search.search_data : []),
    ...(Array.isArray(search?.search_data_nfo) ? search.search_data_nfo : []),
  ];
  L(`search pool size: ${pools.length}`);
  const target = norm(FUND);
  const targetCompact = target.replace(/\s+/g, "");
  const kotak = pools.filter((e) => /kotak arbitrage/i.test(e?.s_name1 ?? ""));
  dump(
    "kotak-candidates.json",
    JSON.stringify(kotak.map((e) => ({ schemecode: e.schemecode, s_name1: e.s_name1 })), null, 2)
  );
  L(`kotak-arbitrage candidates: ${kotak.length}`);

  const exact = pools.find((e) => norm(e.s_name1 ?? "") === target);
  const compact = pools.find((e) => norm(e.s_name1 ?? "").replace(/\s+/g, "") === targetCompact);
  const contains = pools.find((e) => norm(e.s_name1 ?? "").includes(target));
  const firstKotak = kotak[0];
  const hit = exact ?? compact ?? contains ?? firstKotak;
  if (!hit) return null;
  return { code: String(hit.schemecode), name: hit.s_name1 };
}

interface MonthCell {
  aum_pct_raw: string;
  aum_pct_num: number | null;
  shares_raw: string;
  shares_num: number | null;
  arrow: Arrow;
  arrow_raw: string | null;
}
interface OutRow {
  company_name: string;
  fincode: string;
  months: Record<string, MonthCell>;
}

function buildRows(data: any, monthLabels: string[]): OutRow[] {
  const stockData: any[][] = Array.isArray(data?.stock_data) ? data.stock_data : [];
  const mapping: Record<string, string> = data?.stock_mapping ?? {};
  const n = monthLabels.length;

  // Per fincode: arrays of percent_aum and noshares indexed by month.
  const pctByFin = new Map<string, (string | null)[]>();
  const shrByFin = new Map<string, (number | null)[]>();
  const order: string[] = [];

  for (let i = 0; i < n; i++) {
    const monthArr = Array.isArray(stockData[i]) ? stockData[i] : [];
    for (const h of monthArr) {
      const fin = String(h.fincode);
      if (!pctByFin.has(fin)) {
        pctByFin.set(fin, Array(n).fill(null));
        shrByFin.set(fin, Array(n).fill(null));
        order.push(fin);
      }
      pctByFin.get(fin)![i] = h.percent_aum == null ? null : String(h.percent_aum);
      shrByFin.get(fin)![i] = toNumOrNull(h.noshares);
    }
  }

  const slugs = monthLabels.map(slugMonth);
  const rows: OutRow[] = [];
  for (const fin of order) {
    const pct = pctByFin.get(fin)!;
    const shr = shrByFin.get(fin)!;
    const months: Record<string, MonthCell> = {};
    for (let i = 0; i < n; i++) {
      const pctNum = toNumOrNull(pct[i]);
      const shrNum = shr[i];
      months[slugs[i]] = {
        aum_pct_raw: pct[i] == null ? "-" : String(pct[i]),
        aum_pct_num: pctNum,
        shares_raw: shrNum == null ? "-" : indianFmt(shrNum),
        shares_num: shrNum,
        arrow: arrowFor(shr, i),
        arrow_raw: null,
      };
    }
    rows.push({
      company_name: mapping[fin] ?? `#${fin}`,
      fincode: fin,
      months,
    });
  }
  return rows;
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function writeCsv(rows: OutRow[], monthLabels: string[]): void {
  const slugs = monthLabels.map(slugMonth);
  const header = ["company_name"];
  for (const s of slugs) {
    header.push(
      `${s}_aum_pct_raw`,
      `${s}_aum_pct_num`,
      `${s}_shares_raw`,
      `${s}_shares_num`,
      `${s}_arrow`
    );
  }
  const lines = [header.map(csvEscape).join(",")];
  for (const r of rows) {
    const cells = [r.company_name];
    for (const s of slugs) {
      const m = r.months[s];
      cells.push(
        m.aum_pct_raw,
        m.aum_pct_num != null ? String(m.aum_pct_num) : "",
        m.shares_raw,
        m.shares_num != null ? String(m.shares_num) : "",
        m.arrow
      );
    }
    lines.push(cells.map(csvEscape).join(","));
  }
  fs.writeFileSync(CSV_FILE, lines.join("\n") + "\n");
  L(`wrote ${CSV_FILE} (${rows.length} data rows)`);
}

async function main() {
  L(`fund="${FUND}"  origin=${ORIGIN}`);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  });
  let ok = false;
  try {
    const page = await ctx.newPage();
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(2000);
    L("page loaded (session cookies established)");

    const search = await getJson(ctx.request, `${ORIGIN}/home/get_search_data`, "get_search_data");
    if (!search) throw new Error("could not load get_search_data");

    const scheme = findScheme(search);
    if (!scheme) throw new Error(`fund not found in search data: ${FUND}`);
    L(`matched scheme: code=${scheme.code} name="${scheme.name}"`);

    const tracker = await getJson(
      ctx.request,
      `${ORIGIN}/home/get_mf_portfolio_tracker?schemecode=${encodeURIComponent(scheme.code)}`,
      "get_mf_portfolio_tracker"
    );
    if (!tracker) throw new Error("could not load get_mf_portfolio_tracker");
    dump("tracker.json", JSON.stringify(tracker, null, 2));

    const info = Array.isArray(tracker.fund_info) ? tracker.fund_info[0] : null;
    L(`fund_info: s_name="${info?.s_name}" classification="${info?.classification}" aumtotal=${info?.aumtotal} aumdate=${info?.aumdate}`);

    const monthLabels: string[] = (Array.isArray(tracker.month_name) ? tracker.month_name : [])
      .map((m: unknown) => String(m).trim())
      .filter((m: string) => m.length > 0);
    L(`month_name: ${JSON.stringify(monthLabels)}`);
    const monthlyAum = (Array.isArray(tracker.MonthwiseAUM) ? tracker.MonthwiseAUM : []).map(
      (a: any) => a?.aum ?? null
    );

    if (monthLabels.length === 0) throw new Error("no month labels in tracker payload");

    const rows = buildRows(tracker, monthLabels);
    L(`built ${rows.length} equity rows`);
    if (rows.length === 0) throw new Error("no equity rows parsed (stock_data empty?)");

    const payload = {
      meta: {
        source: PAGE_URL,
        endpoint: `${ORIGIN}/home/get_mf_portfolio_tracker?schemecode=${scheme.code}`,
        fund: info?.s_name ?? scheme.name,
        requestedFund: FUND,
        schemecode: scheme.code,
        classification: info?.classification ?? null,
        aumTotalCr: info?.aumtotal ?? null,
        aumAsOf: info?.aumdate ?? null,
        scrapedAt: new Date().toISOString(),
        months: monthLabels.map((label, i) => ({ label, aumCr: monthlyAum[i] ?? null })),
        section: "Equity Holdings",
        extractionMethod: "json-endpoint",
        arrowLogic:
          "Per the tracker UI: arrow compares a month's share count to the next-older month (up=increase, down=decrease, flat/none=no change). Oldest column shows no arrow (flat/none). 'missing' = no holding reported that month.",
      },
      rows,
    };
    fs.writeFileSync(JSON_FILE, JSON.stringify(payload, null, 2) + "\n");
    L(`wrote ${JSON_FILE}`);
    writeCsv(rows, monthLabels);
    ok = true;
  } catch (e) {
    L(`FATAL: ${(e as Error).stack ?? (e as Error).message}`);
  } finally {
    dump("log.txt", logLines.join("\n") + "\n");
    await browser.close();
  }
  L(ok ? "SUCCESS: data files written" : "PARTIAL: see scrape-debug for diagnostics");
  process.exit(0);
}

main();
