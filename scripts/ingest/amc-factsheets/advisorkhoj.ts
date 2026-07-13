/**
 * AdvisorKhoj aggregator adapter — one source for every AMC's monthly portfolio.
 *
 * AdvisorKhoj publishes, per AMC, a server-rendered page listing that AMC's
 * SEBI-mandated MONTHLY PORTFOLIO DISCLOSURE files (complete scheme-by-scheme
 * holdings). Each link points at the AMC's own file host. Because the page is
 * fully server-rendered (no JS needed) it is fetchable with a plain HTTP GET —
 * no headless browser — which lets a single adapter cover all ~50 AMCs instead
 * of a bespoke scraper per AMC.
 *
 *   page:  https://www.advisorkhoj.com/mutual-funds-research/mutual-fund-portfolio/<Slug>/<year>
 *   links: <a href="https://<amc-host>/…file">Monthly Portfolio Disclosure - <Month> <Year></a>
 *
 * The file behind a link is usually a single multi-sheet .xlsx/.xls, but some
 * AMCs (e.g. ICICI, DSP) ship a .zip of per-scheme workbooks — handled here by
 * extracting and merging. A few AMCs host their file behind bot protection
 * (Akamai etc.) that returns HTML to curl; those surface as `kind:"blocked"`
 * and need a browser/direct-URL fallback.
 *
 * All fetching goes through `curl` so it behaves identically in the dev sandbox
 * (egress proxy) and on CI runners (open internet).
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseAmcWorkbook } from "./parse";
import type { AmcParseOptions, AmcScheme } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const AK_ORIGIN = "https://www.advisorkhoj.com";

const MONTH_TO_NUM: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** "Aditya Birla Sun Life Mutual Fund" → "Aditya-Birla-Sun-Life-Mutual-Fund"
 *  (the URL slug AdvisorKhoj uses). */
export function amcSlug(displayName: string): string {
  return displayName.trim().replace(/\s+/g, "-");
}

/**
 * Canonical short slug used for the snapshot filename + tracker reconciliation.
 * The ten AMCs already in the tracker keep their existing slugs so the 2A
 * mapping lines up; every other AMC gets a stable derived slug.
 */
const SLUG_OVERRIDES: Record<string, string> = {
  "Aditya Birla Sun Life Mutual Fund": "absl",
  "Axis Mutual Fund": "axis",
  "DSP Mutual Fund": "dsp",
  "HDFC Mutual Fund": "hdfc",
  "ICICI Prudential Mutual Fund": "icici-pru",
  "Kotak Mahindra Mutual Fund": "kotak",
  "Mirae Asset Mutual Fund": "mirae",
  "Nippon India Mutual Fund": "nippon",
  "SBI Mutual Fund": "sbi",
  "UTI Mutual Fund": "uti",
  "PPFAS Mutual Fund": "ppfas",
};

export function slugFor(displayName: string): string {
  return (
    SLUG_OVERRIDES[displayName.trim()] ??
    displayName
      .replace(/mutual fund/i, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

/** Discover every AMC AdvisorKhoj lists (from the portfolio-page selector). */
export function discoverAmcs(): string[] {
  const html = curlText(`${AK_ORIGIN}/mutual-funds-research/mutual-fund-portfolio/SBI-Mutual-Fund/${new Date().getUTCFullYear()}`);
  if (!html) return [];
  const out: string[] = [];
  const re = /<option[^>]*value="([^"]*Mutual Fund)"[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = decodeHtml(m[1]).trim();
    if (name && name !== "Mutual Fund Research" && !out.includes(name)) out.push(name);
  }
  return out;
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&#x26;/gi, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function curlText(url: string): string | null {
  try {
    const out = execFileSync("curl", ["-fsL", "--max-time", "60", "-A", UA, url], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return out.toString("utf8");
  } catch {
    return null;
  }
}

function curlBuffer(url: string, referer: string): Buffer | null {
  try {
    const out = execFileSync(
      "curl",
      ["-fsL", "--max-time", "120", "-A", UA, "-H", `Referer: ${referer}`, url],
      { maxBuffer: 256 * 1024 * 1024 },
    );
    return out.length > 500 ? out : null;
  } catch {
    return null;
  }
}

export interface PortfolioLink {
  url: string;
  month: number; // 1..12
  year: number;
  label: string; // e.g. "May 2026"
}

/**
 * List an AMC's monthly-disclosure links from its AdvisorKhoj page, newest
 * first. Fetches the given year's page and (to survive the Jan boundary, when
 * the latest available month sits on the prior-year page) merges year-1.
 */
export function listPortfolioLinks(displayName: string, year: number): PortfolioLink[] {
  const slug = amcSlug(displayName);
  const links: PortfolioLink[] = [];
  const seen = new Set<string>();
  // The current year's page already lists that year's months (latest included);
  // only fall back to the prior year when it's empty (the January boundary).
  for (const y of [year, year - 1]) {
    const pageUrl = `${AK_ORIGIN}/mutual-funds-research/mutual-fund-portfolio/${slug}/${y}`;
    const html = curlText(pageUrl);
    if (html) {
      const anchorRe = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = anchorRe.exec(html))) {
        const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        const label = /Portfolio Disclosure\s*-\s*([A-Za-z]+)\s+(\d{4})/i.exec(text);
        if (!label) continue;
        const mon = MONTH_TO_NUM[label[1].toLowerCase()];
        if (!mon) continue;
        const url = decodeHtml(m[1]).trim();
        if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
        seen.add(url);
        links.push({ url, month: mon, year: +label[2], label: `${label[1]} ${label[2]}` });
      }
    }
    if (links.length > 0) break; // current-year page had disclosures — no need for prior year
  }
  links.sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month));
  return links;
}

