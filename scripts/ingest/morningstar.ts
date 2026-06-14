/**
 * Morningstar India ingestion.
 *
 * COMPLIANCE — read before editing:
 *   • This script fetches ONLY publicly accessible Morningstar India pages.
 *   • It does not authenticate, bypass paywalls, defeat captchas or any bot-
 *     protection systems, and does not call Morningstar's commercial APIs.
 *   • If Morningstar credentials happen to be present in the environment
 *     (MORNINGSTAR_CLIENT_ID / _SECRET / _USERNAME / _PASSWORD) we log that
 *     fact but DO NOT attempt API calls — implementing those needs a
 *     separately negotiated licence + documented endpoints.
 *   • Output is a snapshot used as a fallback / comparison source only;
 *     Morningstar values never feed live yield calculations directly.
 *   • If a fetch is blocked, fails, or returns no parsable rows, we mark
 *     status accordingly and KEEP the previous snapshot — empty results
 *     never overwrite valid data.
 */

import * as cheerio from "cheerio";
import fs from "node:fs/promises";
import path from "node:path";
import {
  fetchText,
  info,
  nowIso,
  parseNumberLoose,
  writeSnapshot,
  SNAPSHOT_DIR,
} from "./utils";
import { amfiNameToSlug } from "../../src/data/amcs";
import type {
  MorningstarAumRow,
  MorningstarAumSnapshot,
  MorningstarStatus,
} from "../../src/data/snapshots/types";

const SNAPSHOT_FILE = "morningstar-amc-aum.json";

// Public landing URLs to probe. Tried in order; first that returns a parsable
// AMC + AUM table wins. None of these are behind a login.
const CANDIDATE_URLS = [
  "https://www.morningstar.in/amc-list.aspx",
  "https://www.morningstar.in/featured/amfi-data/avg-aum-by-fund-house.aspx",
  "https://www.morningstar.in/mutualfunds.aspx",
  "https://www.morningstar.in/amfi-data.aspx",
];

// Morningstar tends to display fund-house names verbatim in the same form as
// AMFI ("HDFC Mutual Fund" etc.), so the existing AMFI mapping mostly works.
// Add a few extra spellings sometimes seen on third-party sites.
const EXTRA_NAME_VARIANTS: Record<string, string> = {
  "HDFC AMC": "HDFC Mutual Fund",
  "Nippon India MF": "Nippon India Mutual Fund",
  "Aditya Birla SL Mutual Fund": "Aditya Birla Sun Life Mutual Fund",
  "ABSL Mutual Fund": "Aditya Birla Sun Life Mutual Fund",
  "UTI MF": "UTI Mutual Fund",
};

function normalizeAmcName(raw: string): string {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  return EXTRA_NAME_VARIANTS[trimmed] ?? trimmed;
}

