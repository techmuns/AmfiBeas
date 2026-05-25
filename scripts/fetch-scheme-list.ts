/**
 * ONE-OFF: pull RupeeVest's full scheme universe from /home/get_search_data
 * (the same call the Portfolio Tracker page makes). Emits every scheme's
 * { schemecode, name } so we have the master list + the codes needed to fetch
 * each fund's holdings via get_mf_portfolio_tracker.
 *
 * Runs on a GitHub Actions runner (open internet); this dev container can't
 * reach rupeevest (network allowlist). Loads the page once for cookies, then
 * fetches via the browser context's request. Exits 0 even on failure so the
 * workflow commits diagnostics.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const ORIGIN = "https://www.rupeevest.com";
const PAGE_URL = `${ORIGIN}/Mutual-Fund-Portfolio-Tracker`;
const OUT_FILE = path.join(process.cwd(), "rupeevest-scheme-list.json");
const DEBUG_DIR = path.join(process.cwd(), "scrape-debug");
fs.mkdirSync(DEBUG_DIR, { recursive: true });

const log: string[] = [];
const L = (m: string) => {
  const line = `[${new Date().toISOString()}] ${m}`;
  console.log(line);
  log.push(line);
};

const HEADERS = {
  "X-Requested-With": "XMLHttpRequest",
  Referer: PAGE_URL,
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "en-US,en;q=0.9",
};

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    viewport: { width: 1440, height: 900 },
  });
  let ok = false;
  try {
    const page = await ctx.newPage();
    await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(2000);
    L("page loaded; fetching get_search_data");

    const res = await ctx.request.get(`${ORIGIN}/home/get_search_data`, {
      headers: HEADERS,
      timeout: 60000,
    });
    L(`get_search_data: HTTP ${res.status()}`);
    const body = await res.text();
    if (!res.ok()) {
      fs.writeFileSync(path.join(DEBUG_DIR, "search-error.txt"), body.slice(0, 2000));
      throw new Error(`HTTP ${res.status()}`);
    }
    const data = JSON.parse(body);

    const mk = (arr: any[], nfo: boolean) =>
      (Array.isArray(arr) ? arr : [])
        .map((e) => ({
          schemecode: String(e.schemecode),
          name: String(e.s_name1 ?? "").trim(),
          nfo,
        }))
        .filter((e) => e.name.length > 0);

    const live = mk(data.search_data, false);
    const nfo = mk(data.search_data_nfo, true);
    const seen = new Set<string>();
    const schemes = [...live, ...nfo]
      .filter((s) => (seen.has(s.schemecode) ? false : (seen.add(s.schemecode), true)))
      .sort((a, b) => a.name.localeCompare(b.name));

    const payload = {
      meta: {
        source: PAGE_URL,
        endpoint: `${ORIGIN}/home/get_search_data`,
        fetchedAt: new Date().toISOString(),
        total: schemes.length,
        live: live.length,
        nfo: nfo.length,
      },
      schemes,
    };
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
    L(`wrote ${OUT_FILE}: total=${schemes.length} live=${live.length} nfo=${nfo.length}`);
    ok = true;
  } catch (e) {
    L(`FATAL: ${(e as Error).stack ?? (e as Error).message}`);
  } finally {
    fs.writeFileSync(path.join(DEBUG_DIR, "scheme-list-log.txt"), log.join("\n") + "\n");
    await browser.close();
  }
  L(ok ? "SUCCESS" : "FAILED — see scrape-debug");
  process.exit(0);
}

main();
