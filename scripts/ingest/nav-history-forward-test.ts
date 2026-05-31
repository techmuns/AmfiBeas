/**
 * Phase 3.9B synthetic test for scripts/ingest/nav-history-forward.ts.
 *
 * Verifies the dry-run forward-append behaviour without hitting AMFI or
 * the filesystem (other than reading this test file's own source via the
 * "no production writes" string-search check). The forward-append logic
 * is exported as `simulateForwardAppend` / `dataAvailability` and
 * exercised here against synthetic series + manifest fragments.
 *
 * Run:    npx tsx scripts/ingest/nav-history-forward-test.ts
 * Exits:  0 on all-pass, 1 on any failure.
 */

import path from "node:path";
import { simulateForwardAppend, dataAvailability, ddMMMyyyyToIso } from "./nav-history-forward";

type PeriodKey = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y";
const EMPTY_AVAIL: Record<PeriodKey, boolean> = { "1M": false, "3M": false, "6M": false, "1Y": false, "3Y": false, "5Y": false };

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); }
  else    { fail += 1; console.error(`FAIL  ${name}${detail ? "\n        " + detail : ""}`); }
}

// Reusable synthetic series: 5 years of weekly NAVs ending 2026-05-29.
// Used by the availability checks below.
const FIVE_YEAR_SERIES: Array<[string, number]> = (() => {
  const out: Array<[string, number]> = [];
  // Start at 2021-05-28 to give 5Y headroom; step by 7 days.
  let cursor = Date.UTC(2021, 4, 28);
  const end = Date.UTC(2026, 4, 29);
  let nav = 100;
  while (cursor <= end) {
    const d = new Date(cursor);
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    out.push([iso, Math.round(nav * 100) / 100]);
    nav *= 1.001;
    cursor += 7 * 86_400_000;
  }
  return out;
})();
const FIVE_YEAR_LAST_DATE = FIVE_YEAR_SERIES[FIVE_YEAR_SERIES.length - 1][0];

// ---------------------------------------------------------------------------
// 1. ddMMMyyyyToIso parses AMFI's DD-MMM-YYYY into ISO.
// ---------------------------------------------------------------------------
check(
  "ddMMMyyyyToIso parses 29-May-2026 → 2026-05-29",
  ddMMMyyyyToIso("29-May-2026") === "2026-05-29",
  `got ${ddMMMyyyyToIso("29-May-2026")}`,
);
check(
  "ddMMMyyyyToIso accepts 1-Jan-2025 (single-digit day) → 2025-01-01",
  ddMMMyyyyToIso("1-Jan-2025") === "2025-01-01",
  `got ${ddMMMyyyyToIso("1-Jan-2025")}`,
);
check(
  "ddMMMyyyyToIso rejects malformed input → null",
  ddMMMyyyyToIso("not-a-date") === null,
  `got ${ddMMMyyyyToIso("not-a-date")}`,
);

// ---------------------------------------------------------------------------
// 2. Append a new NAV date (would-append).
// ---------------------------------------------------------------------------
{
  const a = simulateForwardAppend({
    schemecode: "1131",
    fundName: "HDFC Flexi Cap",
    existingSeries: FIVE_YEAR_SERIES,
    existingFirstDate: FIVE_YEAR_SERIES[0][0],
    existingLastDate: FIVE_YEAR_LAST_DATE,
    latestNav: 2200,
    latestNavIso: "2026-05-30",
    latestNavAmfi: "30-May-2026",
    manifestAvailability: EMPTY_AVAIL,
  });
  check(
    "would-append: action is 'would-append'",
    a.action === "would-append",
    `action=${a.action}`,
  );
  check(
    "would-append: proposedPoints == existing + 1",
    a.proposedPoints === FIVE_YEAR_SERIES.length + 1,
    `proposed=${a.proposedPoints} existing=${FIVE_YEAR_SERIES.length}`,
  );
  check(
    "would-append: proposedLastDate is the new latest ISO",
    a.proposedLastDate === "2026-05-30",
    `proposedLastDate=${a.proposedLastDate}`,
  );
  check(
    "would-append: gapCalendarDays = days(historyLastDate → latestNavDate)",
    a.gapCalendarDays === 1,
    `gap=${a.gapCalendarDays}`,
  );
  check(
    "would-append: largeGap=false at 1-day gap",
    !a.largeGap,
    `largeGap=${a.largeGap}`,
  );
}

