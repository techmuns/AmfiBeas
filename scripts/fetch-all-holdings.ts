/**
 * ONE-OFF bulk scraper (not part of the ingest pipeline).
 *
 * Reads the committed RupeeVest scheme universe (rupeevest-scheme-list.json),
 * then for every scheme calls the same JSON endpoint the Portfolio Tracker page
 * uses:
 *   GET /home/get_mf_portfolio_tracker?schemecode=CODE
 *        -> { fund_info:[{s_name,aumtotal,aumdate,classification}],
 *             month_name:[m0,m1,m2,m3],           // m0 = most recent
 *             MonthwiseAUM:[{aum},...],
 *             stock_data:[ [ {fincode,noshares,percent_aum}, ... ] (per month) ],
 *             stock_mapping:{ fincode: companyName }, ... (debt fields ignored) }
 *
 * We KEEP only funds whose latest AUM (fund_info.aumtotal, in Cr) exceeds
 * MIN_AUM_CR (default 500) and emit EQUITY HOLDINGS ONLY. Output:
 *   holdings/<schemecode>-<slug>.json   (per fund, same shape as the Kotak file)
 *   holdings/index.json                 (manifest of every AUM>threshold scheme)
 *
 * The change arrows shown in the UI are NOT in the data; the page derives them
 * by comparing each month's share count to the next-older month
 * (incr / decr / nochange) and shows no arrow on the oldest column. Replicated.
 *
 * Claude's container can't reach rupeevest (network allowlist), so this runs on
 * a GitHub Actions runner. We load the page once for cookies, then fetch the
 * endpoint via the browser context's request (shares cookies/origin). Per-fund
 * files are written as we go so a crash/timeout still leaves partial progress
 * for the workflow's always-commit. Exits 0 even on partial failure.
 */
import { chromium, type APIRequestContext, type Page } from "playwright";
import fs from "node:fs";
import path from "node:path";

const ORIGIN = "https://www.rupeevest.com";
const PAGE_URL = `${ORIGIN}/Mutual-Fund-Portfolio-Tracker`;
const OUT_DIR = process.cwd();
const HOLDINGS_DIR = path.join(OUT_DIR, "holdings");
const INDEX_FILE = path.join(HOLDINGS_DIR, "index.json");
const SCHEME_LIST_FILE = path.join(OUT_DIR, "rupeevest-scheme-list.json");
const DEBUG_DIR = path.join(OUT_DIR, "scrape-debug");

const MIN_AUM_CR = Number(process.env.MIN_AUM_CR ?? "500");
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS ?? "200");
const MAX_SCHEMES = process.env.MAX_SCHEMES ? Number(process.env.MAX_SCHEMES) : Infinity;
const PER_FETCH_RETRIES = 2;
const INDEX_FLUSH_EVERY = 25;

fs.mkdirSync(HOLDINGS_DIR, { recursive: true });
fs.mkdirSync(DEBUG_DIR, { recursive: true });

const logLines: string[] = [];
const L = (msg: string) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logLines.push(line);
};
const flushLog = () =>
  fs.writeFileSync(path.join(DEBUG_DIR, "all-holdings-log.txt"), logLines.join("\n") + "\n");

const AJAX_HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  Referer: PAGE_URL,
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slugMonth = (label: string) =>
  label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const slugName = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

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
// shares[0] = most recent month ... shares[n-1] = oldest. i is the month index.
function arrowFor(shares: (number | null)[], i: number): Arrow {
  const cur = shares[i];
  if (cur == null) return "missing";
  if (i >= shares.length - 1) return "flat/none"; // oldest column: UI shows no arrow
  const prev = shares[i + 1];
  if (prev == null) return "up";
  if (cur > prev) return "up";
  if (cur < prev) return "down";
  return "flat/none";
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
    rows.push({ company_name: mapping[fin] ?? `#${fin}`, fincode: fin, months });
  }
  return rows;
}

interface SchemeListEntry {
  schemecode: string;
  name: string;
  nfo: boolean;
}
interface IndexEntry {
  schemecode: string;
  name: string;
  fundName: string | null;
  classification: string | null;
  aumTotalCr: number | null;
  aumAsOf: string | null;
  rowCount: number;
  file: string | null;
}

async function getJson(
  req: APIRequestContext,
  url: string,
  tag: string
): Promise<{ ok: boolean; status: number; json: any | null }> {
  try {
    const res = await req.get(url, { headers: AJAX_HEADERS, timeout: 60000 });
    const body = await res.text();
    if (!res.ok()) return { ok: false, status: res.status(), json: null };
    try {
      return { ok: true, status: res.status(), json: JSON.parse(body) };
    } catch {
      return { ok: false, status: res.status(), json: null };
    }
  } catch (e) {
    L(`${tag}: request error: ${(e as Error).message}`);
    return { ok: false, status: 0, json: null };
  }
}

async function refreshSession(page: Page): Promise<void> {
  try {
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(1500);
    L("session refreshed (page reloaded)");
  } catch (e) {
    L(`session refresh failed: ${(e as Error).message}`);
  }
}

