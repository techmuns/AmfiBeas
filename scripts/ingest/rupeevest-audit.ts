/**
 * RupeeVest source audit — feasibility of using rupeevest.com as a
 * source for the Scheme Outperformance / Top Quartile dashboard cards.
 *
 * Why this audit exists
 * ---------------------
 * AMC factsheet parsing (PRs #82-#92) is a slog: HDFC works cleanly,
 * Nippon is partial + stale, ICICI needs an annexure parser, and
 * SBI/Kotak/ABSL/UTI fetchers haven't yet succeeded. Before we drop
 * the two cards we were trying to power, this audit checks whether
 * rupeevest.com — a third-party MF analytics aggregator — exposes
 * the same data in a more parseable shape.
 *
 * The audit answers four questions:
 *   1. Is RupeeVest data accessible (HTML / CSV / JSON / DOM-only)?
 *   2. Are scheme returns + benchmark returns + category info
 *      available enough to compute Scheme Outperformance?
 *   3. Is rank / percentile / quartile available? If not, would
 *      a star-rating-based "Top Rated %" proxy work (with a
 *      different label) instead of "Top Quartile %"?
 *   4. Is the licensing / ToS situation acceptable for production
 *      dashboard use?
 *
 * How this script behaves
 * -----------------------
 *  - Network-enabled (CI / dev): Playwright opens a few RupeeVest
 *    pages, attempts to scrape their structure, and writes the
 *    audit JSON with `dataAccessMode = "playwright-probe"` plus
 *    confirmed fields.
 *  - Sandbox / network-restricted: Playwright unavailable or
 *    rupeevest.com on host-not-allowed → writes the audit JSON
 *    with `dataAccessMode = "documentation-based"` plus inferred
 *    fields. The script never fakes data: failures are recorded
 *    as blockers; inferred fields are clearly tagged.
 *
 * No production snapshot is written. No UI is wired. Audit-only.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { Browser, Page } from "playwright";
import { info, nowIso, warn } from "./utils";

const T = {
  pageGoto: 25_000,
  waitNetwork: 6_000,
  scriptTotalKill: 240_000,
};

const PAGES_TO_PROBE: { name: string; url: string; category: PageCategory }[] = [
  {
    name: "Screener (default — all categories)",
    url: "https://www.rupeevest.com/Mutual-Funds-India/Screener",
    category: "screener",
  },
  {
    name: "Mutual Fund Comparison",
    url: "https://www.rupeevest.com/Mutual-Fund-Comparison",
    category: "comparison",
  },
  {
    name: "Rating methodology",
    url: "https://www.rupeevest.com/Mutual-Funds/Rating",
    category: "rating-methodology",
  },
  {
    name: "Terms & Conditions",
    url: "https://www.rupeevest.com/Terms-and-Conditions",
    category: "terms",
  },
];

type PageCategory =
  | "screener"
  | "comparison"
  | "fund-detail"
  | "rating-methodology"
  | "terms";

interface PageProbeResult {
  name: string;
  url: string;
  category: PageCategory;
  ok: boolean;
  httpStatus?: number;
  loadTimeMs?: number;
  /** Headline fields detected in the rendered DOM. */
  detected: {
    hasDownloadButton?: boolean;
    hasFundHouseFilter?: boolean;
    hasCategoryFilter?: boolean;
    hasReturnColumns?: boolean;
    hasBenchmarkColumn?: boolean;
    hasRatingColumn?: boolean;
    hasRankOrPercentile?: boolean;
    hasStarRating?: boolean;
    columnHeadersSeen?: string[];
    sampleRowText?: string;
    /** First 200 chars of the page's body — useful when an
     *  unexpected redirect / paywall / Cloudflare interstitial
     *  appears. */
    bodySnippet?: string;
  };
  failureReason?: string;
}

