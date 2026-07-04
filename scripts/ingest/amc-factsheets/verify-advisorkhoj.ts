/**
 * Verify AdvisorKhoj as a single source for AMC monthly portfolio disclosures.
 *
 * For a diverse sample of AMCs: resolve the latest-month link from AdvisorKhoj,
 * download it, parse complete holdings, and print scheme/holding counts + the
 * download kind (xlsx / zip / blocked). Proves coverage before switching the
 * monthly pipeline over to this aggregator.
 *
 * Run from the repo root:  npx tsx scripts/ingest/amc-factsheets/verify-advisorkhoj.ts
 */

import { listPortfolioLinks, downloadAndParse } from "./advisorkhoj";
import type { AmcParseOptions } from "./types";

// A generic parse profile is enough to VERIFY download+parse: scheme/holding
// counts depend only on ISIN detection, not on the pct/value scaling.
const GENERIC: AmcParseOptions = { pctScale: 1, valueToCr: 100 };

const SAMPLE = [
  "SBI Mutual Fund",
  "ICICI Prudential Mutual Fund",
  "HDFC Mutual Fund",
  "Nippon India Mutual Fund",
  "Kotak Mahindra Mutual Fund",
  "Axis Mutual Fund",
  "Aditya Birla Sun Life Mutual Fund",
  "UTI Mutual Fund",
  "Mirae Asset Mutual Fund",
  "Tata Mutual Fund",
  "PPFAS Mutual Fund",
  "DSP Mutual Fund",
  "Motilal Oswal Mutual Fund",
  "Bandhan Mutual Fund",
];

async function main() {
  const year = new Date().getUTCFullYear();
  const rows: Array<Record<string, string | number>> = [];
  let ok = 0;

  for (const amc of SAMPLE) {
    const links = listPortfolioLinks(amc, year);
    if (links.length === 0) {
      rows.push({ amc, status: "NO LINK", month: "-", schemes: 0, holdings: 0, kind: "-" });
      console.log(`✗ ${amc.padEnd(34)} no monthly-disclosure link on AdvisorKhoj`);
      continue;
    }
    const latest = links[0];
    const res = downloadAndParse(latest.url, GENERIC);
    const holdings = res.schemes.reduce((s, x) => s + x.holdings.length, 0);
    const good = res.schemes.length > 0 && holdings > 0;
    if (good) ok += 1;
    rows.push({
      amc,
      status: good ? "OK" : res.kind.toUpperCase(),
      month: latest.label,
      schemes: res.schemes.length,
      holdings,
      kind: res.kind,
    });
    const mark = good ? "✓" : "✗";
    console.log(
      `${mark} ${amc.padEnd(34)} ${latest.label.padEnd(10)} ` +
        `schemes=${String(res.schemes.length).padStart(4)} holdings=${String(holdings).padStart(6)} ` +
        `[${res.kind}]`,
    );
  }

  console.log(`\n${ok}/${SAMPLE.length} AMCs fully downloaded + parsed via AdvisorKhoj.`);
  console.table(rows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
