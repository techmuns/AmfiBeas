import type { AmcStrategy } from "../factsheet-shared";

// Nippon India MF.
// Listing: https://mf.nipponindiaim.com/investor-service/downloads/factsheet-portfolio-and-other-disclosures
// Observed pattern: https://mf.nipponindiaim.com/InvestorServices/FactSheets/NipponIndia-Factsheet-<Month>-<Year>.pdf
const MONTH_TO_NUM: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export const NIPPON_STRATEGY: AmcStrategy = {
  amcSlug: "nippon",
  amcName: "Nippon India Mutual Fund",
  listingUrl:
    "https://mf.nipponindiaim.com/investor-service/downloads/factsheet-portfolio-and-other-disclosures",
  pdfHrefPattern: /NipponIndia[-_]Factsheet/i,
  periodFromHref: (href) => {
    const m = href.match(/NipponIndia[-_]Factsheet[-_]([a-z]+)[-_](\d{4})/i);
    if (!m) return null;
    const n = MONTH_TO_NUM[m[1].toLowerCase()];
    if (!n) return null;
    return `${m[2]}-${String(n).padStart(2, "0")}`;
  },
  // Nippon's brand string in scheme names is "Nippon India" (no "MF").
  schemeBrandPrefix: /^Nippon\s+India\s/,
  isBoilerplate: (line) =>
    /\bNippon\s+(?:Life\s+India|Asset\s+Management|AMC|Investment|Trustee|Capital|Limited)\b/i.test(
      line
    ),
};
