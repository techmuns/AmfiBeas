import type { AmcStrategy } from "../factsheet-shared";

export const HDFC_STRATEGY: AmcStrategy = {
  amcSlug: "hdfc",
  amcName: "HDFC Mutual Fund",
  listingUrl: "https://www.hdfcfund.com/investor-services/factsheets",
  // PR #82-#87 confirmed on the March 2026 factsheet.
  pdfHrefPattern: /HDFC.{0,3}MF.{0,3}Factsheet/i,
  periodFromHref: (href) => {
    const m = href.match(/\/(\d{4})-(\d{2})\//);
    return m ? `${m[1]}-${m[2]}` : null;
  },
  schemeBrandPrefix: /^HDFC\s/,
  isBoilerplate: (line) =>
    /\bHDFC\s+(?:Asset\s+Management|AMC|Mutual\s+Fund\s+Investor|Trustee|Bank\s+Limited|Limited)\b/i.test(
      line
    ),
  waitListingSelector:
    'a[href*="HDFC%20MF%20Factsheet"], a[href*="HDFC MF Factsheet"]',
};
