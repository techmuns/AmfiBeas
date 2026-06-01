/**
 * Phase 3.10C — Forward-append the latest NIFTY 500 close into the
 * per-index daily history file.
 *
 * Reads:
 *   • public/index-history/NIFTY_500.json          (existing series)
 *   • src/data/snapshots/index-latest.json          (today's NSE close)
 *   • src/data/snapshots/index-history-manifest.json (one-row manifest)
 *
 * Behaviour:
 *   • If latest.asOf > history.lastDate → append [asOf, level]; rewrite
 *     the per-index file atomically; rebuild the manifest entry.
 *   • If latest.asOf == history.lastDate → no-op clean exit.
 *   • If latest.asOf  < history.lastDate → no-op clean exit (we never
 *     rewind a committed series). Logged so the operator can see it.
 *
 * Invariants enforced before any write:
 *   • Strictly ascending dates
 *   • No duplicate dates
 *   • All NAVs/closes finite and > 0
 *   • firstDate unchanged
 *
 * Atomic temp+rename writes only — a torn write leaves the previous
 * file intact (keep-last-good).
 *
 * Run: npm run ingest:index:history-forward
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, nowIso, warn } from "./utils";

const LATEST_PATH = path.resolve(process.cwd(), "src/data/snapshots/index-latest.json");
const MANIFEST_PATH = path.resolve(process.cwd(), "src/data/snapshots/index-history-manifest.json");
const HISTORY_DIR = path.resolve(process.cwd(), "public/index-history");
const TARGET_INDEX_ID = "NIFTY_500";

// ---------------------------------------------------------------------------
// Types (kept inline; matches the public/index-history schema written by
// Phase 3.10A's index-history-backfill.ts.)
// ---------------------------------------------------------------------------

interface LatestRow {
  indexId: string;
  name: string;
  level: number;
  asOf: string;
  sourceUrl?: string;
}
interface LatestSnapshot {
  generatedAt?: string;
  source?: string;
  feedDate: string;
  indices: LatestRow[];
}

interface IndexHistoryFile {
  meta: {
    indexId: string;
    name: string;
    source: string;
    stage: string;
    generatedAt: string;
    firstDate: string | null;
    lastDate: string | null;
    points: number;
    provenance?: {
      csvDir?: string;
      csvFiles?: unknown;
      parser?: string;
      notes?: string;
      forwardSource?: string;
      forwardAppends?: Array<{ asOf: string; level: number; feedDate: string; appendedAt: string; latestSnapshotGeneratedAt: string | null }>;
    };
  };
  series: Array<[string, number]>;
}

interface ManifestEntry {
  indexId: string;
  name: string;
  firstDate: string | null;
  lastDate: string | null;
  points: number;
  path: string;
}
interface ManifestFile {
  stage: string;
  generatedAt: string;
  indices: ManifestEntry[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dayDiffDays(isoA: string, isoB: string): number {
  const [ya, ma, da] = isoA.split("-").map(Number);
  const [yb, mb, db] = isoB.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

async function atomicWriteJson(targetPath: string, payload: unknown): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(targetPath)}.tmp-${process.pid}-${Date.now()}`);
  try {
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
    await fs.rename(tmp, targetPath);
  } catch (e) {
    try { await fs.unlink(tmp); } catch { /* ignore */ }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const generatedAt = nowIso();

  // --- Read latest snapshot --------------------------------------------------
  let latest: LatestSnapshot;
  try {
    latest = JSON.parse(await fs.readFile(LATEST_PATH, "utf8")) as LatestSnapshot;
  } catch (e) {
    warn(`could not read ${path.relative(process.cwd(), LATEST_PATH)}: ${(e as Error).message}`);
    warn(`forward append requires a valid index-latest snapshot — run npm run ingest:index:latest first.`);
    process.exit(1);
  }
  const latestRow = latest.indices?.find((i) => i.indexId === TARGET_INDEX_ID) ?? null;
  if (!latestRow) {
    warn(`index-latest snapshot does not contain ${TARGET_INDEX_ID}; nothing to append.`);
    process.exit(1);
  }
  if (!Number.isFinite(latestRow.level) || latestRow.level <= 0) {
    warn(`invalid latest level for ${TARGET_INDEX_ID}: ${latestRow.level}`);
    process.exit(1);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latestRow.asOf)) {
    warn(`invalid asOf date for ${TARGET_INDEX_ID}: ${latestRow.asOf}`);
    process.exit(1);
  }
  info(`latest: ${TARGET_INDEX_ID} asOf=${latestRow.asOf} level=${latestRow.level}`);

  // --- Read existing per-index history --------------------------------------
  const historyPath = path.join(HISTORY_DIR, `${TARGET_INDEX_ID}.json`);
  let existing: IndexHistoryFile;
  try {
    existing = JSON.parse(await fs.readFile(historyPath, "utf8")) as IndexHistoryFile;
  } catch (e) {
    warn(`could not read ${path.relative(process.cwd(), historyPath)}: ${(e as Error).message}`);
    warn(`forward append requires the per-index file to exist — run npm run ingest:index:backfill first.`);
    process.exit(1);
  }
  if (existing.meta.indexId !== TARGET_INDEX_ID) {
    warn(`history file indexId mismatch: expected ${TARGET_INDEX_ID}, got ${existing.meta.indexId}`);
    process.exit(1);
  }
  const existingLast = existing.meta.lastDate;
  if (!existingLast) {
    warn(`existing history file has no lastDate; refusing to append to an empty series`);
    process.exit(1);
  }
  info(`existing history: lastDate=${existingLast} points=${existing.meta.points}`);

  // --- Decide append vs no-op ------------------------------------------------
  if (latestRow.asOf < existingLast) {
    info(`latest asOf (${latestRow.asOf}) is OLDER than history lastDate (${existingLast}) — no rewind, no-op clean exit.`);
    return;
  }
  if (latestRow.asOf === existingLast) {
    info(`latest asOf (${latestRow.asOf}) already matches history lastDate — no-op clean exit.`);
    return;
  }
  const gapDays = dayDiffDays(existingLast, latestRow.asOf);
  if (gapDays > 7) {
    // Not a hard failure — index trading days can have multi-day gaps
    // around long market holidays — but worth surfacing so the operator
    // knows whether a re-backfill is warranted.
    info(`note: gap of ${gapDays} calendar day(s) between ${existingLast} and ${latestRow.asOf} (likely market closures; not a fault unless persistent).`);
  } else {
    info(`gap: ${gapDays} calendar day(s) between ${existingLast} and ${latestRow.asOf}`);
  }

  // --- Build the merged series + validate end-to-end -----------------------
  const merged: Array<[string, number]> = [...existing.series, [latestRow.asOf, latestRow.level]];
  if (merged.length < 2) {
    warn(`merged series only has ${merged.length} point(s); refusing`);
    process.exit(1);
  }
  const seen = new Set<string>();
  let prev = "";
  for (let i = 0; i < merged.length; i++) {
    const [d, v] = merged[i];
    if (seen.has(d)) { warn(`duplicate date detected at row ${i}: ${d}`); process.exit(1); }
    seen.add(d);
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      warn(`invalid value at ${d}: ${v}`); process.exit(1);
    }
    if (i > 0 && d <= prev) {
      warn(`non-ascending dates at row ${i}: ${d} <= ${prev}`); process.exit(1);
    }
    prev = d;
  }
  const newFirstDate = merged[0][0];
  const newLastDate = merged[merged.length - 1][0];
  if (existing.meta.firstDate !== null && newFirstDate !== existing.meta.firstDate) {
    warn(`firstDate changed across the append: ${existing.meta.firstDate} → ${newFirstDate}`);
    process.exit(1);
  }
  if (newLastDate !== latestRow.asOf) {
    warn(`internal: new lastDate ${newLastDate} != appended ${latestRow.asOf}`); process.exit(1);
  }

  // --- Rebuild the per-index file (preserve meta + provenance verbatim) ----
  const prevProvenance = existing.meta.provenance ?? {};
  const forwardAppends = Array.isArray(prevProvenance.forwardAppends)
    ? [...prevProvenance.forwardAppends]
    : [];
  forwardAppends.push({
    asOf: latestRow.asOf,
    level: latestRow.level,
    feedDate: latest.feedDate,
    appendedAt: generatedAt,
    latestSnapshotGeneratedAt: latest.generatedAt ?? null,
  });
  const newFile: IndexHistoryFile = {
    ...existing,
    meta: {
      ...existing.meta,
      firstDate: newFirstDate,
      lastDate: newLastDate,
      points: merged.length,
      // Phase 3.10C tag — keeps the audit trail clear ("csv-backfill" alone
      // means no forward appends yet; the suffix appears the first time).
      stage: existing.meta.stage.includes("forward") ? existing.meta.stage : `${existing.meta.stage}+forward`,
      generatedAt,
      provenance: {
        ...prevProvenance,
        forwardSource: "NSE daily index close CSV (via scripts/ingest/index-latest.ts → index-latest.json)",
        forwardAppends,
        parser: prevProvenance.parser ?? "scripts/ingest/index-history-backfill.ts:parseCsv",
      },
    },
    series: merged,
  };
  await atomicWriteJson(historyPath, newFile);
  info(`wrote ${path.relative(process.cwd(), historyPath)}  (lastDate=${newLastDate} points=${merged.length})`);

  // --- Rebuild manifest entry ----------------------------------------------
  let manifest: ManifestFile;
  try {
    manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8")) as ManifestFile;
  } catch {
    // Manifest missing is unexpected (3.10A wrote it) but recoverable —
    // synthesize a one-entry manifest.
    manifest = { stage: "csv-backfill", generatedAt, indices: [] };
  }
  const newEntry: ManifestEntry = {
    indexId: TARGET_INDEX_ID,
    name: existing.meta.name,
    firstDate: newFirstDate,
    lastDate: newLastDate,
    points: merged.length,
    path: `/index-history/${TARGET_INDEX_ID}.json`,
  };
  const idx = manifest.indices.findIndex((e) => e.indexId === TARGET_INDEX_ID);
  if (idx >= 0) manifest.indices[idx] = newEntry;
  else manifest.indices.push(newEntry);
  // Mirror the per-index file's stage tag at the manifest level so a
  // consumer can tell at a glance whether forward appends have begun.
  manifest.stage = newFile.meta.stage;
  manifest.generatedAt = generatedAt;
  await atomicWriteJson(MANIFEST_PATH, manifest);
  info(`wrote ${path.relative(process.cwd(), MANIFEST_PATH)}`);

  info(`================ INDEX HISTORY FORWARD SUMMARY ================`);
  info(`index:        ${TARGET_INDEX_ID}`);
  info(`appended:     ${latestRow.asOf}  level=${latestRow.level}  (gap=${gapDays}d)`);
  info(`range now:    ${newFirstDate} → ${newLastDate}`);
  info(`points now:   ${merged.length}`);
  info(`stage:        ${newFile.meta.stage}`);
  info(`================================================================`);
}

main().catch((e) => {
  warn(`index-history-forward failed: ${(e as Error).message}`);
  process.exit(1);
});
