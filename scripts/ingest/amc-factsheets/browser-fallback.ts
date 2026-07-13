/**
 * Browser-based fallback for AMCs the plain-curl AdvisorKhoj path can't reach:
 * Akamai-walled file hosts (HDFC, Edelweiss) and JS-rendered disclosure pages
 * that only inject the real file links after client-side script runs (Mirae,
 * Bandhan, …). A real Chromium (see browser.ts) both clears the bot wall and
 * runs the page, after which we harvest the monthly-portfolio workbook links,
 * download them through the browser context (shares the page's TLS/cookies) and
 * feed each to the same generic workbook parser used everywhere else.
 *
 * Strategy per AMC, in order:
 *  1. If a resolved link is itself a workbook/zip, fetch it directly (the browser
 *     clears the 403 that blocks curl).
 *  2. Otherwise treat it as a disclosure page: run any per-AMC interaction hints
 *     (click a "Monthly Portfolio" tab, pick the latest month), then collect every
 *     .xls/.xlsx/.zip link, keep the newest month, and download + parse + merge.
 */

import fs from "node:fs";
import type { Browser, BrowserContext, Page } from "playwright";
import { newContext } from "./browser";
import { parseAmcWorkbook } from "./parse";
import { normalizeSchemePct } from "./advisorkhoj";
import type { AmcParseOptions, AmcScheme } from "./types";

const FILE_RE = /\.(xlsx?|zip)(\?|#|$)/i;
const MON: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export interface BrowserHints {
  /** Selectors or getByText targets to click before harvesting (reveal SPA links). */
  clicks?: string[];
  /** Extra settle time (ms) after load / interaction for XHRs to land. */
  waitMs?: number;
  /** Keep only links whose (href + anchor text) matches this. */
  include?: RegExp;
  /** Max workbook files to download (guards against grabbing full history). */
  maxFiles?: number;
  /** Reject the harvest if its dominant month is older than this (year*12+month).
   *  Stops a page that only exposes stale history from writing months-old data. */
  floorScore?: number;
  /** Ignore files dated after this (year*12+month) when picking the disclosure
   *  month — filenames carry future FMP-maturity dates. Defaults to now+1. */
  ceilScore?: number;
}

/** year*12+month floor `ageMonths` before the given date (defaults to now-6). */
export function monthFloor(now: Date, ageMonths = 6): number {
  return now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1) - ageMonths;
}

/** year*12+month ceiling `ahead` months after the given date (defaults to now+1). */
export function monthCeil(now: Date, ahead = 1): number {
  return now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1) + ahead;
}

export interface HarvestedLink {
  url: string;
  text: string;
}

/** year*12+month for the newest "<Mon> <YYYY>" token in a string, else 0. An
 *  optional day may sit between the month and year (e.g. DSP's
 *  "…-february-28-2026.zip"), which must not defeat the match. */
export function monthScore(sTr: string): number {
  let best = 0;
  const re = /([A-Za-z]{3,9})[^A-Za-z0-9]{0,4}(?:\d{1,2}(?:st|nd|rd|th)?[^A-Za-z0-9]{0,4})?(\d{4})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sTr))) {
    const mo = MON[m[1].slice(0, 3).toLowerCase()];
    if (!mo) continue;
    const score = +m[2] * 12 + mo;
    if (score > best) best = score;
  }
  return best;
}

/** Keep only the newest month's files (when filenames carry a month), preferring
 *  .xlsx over a same-named .xls, capped at maxFiles. */
export function selectLatestMonthFiles(
  links: HarvestedLink[],
  maxFiles = 150,
  floorScore = 0,
  ceilScore = Number.POSITIVE_INFINITY,
): HarvestedLink[] {
  const scored = links.map((l) => ({ l, s: monthScore(`${decodeURIComponent(l.url)} ${l.text}`) }));
  const dated = scored.filter((x) => x.s > 0);
  let keep: HarvestedLink[];
  if (dated.length >= links.length * 0.5 && dated.length > 0) {
    // Only consider months in the plausible disclosure window [floor, ceil]:
    // filenames carry future dates (FMP maturities → "May 2030") and stale
    // history that must not drive the month pick.
    const inWindow = dated.filter((x) => x.s >= floorScore && x.s <= ceilScore);
    if (inWindow.length === 0) return []; // only stale/future files on the page
    // Pick the MODAL in-window month (the disclosure month is the one the bulk
    // of files share), tie-broken toward the newer month.
    const counts = new Map<number, number>();
    for (const x of inWindow) counts.set(x.s, (counts.get(x.s) ?? 0) + 1);
    let modal = 0;
    let bestCount = -1;
    for (const [s, c] of counts) if (c > bestCount || (c === bestCount && s > modal)) { bestCount = c; modal = s; }
    keep = inWindow.filter((x) => x.s === modal).map((x) => x.l);
  } else {
    keep = links; // page shows a single (current) month with non-dated names
  }
  // Dedupe by extension-stripped URL, preferring .xlsx.
  const byBase = new Map<string, HarvestedLink>();
  for (const l of keep) {
    const base = l.url.replace(/\.(xlsx?|zip)(\?.*)?$/i, "").toLowerCase();
    const cur = byBase.get(base);
    if (!cur || (/\.xlsx(\?|$)/i.test(l.url) && /\.xls(\?|$)/i.test(cur.url))) byBase.set(base, l);
  }
  return [...byBase.values()].slice(0, maxFiles);
}

