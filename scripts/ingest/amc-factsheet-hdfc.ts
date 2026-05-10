/**
 * HDFC Mutual Fund — Scheme Outperformance PoC driver.
 *
 * Single-AMC entry point for the audit workflow added in PR #83.
 * The parser internals were extracted into scripts/ingest/factsheet-
 * shared.ts in PR #88; this file is now just the HDFC-specific
 * driver that:
 *   - resolves the local-PDF / network fetch source
 *   - delegates to runFactsheetStrategy() for parse + eligibility
 *   - writes the HDFC-only audit JSON at
 *     manual-data/audit/hdfc-scheme-outperformance-poc.json
 *
 * The HDFC strategy config (URL, brand prefix, boilerplate) lives at
 * scripts/ingest/factsheet-strategies/hdfc.ts. Everything else
 * (section walking, time-period row extraction, eligibility filter,
 * benchmark detection, dedupe) is universal and shared with the
 * other 6 top-AMC strategies.
 *
 * ### Env vars
 *
 *   HDFC_FACTSHEET_PDF=/path/to/file.pdf
 *     Bypass the network fetch and parse a local PDF. Useful for
 *     iterating on parser heuristics in environments where
 *     hdfcfund.com is on a host-not-allowed list.
 *
 *   HDFC_FACTSHEET_PERIOD=YYYY-MM
 *     Pin the listing scrape to a specific publish-month folder.
 *     Blank → latest available.
 *
 *   HDFC_FACTSHEET_WRITE=0
 *     Dry-run mode; logs but does not write the audit JSON.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Browser } from "playwright";
import { info, nowIso, warn } from "./utils";
import {
  type AmcAuditResult,
  runFactsheetStrategy,
} from "./factsheet-shared";
import { HDFC_STRATEGY } from "./factsheet-strategies/hdfc";

const T = { totalKill: 600_000 };

export async function ingestHdfcFactsheetPoc(): Promise<void> {
  info("=== amc-factsheet-hdfc (PoC) ===");
  const fetchedAt = nowIso();
  const cacheDir = path.resolve(process.cwd(), "manual-data/factsheets/hdfc");
  const auditDir = path.resolve(process.cwd(), "manual-data/audit");
  const auditFile = path.join(auditDir, "hdfc-scheme-outperformance-poc.json");

  const localOverride = process.env.HDFC_FACTSHEET_PDF;
  const requestedPeriod =
    (process.env.HDFC_FACTSHEET_PERIOD ?? "").trim() || null;
  const shouldWrite = (process.env.HDFC_FACTSHEET_WRITE ?? "1") !== "0";
  if (requestedPeriod) info(`hdfc-factsheet: pinned period = ${requestedPeriod}`);
  if (!shouldWrite)
    info(`hdfc-factsheet: write disabled (HDFC_FACTSHEET_WRITE=0)`);

  let browser: Browser | null = null;
  let killed = false;
  const killTimer = setTimeout(() => {
    killed = true;
    warn(
      `hdfc-factsheet: total timeout (${T.totalKill}ms) — closing browser.`
    );
    if (browser) browser.close().catch(() => {});
  }, T.totalKill);

  let result: AmcAuditResult;
  try {
    if (!localOverride) {
      try {
        const { chromium } = await import("playwright");
        browser = await chromium.launch({ headless: true });
      } catch (err) {
        warn(`hdfc-factsheet: playwright unavailable: ${(err as Error).message}`);
      }
    }
    result = await runFactsheetStrategy(HDFC_STRATEGY, browser, {
      requestedPeriod,
      localPdfPath: localOverride ?? null,
      cacheDir,
    });
    // Stamp the fetch timestamp from THIS driver run (in case the
    // strategy was invoked sub-second earlier).
    result.fetchedAt = fetchedAt;
  } finally {
    clearTimeout(killTimer);
    if (browser && !killed) {
      try {
        await browser.close();
      } catch {}
    }
  }

  // The HDFC-only audit JSON keeps the same field shape it had in
  // PR #82-#87 — just produced via the shared strategy now.
  const out = {
    source: "HDFC Mutual Fund factsheet" as const,
    sourceUrl: result.sourceUrl,
    sourceFile: result.sourceFile,
    periodEnd: result.periodEnd,
    fetchedAt: result.fetchedAt,
    parsedSchemeCount: result.parsedSchemeCount,
    eligibleSchemeCount1Y: result.eligibleSchemeCount1Y,
    eligibleSchemeCount3Y: result.eligibleSchemeCount3Y,
    eligibleSchemeCount5Y: result.eligibleSchemeCount5Y,
    outperformingSchemeCount1Y: result.outperformingSchemeCount1Y,
    outperformingSchemeCount3Y: result.outperformingSchemeCount3Y,
    outperformingSchemeCount5Y: result.outperformingSchemeCount5Y,
    outperformancePct1Y: result.outperformancePct1Y,
    outperformancePct3Y: result.outperformancePct3Y,
    outperformancePct5Y: result.outperformancePct5Y,
    candidateBlocksScanned: result.candidateBlocksScanned,
    performancePagesDetected: result.performancePagesDetected,
    rejectedCandidateSamples: result.rejectedCandidateSamples,
    includedSchemes: result.includedSchemes,
    excludedSchemes: result.excludedSchemes,
    warnings: result.warnings,
    notes: [
      "PoC — single-AMC, single-period audit. Not a production snapshot.",
      ...result.notes,
    ],
    status: result.status,
    failureReason: result.failureReason,
    diagnostics: result.diagnostics,
  };

  if (shouldWrite) {
    await fs.mkdir(auditDir, { recursive: true });
    await fs.writeFile(auditFile, JSON.stringify(out, null, 2) + "\n", "utf8");
    info(`hdfc-factsheet: wrote ${auditFile} (${result.status})`);
  } else {
    info(
      `hdfc-factsheet: write disabled — would have written ${auditFile} (${result.status})`
    );
  }
}

const isMain = (() => {
  try {
    const argv1 = process.argv[1] ?? "";
    return /amc-factsheet-hdfc\.ts$/.test(argv1);
  } catch {
    return false;
  }
})();
if (isMain) {
  ingestHdfcFactsheetPoc().catch((err) => {
    warn(`hdfc-factsheet: fatal — ${(err as Error).message}`);
    process.exit(1);
  });
}
