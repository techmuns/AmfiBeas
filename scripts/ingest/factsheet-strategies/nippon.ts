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
  // Broader pattern — PR #90 only matched "NipponIndia[-_]Factsheet"
  // and grabbed July 2025 (likely an older entry on the listing).
  // The actual latest factsheet may use any of these naming variants.
  pdfHrefPattern:
    /(?:NipponIndia|Nippon[-_\s]?India|nia)[-_\s]?Factsheet|InvestorServices.*Factsheet/i,
  periodFromHref: (href) => {
    // Primary: "NipponIndia-Factsheet-March-2026.pdf" / "..._March_2026.pdf"
    const m1 = href.match(/Factsheet[-_\s]([a-z]+)[-_\s](\d{4})/i);
    if (m1) {
      const n = MONTH_TO_NUM[m1[1].toLowerCase()];
      if (n) return `${m1[2]}-${String(n).padStart(2, "0")}`;
    }
    // Fallback: "<Month>-<Year>" anywhere in the path/filename.
    const m2 = href.match(/[\/_-]([A-Za-z]+)[-_\s](\d{4})\.pdf/i);
    if (m2) {
      const n = MONTH_TO_NUM[m2[1].toLowerCase()];
      if (n) return `${m2[2]}-${String(n).padStart(2, "0")}`;
    }
    return null;
  },
  // Some Nippon listing entries label the link with the period text
  // even when the URL doesn't carry it cleanly. PR #91 adds this as
  // a fallback so the picker still finds the latest.
  periodFromLinkText: (text) => {
    const m = text.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i
    );
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
  // Nippon's per-scheme marker is "PERFORMANCE AS ON <date>" (no `^`).
  // PR #89 broadened the marker patterns and got candidateBlocksScanned=24
  // — they all hit. PR #90 adds the structural fixes that turn those
  // 24 candidates into parsed schemes:
  //   - tableOrientation = "row-by-entity": each row is Fund /
  //     Benchmark / Additional Benchmark; periods are columns
  //     (1Y, 3Y, 5Y, SI). HDFC's row-by-period assumption was wrong.
  //   - schemeTitleSource = "after-marker": Nippon prints the scheme
  //     name on the line IMMEDIATELY AFTER the marker
  //     ("PERFORMANCE AS ON June 30,2025\nNippon India Large Cap
  //     Fund"). HDFC's page-header walker can't find it there.
  performanceMarkerPatterns: [
    /\bPERFORMANCE\s+AS\s+ON\b/g,
    /\bPERFORMANCE\s*\^?/g,
    /\bScheme\s+Performance\b/g,
    /\bPerformance\s+of\s+(?:the\s+)?(?:Fund|Scheme)\b/g,
    /\bFund\s+Performance\b/g,
    /\bSchemes?\s+Performance\s+Summary\b/g,
  ],
  tableOrientation: "row-by-entity",
  schemeTitleSource: "after-marker",
};