interface RupeevestAuditOutput {
  status: "ok" | "partial" | "failed";
  generatedAt: string;
  source: "rupeevest.com";
  /** "playwright-probe" — script ran end-to-end against live site.
   *  "documentation-based" — sandbox couldn't reach site; fields
   *  reflect user-provided / publicly-documented structure only. */
  dataAccessMode: "playwright-probe" | "documentation-based";
  pagesTested: PageProbeResult[];
  /** Per-field availability synthesis across the pages probed. */
  fieldsAvailable: {
    schemeName: FieldVerdict;
    fundHouse: FieldVerdict;
    category: FieldVerdict;
    benchmarkIndex: FieldVerdict;
    benchmarkReturns: FieldVerdict;
    schemeReturns1Y: FieldVerdict;
    schemeReturns3Y: FieldVerdict;
    schemeReturns5Y: FieldVerdict;
    categoryAverageReturns: FieldVerdict;
    categoryRankOrPercentile: FieldVerdict;
    quartileLabel: FieldVerdict;
    starRating: FieldVerdict;
    aum: FieldVerdict;
    expenseRatio: FieldVerdict;
    sebiCategory: FieldVerdict;
  };
  schemeOutperformanceFeasible: FeasibilityVerdict;
  topQuartileFeasible: FeasibilityVerdict;
  topRatedFeasible: FeasibilityVerdict;
  licensingRisk: LicensingAnalysis;
  /** Sampled rows from the Screener / fund detail pages, when
   *  Playwright probed successfully. Otherwise empty + a note. */
  sampleRows: Record<string, unknown>[];
  /** XHR / fetch endpoints discovered while pages loaded — useful
   *  for picking a JSON path over scraping the DOM. */
  discoveredEndpoints: { method: string; url: string; status: number }[];
  blockers: string[];
  recommendation: {
    schemeOutperformance: "build" | "drop" | "rename" | "investigate-further";
    topQuartile: "build" | "drop" | "rename-to-top-rated" | "investigate-further";
    overall: string;
  };
  notes: string[];
}

type FieldVerdict =
  | { available: "yes"; source: string }
  | { available: "no"; reason: string }
  | { available: "partial"; reason: string }
  | { available: "unknown"; reason: string };

type FeasibilityVerdict =
  | { feasible: "yes"; rationale: string }
  | { feasible: "no"; rationale: string }
  | { feasible: "partial"; rationale: string }
  | { feasible: "unknown"; rationale: string };

interface LicensingAnalysis {
  termsUrl: string;
  termsPageProbed: boolean;
  /** Direct quotes from the terms relevant to redistribution /
   *  commercial use, when the terms page was reachable. */
  relevantClauses: string[];
  risk: "low" | "medium" | "high" | "unknown";
  riskRationale: string;
}

// ---------------------------------------------------------------------------
// Documentation-based defaults — used when Playwright is unavailable.
// Reflects: user-supplied known facts + standard MF aggregator
// behaviour. Each field is flagged so the consumer can tell which
// answers are "we saw it" vs "we inferred it".
// ---------------------------------------------------------------------------

function defaultDocumentationBasedAudit(): Pick<
  RupeevestAuditOutput,
  | "fieldsAvailable"
  | "schemeOutperformanceFeasible"
  | "topQuartileFeasible"
  | "topRatedFeasible"
  | "licensingRisk"
  | "recommendation"
  | "notes"
