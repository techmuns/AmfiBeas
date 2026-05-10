import type { AmcStrategy } from "../factsheet-shared";

// Kotak Mahindra MF.
// Listing: https://www.kotakmf.com/Information/forms-and-downloads
// Observed pattern: https://www.kotakmf.com/Information/forms-and-downloads/Factsheet/Factsheet_for_<Month>_<Year>/KotakMFFactsheet<Month><Year>.pdf
const MONTH_TO_NUM: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export const KOTAK_STRATEGY: AmcStrategy = {
  amcSlug: "kotak",
  amcName: "Kotak Mahindra Mutual Fund",
  listingUrl: "https://www.kotakmf.com/Information/forms-and-downloads",
  pdfHrefPattern: /Kotak.{0,3}MF.{0,3}Factsheet/i,
  periodFromHref: (href) => {
    // Two locations in the URL where month/year appear: folder name
    // (Factsheet_for_<Month>_<Year>) and filename (KotakMFFactsheet<Month><Year>.pdf).
    const m1 = href.match(/Factsheet[_-]for[_-]([a-z]+)[_-](\d{4})/i);
    if (m1) {
      const n = MONTH_TO_NUM[m1[1].toLowerCase()];
      if (n) return `${m1[2]}-${String(n).padStart(2, "0")}`;
    }
    const m2 = href.match(/KotakMFFactsheet([a-z]+)(\d{4})/i);
    if (m2) {
      const n = MONTH_TO_NUM[m2[1].toLowerCase()];
      if (n) return `${m2[2]}-${String(n).padStart(2, "0")}`;
    }
    return null;
  },
  schemeBrandPrefix: /^Kotak\s/,
  isBoilerplate: (line) =>
    /\bKotak\s+(?:Mahindra\s+(?:Asset\s+Management|Trustee|Bank|Capital|Securities|Investments)|AMC|Trustee|Limited)\b/i.test(
      line
    ),
};
