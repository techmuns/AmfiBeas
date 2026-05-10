import type { AmcStrategy } from "../factsheet-shared";

// SBI MF — listing at https://www.sbimf.com/factsheets.
// Observed PDF pattern (audit, PR #80 source review):
//   https://www.sbimf.com/docs/default-source/scheme-factsheets/sbi-factsheet-<month>-<year>.pdf?sfvrsn=<hash>
// Sitecore appends a `?sfvrsn=<hash>` cache token per upload — the
// listing scrape returns the canonical URL with the token; we keep it.
const MONTH_TO_NUM: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export const SBI_STRATEGY: AmcStrategy = {
  amcSlug: "sbi",
  amcName: "SBI Mutual Fund",
  listingUrl: "https://www.sbimf.com/factsheets",
  pdfHrefPattern: /sbi[-_].{0,4}factsheet/i,
  periodFromHref: (href) => {
    // sbi-factsheet-<month>-<year>.pdf
    const m = href.match(/sbi[-_].{0,4}factsheet[-_]([a-z]+)[-_](\d{4})/i);
    if (!m) return null;
    const monthNum = MONTH_TO_NUM[m[1].toLowerCase()];
    if (!monthNum) return null;
    return `${m[2]}-${String(monthNum).padStart(2, "0")}`;
  },
  schemeBrandPrefix: /^SBI\s/,
  isBoilerplate: (line) =>
    /\bSBI\s+(?:Funds\s+Management|AMC|Mutual\s+Fund\s+(?:Investor|Trustee)|Bank|Capital\s+Markets|Limited|Card)\b/i.test(
      line
    ),
};
