/**
 * AMC factsheet / monthly-portfolio-disclosure source registry.
 *
 * Direct-from-AMC replacement for the RupeeVest holdings feed.
 *
 * PRIMARY SOURCE (as of the AdvisorKhoj switch): the monthly job no longer
 * scrapes each AMC's own SPA. It uses the AdvisorKhoj aggregator
 * (scripts/ingest/amc-factsheets/advisorkhoj.ts), which lists every AMC's SEBI
 * monthly portfolio disclosure on one server-rendered page per AMC — a single
 * curl-able code path covering ~21/50 AMCs with a DIRECT downloadable file,
 * including the largest AUM names and 8 of the tracker's current 10 AMCs
 * (all except HDFC + Mirae). The remaining AMCs expose only a JS-rendered
 * landing page (Mirae, PGIM, WhiteOak, Union…), a per-scheme file list that
 * needs an HTML scrape (Canara Robeco, HSBC), or a bot wall / stale path
 * (HDFC = Akamai 403, Edelweiss 403, Motilal 404) and still need a targeted
 * per-AMC fallback.
 *
 * This registry is retained as (a) the DIRECT-URL fallback for the three AMCs
 * with a stable templatable file URL (SBI, Nippon, Kotak — see fetch.ts), and
 * (b) documentation of the known-hard AMCs. The per-AMC `access`/`notes` below
 * predate the AdvisorKhoj switch and describe the old bespoke-scraper strategy.
 *
 * Fetch cadence: once a day on the 9th–12th of each month — the window in which
 * most AMCs publish the prior month's disclosure. Encoded in
 * AMC_FACTSHEET_FETCH_WINDOW and enforced by the scheduling workflow.
 */

export interface AmcFactsheetSource {
  /** Display name. */
  amc: string;
  /** Stable id — matches the fund-wise directory slug where one exists, so the
   *  fetched holdings can be reconciled with the existing tracker identities. */
  slug: string;
  /** Public landing page for the AMC's disclosures / factsheets. */
  sourceUrl: string;
  /** What the monthly artefact behind `sourceUrl` is:
   *   - "portfolio-disclosure": the complete monthly holdings (what we want)
   *   - "factsheet": marketing summary (top-10 holdings only — insufficient)
   *   - "mixed": the page carries both; the fetcher must select the disclosure */
  kind: "portfolio-disclosure" | "factsheet" | "mixed";
  /** How the monthly file is reachable:
   *   - "browser": JS-rendered / bot-protected — needs a headless browser
   *   - "http": a stable, directly-fetchable file URL (rare) */
  access: "browser" | "http";
  /** "pilot" = part of the first five-AMC integration; "pending" = queued. */
  status: "pilot" | "pending";
  notes?: string;
}

/** Auto-fetch window: once a day, on the 9th through 12th of each month. */
export const AMC_FACTSHEET_FETCH_WINDOW = { fromDay: 9, toDay: 12, runsPerDay: 1 } as const;

export const AMC_FACTSHEET_SOURCES: AmcFactsheetSource[] = [
  {
    amc: "Nippon India",
    slug: "nippon",
    sourceUrl:
      "https://mf.nipponindiaim.com/investor-service/downloads/factsheet-portfolio-and-other-disclosures",
    kind: "portfolio-disclosure",
    access: "http",
    status: "pilot",
    notes:
      "SOLVED. Complete monthly portfolio at a templated URL: " +
      "InvestorServices/FactsheetsDocuments/NIMF-MONTHLY-PORTFOLIO-<DD>-<Mon>-<YY>.xls " +
      "(one sheet per scheme; cols ISIN/Name/Industry/Qty/MktValue-Lac/%toNAV as a FRACTION). " +
      "Landing page 403s to curl but the file URL is directly fetchable with a Referer header.",
  },
  {
    amc: "SBI",
    slug: "sbi",
    sourceUrl: "https://www.sbimf.com/portfolios",
    kind: "portfolio-disclosure",
    access: "http",
    status: "pilot",
    notes:
      "SOLVED. Complete all-schemes monthly portfolio at a templated URL: " +
      "docs/default-source/scheme-portfolios/all-schemes-monthly-portfolio---as-on-<Nth>-<month>-<year>.xlsx " +
      "(one sheet per scheme; cols Name/ISIN/Industry/Qty/MktValue-Lakh/%toAUM). Fetch via curl + backward month-probe.",
  },
  {
    amc: "ICICI Prudential",
    slug: "icici-pru",
    sourceUrl:
      "https://www.icicipruamc.com/media-center/downloads?currentTabFilter=HistoricalFactsheets",
    kind: "portfolio-disclosure",
    access: "http",
    status: "pilot",
    notes:
      "NEARLY SOLVED via open JSON API (no token). Headers: 'env: api' + 'requestapiid: <uuid>'. " +
      "POST https://apimf.icicipruamc.com/nms/v1/downloads/files  body { categoryId: " +
      "'26a073d7-08d2-4a95-95fa-f83a4ee51e40' (Monthly Portfolio Disclosures leaf under 'Other Scheme " +
      "Disclosures'), userType:'Investor', page/size (number strings), fileType, filter:[{key:'FINANCIAL_YEAR', " +
      "filterValue:[...]}] }. Remaining: capture the exact fileType + filter payload from one browser POST.",
  },
  {
    amc: "HDFC",
    slug: "hdfc",
    sourceUrl: "https://www.hdfcfund.com/mutual-funds/factsheets",
    kind: "mixed",
    access: "browser",
    status: "pilot",
    notes:
      "HARD. 403 'Access Denied' (Akamai) even to a real browser WITH stealth (webdriver spoof, " +
      "automation flags off, en-IN). Recon2 could not get past it. Options: undetected-chromedriver / a " +
      "residential-proxy fetch, or source HDFC's monthly portfolio from an alternate host (e.g. its CDN).",
  },
  {
    amc: "Kotak",
    slug: "kotak",
    sourceUrl: "https://www.kotakmf.com/factsheet/may_2026/",
    kind: "portfolio-disclosure",
    access: "http",
    status: "pilot",
    notes:
      "SOLVED. Complete consolidated monthly portfolio on Kotak's S3 at a templated URL: " +
      "https://vatseelabs-s3.kotakmf.com/FAD/Portfolios/Consolidated-Portfolio-as-on-<Month>-<DD>,-<YYYY>/" +
      "ConsolidatedSEBIPortfolio<Month><YYYY>.xlsx (one sheet per scheme; cols Name/ISIN/Industry/Qty/" +
      "MktValue-Lac/%toNetAssets). The factsheet PDF at the given landing URL is only a top-10 summary.",
  },
];
