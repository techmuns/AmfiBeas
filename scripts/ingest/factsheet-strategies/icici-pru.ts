import type { AmcStrategy } from "../factsheet-shared";

// ICICI Prudential MF — digital factsheet portal.
// Listing: https://digitalfactsheet.icicipruamc.com/fact/
// Observed pattern: https://digitalfactsheet.icicipruamc.com/fact/pdf/fund-factsheet-for-<month>-<year>.pdf
// Historic archive lives under icicipruamc.com/blob/downloads/Files/Historic Factsheets/<yr>-<yr>/.
const MONTH_TO_NUM: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export const ICICI_PRU_STRATEGY: AmcStrategy = {
  amcSlug: "icici-pru",
  amcName: "ICICI Prudential Mutual Fund",
  listingUrl: "https://digitalfactsheet.icicipruamc.com/fact/",
  pdfHrefPattern: /(?:fund-factsheet-for|complete-?factsheet|icici.{0,3}prudential).{0,40}\.pdf/i,
  periodFromHref: (href) => {
    const m = href.match(/(?:fund-factsheet-for|factsheet)[-_]([a-z]+)[-_](\d{4})/i);
    if (!m) return null;
    const n = MONTH_TO_NUM[m[1].toLowerCase()];
    if (!n) return null;
    return `${m[2]}-${String(n).padStart(2, "0")}`;
  },
  schemeBrandPrefix: /^ICICI\s+Prudential\s/,
  isBoilerplate: (line) =>
    /\bICICI\s+Prudential\s+(?:Asset\s+Management|AMC|Trust|Trustee|Bank|Securities|Life\s+Insurance|General\s+Insurance|Limited)\b/i.test(
      line
    ),
};