async function main() {
  L(`bulk holdings fetch — MIN_AUM_CR=${MIN_AUM_CR} delay=${REQUEST_DELAY_MS}ms`);

  if (!fs.existsSync(SCHEME_LIST_FILE)) {
    L(`FATAL: ${SCHEME_LIST_FILE} not found`);
    flushLog();
    process.exit(0);
  }
  const schemeList = JSON.parse(fs.readFileSync(SCHEME_LIST_FILE, "utf8"));
  const schemes: SchemeListEntry[] = Array.isArray(schemeList?.schemes) ? schemeList.schemes : [];
  L(`loaded ${schemes.length} schemes from scheme list`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  });

  const index: IndexEntry[] = [];
  const errors: { schemecode: string; name: string; reason: string }[] = [];
  let kept = 0;
  let skippedAum = 0;
  let processed = 0;

  const writeIndex = () => {
    index.sort((a, b) => (b.aumTotalCr ?? 0) - (a.aumTotalCr ?? 0));
    const payload = {
      meta: {
        source: PAGE_URL,
        endpoint: `${ORIGIN}/home/get_mf_portfolio_tracker?schemecode=CODE`,
        generatedAt: new Date().toISOString(),
        minAumCr: MIN_AUM_CR,
        section: "Equity Holdings",
        schemesTotal: schemes.length,
        schemesProcessed: processed,
        keptAboveThreshold: kept,
        skippedBelowThreshold: skippedAum,
        errorCount: errors.length,
        note:
          "Funds with latest AUM (Cr) > minAumCr. Equity holdings only; funds with no reported equity holdings have rowCount 0 and file null. Sorted by AUM desc.",
      },
      funds: index,
      errors,
    };
    fs.writeFileSync(INDEX_FILE, JSON.stringify(payload, null, 2) + "\n");
  };

  try {
    const page = await ctx.newPage();
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(2000);
    L("page loaded (session cookies established)");

    const limit = Math.min(schemes.length, MAX_SCHEMES);
    for (let idx = 0; idx < limit; idx++) {
      const s = schemes[idx];
      processed++;
      const url = `${ORIGIN}/home/get_mf_portfolio_tracker?schemecode=${encodeURIComponent(s.schemecode)}`;

      let result = await getJson(ctx.request, url, `tracker[${s.schemecode}]`);
      for (let attempt = 1; !result.ok && attempt <= PER_FETCH_RETRIES; attempt++) {
        if (result.status === 403 || result.status === 0 || result.status >= 500) {
          await refreshSession(page);
        }
        await sleep(500 * attempt);
        result = await getJson(ctx.request, url, `tracker[${s.schemecode}] retry${attempt}`);
      }

      if (!result.ok || !result.json) {
        errors.push({ schemecode: s.schemecode, name: s.name, reason: `fetch failed (status ${result.status})` });
        if (processed % 50 === 0) L(`...${processed}/${limit} processed (kept=${kept})`);
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      const tracker = result.json;
      const info = Array.isArray(tracker.fund_info) ? tracker.fund_info[0] : null;
      const aumTotalCr = toNumOrNull(info?.aumtotal);

      if (aumTotalCr == null || aumTotalCr <= MIN_AUM_CR) {
        skippedAum++;
        if (processed % 50 === 0) {
          L(`...${processed}/${limit} processed (kept=${kept})`);
          writeIndex();
          flushLog();
        }
        await sleep(REQUEST_DELAY_MS);
        continue;
      }

      const monthLabels: string[] = (Array.isArray(tracker.month_name) ? tracker.month_name : [])
        .map((m: unknown) => String(m).trim())
        .filter((m: string) => m.length > 0);
      const monthlyAum = (Array.isArray(tracker.MonthwiseAUM) ? tracker.MonthwiseAUM : []).map(
        (a: any) => a?.aum ?? null
      );
      const rows = monthLabels.length ? buildRows(tracker, monthLabels) : [];

      const fundName: string = info?.s_name ?? s.name;
      let file: string | null = null;
      if (rows.length > 0) {
        const fileName = `${s.schemecode}-${slugName(fundName)}.json`;
        file = `holdings/${fileName}`;
        const payload = {
          meta: {
            source: PAGE_URL,
            endpoint: url,
            fund: fundName,
            schemecode: s.schemecode,
            classification: info?.classification ?? null,
            aumTotalCr,
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
        fs.writeFileSync(path.join(HOLDINGS_DIR, fileName), JSON.stringify(payload, null, 2) + "\n");
      }

      index.push({
        schemecode: s.schemecode,
        name: s.name,
        fundName,
        classification: info?.classification ?? null,
        aumTotalCr,
        aumAsOf: info?.aumdate ?? null,
        rowCount: rows.length,
        file,
      });
      kept++;
      if (kept % 10 === 0) L(`kept ${kept} funds so far (latest: ${fundName} — ${aumTotalCr} Cr, ${rows.length} rows)`);
      if (kept % INDEX_FLUSH_EVERY === 0) {
        writeIndex();
        flushLog();
      }
      await sleep(REQUEST_DELAY_MS);
    }

    writeIndex();
    L(`DONE: processed=${processed} kept=${kept} skipped(<=${MIN_AUM_CR}Cr)=${skippedAum} errors=${errors.length}`);
  } catch (e) {
    L(`FATAL: ${(e as Error).stack ?? (e as Error).message}`);
    writeIndex();
  } finally {
    flushLog();
    await browser.close();
  }
  process.exit(0);
}

main();
