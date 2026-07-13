/**
 * AMC factsheet/portfolio-disclosure RECON harness (runs in CI, not locally —
 * the sandbox can't reach a browser through its proxy).
 *
 * For each AMC in the source registry it opens the landing page in a real
 * headless browser (bypasses the bot protection + runs the SPA's JS), then
 * captures everything needed to write a correct scraper WITHOUT guessing:
 *   - every network request the page fires (URL, method, type, status,
 *     content-type) — this surfaces the AMC's private portfolio/disclosure API
 *     and any file URLs automatically;
 *   - the fully-rendered DOM + a screenshot;
 *   - candidate "latest monthly portfolio disclosure" links from the DOM;
 *   - a best-effort download of each candidate file (xlsx/xls/csv/pdf/zip).
 *
 * Output → amc-recon-out/<slug>/ (uploaded as a CI artifact). The captured
 * network log + sample files are what the per-AMC adapters are then built from.
 *
 * Run in CI: node/tsx scripts/ingest/amc-factsheets/recon.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { AMC_FACTSHEET_SOURCES } from "../amc-factsheet-sources";

const OUT = path.resolve(process.cwd(), "amc-recon-out");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FILE_RE = /\.(xlsx|xls|csv|pdf|zip)(\?|$)/i;
const INTEREST_RE = /portfolio|disclosur|factsheet|holding|monthly|\.xlsx|\.xls|\.csv|\.pdf|\.zip|api|document|download/i;
const FILE_CT_RE = /sheet|excel|spreadsheet|pdf|octet-stream|zip|csv|ms-excel/i;

interface NetEntry {
  url: string;
  method: string;
  type: string;
  status: number;
  ct: string;
}

async function reconOne(browser: Browser, slug: string, amc: string, url: string) {
  const dir = path.join(OUT, slug);
  await fs.mkdir(dir, { recursive: true });
  const net: NetEntry[] = [];
  let ctx: BrowserContext | null = null;
  const summary: Record<string, unknown> = { amc, slug, url, startedAt: new Date().toISOString() };
  try {
    ctx = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1440, height: 900 },
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();
    page.on("response", (resp) => {
      try {
        net.push({
          url: resp.url(),
          method: resp.request().method(),
          type: resp.request().resourceType(),
          status: resp.status(),
          ct: resp.headers()["content-type"] || "",
        });
      } catch {
        /* ignore */
      }
    });

    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    summary.landingStatus = resp?.status() ?? null;
    // Let the SPA settle + fire its data calls.
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(4000);
    summary.title = await page.title();
    summary.finalUrl = page.url();

    // Rendered DOM + screenshot.
    await fs.writeFile(path.join(dir, "rendered.html"), await page.content(), "utf8");
    await page.screenshot({ path: path.join(dir, "screenshot.png"), fullPage: true }).catch(() => {});

    // DOM candidate links (portfolio/disclosure/file-ish).
    const links = await page
      .$$eval("a[href]", (as) =>
        as.map((a) => ({ text: (a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80), href: (a as HTMLAnchorElement).href })),
      )
      .catch(() => [] as { text: string; href: string }[]);
    const domCandidates = links.filter((l) => FILE_RE.test(l.href) || INTEREST_RE.test(l.href) || INTEREST_RE.test(l.text));

    // Network candidates: API/JSON calls + anything that smells like a file.
    const netCandidates = net.filter((n) => FILE_RE.test(n.url) || FILE_CT_RE.test(n.ct) || /api|service|portfolio|disclosur|month/i.test(n.url));

    // Best-effort: download the file-ish candidates (from DOM + network).
    const fileUrls = Array.from(
      new Set([
        ...domCandidates.filter((c) => FILE_RE.test(c.href)).map((c) => c.href),
        ...netCandidates.filter((n) => FILE_RE.test(n.url) || FILE_CT_RE.test(n.ct)).map((n) => n.url),
      ]),
    ).slice(0, 8);
    const downloaded: Array<{ url: string; ok: boolean; bytes: number; file?: string; error?: string }> = [];
    for (let i = 0; i < fileUrls.length; i++) {
      const fu = fileUrls[i];
      try {
        const r = await ctx.request.get(fu, { timeout: 45_000 });
        const buf = await r.body();
        const ext = (fu.match(FILE_RE)?.[1] || "bin").toLowerCase();
        const fname = `file-${i + 1}.${ext}`;
        await fs.writeFile(path.join(dir, fname), buf);
        downloaded.push({ url: fu, ok: r.ok(), bytes: buf.length, file: fname });
      } catch (e) {
        downloaded.push({ url: fu, ok: false, bytes: 0, error: (e as Error).message.slice(0, 120) });
      }
    }

    summary.netRequestCount = net.length;
    summary.domCandidates = domCandidates.slice(0, 40);
    summary.netCandidates = netCandidates.slice(0, 60);
    summary.downloaded = downloaded;
    summary.ok = true;
  } catch (e) {
    summary.ok = false;
    summary.error = (e as Error).message.slice(0, 300);
  } finally {
    await fs.writeFile(path.join(dir, "network.json"), JSON.stringify(net, null, 2), "utf8").catch(() => {});
    await fs.writeFile(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2), "utf8").catch(() => {});
    await ctx?.close().catch(() => {});
  }
  const s = summary as { ok?: boolean; landingStatus?: number; netRequestCount?: number; downloaded?: unknown[] };
  console.log(
    `[${slug}] ok=${s.ok} landing=${s.landingStatus} netReqs=${s.netRequestCount ?? 0} files=${(s.downloaded as unknown[] | undefined)?.length ?? 0}`,
  );
  return summary;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const all: unknown[] = [];
  for (const src of AMC_FACTSHEET_SOURCES) {
    console.log(`\n=== ${src.amc} (${src.slug}) → ${src.sourceUrl}`);
    all.push(await reconOne(browser, src.slug, src.amc, src.sourceUrl));
  }
  await browser.close();
  await fs.writeFile(path.join(OUT, "recon-summary.json"), JSON.stringify(all, null, 2), "utf8");
  console.log(`\nRecon complete → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => {
  console.error("recon failed:", e);
  process.exit(1);
});
