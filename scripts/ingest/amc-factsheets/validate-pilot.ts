/**
 * Local/CI validation for the SBI + Nippon pilot: fetch each AMC's latest
 * monthly portfolio disclosure, parse it, and print a summary + spot-checks so
 * we can eyeball that complete holdings came through correctly.
 *
 * Run: npx tsx scripts/ingest/amc-factsheets/validate-pilot.ts
 */

import { fetchLatest } from "./fetch";
import { parseAmcWorkbook } from "./parse";
import type { AmcParseOptions, AmcScheme } from "./types";

const OPTS: Record<string, AmcParseOptions> = {
  sbi: { pctScale: 1, valueToCr: 100 },
  nippon: { pctScale: 100, valueToCr: 100 },
};

function summarize(slug: string, schemes: AmcScheme[]) {
  const totalHoldings = schemes.reduce((s, x) => s + x.holdings.length, 0);
  const withIsin = schemes.reduce((s, x) => s + x.holdings.filter((h) => h.isin).length, 0);
  console.log(`  schemes=${schemes.length}  holdings=${totalHoldings}  (withISIN=${withIsin})`);
  // Spot-check a well-known equity scheme.
  const probe =
    schemes.find((x) => /flexicap|flexi cap|multi cap/i.test(x.schemeName)) ?? schemes.find((x) => x.holdings.length > 20);
  if (probe) {
    const top = [...probe.holdings].filter((h) => h.pctToNav != null).sort((a, b) => (b.pctToNav ?? 0) - (a.pctToNav ?? 0)).slice(0, 5);
    const sum = probe.holdings.reduce((s, h) => s + (h.pctToNav ?? 0), 0);
    console.log(`  e.g. "${probe.schemeName}" asOf=${probe.asOf} holdings=${probe.holdings.length} Σ%=${sum.toFixed(1)}`);
    for (const h of top) console.log(`     ${(h.pctToNav ?? 0).toFixed(2).padStart(5)}%  ${h.name}  [${h.isin}] ${h.industry ?? ""} · ₹${h.marketValueCr}Cr`);
  }
}

async function main() {
  for (const slug of ["sbi", "nippon"]) {
    console.log(`\n===== ${slug.toUpperCase()} =====`);
    const file = fetchLatest(slug);
    if (!file) { console.log("  FETCH FAILED (no month resolved)"); continue; }
    console.log(`  fetched ${file.asOfMonth}  ${(file.buf.length / 1e6).toFixed(2)}MB  ${file.url}`);
    const schemes = parseAmcWorkbook(file.buf, OPTS[slug]);
    summarize(slug, schemes);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
