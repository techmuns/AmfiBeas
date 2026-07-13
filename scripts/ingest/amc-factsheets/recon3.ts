/**
 * RECON v3 (CI) — targeted capture to finish ICICI + Kotak.
 *
 * ICICI: its holdings API is open (env:api + requestapiid) and the endpoint is
 *   POST /nms/v1/downloads/files, but the exact body (fileType + FINANCIAL_YEAR
 *   filter) is unknown. This drives the downloads SPA to "Other Scheme
 *   Disclosures → Monthly Portfolio Disclosures" and records the REQUEST BODY of
 *   every /downloads/files POST + the response (the file list with URLs).
 * Kotak: drives /Information/statutory-disclosure to the monthly-portfolio
 *   section and captures the file URLs / API calls.
 *
 * Output → amc-recon3-out/<slug>/ (CI artifact): posts.json (captured POST
 * bodies), cap-*.json (API responses), DOM + screenshots.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright";

const OUT = path.resolve(process.cwd(), "amc-recon3-out");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface Target { slug: string; startUrl: string; clickTexts: string[] }
const TARGETS: Target[] = [
  {
    slug: "icici-pru",
    startUrl: "https://www.icicipruamc.com/media-center/downloads?currentTabFilter=HistoricalFactsheets",
    clickTexts: ["Other Scheme Disclosures", "Scheme Disclosures", "Monthly Portfolio Disclosures", "Monthly Portfolio", "Portfolio", "2026 - 2027", "2026-2027", "2025 - 2026", "Search"],
  },
  {
    slug: "kotak",
    startUrl: "https://www.kotakmf.com/Information/statutory-disclosure",
    clickTexts: ["Monthly Portfolio", "Portfolio Disclosure", "Portfolio", "Monthly", "Fortnightly", "Disclosure", "Download", "2026", "May"],
  },
];

const POST_RE = /downloads\/files|\/files|portfolio|document|disclosur/i;

async function run(browser: Awaited<ReturnType<typeof chromium.launch>>, t: Target) {
  const dir = path.join(OUT, t.slug);
  await fs.mkdir(dir, { recursive: true });
  const posts: Array<Record<string, unknown>> = [];
  let saved = 0;
  const ctx: BrowserContext = await browser.newContext({
    userAgent: UA, viewport: { width: 1440, height: 1000 }, locale: "en-IN", timezoneId: "Asia/Kolkata", ignoreHTTPSErrors: true,
  });

  ctx.on("request", (req) => {
    if (req.method() !== "POST") return;
    if (!POST_RE.test(req.url())) return;
    posts.push({ url: req.url(), headers: req.headers(), postData: (req.postData() || "").slice(0, 3000) });
  });
  ctx.on("response", async (resp) => {
    const u = resp.url();
    if (!/\/files|downloads|portfolio|\.xls|\.pdf/i.test(u)) return;
    const ct = resp.headers()["content-type"] || "";
    if (saved >= 25) return;
    if (/json/i.test(ct) || /\.(xls|xlsx|pdf)/i.test(u)) {
      try {
        const b = await resp.body();
        if (b.length > 150) {
          const ext = /\.(xls|xlsx|pdf)/i.test(u) ? u.match(/\.(xls|xlsx|pdf)/i)![1] : "json";
          await fs.writeFile(path.join(dir, `cap-${++saved}.${ext}`), b);
        }
      } catch { /* ignore */ }
    }
  });

  const page = await ctx.newPage();
  const log: string[] = [];
  try {
    await page.goto(t.startUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
    await page.waitForTimeout(3500);
    log.push(`loaded ${t.startUrl} :: ${await page.title()}`);

    for (const text of t.clickTexts) {
      // Try <select> options first, then clickable elements.
      let acted = false;
      for (const sel of await page.$$("select")) {
        const opts = await sel.$$eval("option", (os) => os.map((o) => o.textContent?.trim() || ""));
        const match = opts.find((o) => o.toLowerCase().includes(text.toLowerCase()));
        if (match) { try { await sel.selectOption({ label: match }); acted = true; log.push(`select "${match}"`); } catch { /* */ } }
      }
      if (!acted) {
        const els = await page.$$("a, button, li, span, div[role], [role=tab], [role=option], [role=button], p, h3, h4");
        for (const el of els) {
          const tx = ((await el.textContent().catch(() => "")) || "").trim();
          if (!tx || tx.length > 45 || tx.toLowerCase() !== text.toLowerCase() && !tx.toLowerCase().includes(text.toLowerCase())) continue;
          try { await el.click({ timeout: 2500 }); acted = true; log.push(`click "${tx}"`); break; } catch { /* */ }
        }
      }
      if (acted) { await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {}); await page.waitForTimeout(1800); }
    }
    await fs.writeFile(path.join(dir, "dom.html"), await page.content(), "utf8");
    await page.screenshot({ path: path.join(dir, "screenshot.png"), fullPage: true }).catch(() => {});
  } catch (e) {
    log.push(`ERROR: ${(e as Error).message.slice(0, 200)}`);
  }
  await fs.writeFile(path.join(dir, "posts.json"), JSON.stringify(posts, null, 2), "utf8");
  await fs.writeFile(path.join(dir, "log.json"), JSON.stringify(log, null, 2), "utf8");
  await ctx.close();
  console.log(`[${t.slug}] posts=${posts.length} filesSaved=${saved} steps=${log.length}`);
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"] });
  for (const t of TARGETS) { console.log(`\n=== ${t.slug} ===`); await run(browser, t).catch((e) => console.log(`  FAILED ${(e as Error).message.slice(0, 120)}`)); }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
