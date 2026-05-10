import type { AmcStrategy } from "../factsheet-shared";

// UTI MF.
// Listing: https://www.utimf.com/downloads/fact-sheet
// Observed (less standardised) pattern:
//   https://www.utimf.com/static/digitalfactsheet-<month><year>/UTI-Factsheet.pdf
// UTI also publishes an HTML "digital factsheet" page which we don't
// parse. Some historical sheets are image-heavy with no clean text
// layer — flagged in PR #82's source audit.
const MONTH_TO_NUM: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const MONTH_SHORT_TO_NUM: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export const UTI_STRATEGY: AmcStrategy = {
  amcSlug: "uti",
  amcName: "UTI Mutual Fund",
  listingUrl: "https://www.utimf.com/downloads/fact-sheet",
  pdfHrefPattern: /UTI[-_]?(?:MF[-_]?)?Factsheet|digitalfactsheet[-_]/i,
  periodFromHref: (href) => {
    // Long-form: /static/digitalfactsheet-<month><year>/...
    const m1 = href.match(/digitalfactsheet[-_]([a-z]+)(\d{4})/i);
    if (m1) {
      const n = MONTH_TO_NUM[m1[1].toLowerCase()];
      if (n) return `${m1[2]}-${String(n).padStart(2, "0")}`;
    }
    // Short-form: <Mon>-<Year> in URL or filename.
    const m2 = href.match(/[\/_-]([A-Za-z]{3})[\/_-](\d{4})/);
    if (m2) {
      const n = MONTH_SHORT_TO_NUM[m2[1].toLowerCase()];
      if (n) return `${m2[2]}-${String(n).padStart(2, "0")}`;
    }
    return null;
  },
  schemeBrandPrefix: /^UTI\s/,
  isBoilerplate: (line) =>
    /\bUTI\s+(?:Asset\s+Management|AMC|Trustee|Mutual\s+Fund\s+Investor|Limited|Capital|Pension|International)\b/i.test(
      line
    ),
};