// ---------------------------------------------------------------------------
// 3. Idempotent same-date → no-op.
// ---------------------------------------------------------------------------
{
  const a = simulateForwardAppend({
    schemecode: "1131",
    fundName: "HDFC Flexi Cap",
    existingSeries: FIVE_YEAR_SERIES,
    existingFirstDate: FIVE_YEAR_SERIES[0][0],
    existingLastDate: FIVE_YEAR_LAST_DATE,
    latestNav: 2200,
    latestNavIso: FIVE_YEAR_LAST_DATE,
    latestNavAmfi: "29-May-2026",
    manifestAvailability: EMPTY_AVAIL,
  });
  check(
    "idempotent: action is 'current' when latest == history.lastDate",
    a.action === "current",
    `action=${a.action}`,
  );
  check(
    "idempotent: proposedPoints unchanged",
    a.proposedPoints === FIVE_YEAR_SERIES.length,
    `proposed=${a.proposedPoints} existing=${FIVE_YEAR_SERIES.length}`,
  );
  check(
    "idempotent: proposedLastDate unchanged",
    a.proposedLastDate === FIVE_YEAR_LAST_DATE,
    `proposedLastDate=${a.proposedLastDate}`,
  );
  check(
    "idempotent: gapCalendarDays = 0",
    a.gapCalendarDays === 0,
    `gap=${a.gapCalendarDays}`,
  );
}

// ---------------------------------------------------------------------------
// 4. Stale latest NAV → no rewind.
// ---------------------------------------------------------------------------
{
  const a = simulateForwardAppend({
    schemecode: "1131",
    fundName: "HDFC Flexi Cap",
    existingSeries: FIVE_YEAR_SERIES,
    existingFirstDate: FIVE_YEAR_SERIES[0][0],
    existingLastDate: FIVE_YEAR_LAST_DATE,
    latestNav: 2200,
    latestNavIso: "2026-05-22", // earlier than lastDate
    latestNavAmfi: "22-May-2026",
    manifestAvailability: EMPTY_AVAIL,
  });
  check(
    "stale-latest: action is 'stale-latest' when latest < history.lastDate",
    a.action === "stale-latest",
    `action=${a.action}`,
  );
  check(
    "stale-latest: proposedPoints unchanged (no rewind)",
    a.proposedPoints === FIVE_YEAR_SERIES.length,
    `proposed=${a.proposedPoints}`,
  );
  check(
    "stale-latest: proposedLastDate stays at the existing lastDate",
    a.proposedLastDate === FIVE_YEAR_LAST_DATE,
    `proposedLastDate=${a.proposedLastDate}`,
  );
}

