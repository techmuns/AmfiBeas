/**
 * RECON v4 (CI) — precise capture now that both UIs are understood.
 *
 * ICICI: Downloads → "Other Scheme Disclosures" tab → open "Document Type",
 *   pick "Monthly Portfolio Disclosures" → open "Financial Year", pick the top
 *   year → click APPLY. That fires POST /nms/v1/downloads/files — we record its
 *   request body + response (the file list with URLs).
 * Kotak: statutory-disclosure → pick a "…Portfolio" type + latest year → click
 *   its Download. The file opens via a client-side download/navigation, so we
 *   capture page.on("download") URLs + any popup URL + file responses.
 *
 * Output → amc-recon4-out/<slug>/.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright";

const OUT = path.resolve(process.cwd(), "amc-recon4-out");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function icici(ctx: BrowserContext, dir: string) {
  const posts: Array<Record<string, unknown>> = [];
  let saved = 0;
  ctx.on("request", (req) => {
    if (req.method() === "POST" && /downloads\/files/i.test(req.url())) posts.push({ url: req.url(), body: req.postData() });
  });
  ctx.on("response", async (resp) => {
    if (!/downloads\/files/i.test(resp.url())) return;
    try { const b = await resp.body(); if (b.length > 100) await fs.writeFile(path.join(dir, `files-resp-${++saved}.json`), b); } catch { /* */ }
  });
  const page = await ctx.newPage();
  const log: string[] = [];
  try {
    await page.goto("https://www.icicipruamc.com/media-center/downloads?currentTabFilter=HistoricalFactsheets", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
    await page.waitForTimeout(3500);
    // Precise, exact-text targeting (the earlier fuzzy match hit combined nodes
    // like "Clear AllAPPLY").
    const tap = async (label: string, fn: () => Promise<void>) => {
      try { await fn(); log.push(label); await page.waitForTimeout(1200); } catch (e) { log.push(`${label} MISS ${(e as Error).message.slice(0, 40)}`); }
    };
    await tap("tab Other Scheme Disclosures", () => page.getByText("Other Scheme Disclosures", { exact: true }).first().click({ timeout: 5000 }));
    await page.waitForTimeout(1200);
    await tap("open Document Type", () => page.getByText(/^Document Type/).first().click({ timeout: 4000 }));
    await tap("chip Monthly Portfolio Disclosures", () => page.getByText("Monthly Portfolio Disclosures", { exact: true }).first().click({ timeout: 4000 }));
    await tap("open Financial Year", () => page.getByText("Financial Year", { exact: true }).first().click({ timeout: 4000 }));
    await tap("pick FY", () => page.getByText(/^\s*20\d\d\s*-\s*20\d\d\s*$/).first().click({ timeout: 4000 }));
    await tap("APPLY", () => page.getByRole("button", { name: /^\s*APPLY\s*$/ }).first().click({ timeout: 4000 }));
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await fs.writeFile(path.join(dir, "dom.html"), await page.content(), "utf8");
    await page.screenshot({ path: path.join(dir, "screenshot.png"), fullPage: true }).catch(() => {});
  } catch (e) { log.push(`ERR ${(e as Error).message.slice(0, 160)}`); }
  await fs.writeFile(path.join(dir, "posts.json"), JSON.stringify(posts, null, 2), "utf8");
  await fs.writeFile(path.join(dir, "log.json"), JSON.stringify(log, null, 2), "utf8");
  console.log(`[icici] filesPOSTs=${posts.length} responses=${saved}`);
}

async function kotak(ctx: BrowserContext, dir: string) {
  const downloads: string[] = [];
  const popups: string[] = [];
  ctx.on("page", (p) => popups.push(p.url()));
  const page = await ctx.newPage();
  page.on("download", (d) => downloads.push(d.url()));
  page.on("popup", (p) => popups.push(p.url()));
  const log: string[] = [];
  try {
    await page.goto("https://www.kotakmf.com/Information/statutory-disclosure", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
    await page.waitForTimeout(3500);
    // Choose a Portfolio disclosure type in any <select> that offers one.
    for (const sel of await page.$$("select")) {
      const opts = await sel.$$eval("option", (os) => os.map((o) => o.textContent?.trim() || ""));
      const m = opts.find((o) => /monthly.*portfolio|total.*portfolio|consolidated.*portfolio|portfolio/i.test(o));
      if (m) { try { await sel.selectOption({ label: m }); log.push(`type "${m}"`); await page.waitForTimeout(1200); } catch { /* */ } }
    }
    // Click a Download near a Portfolio row.
    const rows = await page.$$("tr, li, div");
    let clicked = 0;
    for (const row of rows) {
      if (clicked >= 3) break;
      const tx = ((await row.textContent().catch(() => "")) || "").toLowerCase();
      if (!/portfolio/.test(tx) || tx.length > 200) continue;
      const dl = await row.$("a:has-text('Download'), button:has-text('Download'), [class*=download]");
      if (dl) { try { await dl.click({ timeout: 3000 }); clicked++; log.push(`download row: ${tx.slice(0, 50)}`); await page.waitForTimeout(2500); } catch { /* */ } }
    }
    await fs.writeFile(path.join(dir, "dom.html"), await page.content(), "utf8");
    await page.screenshot({ path: path.join(dir, "screenshot.png"), fullPage: true }).catch(() => {});
  } catch (e) { log.push(`ERR ${(e as Error).message.slice(0, 160)}`); }
  await fs.writeFile(path.join(dir, "captured.json"), JSON.stringify({ downloads, popups: [...new Set(popups)], log }, null, 2), "utf8");
  console.log(`[kotak] downloads=${downloads.length} popups=${new Set(popups).size}`);
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"] });
  const mk = async (slug: string) => {
    const dir = path.join(OUT, slug); await fs.mkdir(dir, { recursive: true });
    return browser.newContext({ userAgent: UA, viewport: { width: 1440, height: 1000 }, locale: "en-IN", timezoneId: "Asia/Kolkata", ignoreHTTPSErrors: true, acceptDownloads: true });
  };
  const ci = await mk("icici-pru"); await icici(ci, path.join(OUT, "icici-pru")).catch((e) => console.log("icici FAIL", (e as Error).message.slice(0, 100))); await ci.close();
  const ck = await mk("kotak"); await kotak(ck, path.join(OUT, "kotak")).catch((e) => console.log("kotak FAIL", (e as Error).message.slice(0, 100))); await ck.close();
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