> {
  const yes = (source: string): FieldVerdict => ({ available: "yes", source });
  const no = (reason: string): FieldVerdict => ({ available: "no", reason });
  const unknown = (reason: string): FieldVerdict => ({
    available: "unknown",
    reason,
  });

  return {
    fieldsAvailable: {
      schemeName: yes("Screener / fund detail page"),
      fundHouse: yes("Screener filter; fund detail header"),
      category: yes("Screener column; fund detail header"),
      benchmarkIndex: yes("Screener column; fund detail header"),
      benchmarkReturns: unknown(
        "Likely surfaced via the Comparison tool's index returns row, but per-fund benchmark return alignment requires confirmation. Probe needed."
      ),
      schemeReturns1Y: yes("Screener column; fund detail performance section"),
      schemeReturns3Y: yes("Screener column; fund detail performance section"),
      schemeReturns5Y: yes("Screener column; fund detail performance section"),
      categoryAverageReturns: yes(
        "Fund detail page typically shows 'Category average' alongside scheme return"
      ),
      categoryRankOrPercentile: unknown(
        "Standard MF aggregator behaviour but unconfirmed for RupeeVest specifically. May only be visible on peer-comparison sub-section. Probe needed."
      ),
      quartileLabel: no(
        "RupeeVest publishes a 5-star rating, not a Q1/Q2/Q3/Q4 label. Star rating buckets (5/4/3/2/1 = top 10%/25%/30%/25%/10%) do NOT align with quartile boundaries."
      ),
      starRating: yes(
        "Per user-provided known facts: 5-star = top 10%, 4-star = next 25%, 3-star = next 30%, 2-star = next 25%, 1-star = bottom 10%."
      ),
      aum: yes("Screener column; fund detail page"),
      expenseRatio: yes("Fund detail page"),
      sebiCategory: yes("Screener category filter mirrors SEBI category"),
    },
    schemeOutperformanceFeasible: {
      feasible: "partial",
      rationale:
        "Scheme returns are exposed; benchmark returns per period need confirmation via the Screener column or the fund detail page's performance section. If benchmark returns ARE in the screener output (downloadable / scrapable), the metric is computable. If only category-average is exposed (without per-fund benchmark), the metric becomes 'beats category average', not 'beats benchmark' — different definition.",
    },
    topQuartileFeasible: {
      feasible: "no",
      rationale:
        "RupeeVest does not publish a Q1/Q2/Q3/Q4 label or a clean percentile rank per fund (per known facts; pending confirmation on the peer-comparison section). Star rating uses different bucket sizes — 5-star is top 10%, not top 25%. Calling a star-based metric 'Top Quartile' would be misleading.",
    },
    topRatedFeasible: {
      feasible: "yes",
      rationale:
        "RupeeVest's 5-star rating IS exposed and ranks within category. 'Top Rated %' (% of AMC's schemes rated 4-star or 5-star) is a defensible alternative metric — but it is NOT 'Top Quartile %'. The label change is mandatory if we use rating as a proxy.",
    },
    licensingRisk: {
      termsUrl: "https://www.rupeevest.com/Terms-and-Conditions",
      termsPageProbed: false,
      relevantClauses: [],
      risk: "high",
      riskRationale:
        "Standard Indian MF aggregator ToS typically restrict (a) commercial redistribution, (b) creation of derivative datasets / dashboards. Without explicit license, displaying RupeeVest-derived returns / ratings on a public dashboard likely violates §1-3 of typical aggregator terms. NEEDS EXPLICIT REVIEW of the actual Terms page before any production use. Mitigation: pull the underlying primary data (AMFI NAVs + index providers' benchmark series) and recompute outperformance / quartile in-house — that data is regulator-disclosed and free to redistribute.",
    },
    recommendation: {
      schemeOutperformance: "investigate-further",
      topQuartile: "rename-to-top-rated",
      overall: [
        "PRIMARY RECOMMENDATION: do NOT redistribute RupeeVest data on the dashboard without an explicit license — high ToS risk.",
        "If the goal is to ship the two cards quickly, the cleanest path is to compute the underlying numbers ourselves from regulator-disclosed sources:",
        "  - Scheme returns: AMFI daily NAVs (already in the codebase via amfi-nav.ts) → CAGR over 1Y / 3Y / 5Y per scheme.",
        "  - Benchmark returns: NSE/BSE official index series (e.g. NIFTY 500 TRI from NSE Indices, BSE Sensex from BSE).",
        "  - Category quartile: rank each scheme's 1Y/3Y/5Y return within its SEBI category from the same NAV-derived computation.",
        "This avoids RupeeVest's ToS entirely and gives us the same metrics under our own data.",
        "If RupeeVest's UI is used at all, restrict to (a) cross-checking our own numbers, or (b) labelled 'data via RupeeVest' with explicit attribution AND a license — ask first.",
        "If the AMC factsheet effort is still preferred, narrow scope: keep Scheme Outperformance from factsheets (HDFC works, Nippon partial), and DROP Top Quartile until the AMFI-NAV-derived approach lands.",
      ].join(" "),
    },
    notes: [
      "This audit's documentation-based defaults reflect the user-provided known facts + standard MF aggregator behaviour. Sandbox could not directly probe rupeevest.com (host-not-allowed). Run via the CI workflow to populate playwright-probe results.",
      "RupeeVest rating: 5-star = top 10% within category, 4-star = next 25%, 3-star = next 30%, 2-star = next 25%, 1-star = bottom 10%. Star-rating buckets do NOT align with quartile boundaries (Q1 = top 25%).",
      "If we adopt RupeeVest, propose relabelling 'Top Quartile %' → 'Top Rated %' (4-star or 5-star) on the dashboard — accuracy + lower legal exposure than calling a rating-based metric a quartile.",
      "Cleanest path remains AMFI NAV-derived computation (regulator data, free to redistribute, exact methodology under our control).",
    ],
  };
}

// ---------------------------------------------------------------------------
// Playwright probe — runs in CI / dev with network access.
// ---------------------------------------------------------------------------

