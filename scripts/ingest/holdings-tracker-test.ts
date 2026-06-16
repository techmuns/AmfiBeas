/**
 * Synthetic test for scripts/ingest/holdings-tracker.ts.
 *
 * Exercises the import-safe pure logic without hitting RupeeVest:
 *   - month helpers (canonMonthLabel / monthSortKey / monthEndIso / numbers)
 *   - parseTracker against a synthetic HTML holdings table
 *   - mergeHoldings against a REAL on-disk snapshot + a fresh May fetch,
 *     asserting history is preserved, the new month is appended newest-first,
 *     and change arrows are recomputed over the merged window.
 *
 * Run:    npx tsx scripts/ingest/holdings-tracker-test.ts
 * Exits:  0 on all-pass, 1 on any failure.
 */
import fs from "node:fs";
import path from "node:path";
import {
  canonMonthLabel,
  monthSortKey,
  monthEndIso,
  parseIndianNumber,
  parseTracker,
  mergeHoldings,
  type FundPortfolio,
  type ParsedTracker,
  type IndexEntry,
} from "./holdings-tracker";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    console.error(`FAIL  ${name}${detail ? "\n        " + detail : ""}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Month helpers
// ---------------------------------------------------------------------------
check("canonMonthLabel Apr-26", canonMonthLabel("Apr-26") === "Apr-26");
check("canonMonthLabel 'April 2026'", canonMonthLabel("April 2026") === "Apr-26");
check("canonMonthLabel 'May 26'", canonMonthLabel("May 26") === "May-26");
check("canonMonthLabel rejects 'Total'", canonMonthLabel("Total") === null);

check("monthSortKey May>Apr", monthSortKey("May-26") > monthSortKey("Apr-26"));
check("monthSortKey Jan-26>Dec-25", monthSortKey("Jan-26") > monthSortKey("Dec-25"));

check(
  "monthEndIso May-26 -> 2026-05-31",
  monthEndIso("May-26") === "2026-05-31T00:00:00.000Z",
  String(monthEndIso("May-26"))
);
check(
  "monthEndIso Apr-26 -> 2026-04-30",
  monthEndIso("Apr-26") === "2026-04-30T00:00:00.000Z",
  String(monthEndIso("Apr-26"))
);
check(
  "monthEndIso Feb-24 -> leap 2024-02-29",
  monthEndIso("Feb-24") === "2024-02-29T00:00:00.000Z",
  String(monthEndIso("Feb-24"))
);

check("parseIndianNumber 76,97,626", parseIndianNumber("76,97,626") === 7697626);
check("parseIndianNumber 8.26", parseIndianNumber("8.26") === 8.26);
check("parseIndianNumber '-'", parseIndianNumber("-") === null);

// ---------------------------------------------------------------------------
// 2. parseTracker — synthetic HTML table in the shape the parser targets
// ---------------------------------------------------------------------------
const SYNTH_HTML = `
  <div class="wrap">
    <table class="portfolio">
      <tr><th>Company</th><th>May-26</th><th>Apr-26</th></tr>
      <tr data-fincode="132174">
        <td>ICICI Bank Limited</td>
        <td>80,00,000 (8.50%)</td>
        <td>76,97,626 (8.26%)</td>
      </tr>
      <tr data-fincode="100180">
        <td>HDFC Bank Limited</td>
        <td>1,20,17,612 (7.88%)</td>
        <td>97,14,287 (6.63%)</td>
      </tr>
    </table>
  </div>`;

const parsed = parseTracker(SYNTH_HTML, "642");
check(
  "parseTracker finds 2 months newest-first",
  parsed.months.map((m) => m.label).join(",") === "May-26,Apr-26",
  parsed.months.map((m) => m.label).join(",")
);
check("parseTracker finds 2 rows", parsed.rows.length === 2);
const icici = parsed.rows.find((r) => r.fincode === "132174");
check("parseTracker ICICI fincode", Boolean(icici));
check(
  "parseTracker ICICI May shares",
  icici?.cells["may_26"]?.shares_num === 8000000,
  String(icici?.cells["may_26"]?.shares_num)
);
check(
  "parseTracker ICICI May pct",
  icici?.cells["may_26"]?.aum_pct_num === 8.5,
  String(icici?.cells["may_26"]?.aum_pct_num)
);

// parseTracker must THROW (not return blanks) on an unrecognised response.
let threw = false;
try {
  parseTracker("not a table at all", "999");
} catch {
  threw = true;
}
check("parseTracker throws on junk", threw);

// ---------------------------------------------------------------------------
// 3. mergeHoldings — real snapshot + a fresh May fetch
// ---------------------------------------------------------------------------
const REAL = path.join(
  process.cwd(),
  "public/holdings/642-dsp-flexi-cap-fund-reg-g.json"
);
const existing = JSON.parse(fs.readFileSync(REAL, "utf8")) as FundPortfolio;
const existingMonths = existing.meta.months.map((m) => m.label).join(",");
check(
  "fixture has Apr..Jan window",
  existingMonths === "Apr-26,Mar-26,Feb-26,Jan-26",
  existingMonths
);
const iciciJanShares =
  existing.rows.find((r) => r.fincode === "132174")?.months["jan_26"]?.shares_num ??
  null;

// Fresh fetch returns the tracker's new rolling window (May + the Apr overlap).
const freshMay: ParsedTracker = {
  fund: "DSP Flexi Cap Fund-Reg(G)",
  classification: "Equity : Flexi Cap",
  aumTotalCr: 12010.5,
  months: [
    { label: "May-26", aumCr: "-" },
    { label: "Apr-26", aumCr: "-" },
  ],
  rows: [
    {
      company_name: "ICICI Bank Limited",
      fincode: "132174",
      cells: {
        may_26: { aum_pct_raw: "8.50", aum_pct_num: 8.5, shares_raw: "80,00,000", shares_num: 8000000 },
        apr_26: { aum_pct_raw: "8.26", aum_pct_num: 8.26, shares_raw: "76,97,626", shares_num: 7697626 },
      },
    },
  ],
  method: "html-table",
};

const entry: IndexEntry = {
  schemecode: "642",
  name: "DSP Flexi Cap Fund-Reg(G)",
  fundName: "DSP Flexi Cap Fund-Reg(G)",
  classification: "Equity : Flexi Cap",
  aumTotalCr: 11769.1,
  aumAsOf: "2026-04-30T00:00:00.000Z",
  rowCount: existing.rows.length,
  file: "holdings/642-dsp-flexi-cap-fund-reg-g.json",
};

const merged = mergeHoldings(existing, freshMay, entry);
const mergedMonths = merged.meta.months.map((m) => m.label).join(",");
check(
  "merge appends May, preserves Jan (5-month window)",
  mergedMonths === "May-26,Apr-26,Mar-26,Feb-26,Jan-26",
  mergedMonths
);
check(
  "merge updates aumAsOf to May month-end",
  merged.meta.aumAsOf === "2026-05-31T00:00:00.000Z",
  String(merged.meta.aumAsOf)
);
check(
  "merge takes fresh aumTotalCr",
  merged.meta.aumTotalCr === 12010.5,
  String(merged.meta.aumTotalCr)
);

const mIcici = merged.rows.find((r) => r.fincode === "132174");
check("merge keeps ICICI row", Boolean(mIcici));
check(
  "merge added ICICI May cell",
  mIcici?.months["may_26"]?.shares_num === 8000000
);
check(
  "merge preserved ICICI Jan cell from disk",
  mIcici?.months["jan_26"]?.shares_num === iciciJanShares && iciciJanShares !== null,
  `merged=${mIcici?.months["jan_26"]?.shares_num} disk=${iciciJanShares}`
);
check(
  "merge arrow: May up vs Apr (80L > 76.9L)",
  mIcici?.months["may_26"]?.arrow === "up",
  String(mIcici?.months["may_26"]?.arrow)
);
check(
  "merge arrow: oldest Jan is flat/none",
  mIcici?.months["jan_26"]?.arrow === "flat/none",
  String(mIcici?.months["jan_26"]?.arrow)
);
check(
  "merge preserves other existing rows (count grows or holds)",
  merged.rows.length >= existing.rows.length,
  `merged=${merged.rows.length} existing=${existing.rows.length}`
);

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