const URL_IN_TEXT_RE = /https?:\/\/[^"'`\\\s<>()]+?\.(?:xlsx?|zip)(?:\?[^"'`\\\s<>()]*)?/gi;

/**
 * Collect candidate workbook links from every place an AMC site hides them:
 *  - <a href> anchors (HDFC, Mirae, Invesco render these),
 *  - href/onclick/data-* attributes and inline JSON in the rendered HTML,
 *  - plus the network-captured URLs passed in (files requested during load and
 *    file URLs embedded in JSON/JS API responses).
 */
async function harvestLinks(page: Page, captured: Set<string>, include?: RegExp): Promise<HarvestedLink[]> {
  const anchors: HarvestedLink[] = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      url: (a as HTMLAnchorElement).href,
      text: (a.textContent || "").replace(/\s+/g, " ").trim(),
    })),
  );
  const html = await page.content().catch(() => "");
  const fromHtml = [...html.matchAll(URL_IN_TEXT_RE)].map((m) => ({ url: m[0], text: "" }));
  const fromNet = [...captured].map((u) => ({ url: u, text: "" }));
  const all = [...anchors, ...fromHtml, ...fromNet];
  const seen = new Set<string>();
  return all.filter((l) => {
    if (!FILE_RE.test(l.url) || seen.has(l.url)) return false;
    seen.add(l.url);
    return !include || include.test(`${l.url} ${l.text}`);
  });
}

/** Run `fn` over `items` with at most `n` in flight. */
async function mapPool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

async function downloadAndParseMany(
  ctx: BrowserContext,
  links: HarvestedLink[],
  opts: AmcParseOptions,
): Promise<AmcScheme[]> {
  // AMCs publish per-scheme workbooks (HDFC ~95, Groww ~117), so download in
  // parallel — sequential fetches are the run's bottleneck.
  const perFile = await mapPool(links, 6, async (l): Promise<AmcScheme[]> => {
    try {
      const resp = await ctx.request.get(l.url, { timeout: 45000 });
      if (!resp.ok()) return [];
      const buf = Buffer.from(await resp.body());
      const head = buf.subarray(0, 64).toString("latin1").trimStart().toLowerCase();
      if (head.startsWith("<!doctype") || head.startsWith("<html")) return []; // still a wall
      return parseAmcWorkbook(buf, opts).map(normalizeSchemePct);
    } catch {
      return []; // skip a single bad file
    }
  });
  return perFile.flat();
}

export interface BrowserFetchResult {
  schemes: AmcScheme[];
  usedUrl: string | null;
  fileCount: number;
}

/**
 * Fetch an AMC's monthly portfolio with a browser, trying each candidate URL
 * (newest-first) until one yields holdings.
 */
export async function browserFetchAmc(
  browser: Browser,
  urls: string[],
  opts: AmcParseOptions,
  hints: BrowserHints = {},
): Promise<BrowserFetchResult> {
  const ctx = await newContext(browser);
  try {
    for (const url of urls) {
      const page = await ctx.newPage();
      // Capture workbook URLs seen on the wire + file URLs embedded in JSON/JS
      // API responses — SPAs build download links this way rather than as <a>.
      const captured = new Set<string>();
      page.on("response", (resp) => {
        const u = resp.url();
        if (FILE_RE.test(u)) captured.add(u);
      });
      page.on("response", async (resp) => {
        try {
          const ct = resp.headers()["content-type"] ?? "";
          if (!/json|javascript|text\/plain/i.test(ct)) return;
          const body = await resp.text();
          for (const m of body.matchAll(URL_IN_TEXT_RE)) captured.add(m[0]);
        } catch { /* body not readable */ }
      });

      try {
        // Case 1: the URL is itself a workbook. Navigating triggers a browser
        // download (which the Akamai wall now allows); capture it.
        if (FILE_RE.test(url)) {
          const dl = await Promise.race([
            page.waitForEvent("download", { timeout: 45000 }).catch(() => null),
            page.goto(url, { waitUntil: "commit", timeout: 45000 }).then(() => null).catch(() => null),
          ]);
          if (dl) {
            const p = await dl.path();
            if (p) {
              const buf = fs.readFileSync(p);
              const schemes = parseAmcWorkbook(buf, opts).map(normalizeSchemePct);
              if (schemes.length) return { schemes, usedUrl: url, fileCount: 1 };
            }
          }
          // Not a download after all (served inline / captured on the wire) —
          // fall through to harvest, which will include `captured`.
        } else {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        }

        // Case 2: disclosure page — settle, run interaction hints, harvest.
        try { await page.waitForLoadState("networkidle", { timeout: 10000 }); } catch { /* SPA keeps polling */ }
        for (const sel of hints.clicks ?? []) {
          try {
            const target = sel.startsWith("text=") ? page.getByText(sel.slice(5), { exact: false }).first() : page.locator(sel).first();
            await target.click({ timeout: 8000 });
            await page.waitForTimeout(2000);
          } catch { /* hint selector may not be present every month */ }
        }
        await page.waitForTimeout(hints.waitMs ?? 2500);

        let found = await harvestLinks(page, captured, hints.include);
        if (found.length === 0) {
          // Heavy SPAs occasionally render nothing on the first paint — reload once.
          await page.reload({ waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
          await page.waitForTimeout((hints.waitMs ?? 2500) + 2500);
          found = await harvestLinks(page, captured, hints.include);
        }
        const picked = selectLatestMonthFiles(found, hints.maxFiles, hints.floorScore, hints.ceilScore);
        if (picked.length) {
          const schemes = await downloadAndParseMany(ctx, picked, opts);
          if (schemes.length) return { schemes, usedUrl: url, fileCount: picked.length };
        }
      } finally {
        await page.close();
      }
    }
    return { schemes: [], usedUrl: null, fileCount: 0 };
  } finally {
    await ctx.close();
  }
}