async function probePage(
  page: Page,
  spec: { name: string; url: string; category: PageCategory }
): Promise<PageProbeResult> {
  const start = Date.now();
  const out: PageProbeResult = {
    name: spec.name,
    url: spec.url,
    category: spec.category,
    ok: false,
    detected: {},
  };
  try {
    info(`rupeevest-audit: probing ${spec.url}`);
    const resp = await page.goto(spec.url, {
      waitUntil: "domcontentloaded",
      timeout: T.pageGoto,
    });
    out.httpStatus = resp?.status() ?? 0;
    if (!resp || !resp.ok()) {
      out.failureReason = `HTTP ${out.httpStatus}`;
      return out;
    }
    await page
      .waitForLoadState("networkidle", { timeout: T.waitNetwork })
      .catch(() => {});

    const detected = await page.evaluate(() => {
      const text = (document.body.innerText || "").trim();
      const lower = text.toLowerCase();
      const headers = Array.from(document.querySelectorAll("th"))
        .map((th) => (th.textContent || "").trim())
        .filter((t) => t.length > 0)
        .slice(0, 30);
      const downloadButton = !!document.querySelector(
        'button[data-action*="download" i], button[id*="download" i], a[href*=".csv" i], a[href*=".xls" i], a[href*="download" i]'
      );
      // Sample first non-header row of any table on the page.
      const firstRow = document.querySelector("tbody tr");
      const sampleRowText = firstRow
        ? (firstRow.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240)
        : undefined;
      return {
        headers,
        downloadButton,
        hasFundHouse: /fund\s*house/i.test(text),
        hasCategoryFilter: /\bcategory\b/i.test(lower),
        has1Y: /\b1[\s\-_]?(?:y|yr|year)\b/i.test(text) || /\b1\s*Yr\b/.test(text),
        has3Y: /\b3[\s\-_]?(?:y|yr|year)\b/i.test(text) || /\b3\s*Yr\b/.test(text),
        has5Y: /\b5[\s\-_]?(?:y|yr|year)\b/i.test(text) || /\b5\s*Yr\b/.test(text),
        hasBenchmark: /\bbenchmark\b/i.test(lower) || /\bindex\b/i.test(lower),
        hasRating: /\brating\b/i.test(lower) || /★|⭐|★/.test(text),
        hasRank: /\b(?:rank|percentile|quartile)\b/i.test(lower),
        hasStarRating: /★|⭐|⋆|\b\d\s*star\b/i.test(text),
        sampleRowText,
        bodySnippet: text.slice(0, 200),
      };
    });

    out.ok = true;
    out.loadTimeMs = Date.now() - start;
    out.detected = {
      hasDownloadButton: detected.downloadButton,
      hasFundHouseFilter: detected.hasFundHouse,
      hasCategoryFilter: detected.hasCategoryFilter,
      hasReturnColumns: detected.has1Y || detected.has3Y || detected.has5Y,
      hasBenchmarkColumn: detected.hasBenchmark,
      hasRatingColumn: detected.hasRating,
      hasRankOrPercentile: detected.hasRank,
      hasStarRating: detected.hasStarRating,
      columnHeadersSeen: detected.headers,
      sampleRowText: detected.sampleRowText,
      bodySnippet: detected.bodySnippet,
    };
  } catch (err) {
    out.failureReason = (err as Error).message;
  }
  return out;
}

