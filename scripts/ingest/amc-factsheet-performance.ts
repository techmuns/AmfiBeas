/**
 * Scheme Outperformance — top-7 AMC factsheet aggregate audit.
 *
 * Drives runFactsheetStrategy() across all 7 strategies in
 * scripts/ingest/factsheet-strategies/ and writes a single aggregate
 * audit JSON at:
 *   manual-data/audit/top7-scheme-outperformance-poc.json
 *
 * Behaviour
 *  - One Playwright browser shared across all AMCs (amortises
 *    headless-Chromium startup; ~1-2s vs 7s).
 *  - Per-AMC failures (WAF / bad URL / missing PDF / parse miss)
 *    are caught locally and recorded as status="failed" with a
 *    failureReason. The driver continues to the next AMC.
 *  - No production snapshot is written. No UI is wired. The
 *    aggregate JSON is the audit output the workflow consumes.
 *
 * Env vars
 *   TOP7_FACTSHEET_PERIOD=YYYY-MM
 *     Pin all strategies to the same publish-month folder. Blank →
 *     each strategy picks its own latest. Useful when comparing
 *     AMCs at the same period.
 *   TOP7_FACTSHEET_WRITE=0
 *     Dry-run mode; logs but does not write the audit JSON.
 *   TOP7_FACTSHEET_AMC_PDF__<SLUG>=/path/to/file.pdf
 *     Bypass the network fetch for ONE AMC and parse a local PDF
 *     (e.g. TOP7_FACTSHEET_AMC_PDF__hdfc=/tmp/hdfc.pdf). Useful
 *     for iterating on parser heuristics in environments where
 *     the AMC's host is on a host-not-allowed list. The slug must
 *     match the strategy's amcSlug exactly (lower-case).
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Browser } from "playwright";
import { info, nowIso, warn } from "./utils";
import {
  type AmcAuditResult,
  type AmcStrategy,
  runFactsheetStrategy,
} from "./factsheet-shared";
import { TOP7_STRATEGIES } from "./factsheet-strategies";

const TOTAL_KILL_MS = 1_200_000; // 20 minutes — 7 AMCs × ~3 min each worst-case

interface Top7AuditOutput {
  meta: {
    generatedAt: string;
    source: "AMC factsheets";
    /** Latest periodEnd across the AMCs that succeeded. Useful as
     *  the headline "as of <Month> <Year>" stamp on the dashboard
     *  layer (when wired). */
    periodEnd: string | null;
    notes: string[];
  };
  amcs: AmcAuditResult[];
}

function pickLocalPdfFor(slug: string): string | null {
  const envName = `TOP7_FACTSHEET_AMC_PDF__${slug.replace(/-/g, "_")}`;
  const v = process.env[envName];
  if (v && v.trim()) return v.trim();
  return null;
}

function consensusPeriodEnd(results: AmcAuditResult[]): string | null {
  // The dashboard reads ONE periodEnd per refresh. Pick the latest
  // YYYY-MM that any successful AMC reported. Failed AMCs don't
  // contribute. Returns null if none succeeded.
  const periods = results
    .filter((r) => r.status !== "failed" && r.periodEnd)
    .map((r) => r.periodEnd!)
    .sort();
  return periods.length > 0 ? periods[periods.length - 1] : null;
}

