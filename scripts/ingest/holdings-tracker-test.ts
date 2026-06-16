/**
 * Synthetic test for scripts/ingest/holdings-tracker.ts.
 *
 * Exercises the import-safe pure logic without hitting RupeeVest:
 *   - month/number helpers + the faithful arrowFor change-arrow logic
 *   - parseTracker against the real get_mf_portfolio_tracker JSON shape
 *   - mergeHoldings against a REAL on-disk snapshot + a fresh May fetch,
 *     asserting history is preserved, the new month is appended newest-first,
 *     and arrows are recomputed over the merged window.
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
  toNumOrNull,
  indianFmt,
  arrowFor,
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
// 1. Helpers
// ---------------------------------------------------------------------------
check("canonMonthLabel Apr-26", canonMonthLabel("Apr-26") === "Apr-26");
check("canonMonthLabel 'April 2026'", canonMonthLabel("April 2026") === "Apr-26");
check("canonMonthLabel rejects 'Total'", canonMonthLabel("Total") === null);
check("monthSortKey May>Apr", monthSortKey("May-26") > monthSortKey("Apr-26"));
check("monthSortKey Jan-26>Dec-25", monthSortKey("Jan-26") > monthSortKey("Dec-25"));
check("monthEndIso May-26 -> 2026-05-31", monthEndIso("May-26") === "2026-05-31T00:00:00.000Z");
check("monthEndIso Feb-24 -> leap 2024-02-29", monthEndIso("Feb-24") === "2024-02-29T00:00:00.000Z");
check("toNumOrNull 76,97,626", toNumOrNull("76,97,626") === 7697626);
check("toNumOrNull 8.26%", toNumOrNull("8.26%") === 8.26);
check("toNumOrNull '-'", toNumOrNull("-") === null);
check("indianFmt 7697626 -> 76,97,626", indianFmt(7697626) === "76,97,626");
check("indianFmt 120 -> 120", indianFmt(120) === "120");

// arrowFor — shares[0]=newest … shares[n-1]=oldest
check("arrowFor up (cur>prev)", arrowFor([8000000, 7697626], 0) === "up");
check("arrowFor down (cur<prev)", arrowFor([5, 9], 0) === "down");
check("arrowFor flat (cur==prev)", arrowFor([5, 5], 0) === "flat/none");
check("arrowFor appeared (prev null) -> up", arrowFor([5, null], 0) === "up");
check("arrowFor cur null -> missing", arrowFor([null, 5], 0) === "missing");
check("arrowFor oldest col -> flat/none", arrowFor([5, 9], 1) === "flat/none");

// ---------------------------------------------------------------------------
// 2. parseTracker — the real get_mf_portfolio_tracker JSON shape
// ---------------------------------------------------------------------------
const SYNTH_JSON = {
  fund_info: [
    {
      s_name: "DSP Flexi Cap Fund-Reg(G)",
      aumtotal: "12010.5",
      aumdate: "2026-05-31T00:00:00.000Z",
      classification: "Equity : Flexi Cap",
    },
  ],
  month_name: ["May-26", "Apr-26"],
  MonthwiseAUM: [{ aum: "-" }, { aum: "-" }],
  stock_data: [
    [
      { fincode: "132174", noshares: "8000000", percent_aum: "8.50" },
      { fincode: "100180", noshares: "1,20,17,612", percent_aum: "7.88" },
    ],
    [{ fincode: "132174", noshares: "7697626", percent_aum: "8.26" }],
  ],
  stock_mapping: { "132174": "ICICI Bank Limited", "100180": "HDFC Bank Limited" },
};

const parsed = parseTracker(SYNTH_JSON, "642");
check("parseTracker fund name", parsed.fund === "DSP Flexi Cap Fund-Reg(G)");
check("parseTracker aumTotalCr", parsed.aumTotalCr === 12010.5, String(parsed.aumTotalCr));
check(
  "parseTracker months newest-first",
  parsed.months.map((m) => m.label).join(",") === "May-26,Apr-26"
);
check("parseTracker 2 rows", parsed.rows.length === 2);
const icici = parsed.rows.find((r) => r.fincode === "132174");
check("parseTracker ICICI May shares", icici?.cells["may_26"]?.shares_num === 8000000);
check("parseTracker ICICI May pct", icici?.cells["may_26"]?.aum_pct_num === 8.5);
check("parseTracker ICICI has Apr cell", icici?.cells["apr_26"]?.shares_num === 7697626);
const hdfc = parsed.rows.find((r) => r.fincode === "100180");
check("parseTracker HDFC May shares (Indian-string input)", hdfc?.cells["may_26"]?.shares_num === 12017612);
check("parseTracker HDFC has no Apr cell (present-only)", hdfc?.cells["apr_26"] === undefined);

// THROWS (not blanks) on unrecognised responses → caller keeps last-good.
const throws = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};
check("parseTracker throws on non-JSON", throws(() => parseTracker("<html>nope</html>", "x")));
check("parseTracker throws on missing month_name", throws(() => parseTracker({ fund_info: [] }, "x")));

// ---------------------------------------------------------------------------
// 3. mergeHoldings — real snapshot + a fresh May fetch
// ---------------------------------------------------------------------------
const REAL = path.join(process.cwd(), "public/holdings/642-dsp-flexi-cap-fund-reg-g.json");
const existing = JSON.parse(fs.readFileSync(REAL, "utf8")) as FundPortfolio;
check(
  "fixture has Apr..Jan window",
  existing.meta.months.map((m) => m.label).join(",") === "Apr-26,Mar-26,Feb-26,Jan-26"
);
const iciciJanShares =
  existing.rows.find((r) => r.fincode === "132174")?.months["jan_26"]?.shares_num ?? null;

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
  method: "json-endpoint",
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
check(
  "merge appends May, preserves Jan (5-month window)",
  merged.meta.months.map((m) => m.label).join(",") === "May-26,Apr-26,Mar-26,Feb-26,Jan-26",
  merged.meta.months.map((m) => m.label).join(",")
);
check("merge aumAsOf -> May month-end", merged.meta.aumAsOf === "2026-05-31T00:00:00.000Z");
check("merge takes fresh aumTotalCr", merged.meta.aumTotalCr === 12010.5);

const mIcici = merged.rows.find((r) => r.fincode === "132174");
check("merge added ICICI May cell", mIcici?.months["may_26"]?.shares_num === 8000000);
check(
  "merge preserved ICICI Jan cell from disk",
  mIcici?.months["jan_26"]?.shares_num === iciciJanShares && iciciJanShares !== null,
  `merged=${mIcici?.months["jan_26"]?.shares_num} disk=${iciciJanShares}`
);
check("merge arrow: May up vs Apr", mIcici?.months["may_26"]?.arrow === "up");
check("merge arrow: oldest Jan flat/none", mIcici?.months["jan_26"]?.arrow === "flat/none");
check(
  "merge full-grid: every row has all 5 window months",
  merged.rows.every((r) => Object.keys(r.months).length === 5)
);
check("merge keeps all disk rows", merged.rows.length >= existing.rows.length);

// ---------------------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
