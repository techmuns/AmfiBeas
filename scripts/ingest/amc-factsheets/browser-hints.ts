/**
 * Per-AMC configuration for the browser fallback (browser-fallback.ts).
 *
 * Most AMCs need nothing here — the generic "navigate the AdvisorKhoj-resolved
 * disclosure page, harvest workbook links, download + parse" pass already works
 * (HDFC, Mirae, Invesco, Groww, Canara Robeco, Baroda BNP, JM Financial, NJ,
 * Helios, WhiteOak). This registry holds the exceptions:
 *  - `urls`  : an explicit disclosure page for AMCs AdvisorKhoj has no link for
 *              (LIC, Quantum, Sundaram) or whose AdvisorKhoj link is wrong; tried
 *              before the AdvisorKhoj links.
 *  - `hints` : interaction needed before the links appear (click a "Monthly
 *              Portfolio" tab / pick the latest month) for heavier SPAs.
 */

import type { BrowserHints } from "./browser-fallback";

export interface AmcBrowserConfig {
  urls?: string[];
  hints?: BrowserHints;
}

export const BROWSER_CONFIG: Record<string, AmcBrowserConfig> = {
  // Groww's disclosure page is a 1000+ link document library (AAUM, transaction,
  // exposure reports …); narrow to its consolidated monthly-portfolio workbook.
  groww: { hints: { include: /monthly[\s-]*portfolio/i } },

  // Quantum has no AdvisorKhoj link; its combined-portfolio page serves the
  // per-scheme workbooks directly (GUID filenames, so no month filtering).
  quantum: { urls: ["https://www.quantumamc.com/portfolio/combined/-1/1/0/0"] },

  // HDFC's own monthly-portfolio page is Akamai-walled to curl (403) but renders
  // in the browser; it lists a per-scheme .xlsx for the latest period on the OPEN
  // files.hdfcfund.com host. Point at HDFC's own page (drops the AdvisorKhoj link)
  // and keep only the "Monthly …" workbooks. The file URL folder is the PUBLICATION
  // month (June data lands in /2026-07/), but monthScore keys off the reporting date
  // in the filename ("… - 30 June 2026.xlsx"), so the month pick stays correct.
  hdfc: {
    urls: ["https://www.hdfcfund.com/statutory-disclosure/portfolio/monthly-portfolio"],
    hints: { include: /monthly/i },
  },

  // Edelweiss is Akamai-walled to curl (403 everywhere) but renders in the browser.
  // Its disclosures page loads the full document set and filters CLIENT-SIDE, so the
  // per-scheme "EDEL_Portfolio_Monthly_Notes_<date>_<uploadstamp>.xlsx" links (whose
  // upload-timestamp filenames can't be constructed) are captured on the wire /in the
  // DOM regardless of the visible filter; `include` does the "Monthly Portfolio" pick
  // on our side. Best-effort text clicks nudge the filter for good measure (fail soft).
  edelweiss: {
    urls: ["https://www.edelweissmf.com/literature/disclosures?productType=All"],
    hints: { include: /monthly/i, clicks: ["text=Monthly Portfolio"], waitMs: 5000 },
  },
};
// (The Wealth Company moved to the curl JSON-API tier — its document list streams in
// the RSC payload of /literature-forms/portfolio-documents/monthly/; see json-api.ts.
// The old /monthly-portfolio/ page this registry pointed at now 301s to the homepage.)
