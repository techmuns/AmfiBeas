import type { AmcStrategy } from "../factsheet-shared";

// Aditya Birla Sun Life MF.
// Listing: https://mutualfund.adityabirlacapital.com/forms-and-downloads/factsheets
// Observed pattern: https://mutualfund.adityabirlacapital.com/-/media/bsl/files/resources/factsheets/<year>/abslmf-empower-<month>-<year>.pdf
// Some months use the underscore variant (abslmf_empower_...).
const MONTH_TO_NUM: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

export const ABSL_STRATEGY: AmcStrategy = {
  amcSlug: "absl",
  amcName: "Aditya Birla Sun Life Mutual Fund",
  listingUrl:
    "https://mutualfund.adityabirlacapital.com/forms-and-downloads/factsheets",
  pdfHrefPattern: /abslmf[-_]empower/i,
  periodFromHref: (href) => {
    const m = href.match(/abslmf[-_]empower[-_]([a-z]+)[-_](\d{4})/i);
    if (!m) return null;
    const n = MONTH_TO_NUM[m[1].toLowerCase()];
    if (!n) return null;
    return `${m[2]}-${String(n).padStart(2, "0")}`;
  },
  // ABSL's scheme names use the full brand "Aditya Birla Sun Life" prefix.
  schemeBrandPrefix: /^Aditya\s+Birla\s+Sun\s+Life\s/,
  isBoilerplate: (line) =>
    /\bAditya\s+Birla\s+(?:Capital|Sun\s+Life\s+(?:AMC|Asset\s+Management|Trustee|Insurance|Pension|Health|Limited))\b/i.test(
      line
    ),
};
