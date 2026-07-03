/**
 * AMC factsheet / monthly-portfolio-disclosure source registry.
 *
 * Direct-from-AMC replacement for the RupeeVest holdings feed. Each entry points
 * at the public page where an AMC publishes its SEBI-mandated MONTHLY PORTFOLIO
 * DISCLOSURE (the complete scheme-by-scheme holdings) alongside its factsheet.
 * The monthly auto-fetch job reads this registry, resolves the latest month's
 * file for each AMC, parses the complete holdings, and feeds the MFs Portfolio
 * Tracker "Holdings" tab.
 *
 * Fetch cadence: once a day on the 9th–12th of each month — the window in which
 * most AMCs publish the prior month's disclosure. Encoded in
 * AMC_FACTSHEET_FETCH_WINDOW and enforced by the scheduling workflow.
 *
 * NOTE on access: every one of these pages is a JavaScript-rendered SPA and
 * several sit behind bot protection (plain HTTP GET returns 403 / an empty
 * shell), so the monthly file must be resolved with a real (headless) browser
 * or via each AMC's underlying data API — not a simple fetch. `access` records
 * which applies so the fetcher can pick the right strategy.
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
    access: "browser",
    status: "pilot",
    notes: "Plain GET → 403 (bot-protected); portfolio files load via client-side JS.",
  },
  {
    amc: "SBI",
    slug: "sbi",
    sourceUrl: "https://www.sbimf.com/portfolios",
    kind: "portfolio-disclosure",
    access: "browser",
    status: "pilot",
    notes: "Page shell loads; monthly portfolio files are populated by a client-side API.",
  },
  {
    amc: "ICICI Prudential",
    slug: "icici-pru",
    sourceUrl:
      "https://www.icicipruamc.com/media-center/downloads?currentTabFilter=HistoricalFactsheets",
    kind: "mixed",
    access: "browser",
    status: "pilot",
    notes: "Downloads center; monthly portfolio disclosure must be selected from the tabs.",
  },
  {
    amc: "HDFC",
    slug: "hdfc",
    sourceUrl: "https://www.hdfcfund.com/mutual-funds/factsheets",
    kind: "mixed",
    access: "browser",
    status: "pilot",
    notes: "Plain GET → 403 (bot-protected); JS-rendered factsheet + disclosure listing.",
  },
  {
    amc: "Kotak",
    slug: "kotak",
    sourceUrl: "https://www.kotakmf.com/factsheet/may_2026/",
    kind: "mixed",
    access: "browser",
    status: "pilot",
    notes: "Month-directory URL (…/<month>_<year>/) — path is likely month-templated.",
  },
];