export type DownloadKind = "xlsx" | "zip" | "blocked" | "empty";

export interface DownloadResult {
  schemes: AmcScheme[];
  kind: DownloadKind;
  bytes: number;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

/** A downloaded .zip of per-scheme workbooks → merged schemes. */
function parseZip(buf: Buffer, opts: AmcParseOptions): AmcScheme[] {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "akzip-"));
  const zipPath = path.join(tmp, "download.zip");
  const merged: AmcScheme[] = [];
  try {
    fs.writeFileSync(zipPath, buf);
    execFileSync("unzip", ["-o", "-qq", zipPath, "-d", tmp], { stdio: "ignore" });
    for (const f of walkFiles(tmp)) {
      if (f === zipPath || !/\.(xlsx|xls|csv)$/i.test(f)) continue;
      try {
        merged.push(...parseAmcWorkbook(fs.readFileSync(f), opts));
      } catch {
        /* skip an unparseable inner file */
      }
    }
  } catch {
    /* not a real zip / corrupt archive */
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return merged;
}

/** Download a resolved link and parse complete holdings (handles zip/xlsx). */
export function downloadAndParse(url: string, opts: AmcParseOptions): DownloadResult {
  const buf = curlBuffer(url, `${AK_ORIGIN}/`);
  if (!buf) return { schemes: [], kind: "blocked", bytes: 0 };

  // A bot-protected host returns an HTML page instead of the file.
  const head = buf.subarray(0, 128).toString("latin1").trimStart().toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<head")) {
    return { schemes: [], kind: "blocked", bytes: buf.length };
  }

  // Most AMCs: one multi-sheet workbook.
  try {
    const schemes = parseAmcWorkbook(buf, opts);
    if (schemes.length > 0) return { schemes, kind: "xlsx", bytes: buf.length };
  } catch {
    /* fall through to zip handling */
  }

  // Some AMCs (ICICI, DSP): a .zip of per-scheme workbooks.
  const zipSchemes = parseZip(buf, opts);
  if (zipSchemes.length > 0) return { schemes: zipSchemes, kind: "zip", bytes: buf.length };

  return { schemes: [], kind: "empty", bytes: buf.length };
}

export interface ResolvedDownload extends DownloadResult {
  link: PortfolioLink | null;
}

/**
 * Try the resolved links newest-first and return the first that actually
 * downloads AND parses. AdvisorKhoj sometimes lists the newest month before the
 * AMC has published its file (a dead/404 link) while the prior month is live —
 * e.g. Motilal, whose per-month filenames aren't templatable — so falling back
 * to the next-newest link recovers the freshest available portfolio instead of
 * giving up. Capped at `maxAttempts` so genuinely walled hosts (every month on
 * the same Akamai host) fail fast rather than probing the whole year.
 */
export function downloadFirstParsable(
  links: PortfolioLink[],
  opts: AmcParseOptions,
  maxAttempts = 3,
): ResolvedDownload {
  let firstAttempt: ResolvedDownload | null = null;
  for (const link of links.slice(0, maxAttempts)) {
    const res = downloadAndParse(link.url, opts);
    if (res.schemes.length > 0) return { ...res, link };
    firstAttempt ??= { ...res, link };
  }
  return firstAttempt ?? { schemes: [], kind: "blocked", bytes: 0, link: null };
}

/**
 * Normalize a scheme's `pctToNav` to whole-percent units in place.
 *
 * Across AMCs the "% to NAV" column is printed either as a percentage (99.93)
 * or as a fraction (0.9993). Rather than hard-code a per-AMC scale we detect it
 * per scheme: a fraction-printed sheet has every weight ≤ ~1 and sums to ~1,
 * which is unmistakably separable from percent (top weights of several, summing
 * to ~100). Only then do we multiply by 100.
 */
export function normalizeSchemePct(scheme: AmcScheme): AmcScheme {
  let sum = 0;
  let max = 0;
  for (const h of scheme.holdings) {
    if (h.pctToNav == null) continue;
    const a = Math.abs(h.pctToNav);
    sum += a;
    if (a > max) max = a;
  }
  if (sum > 0 && sum < 5 && max <= 1.5) {
    for (const h of scheme.holdings) {
      if (h.pctToNav != null) h.pctToNav = Math.round(h.pctToNav * 100 * 10000) / 10000;
    }
  }
  return scheme;
}
