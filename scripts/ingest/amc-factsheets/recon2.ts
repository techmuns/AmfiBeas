/**
 * RECON v2 (CI) — cracks the three harder AMCs that plain-URL fetching didn't
 * solve: ICICI (data behind an auth'd JSON API), Kotak (needs the separate
 * portfolio-disclosure file, not the marketing factsheet) and HDFC (403 bot
 * wall even to a normal headless browser).
 *
 * For each target it: opens candidate pages (with stealth for HDFC), records
 * every XHR/fetch REQUEST (URL + headers — this captures ICICI's Authorization/
 * API-key) and RESPONSE (status + saved body for JSON/file responses), then
 * clicks through the "portfolio / disclosure / download / monthly" UI to trigger
 * the data calls, and captures anything that surfaces.
 *
 * Output → amc-recon2-out/<slug>/ (CI artifact): network.json (with request
 * headers), any captured api-*.json / file-*.{xls,xlsx,pdf}, DOM + screenshots.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Response } from "playwright";

const OUT = path.resolve(process.cwd(), "amc-recon2-out");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CLICK_RE = /portfolio|disclosur|download|monthly|holding|scheme|factsheet/i;
const CAPTURE_RE = /\/(api|cs\/v1|ds\/v1|mf\/v1)\/|portfolio|disclosur|document|download|\.xls|\.xlsx|\.csv|\.pdf|\.zip/i;
const FILE_RE = /\.(xlsx|xls|csv|pdf|zip)(\?|$)/i;
const ASSET_RE = /\.(js|css|png|jpe?g|svg|gif|woff2?|ico|mp4|webp)(\?|$)|google|gtm|taboola|haptik|doubleclick|fonts\.|analytics|notifyvisitors/i;

interface Target { slug: string; startUrls: string[]; stealth: boolean }
const TARGETS: Target[] = [
  { slug: "icici-pru", stealth: false, startUrls: ["https://www.icicipruamc.com/media-center/downloads?currentTabFilter=HistoricalFactsheets"] },
  { slug: "kotak", stealth: false, startUrls: ["https://www.kotakmf.com/downloads", "https://www.kotakmf.com/statutory-disclosure", "https://www.kotakmf.com/"] },
  { slug: "hdfc", stealth: true, startUrls: ["https://www.hdfcfund.com/statutory-disclosures/portfolios", "https://www.hdfcfund.com/mutual-funds/factsheets"] },
];

const STEALTH_INIT = `
  Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
  Object.defineProperty(navigator,'languages',{get:()=>['en-IN','en']});
  Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});
  window.chrome={runtime:{}};
`;

async function newCtx(browser: Awaited<ReturnType<typeof chromium.launch>>, stealth: boolean): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { "Accept-Language": "en-IN,en;q=0.9" },
  });
  if (stealth) await ctx.addInitScript(STEALTH_INIT);
  return ctx;
}

async function reconTarget(browser: Awaited<ReturnType<typeof chromium.launch>>, t: Target) {
  const dir = path.join(OUT, t.slug);
  await fs.mkdir(dir, { recursive: true });
  const net: Array<Record<string, unknown>> = [];
  const reqHeaders = new Map<string, Record<string, string>>();
  const summary: Record<string, unknown> = { slug: t.slug, startedAt: new Date().toISOString(), pages: [] };
  const ctx = await newCtx(browser, t.stealth);
  let saved = 0;

  ctx.on("request", (req) => {
    if (!ASSET_RE.test(req.url())) reqHeaders.set(req.url(), req.headers());
  });
  const onResp = async (resp: Response) => {
    const url = resp.url();
    if (ASSET_RE.test(url) || !CAPTURE_RE.test(url)) return;
    const ct = resp.headers()["content-type"] || "";
    net.push({ url, method: resp.request().method(), status: resp.status(), ct, reqHeaders: reqHeaders.get(url) || null });
    // Save promising bodies (JSON API responses + files), capped.
    if (saved < 30 && (/(json)/i.test(ct) || FILE_RE.test(url) || /sheet|excel|pdf|octet/i.test(ct))) {
      try {
        const body = await resp.body();
        if (body.length > 200) {
          const ext = FILE_RE.test(url) ? url.match(FILE_RE)![1] : /json/i.test(ct) ? "json" : "bin";
          await fs.writeFile(path.join(dir, `cap-${++saved}.${ext}`), body);
        }
      } catch { /* body unavailable */ }
    }
  };
  ctx.on("response", (r) => { void onResp(r); });

  for (const url of t.startUrls) {
    const page = await ctx.newPage();
    const rec: Record<string, unknown> = { url };
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      rec.status = resp?.status() ?? null;
      await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
      await page.waitForTimeout(3500);
      rec.title = await page.title();
      // Click through the disclosure/portfolio UI to trigger data calls.
      const clickables = await page.$$("a, button, [role=tab], [role=button], li, span, div[class*=tab]");
      let clicks = 0;
      for (const el of clickables) {
        if (clicks >= 8) break;
        const txt = ((await el.textContent().catch(() => "")) || "").trim();
        if (!txt || txt.length > 40 || !CLICK_RE.test(txt)) continue;
        try {
          await el.click({ timeout: 3000 });
          clicks++;
          await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
          await page.waitForTimeout(1500);
        } catch { /* not clickable */ }
      }
      rec.clicks = clicks;
      const slugSafe = url.replace(/[^a-z0-9]+/gi, "_").slice(-40);
      await fs.writeFile(path.join(dir, `dom-${slugSafe}.html`), await page.content(), "utf8");
      await page.screenshot({ path: path.join(dir, `shot-${slugSafe}.png`), fullPage: true }).catch(() => {});
    } catch (e) {
      rec.error = (e as Error).message.slice(0, 200);
    } finally {
      (summary.pages as unknown[]).push(rec);
      await page.close().catch(() => {});
    }
  }

  summary.netCaptured = net.length;
  summary.filesSaved = saved;
  await fs.writeFile(path.join(dir, "network.json"), JSON.stringify(net, null, 2), "utf8");
  await fs.writeFile(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await ctx.close();
  console.log(`[${t.slug}] pages=${(summary.pages as unknown[]).length} netCaptured=${net.length} filesSaved=${saved}`);
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"] });
  for (const t of TARGETS) {
    console.log(`\n=== ${t.slug} ===`);
    await reconTarget(browser, t).catch((e) => console.log(`  ${t.slug} FAILED: ${(e as Error).message.slice(0, 150)}`));
  }
  await browser.close();
  console.log(`\nRecon v2 → ${path.relative(process.cwd(), OUT)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
