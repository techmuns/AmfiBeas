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
};