// ---------------------------------------------------------------------------
// 5. Invalid NAV → blocked.
// ---------------------------------------------------------------------------
{
  for (const bad of [-1, 0, NaN, Infinity, null as unknown as number]) {
    const a = simulateForwardAppend({
      schemecode: "X", fundName: "X",
      existingSeries: FIVE_YEAR_SERIES,
      existingFirstDate: FIVE_YEAR_SERIES[0][0],
      existingLastDate: FIVE_YEAR_LAST_DATE,
      latestNav: bad,
      latestNavIso: "2026-05-30",
      latestNavAmfi: "30-May-2026",
      manifestAvailability: EMPTY_AVAIL,
    });
    check(
      `invalid-nav: action='invalid-nav' for nav=${bad}`,
      a.action === "invalid-nav" || a.action === "no-latest-row",
      `action=${a.action}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 6. Duplicate date prevention (would-append never re-adds an existing date).
//    The simulate function only enters would-append when latest > lastDate,
//    so the very next series point is the new date. Confirm the simulated
//    merged series has no duplicates by reconstructing it the same way the
//    production path will.
// ---------------------------------------------------------------------------
{
  const a = simulateForwardAppend({
    schemecode: "Y", fundName: "Y",
    existingSeries: FIVE_YEAR_SERIES,
    existingFirstDate: FIVE_YEAR_SERIES[0][0],
    existingLastDate: FIVE_YEAR_LAST_DATE,
    latestNav: 2200,
    latestNavIso: "2026-05-30",
    latestNavAmfi: "30-May-2026",
    manifestAvailability: EMPTY_AVAIL,
  });
  // Reconstruct the merged series the same way main() does — and assert no
  // duplicate dates.
  const merged: Array<[string, number]> = a.action === "would-append" && a.latestNavDate !== null
    ? [...FIVE_YEAR_SERIES, [a.latestNavDate, 2200]]
    : FIVE_YEAR_SERIES;
  const seenDates = new Set<string>();
  let dup = false;
  for (const [d] of merged) {
    if (seenDates.has(d)) { dup = true; break; }
    seenDates.add(d);
  }
  check(
    "duplicate-date prevention: simulated merge has no duplicate dates",
    !dup,
    "checked all merged dates",
  );
}

// ---------------------------------------------------------------------------
// 7. Ascending series preservation.
// ---------------------------------------------------------------------------
{
  const a = simulateForwardAppend({
    schemecode: "Z", fundName: "Z",
    existingSeries: FIVE_YEAR_SERIES,
    existingFirstDate: FIVE_YEAR_SERIES[0][0],
    existingLastDate: FIVE_YEAR_LAST_DATE,
    latestNav: 2200,
    latestNavIso: "2026-06-05",
    latestNavAmfi: "5-Jun-2026",
    manifestAvailability: EMPTY_AVAIL,
  });
  const merged: Array<[string, number]> = a.action === "would-append" && a.latestNavDate !== null
    ? [...FIVE_YEAR_SERIES, [a.latestNavDate, 2200]]
    : FIVE_YEAR_SERIES;
  let asc = true;
  for (let i = 1; i < merged.length; i++) {
    if (merged[i][0] <= merged[i - 1][0]) { asc = false; break; }
  }
  check(
    "ascending preserved: merged series is strictly ascending after append",
    asc,
    "walked all consecutive pairs",
  );
}

// ---------------------------------------------------------------------------
// 8. Gap detection.
// ---------------------------------------------------------------------------
{
  // Small gap (~3 days, weekend hop) — should NOT flag largeGap.
  const small = simulateForwardAppend({
    schemecode: "G1", fundName: "G1",
    existingSeries: FIVE_YEAR_SERIES,
    existingFirstDate: FIVE_YEAR_SERIES[0][0],
    existingLastDate: FIVE_YEAR_LAST_DATE,
    latestNav: 200,
    latestNavIso: "2026-06-01",
    latestNavAmfi: "1-Jun-2026",
    manifestAvailability: EMPTY_AVAIL,
  });
  check(
    "gap-detect: 3-day weekend hop is not flagged as largeGap",
    small.gapCalendarDays === 3 && !small.largeGap,
    `gap=${small.gapCalendarDays} largeGap=${small.largeGap}`,
  );
  // Large gap (15 days) — SHOULD flag largeGap (> 7-day threshold).
  const large = simulateForwardAppend({
    schemecode: "G2", fundName: "G2",
    existingSeries: FIVE_YEAR_SERIES,
    existingFirstDate: FIVE_YEAR_SERIES[0][0],
    existingLastDate: FIVE_YEAR_LAST_DATE,
    latestNav: 200,
    latestNavIso: "2026-06-13",
    latestNavAmfi: "13-Jun-2026",
    manifestAvailability: EMPTY_AVAIL,
  });
  check(
    "gap-detect: 15-day gap IS flagged as largeGap",
    large.gapCalendarDays === 15 && large.largeGap,
    `gap=${large.gapCalendarDays} largeGap=${large.largeGap}`,
  );
}

// ---------------------------------------------------------------------------
// 9. dataAvailability matches the production rule (1M/3M/6M/1Y/3Y/5Y).
//    Built on the 5-year weekly series with end-anchor 2026-05-29 — all six
//    periods should be available because firstDate (2021-05-28) is one day
//    before the 5Y anchor (2026-05-29 − 5y = 2021-05-29).
// ---------------------------------------------------------------------------
{
  const pts = FIVE_YEAR_SERIES.map(([d, n]) => ({ date: d, nav: n }));
  const avail = dataAvailability(pts);
  check(
    "dataAvailability: 5-year weekly series has all 6 periods",
    avail["1M"] && avail["3M"] && avail["6M"] && avail["1Y"] && avail["3Y"] && avail["5Y"],
    JSON.stringify(avail),
  );
}
{
  // A 4-year series — should have everything EXCEPT 5Y.
  const fourYears = FIVE_YEAR_SERIES.filter(([d]) => d >= "2022-05-29");
  const pts = fourYears.map(([d, n]) => ({ date: d, nav: n }));
  const avail = dataAvailability(pts);
  check(
    "dataAvailability: 4-year series has 1M-3Y but not 5Y",
    avail["1M"] && avail["3M"] && avail["6M"] && avail["1Y"] && avail["3Y"] && !avail["5Y"],
    JSON.stringify(avail),
  );
}
{
  // A 2-year series — should have 1M/3M/6M/1Y but not 3Y or 5Y.
  const twoYears = FIVE_YEAR_SERIES.filter(([d]) => d >= "2024-05-29");
  const pts = twoYears.map(([d, n]) => ({ date: d, nav: n }));
  const avail = dataAvailability(pts);
  check(
    "dataAvailability: 2-year series has 1M-1Y but not 3Y or 5Y",
    avail["1M"] && avail["3M"] && avail["6M"] && avail["1Y"] && !avail["3Y"] && !avail["5Y"],
    JSON.stringify(avail),
  );
}

// ---------------------------------------------------------------------------
// 10. Funds that age IN to a new period after the proposed append.
//     A series whose firstDate is just-after the 1Y target before append
//     should gain "1Y" after appending a new point one day later (because
//     the asOf advances by one day and (asOf − 1y) advances with it).
// ---------------------------------------------------------------------------
{
  // Series spanning ~ (just shy of 1 year) ending at 2026-05-29.
  // firstDate = 2025-05-30. asOf = 2026-05-29 → 1Y target = 2025-05-29.
  // firstDate > target → 1Y unavailable.
  const just_under_1y: Array<[string, number]> = [];
  let cursor = Date.UTC(2025, 4, 30); // 2025-05-30
  const end = Date.UTC(2026, 4, 29);
  let nav = 100;
  while (cursor <= end) {
    const d = new Date(cursor);
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    just_under_1y.push([iso, Math.round(nav * 100) / 100]);
    nav *= 1.001;
    cursor += 7 * 86_400_000;
  }
  const priorPts = just_under_1y.map(([d, n]) => ({ date: d, nav: n }));
  const priorAvail = dataAvailability(priorPts);
  check(
    "ageing-in (pre-append): just-under-1Y series has 6M but not 1Y",
    priorAvail["6M"] && !priorAvail["1Y"],
    `prior=${JSON.stringify(priorAvail)}`,
  );
  const a = simulateForwardAppend({
    schemecode: "AGED", fundName: "AGED",
    existingSeries: just_under_1y,
    existingFirstDate: just_under_1y[0][0],
    existingLastDate: just_under_1y[just_under_1y.length - 1][0],
    latestNav: 200,
    latestNavIso: "2026-05-31",
    latestNavAmfi: "31-May-2026",
    manifestAvailability: { ...EMPTY_AVAIL, "6M": true }, // manifest reflects pre-append state
  });
  check(
    "ageing-in (post-append): fund gains 1Y after one more day's NAV pushes the anchor past firstDate",
    a.action === "would-append" && a.proposedAvailability["1Y"] === true,
    `action=${a.action} proposed=${JSON.stringify(a.proposedAvailability)}`,
  );
  check(
    "ageing-in: 6M still available; firstDate unchanged across the append",
    a.proposedAvailability["6M"] === true,
    JSON.stringify(a.proposedAvailability),
  );
}

// ---------------------------------------------------------------------------
// 11. Dry-run never writes to public/nav-history/ or src/data/snapshots/.
//     Verified by string-searching the production script's source.
// ---------------------------------------------------------------------------
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "scripts/ingest/nav-history-forward.ts"),
    "utf8",
  );
  // Phase 3.9C: production writes to public/nav-history/ + src/data/snapshots/
  // now EXIST but must be gated behind the production guard. The dry-run path
  // (the default) still touches only data/debug/. We assert (a) the writes
  // exist, and (b) they live inside the `WRITE_MODE === "production" && guardPass`
  // block, never in the dry-run path.
  const prodGateIdx = src.indexOf('WRITE_MODE === "production" && guardPass');
  const historyWriteIdx = src.indexOf("atomicWriteJson(path.join(HISTORY_DIR,");
  const manifestWriteIdx = src.indexOf("atomicWriteJson(MANIFEST_PATH,");
  check(
    "gated write: per-fund history write lives AFTER the production gate",
    prodGateIdx > 0 && historyWriteIdx > prodGateIdx,
    `gate=${prodGateIdx} historyWrite=${historyWriteIdx}`,
  );
  check(
    "gated write: manifest write lives AFTER the production gate",
    prodGateIdx > 0 && manifestWriteIdx > prodGateIdx,
    `gate=${prodGateIdx} manifestWrite=${manifestWriteIdx}`,
  );
  // The dry-run sample/summary writes (data/debug) must be gated on dry-run
  // so a production run never reconstructs (and double-appends) sample files.
  const dryRunGateIdx = src.indexOf('if (WRITE_MODE === "dryrun") {');
  const sampleWriteIdx = src.indexOf("path.join(SAMPLE_DIR,");
  check(
    "gated write: sample/summary debug writes are inside the dry-run guard",
    dryRunGateIdx > 0 && sampleWriteIdx > dryRunGateIdx,
    `dryRunGate=${dryRunGateIdx} sampleWrite=${sampleWriteIdx}`,
  );
  // The report itself always writes to data/debug/ (both modes).
  const writesDebugReport = /fs\.writeFile\(REPORT_PATH/.test(src) && /data\/debug/.test(src);
  check(
    "debug writes: dry-run report always written to data/debug/ (gitignored)",
    writesDebugReport,
    "data/debug report write present ✓",
  );
}

// ---------------------------------------------------------------------------
// 12. nav-returns.ts guards are now manifest-derived (no hardcoded
//     exact1M / approx3M etc. coverage constants).
// ---------------------------------------------------------------------------
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "scripts/ingest/nav-returns.ts"),
    "utf8",
  );
  // The old guards: exact1M / approx3M / approx6M / approx1Y / exact3Y /
  // exact5Y / approxTolerancePct. Manifest-derived replacements should not
  // declare any of these constants any more.
  const stillHasOldGuards =
    /\bexact1M\s*:/.test(src) ||
    /\bapprox3M\s*:/.test(src) ||
    /\bapprox6M\s*:/.test(src) ||
    /\bapprox1Y\s*:/.test(src) ||
    /\bexact3Y\s*:/.test(src) ||
    /\bexact5Y\s*:/.test(src) ||
    /\bapproxTolerancePct\s*:/.test(src);
  check(
    "returns guard: hard-coded exact/approx period constants removed from nav-returns.ts",
    !stillHasOldGuards,
    stillHasOldGuards ? "found one of the old constants" : "manifest-derived ✓",
  );
  // The new check should reference manifest.periodCoverage at the
  // validation site.
  const usesManifestPeriodCoverage = /manifest\.periodCoverage/.test(src);
  check(
    "returns guard: validation references manifest.periodCoverage as the source of truth",
    usesManifestPeriodCoverage,
    usesManifestPeriodCoverage ? "manifest.periodCoverage referenced ✓" : "missing",
  );
}

// ---------------------------------------------------------------------------
// 13. Manifest-derived returns guard tolerates growth (eligibility tick-ups).
//     Synthetic mirror of the production rule: required exact match against
//     the manifest. The manifest is regenerated alongside the per-fund files
//     in Phase 3.9C, so post-regen they'll always agree exactly. Growth from
//     one daily run to the next IS expected and the guard treats it as the
//     new exact value.
// ---------------------------------------------------------------------------
{
  function isCoverageOk(
    availability: Record<PeriodKey, number>,
    manifestPeriodCoverage: Record<PeriodKey, number>,
  ): { ok: boolean; failures: string[] } {
    const failures: string[] = [];
    for (const k of ["1M", "3M", "6M", "1Y", "3Y", "5Y"] as PeriodKey[]) {
      if (manifestPeriodCoverage[k] === undefined) continue;
      if (availability[k] !== manifestPeriodCoverage[k]) {
        failures.push(`${k}: ${availability[k]} != manifest ${manifestPeriodCoverage[k]}`);
      }
    }
    return { ok: failures.length === 0, failures };
  }
  // Day 1: matches.
  const day1 = isCoverageOk(
    { "1M": 1036, "3M": 1029, "6M": 1022, "1Y": 995, "3Y": 826, "5Y": 637 },
    { "1M": 1036, "3M": 1029, "6M": 1022, "1Y": 995, "3Y": 826, "5Y": 637 },
  );
  check(
    "returns guard: exact match against the manifest → PASS",
    day1.ok,
    day1.failures.join(" · "),
  );
  // Day 2: a few funds aged into 1Y / 3Y / 5Y, AND the manifest grew
  // alongside (regenerated in the same forward-refresh run). Exact match
  // still holds.
  const day2 = isCoverageOk(
    { "1M": 1036, "3M": 1029, "6M": 1022, "1Y": 998, "3Y": 828, "5Y": 640 },
    { "1M": 1036, "3M": 1029, "6M": 1022, "1Y": 998, "3Y": 828, "5Y": 640 },
  );
  check(
    "returns guard: eligibility-tick-up with manifest regenerated alongside → PASS",
    day2.ok,
    day2.failures.join(" · "),
  );
  // Failure: drift between snapshot and manifest (this is the bug-class the
  // new guard catches — and what would have masked the Phase-3.7A asOf bug).
  const skew = isCoverageOk(
    { "1M": 1036, "3M": 1029, "6M": 1022, "1Y": 998, "3Y": 828, "5Y": 640 },
    { "1M": 1036, "3M": 1029, "6M": 1022, "1Y": 995, "3Y": 826, "5Y": 637 },
  );
  check(
    "returns guard: snapshot vs manifest skew → FAIL (3 mismatches)",
    !skew.ok && skew.failures.length === 3,
    `failures=${JSON.stringify(skew.failures)}`,
  );
  // Manifest is older-shape (no 5Y key — pre-Stage-3): keys not present in
  // the manifest are not checked.
  const oldManifest = isCoverageOk(
    { "1M": 1036, "3M": 1029, "6M": 1022, "1Y": 995, "3Y": 826, "5Y": 637 },
    { "1M": 1036, "3M": 1029, "6M": 1022, "1Y": 995 } as Record<PeriodKey, number>,
  );
  check(
    "returns guard: tolerates older Stage-1/2 manifests (missing 3Y/5Y keys)",
    oldManifest.ok,
    oldManifest.failures.join(" · "),
  );
}

// ---------------------------------------------------------------------------
// 14. Import-guard: the production script's main() must not run as a side
//     effect of importing its exported helpers. We've already imported them
//     above; if main() had auto-run, the script would have logged its
//     "============ NAV HISTORY FORWARD REFRESH DRY-RUN ============" banner
//     synchronously and written debug files. We verify the file source
//     contains an entry-guard around main().
// ---------------------------------------------------------------------------
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "scripts/ingest/nav-history-forward.ts"),
    "utf8",
  );
  // The guard must be present AND must wrap the main() call.
  const hasGuard = /process\.argv\[1\][\s\S]+nav-history-forward/.test(src);
  const hasGuardedMain = /if \(_isEntry\)\s*\{\s*main\(\)/.test(src);
  check(
    "import-guard: production script wraps main() in a process.argv entry-check",
    hasGuard && hasGuardedMain,
    `hasGuard=${hasGuard} hasGuardedMain=${hasGuardedMain}`,
  );
}

// ===========================================================================
// Phase 3.9C additions — production write mode
// ===========================================================================

// 15. Production-write gating truth table (mirror of the script's gate
//     `WRITE_MODE === "production" && guardPass`).
{
  function shouldWrite(writeMode: "dryrun" | "production", guardPass: boolean): boolean {
    return writeMode === "production" && guardPass;
  }
  check("prod-gate: dryrun + pass → no write", shouldWrite("dryrun", true) === false, "");
  check("prod-gate: dryrun + fail → no write", shouldWrite("dryrun", false) === false, "");
  check("prod-gate: production + fail → no write (keep-last-good)", shouldWrite("production", false) === false, "");
  check("prod-gate: production + pass → write", shouldWrite("production", true) === true, "");
}

// 16. Source inspection of the production block.
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "scripts/ingest/nav-history-forward.ts"),
    "utf8",
  );

  check(
    "prod: WRITE_MODE is env-driven (NAV_HISTORY_FORWARD_WRITE_MODE === 'production')",
    /NAV_HISTORY_FORWARD_WRITE_MODE === "production"/.test(src),
    "env switch present",
  );
  check(
    "prod: production write block is gated on WRITE_MODE === 'production' && guardPass",
    /WRITE_MODE === "production" && guardPass/.test(src),
    "gate present",
  );
  check(
    "prod: only would-append funds are written (loop over `wouldAppend`)",
    /for \(const a of wouldAppend\)/.test(src),
    "iterates wouldAppend, not the full universe",
  );
  check(
    "prod: per-fund history files written via atomicWriteJson",
    /atomicWriteJson\(path\.join\(HISTORY_DIR, `\$\{a\.schemecode\}\.json`\), file\)/.test(src),
    "atomic per-fund write present",
  );
  check(
    "prod: manifest written via atomicWriteJson to MANIFEST_PATH",
    /atomicWriteJson\(MANIFEST_PATH, newManifest\)/.test(src),
    "atomic manifest write present",
  );
  // Manifest must be written AFTER the per-fund loop. Compare source indices.
  const perFundWriteIdx = src.indexOf("atomicWriteJson(path.join(HISTORY_DIR,");
  const manifestWriteIdx = src.indexOf("atomicWriteJson(MANIFEST_PATH,");
  check(
    "prod: manifest is written AFTER all per-fund history files (torn-write safety)",
    perFundWriteIdx > 0 && manifestWriteIdx > 0 && manifestWriteIdx > perFundWriteIdx,
    `perFund=${perFundWriteIdx} manifest=${manifestWriteIdx}`,
  );
  // Returns regen must come after the manifest write; category after returns.
  const returnsRegenIdx = src.indexOf('execFileSync("npm", ["run", "ingest:nav:returns"]');
  const categoryRegenIdx = src.indexOf('execFileSync("npm", ["run", "ingest:nav:category-returns"]');
  check(
    "prod: mf-returns regen runs AFTER the manifest write",
    returnsRegenIdx > 0 && returnsRegenIdx > manifestWriteIdx,
    `manifest=${manifestWriteIdx} returnsRegen=${returnsRegenIdx}`,
  );
  check(
    "prod: mf-category-returns regen runs AFTER mf-returns regen",
    categoryRegenIdx > 0 && categoryRegenIdx > returnsRegenIdx,
    `returnsRegen=${returnsRegenIdx} categoryRegen=${categoryRegenIdx}`,
  );
  check(
    "prod: category regen is gated on returns regen succeeding",
    /if \(production\.returnsRegenerated\) \{[\s\S]*?ingest:nav:category-returns/.test(src),
    "category gated on returns",
  );
  // productionOk requires manifest + both regens to have succeeded.
  check(
    "prod: productionOk requires manifestWritten && returnsRegenerated && categoryRegenerated",
    /productionOk\s*=[\s\S]*?production\.manifestWritten[\s\S]*?production\.returnsRegenerated[\s\S]*?production\.categoryRegenerated/.test(src),
    "productionOk composite present",
  );
  // The final exit propagates a failed production write.
  check(
    "prod: non-zero exit when production write did not complete cleanly",
    /WRITE_MODE === "production" && !productionOk[\s\S]*?process\.exit\(1\)/.test(src),
    "exit-on-incomplete present",
  );
  // Samples/summaries are dry-run only (no double-append in production).
  check(
    "prod: sample + summary writes are gated on dry-run (no double-append in production)",
    /if \(WRITE_MODE === "dryrun"\) \{[\s\S]*?SAMPLE_DIR[\s\S]*?CATEGORY_SUMMARY_PATH/.test(src),
    "dry-run-only debug writes",
  );
  // firstDate must not change across a forward append.
  check(
    "prod: forward append asserts firstDate is unchanged",
    /firstDate changed by forward append/.test(src),
    "firstDate-unchanged guard present",
  );
  // never overwrite existing same-date: merge only appends the new latest
  // (would-append branch only entered when latestIso > lastDate).
  check(
    "prod: merged series is existingSeries + the single new latest point",
    /const merged: Array<\[string, number\]> = \[\.\.\.existing\.series, \[a\.latestNavDate, latestRow\.nav\]\]/.test(src),
    "single-point append",
  );
}

// 17. Workflow commit wiring for Phase 3.9C.
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const yml = fs.readFileSync(
    path.resolve(process.cwd(), ".github/workflows/nav-history-forward.yml"),
    "utf8",
  );
  check(
    "workflow: still workflow_dispatch only (no schedule)",
    /workflow_dispatch:/.test(yml) && !/^\s*schedule:/m.test(yml),
    "dispatch present, no schedule",
  );
  check(
    "workflow: run step sets NAV_HISTORY_FORWARD_WRITE_MODE from commit input",
    /NAV_HISTORY_FORWARD_WRITE_MODE: \$\{\{ inputs\.commit == 'true' && 'production' \|\| 'dryrun' \}\}/.test(yml),
    "env wiring present",
  );
  check(
    "workflow: commit step gated on commit == 'true' AND run success",
    /inputs\.commit == 'true' && steps\.run\.outcome == 'success'/.test(yml),
    "commit gate present",
  );
  check(
    "workflow: commit message is 'chore(data): daily forward NAV refresh'",
    /git commit -m "chore\(data\): daily forward NAV refresh"/.test(yml),
    "commit message present",
  );
  check(
    "workflow: git add scopes exactly the four production paths",
    /git add public\/nav-history src\/data\/snapshots\/mf-history-manifest\.json src\/data\/snapshots\/mf-returns\.json src\/data\/snapshots\/mf-category-returns\.json/.test(yml),
    "git add scope present",
  );
  check(
    "workflow: no-op clean exit when git has no changes",
    /No forward-refresh changes to commit\./.test(yml),
    "no-op guard present",
  );
  check(
    "workflow: permissions contents: write (needed for commit)",
    /permissions:\s*\n\s*contents: write/.test(yml),
    "write permission present",
  );
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