function inferQuarterAndDate(): { quarter: string; date: string } {
  // Most-recent COMPLETED calendar quarter — the latest quarter whose final
  // day is strictly in the past. A quarter-end month (Mar/Jun/Sep/Dec) is only
  // "complete" once we're past its last day, so the current in-progress quarter
  // must be excluded. (The old walk-back started from the current month and so
  // returned the still-running quarter whenever the script ran in the third
  // month of a quarter, e.g. any June day → 2026-Q2 before it had finished.)
  const now = new Date();
  let yr = now.getFullYear();
  // Current quarter's end month (3/6/9/12).
  let mo = Math.ceil((now.getMonth() + 1) / 3) * 3;
  // Step back a quarter at a time until the quarter-end has fully elapsed.
  while (new Date(yr, mo, 0) >= now) {
    mo -= 3;
    if (mo <= 0) { mo = 12; yr -= 1; }
  }
  const qNum = Math.ceil(mo / 3);
  const lastDay = new Date(yr, mo, 0).getDate();
  return {
    quarter: `${yr}-Q${qNum}`,
    date: `${yr}-${String(mo).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

interface FetchOutcome {
  url: string;
  html: string | null;
  status: number | null;
  blocked: boolean;
  errorMessage?: string;
}

async function tryFetch(url: string): Promise<FetchOutcome> {
  try {
    info(`morningstar: GET ${url}`);
    const html = await fetchText(url);
    return { url, html, status: 200, blocked: false };
  } catch (err) {
    const msg = (err as Error).message;
    info(`  ${url} → ${msg}`);
    // Heuristic: 4xx/5xx indicates blocked or unavailable; we surface that
    // distinctly so the snapshot status reflects the real reason.
    const httpMatch = msg.match(/HTTP\s+(\d{3})/);
    const status = httpMatch ? Number(httpMatch[1]) : null;
    const blocked =
      status === 403 ||
      status === 429 ||
      /captcha|cloudflare|blocked/i.test(msg);
    return { url, html: null, status, blocked, errorMessage: msg };
  }
}

interface ParsedRow {
  amcSlug: string;
  originalName: string;
  averageAum: number;
}

function parseAumTablesFromHtml(html: string): ParsedRow[] {
  const $ = cheerio.load(html);
  const out: ParsedRow[] = [];
  const seen = new Set<string>();

  $("table").each((_, tbl) => {
    const headers = $(tbl)
      .find("thead tr th, tr:first-child th, tr:first-child td")
      .map((_, el) => $(el).text().trim().toLowerCase())
      .get();
    const amcIdx = headers.findIndex((h) =>
      /amc|fund\s*house|mutual\s*fund|asset\s*manager/.test(h)
    );
    let aumIdx = headers.findIndex((h) =>
      /(grand\s*total|total\s*aaum|total\s*average\s*aum)/.test(h)
    );
    if (aumIdx === -1)
      aumIdx = headers.findIndex((h) =>
        /aaum|average\s*aum|avg\.?\s*aum|aum\s*\(/.test(h)
      );
    if (amcIdx === -1 || aumIdx === -1) return;

    $(tbl)
      .find("tbody tr, tr")
      .each((i, row) => {
        if (i === 0) return; // skip header
        const cells = $(row)
          .find("th, td")
          .map((_, c) => $(c).text().trim())
          .get();
        const name = (cells[amcIdx] ?? "").trim();
        if (!name) return;
        if (/^(total|grand|sub|industry|note|\*|s\.?\s*no)/i.test(name)) return;
        const aum = parseNumberLoose(cells[aumIdx]);
        if (aum === null || aum <= 0) return;
        const normalized = normalizeAmcName(name);
        const slug = amfiNameToSlug(normalized);
        if (!slug) {
          // Unmapped — log via diagnostics, don't force-map.
          info(`  unmapped AMC name on Morningstar: "${name}"`);
          return;
        }
        const key = slug;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ amcSlug: slug, originalName: name, averageAum: aum });
      });
  });

  return out;
}

async function readExistingSnapshot(): Promise<MorningstarAumSnapshot | null> {
  try {
    const raw = await fs.readFile(
      path.join(SNAPSHOT_DIR, SNAPSHOT_FILE),
      "utf8"
    );
    return JSON.parse(raw) as MorningstarAumSnapshot;
  } catch {
    return null;
  }
}

function logCredentialPresence() {
  const has = (k: string) => Boolean(process.env[k]);
  const present = [
    "MORNINGSTAR_CLIENT_ID",
    "MORNINGSTAR_CLIENT_SECRET",
    "MORNINGSTAR_USERNAME",
    "MORNINGSTAR_PASSWORD",
  ].filter(has);
  if (present.length === 0) {
    info(
      "morningstar: no API credentials in env — public-pages-only mode"
    );
  } else {
    info(
      `morningstar: detected env vars [${present.join(", ")}] — placeholder code path only, no API calls implemented`
    );
  }
}

export async function ingestMorningstar(): Promise<void> {
  if (process.env.MORNINGSTAR_FETCH_ENABLED !== "1") {
    info(
      "morningstar: skipped (MORNINGSTAR_FETCH_ENABLED not set to '1')"
    );
    return;
  }

  logCredentialPresence();

  const fetchedAt = nowIso();
  const { quarter, date } = inferQuarterAndDate();
  const existing = await readExistingSnapshot();

  let firstHit: { url: string; html: string } | null = null;
  let firstBlocked: FetchOutcome | null = null;
  let firstFailed: FetchOutcome | null = null;

  for (const url of CANDIDATE_URLS) {
    const outcome = await tryFetch(url);
    info(
      `morningstar: ${url} → status=${outcome.status ?? "—"} blocked=${outcome.blocked}`
    );
    if (outcome.html) {
      firstHit = { url, html: outcome.html };
      break;
    }
    if (outcome.blocked && !firstBlocked) firstBlocked = outcome;
    if (!outcome.blocked && !firstFailed) firstFailed = outcome;
  }

  let status: MorningstarStatus;
  let notes: string | undefined;
  let rows: MorningstarAumRow[] = [];
  let sourceUrl = "";

  if (!firstHit) {
    if (firstBlocked) {
      status = "blocked";
      sourceUrl = firstBlocked.url;
      notes = `Blocked: HTTP ${firstBlocked.status ?? "?"} ${firstBlocked.errorMessage ?? ""}`.trim();
    } else if (firstFailed) {
      status = "failed";
      sourceUrl = firstFailed.url;
      notes = `Failed: HTTP ${firstFailed.status ?? "?"} ${firstFailed.errorMessage ?? ""}`.trim();
    } else {
      status = "failed";
      notes = "No candidate URL returned content";
    }
    info(`morningstar: status=${status} (no rows). ${notes ?? ""}`);
  } else {
    sourceUrl = firstHit.url;
    const parsed = parseAumTablesFromHtml(firstHit.html);
    info(`morningstar: parsed ${parsed.length} mapped AMC rows from ${sourceUrl}`);
    if (parsed.length === 0) {
      status = "empty";
      notes =
        "Page reachable but no AMC + AAUM table found. Morningstar's public surface may not expose this dataset, or the page structure changed.";
    } else {
      status = "ok";
      rows = parsed.map(
        (r): MorningstarAumRow => ({
          date,
          quarter,
          amcId: r.amcSlug,
          originalName: r.originalName,
          averageAum: r.averageAum,
          sourceUrl,
          confidence: "medium",
        })
      );
    }
  }

  // Validation: averageAum > 0, sourceUrl present, fetchedAt present
  rows = rows.filter(
    (r) =>
      Number.isFinite(r.averageAum) &&
      r.averageAum > 0 &&
      r.sourceUrl.length > 0
  );

  // Never overwrite a valid previous snapshot with empty data.
  const existingHasValidData =
    existing &&
    existing.meta.status === "ok" &&
    Array.isArray(existing.rows) &&
    existing.rows.length > 0;

  if (rows.length === 0 && existingHasValidData) {
    info(
      `morningstar: keeping previous valid snapshot (${existing!.rows.length} rows, fetched ${existing!.meta.fetchedAt}). Logging current attempt as ${status}.`
    );
    return;
  }

  const snapshot: MorningstarAumSnapshot = {
    meta: {
      source: "Morningstar India",
      sourceUrl,
      fetchedAt,
      status,
      notes,
    },
    rows,
  };
  await writeSnapshot(SNAPSHOT_FILE, snapshot);
  info(
    `morningstar: wrote ${SNAPSHOT_FILE} status=${status} rows=${rows.length}`
  );
}