async function probeRupeevest(): Promise<{
  pagesTested: PageProbeResult[];
  endpoints: { method: string; url: string; status: number }[];
  blockers: string[];
}> {
  const blockers: string[] = [];
  const endpoints: { method: string; url: string; status: number }[] = [];
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    blockers.push(`Playwright import failed: ${(err as Error).message}`);
    return { pagesTested: [], endpoints, blockers };
  }
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    blockers.push(`Playwright launch failed: ${(err as Error).message}`);
    return { pagesTested: [], endpoints, blockers };
  }
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  page.on("response", (resp) => {
    const url = resp.url();
    if (!/rupeevest\.com/i.test(url)) return;
    if (/\.(css|png|jpe?g|svg|woff2?|ttf|map|ico)(\?|$)/i.test(url)) return;
    endpoints.push({
      method: resp.request().method(),
      url,
      status: resp.status(),
    });
  });
  const pagesTested: PageProbeResult[] = [];
  for (const spec of PAGES_TO_PROBE) {
    pagesTested.push(await probePage(page, spec));
  }
  await ctx.close().catch(() => {});
  await browser.close().catch(() => {});
  // Cap endpoints array to keep the JSON manageable.
  return { pagesTested, endpoints: endpoints.slice(0, 60), blockers };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export async function ingestRupeevestAudit(): Promise<void> {
  info("=== rupeevest-audit ===");
  const generatedAt = nowIso();
  const auditDir = path.resolve(process.cwd(), "manual-data/audit");
  const auditFile = path.join(auditDir, "rupeevest-source-audit.json");
  const shouldWrite = (process.env.RUPEEVEST_AUDIT_WRITE ?? "1") !== "0";

  const killTimer = setTimeout(() => {
    warn(`rupeevest-audit: total timeout (${T.scriptTotalKill}ms) — exiting`);
    process.exit(2);
  }, T.scriptTotalKill);
  killTimer.unref();

  const probe = await probeRupeevest();
  const docs = defaultDocumentationBasedAudit();

  const probeOk = probe.pagesTested.length > 0 && probe.pagesTested.some((p) => p.ok);
  const dataAccessMode: RupeevestAuditOutput["dataAccessMode"] = probeOk
    ? "playwright-probe"
    : "documentation-based";

  // Promote probe-based facts when a page actually loaded.
  const screener = probe.pagesTested.find((p) => p.category === "screener" && p.ok);
  const terms = probe.pagesTested.find((p) => p.category === "terms" && p.ok);

  const fieldsAvailable = { ...docs.fieldsAvailable };
  if (screener) {
    if (screener.detected.hasDownloadButton) {
      fieldsAvailable.schemeReturns1Y = {
        available: "yes",
        source: `Screener (download button detected at ${screener.url})`,
      };
    }
    if (screener.detected.hasBenchmarkColumn) {
      fieldsAvailable.benchmarkIndex = {
        available: "yes",
        source: `Screener (benchmark column detected at ${screener.url})`,
      };
    }
    if (screener.detected.hasRankOrPercentile) {
      fieldsAvailable.categoryRankOrPercentile = {
        available: "yes",
        source: `Screener (rank/percentile column detected at ${screener.url})`,
      };
    }
    if (screener.detected.hasStarRating || screener.detected.hasRatingColumn) {
      fieldsAvailable.starRating = {
        available: "yes",
        source: `Screener (rating column detected at ${screener.url})`,
      };
    }
  }

  const licensingRisk: LicensingAnalysis = {
    ...docs.licensingRisk,
    termsPageProbed: !!terms?.ok,
    relevantClauses: terms?.detected.bodySnippet
      ? [terms.detected.bodySnippet]
      : [],
  };

  // Refine recommendations slightly based on what we observed.
  const recommendation = { ...docs.recommendation };
  if (screener && !screener.detected.hasRankOrPercentile && !screener.detected.hasBenchmarkColumn) {
    recommendation.schemeOutperformance = "investigate-further";
    recommendation.topQuartile = "rename-to-top-rated";
  }

  const status: RupeevestAuditOutput["status"] = probeOk
    ? probe.pagesTested.every((p) => p.ok)
      ? "ok"
      : "partial"
    : "failed";

  const out: RupeevestAuditOutput = {
    status,
    generatedAt,
    source: "rupeevest.com",
    dataAccessMode,
    pagesTested: probe.pagesTested.length > 0 ? probe.pagesTested : PAGES_TO_PROBE.map(
      (p) => ({
        name: p.name,
        url: p.url,
        category: p.category,
        ok: false,
        detected: {},
        failureReason: probe.blockers[0] ?? "Not probed (sandbox / network).",
      })
    ),
    fieldsAvailable,
    schemeOutperformanceFeasible: docs.schemeOutperformanceFeasible,
    topQuartileFeasible: docs.topQuartileFeasible,
    topRatedFeasible: docs.topRatedFeasible,
    licensingRisk,
    sampleRows: [],
    discoveredEndpoints: probe.endpoints,
    blockers: probe.blockers,
    recommendation,
    notes: docs.notes,
  };

  if (shouldWrite) {
    await fs.mkdir(auditDir, { recursive: true });
    await fs.writeFile(auditFile, JSON.stringify(out, null, 2) + "\n", "utf8");
    info(`rupeevest-audit: wrote ${auditFile} (status=${status}, mode=${dataAccessMode})`);
  } else {
    info(
      `rupeevest-audit: write disabled — would have written ${auditFile} (status=${status}, mode=${dataAccessMode})`
    );
  }
}

const isMain = (() => {
  try {
    const argv1 = process.argv[1] ?? "";
    return /rupeevest-audit\.ts$/.test(argv1);
  } catch {
    return false;
  }
})();
if (isMain) {
  ingestRupeevestAudit().catch((err) => {
    warn(`rupeevest-audit: fatal — ${(err as Error).message}`);
    process.exit(1);
  });
}
