/**
 * Monthly auto-fetch orchestrator — the job the 9th–12th cron runs.
 *
 * For every AMC whose source is SOLVED it resolves the latest monthly portfolio
 * disclosure, parses complete holdings, and writes a normalized snapshot to
 * public/amc-holdings/<slug>-<Mon-YY>.json (+ an index.json). The (deferred)
 * 2A integration reads these to feed the tracker's Holdings tab. AMCs still in
 * recon (ICICI/Kotak/HDFC) are listed but skipped until their adapters land, so
 * the job is safe to schedule now.
 *
 * Run: npx tsx scripts/ingest/amc-factsheets/run-monthly.ts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fetchLatest } from "./fetch";
import { parseAmcWorkbook } from "./parse";
import { AMC_FACTSHEET_SOURCES } from "../amc-factsheet-sources";
import type { AmcParseOptions, AmcPortfolioSnapshot } from "./types";

const OUT = path.resolve(process.cwd(), "public/amc-holdings");

/** Solved AMCs + their parse options. Add entries as adapters come online. */
const SOLVED: Record<string, AmcParseOptions> = {
  sbi: { pctScale: 1, valueToCr: 100 },
  nippon: { pctScale: 100, valueToCr: 100 },
  kotak: { pctScale: 1, valueToCr: 100 },
};

interface IndexEntry {
  slug: string;
  amc: string;
  asOfMonth: string;
  schemes: number;
  holdings: number;
  file: string;
  updatedAt: string;
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const index: IndexEntry[] = [];
  let ok = 0;
  let skipped = 0;

  for (const src of AMC_FACTSHEET_SOURCES) {
    const opts = SOLVED[src.slug];
    if (!opts) {
      console.log(`[${src.slug}] skipped — adapter not yet available (${src.notes?.split(".")[0] ?? "pending"})`);
      skipped += 1;
      continue;
    }
    const file = fetchLatest(src.slug);
    if (!file) {
      console.log(`[${src.slug}] FETCH FAILED — no month resolved`);
      continue;
    }
    const schemes = parseAmcWorkbook(file.buf, opts);
    const holdings = schemes.reduce((s, x) => s + x.holdings.length, 0);
    if (schemes.length === 0) {
      console.log(`[${src.slug}] PARSE EMPTY — ${file.url}`);
      continue;
    }
    const snapshot: AmcPortfolioSnapshot = {
      amc: src.amc,
      amcSlug: src.slug,
      sourceUrl: file.url,
      asOfMonth: file.asOfMonth,
      fetchedAt: new Date().toISOString(),
      schemes,
    };
    const outName = `${src.slug}-${file.asOfMonth}.json`;
    await fs.writeFile(path.join(OUT, outName), JSON.stringify(snapshot) + "\n", "utf8");
    index.push({
      slug: src.slug,
      amc: src.amc,
      asOfMonth: file.asOfMonth,
      schemes: schemes.length,
      holdings,
      file: outName,
      updatedAt: snapshot.fetchedAt,
    });
    console.log(`[${src.slug}] wrote ${outName} — ${schemes.length} schemes, ${holdings} holdings`);
    ok += 1;
  }

  // Merge into the index (keep the newest entry per slug).
  const idxPath = path.join(OUT, "index.json");
  let prev: IndexEntry[] = [];
  try { prev = JSON.parse(await fs.readFile(idxPath, "utf8")); } catch { /* first run */ }
  const bySlug = new Map(prev.map((e) => [e.slug, e]));
  for (const e of index) bySlug.set(e.slug, e);
  await fs.writeFile(idxPath, JSON.stringify([...bySlug.values()], null, 2) + "\n", "utf8");

  console.log(`\nMonthly AMC fetch: ${ok} written, ${skipped} skipped (adapters pending).`);
}

main().catch((e) => { console.error("run-monthly failed:", e); process.exit(1); });