export async function ingestTop7Factsheets(): Promise<void> {
  info("=== amc-factsheet-performance (top-7) ===");
  const fetchedAt = nowIso();
  const auditDir = path.resolve(process.cwd(), "manual-data/audit");
  const auditFile = path.join(
    auditDir,
    "top7-scheme-outperformance-poc.json"
  );

  const requestedPeriod =
    (process.env.TOP7_FACTSHEET_PERIOD ?? "").trim() || null;
  const shouldWrite = (process.env.TOP7_FACTSHEET_WRITE ?? "1") !== "0";
  if (requestedPeriod)
    info(`top7-factsheet: pinned period = ${requestedPeriod}`);
  if (!shouldWrite) info(`top7-factsheet: write disabled`);

  // Per-AMC local-PDF overrides (sandbox / debug).
  const localPdfOverrides = new Map<string, string>();
  for (const strategy of TOP7_STRATEGIES) {
    const v = pickLocalPdfFor(strategy.amcSlug);
    if (v) localPdfOverrides.set(strategy.amcSlug, v);
  }
  if (localPdfOverrides.size > 0) {
    info(
      `top7-factsheet: ${localPdfOverrides.size} AMC(s) have local PDF overrides: [${Array.from(
        localPdfOverrides.keys()
      ).join(", ")}]`
    );
  }

  let browser: Browser | null = null;
  let killed = false;
  const killTimer = setTimeout(() => {
    killed = true;
    warn(
      `top7-factsheet: total timeout (${TOTAL_KILL_MS}ms) — closing browser.`
    );
    if (browser) browser.close().catch(() => {});
  }, TOTAL_KILL_MS);

  // Only launch Playwright if AT LEAST one strategy needs the network.
  const needsBrowser = TOP7_STRATEGIES.some(
    (s) => !localPdfOverrides.has(s.amcSlug)
  );
  if (needsBrowser) {
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch({ headless: true });
    } catch (err) {
      warn(
        `top7-factsheet: playwright unavailable: ${(err as Error).message} — strategies without local PDF override will fail.`
      );
    }
  }

  const results: AmcAuditResult[] = [];
  try {
    for (const strategy of TOP7_STRATEGIES) {
      if (killed) {
        info(`top7-factsheet: kill signal received, skipping ${strategy.amcSlug}`);
        results.push(stubFailed(strategy, "Total run timeout reached."));
        continue;
      }
      info(`top7-factsheet: --- ${strategy.amcSlug} (${strategy.amcName}) ---`);
      const cacheDir = path.resolve(
        process.cwd(),
        `manual-data/factsheets/${strategy.amcSlug}`
      );
      const localOverride = localPdfOverrides.get(strategy.amcSlug) ?? null;
      try {
        const r = await runFactsheetStrategy(strategy, browser, {
          requestedPeriod,
          localPdfPath: localOverride,
          cacheDir,
        });
        r.fetchedAt = fetchedAt;
        results.push(r);
      } catch (err) {
        const message = (err as Error).message;
        warn(`top7-factsheet: ${strategy.amcSlug} threw: ${message}`);
        results.push(stubFailed(strategy, `Unexpected error: ${message}`));
      }
    }
  } finally {
    clearTimeout(killTimer);
    if (browser && !killed) {
      try {
        await browser.close();
      } catch {}
    }
  }

  const out: Top7AuditOutput = {
    meta: {
      generatedAt: fetchedAt,
      source: "AMC factsheets",
      periodEnd: consensusPeriodEnd(results),
      notes: [
        "Top-7 AMC scheme-outperformance audit. Not a production snapshot.",
        "Eligibility = IIFL active-equity envelope (Sub II + Sub III ex-Arbitrage + Sub IV; 18 SEBI categories).",
        "Outperformance = scheme return > primary benchmark return for the period; null on either side drops the scheme from that period's denominator.",
        "Per-AMC failures (WAF / no link / parser miss) are recorded with failureReason; the driver continues to the next AMC. No fake values.",
        `Strategies attempted: ${TOP7_STRATEGIES.map((s) => s.amcSlug).join(", ")}.`,
      ],
    },
    amcs: results,
  };

  // Headline summary log so the workflow's run log makes the
  // per-AMC status visible without digging through the JSON.
  info("top7-factsheet: --- summary ---");
  for (const r of results) {
    info(
      `  ${r.amcSlug.padEnd(10)} status=${r.status.padEnd(7)}` +
        ` parsed=${String(r.parsedSchemeCount).padStart(3)}` +
        ` included=${String(r.includedSchemes.length).padStart(3)}` +
        ` 1Y=${r.outperformancePct1Y ?? "—"}%` +
        ` 3Y=${r.outperformancePct3Y ?? "—"}%` +
        ` 5Y=${r.outperformancePct5Y ?? "—"}%` +
        (r.failureReason ? `  reason="${r.failureReason}"` : "")
    );
  }
  const okCount = results.filter((r) => r.status === "ok").length;
  info(
    `top7-factsheet: ${okCount}/${results.length} AMC(s) ok; periodEnd=${out.meta.periodEnd ?? "n/a"}`
  );

  if (shouldWrite) {
    await fs.mkdir(auditDir, { recursive: true });
    await fs.writeFile(auditFile, JSON.stringify(out, null, 2) + "\n", "utf8");
    info(`top7-factsheet: wrote ${auditFile}`);
  } else {
    info(`top7-factsheet: write disabled — would have written ${auditFile}`);
  }
}

function stubFailed(strategy: AmcStrategy, reason: string): AmcAuditResult {
  return {
    amcSlug: strategy.amcSlug,
    amcName: strategy.amcName,
    source: "AMC factsheet",
    sourceUrl: strategy.listingUrl,
    sourceFile: null,
    periodEnd: null,
    fetchedAt: nowIso(),
    status: "failed",
    parsedSchemeCount: 0,
    eligibleSchemeCount1Y: 0,
    eligibleSchemeCount3Y: 0,
    eligibleSchemeCount5Y: 0,
    outperformingSchemeCount1Y: 0,
    outperformingSchemeCount3Y: 0,
    outperformingSchemeCount5Y: 0,
    outperformancePct1Y: null,
    outperformancePct3Y: null,
    outperformancePct5Y: null,
    candidateBlocksScanned: 0,
    performancePagesDetected: [],
    rejectedCandidateSamples: [],
    includedSchemes: [],
    excludedSchemes: [],
    warnings: [],
    notes: [reason],
    failureReason: reason,
  };
}

const isMain = (() => {
  try {
    const argv1 = process.argv[1] ?? "";
    return /amc-factsheet-performance\.ts$/.test(argv1);
  } catch {
    return false;
  }
})();
if (isMain) {
  ingestTop7Factsheets().catch((err) => {
    warn(`top7-factsheet: fatal — ${(err as Error).message}`);
    process.exit(1);
  });
}
