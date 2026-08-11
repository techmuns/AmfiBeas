/**
 * Recover disclosure months that an earlier monthly run overwrote.
 *
 * `writeSnapshot` used to replace public/amc-holdings/<slug>.json with only the
 * month it had just downloaded, so the first cron after the history backfill
 * deleted every older month: funds that showed six month-over-month columns in
 * the tracker showed one. The fetchers can't get those months back — most AMCs
 * only host the current disclosure — but git still has them, so this reads the
 * snapshots at a past commit and merges their months into today's files using
 * the same `mergeMonthBuckets` the pipeline now uses everywhere.
 *
 * Safe to re-run: months already on file win only if the older commit doesn't
 * carry them; a month present in both keeps the CURRENT copy (newer parse).
 *
 * Run: npx tsx scripts/ingest/amc-factsheets/restore-history.ts <git-ref> [slug,slug]
 *   e.g. npx tsx scripts/…/restore-history.ts c1e76c9c5
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MAX_SNAPSHOT_MONTHS, mergeMonthBuckets, ymOf } from "./months";
import type { AmcPortfolioSnapshot } from "./types";
import type { MonthBucket } from "./months";

const OUT = path.resolve(process.cwd(), "public/amc-holdings");
const ref = process.argv[2];
const only = process.argv[3]?.split(",").map((s) => s.trim()).filter(Boolean);

if (!ref) {
  console.error("usage: restore-history.ts <git-ref> [slug,slug]");
  process.exit(1);
}

/** A snapshot's months, newest-first, as merge buckets. */
function bucketsOf(snap: Partial<AmcPortfolioSnapshot>): MonthBucket[] {
  const latest: MonthBucket[] = snap.schemes?.length
    ? [{ asOfMonth: snap.asOfMonth ?? "", asOf: snap.schemes[0]?.asOf ?? null, schemes: snap.schemes }]
    : [];
  return [...latest, ...(snap.history ?? [])];
}

function atRef(file: string): Partial<AmcPortfolioSnapshot> | null {
  try {
    const raw = execFileSync("git", ["show", `${ref}:public/amc-holdings/${file}`], {
      maxBuffer: 512 * 1024 * 1024,
    }).toString("utf8");
    return JSON.parse(raw) as AmcPortfolioSnapshot;
  } catch {
    return null; // not present at that commit
  }
}

let restored = 0;
let unchanged = 0;
for (const file of fs.readdirSync(OUT).sort()) {
  if (!file.endsWith(".json") || file === "index.json") continue;
  const slug = file.replace(/\.json$/, "");
  if (only?.length && !only.includes(slug)) continue;

  const current = JSON.parse(fs.readFileSync(path.join(OUT, file), "utf8")) as AmcPortfolioSnapshot;
  const past = atRef(file);
  if (!past) { console.log(`· ${slug.padEnd(20)} not at ${ref}`); continue; }

  const before = bucketsOf(current);
  const merged = mergeMonthBuckets(before, bucketsOf(past), MAX_SNAPSHOT_MONTHS);
  // Rewrite whenever the month SET changes — months recovered from the older
  // commit, and equally months dropped because their label was never a real
  // disclosure month (a mis-read maturity date that won a modal vote).
  const was = before.map((b) => ymOf(b.asOfMonth) ?? "?").join(" ");
  const now = merged.map((b) => ymOf(b.asOfMonth)!).join(" ");
  if (was === now) {
    unchanged++;
    console.log(`· ${slug.padEnd(20)} ${merged.length} month(s), nothing to restore`);
    continue;
  }

  const snap: AmcPortfolioSnapshot = {
    amc: current.amc,
    amcSlug: current.amcSlug,
    sourceUrl: current.sourceUrl,
    asOfMonth: merged[0].asOfMonth,
    fetchedAt: current.fetchedAt,
    schemes: merged[0].schemes,
    history: merged.slice(1),
  };
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(snap) + "\n", "utf8");
  restored++;
  console.log(`✓ ${slug.padEnd(20)} ${merged.map((m) => m.asOfMonth).join(" ")}`);
}

console.log(`\nRestored history for ${restored} AMC(s); ${unchanged} already complete.`);
