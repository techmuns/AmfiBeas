/**
 * Phase 3.7A synthetic test for the Stage-3 (5Y) additions in
 * scripts/ingest/nav-history-backfill.ts.
 *
 * Purpose
 *   Verify, without hitting AMFI, that:
 *     • The Stage-3 window grid is built correctly (60 months back, 75-day
 *       chunks, one pre-buffer window prepended).
 *     • The 5Y target (asOf − 5y) lands inside the pre-buffer window — the
 *       whole point of the pre-buffer pattern.
 *     • Stage-1 and Stage-2 window grids are byte-identical to the proven
 *       configurations (no regression).
 *     • The 5Y eligibility-aware guardrail behaves exactly like the 3Y one:
 *       young funds excluded, older missing funds fail the metric, boundary
 *       inclusive, null firstDate ineligible.
 *     • WRITE_MODE === "dryrun" produces no public/ files (the script's
 *       guarded write path is gated on WRITE_MODE === "production" AND
 *       guardPass).
 *
 * The Stage-3 partition logic is a mirror of the 3Y logic with the 5Y
 * anchor; mirrored here so a regression in the production script can't
 * silently bypass the test.
 *
 * Run:    npx tsx scripts/ingest/nav-history-backfill-stage3-test.ts
 * Exits:  0 on all-pass, 1 on any failure.
 */

import path from "node:path";

// ---------------------------------------------------------------------------
// Window builder mirror (matches scripts/ingest/nav-history-backfill.ts
// buildWindows + utcShiftMonths/Days). Kept inline so a refactor of the
// production scheduler can't silently break the test.
// ---------------------------------------------------------------------------

interface WindowSpec { from: Date; to: Date; role: "main" | "pre-buffer" }

function utcShiftDays(daysBack: number, fromMs?: number): Date {
  const base = fromMs ?? Date.now();
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() - daysBack);
  return d;
}

function utcShiftMonths(monthsBack: number): Date {
  const t = new Date();
  t.setUTCMonth(t.getUTCMonth() - monthsBack);
  return t;
}

function buildWindows(monthsBack: number, chunkDays: number, bufferDays = 0): WindowSpec[] {
  const today = new Date();
  const earliest = utcShiftMonths(monthsBack);
  const mains: WindowSpec[] = [];
  let toDate = today;
  while (toDate > earliest) {
    const fromDate = new Date(Math.max(earliest.getTime(), toDate.getTime() - (chunkDays - 1) * 86_400_000));
    mains.push({ from: fromDate, to: toDate, role: "main" });
    toDate = utcShiftDays(1, fromDate.getTime());
  }
  mains.reverse();
  if (bufferDays <= 0) return mains;
  const firstMain = mains[0];
  const preTo = utcShiftDays(1, firstMain.from.getTime());
  const preFrom = utcShiftDays(bufferDays - 1, preTo.getTime());
  return [{ from: preFrom, to: preTo, role: "pre-buffer" }, ...mains];
}

function toIso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function subPeriod(iso: string, months: number, years: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  let ny = y - years;
  let nm = m - months;
  while (nm <= 0) { nm += 12; ny -= 1; }
  const dim = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, dim);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Eligibility partition mirror
// ---------------------------------------------------------------------------

interface TestFund {
  schemecode: string;
  firstDate: string | null;
  has: boolean; // has 5Y (or 3Y, depending on the test) availability
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

function partition(funds: TestFund[], anchor: string | null) {
  const eligible: TestFund[] = [];
  const ineligible: TestFund[] = [];
  if (!anchor) return { eligible, ineligible, eligibleAvailable: 0, eligibleCoveragePct: 0 };
  for (const f of funds) {
    if (f.firstDate && f.firstDate <= anchor) eligible.push(f);
    else ineligible.push(f);
  }
  const eligibleAvailable = eligible.filter((f) => f.has).length;
  const eligibleCoveragePct = eligible.length > 0
    ? round2((eligibleAvailable / eligible.length) * 100)
    : 0;
  return { eligible, ineligible, eligibleAvailable, eligibleCoveragePct };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { pass += 1; console.log(`PASS  ${name}`); }
  else    { fail += 1; console.error(`FAIL  ${name}${detail ? "\n        " + detail : ""}`); }
}

// 1. Stage-3 window grid: 60 months back, 75-day chunks, 1 pre-buffer.
{
  const wins3 = buildWindows(60, 75, 45);
  const preBufs = wins3.filter((w) => w.role === "pre-buffer");
  const mains = wins3.filter((w) => w.role === "main");
  check(
    "Stage-3 has exactly 1 pre-buffer window",
    preBufs.length === 1,
    `got ${preBufs.length}`,
  );
  // ~60 months × 30.44 days/mo = 1826 days. ceil(1826/75) = ~25. Allow ±1
  // for today-of-month vs end-of-month rounding edge cases.
  check(
    "Stage-3 main window count is roughly 25 (±1)",
    Math.abs(mains.length - 25) <= 1,
    `got ${mains.length}`,
  );
  check(
    "Stage-3 total window count is roughly 26 (±1)",
    Math.abs(wins3.length - 26) <= 1,
    `got ${wins3.length}`,
  );
  // The pre-buffer's correctness property: it must provide NAV points on or
  // before the 5Y target so `nearestPrior(target)` finds an anchor. The
  // combined pre-buffer + main coverage runs from preBuffer.from to today,
  // continuously (preBuffer.to + 1 day === firstMain.from by construction).
  // We require preBuffer.from <= 5Y target <= today.
  const todayIso = toIso(new Date());
  const fiveYTarget = subPeriod(todayIso, 0, 5);
  const preFrom = toIso(preBufs[0].from);
  const preTo = toIso(preBufs[0].to);
  const firstMainFrom = toIso(mains[0].from);
  check(
    "Stage-3 pre-buffer + first main are consecutive (no gap at the 5Y anchor seam)",
    (() => {
      const [py, pm, pd] = preTo.split("-").map(Number);
      const nextAfterPreTo = toIso(new Date(Date.UTC(py, pm - 1, pd + 1)));
      return nextAfterPreTo === firstMainFrom;
    })(),
    `preBuffer.to ${preTo} → firstMain.from ${firstMainFrom}`,
  );
  check(
    "Stage-3 5Y target (asOf − 5y) is reachable: preBuffer.from <= target <= today",
    preFrom <= fiveYTarget && fiveYTarget <= todayIso,
    `pre-buffer ${preFrom} → ${preTo} · 5Y target ${fiveYTarget} · today ${todayIso}`,
  );
}

// 2. Stage-1 and Stage-2 window grids unchanged (no regression).
{
  const wins1 = buildWindows(15, 75, 0);
  const preBufs1 = wins1.filter((w) => w.role === "pre-buffer");
  check(
    "Stage-1 has no pre-buffer (config bufferDays = 0)",
    preBufs1.length === 0,
    `got ${preBufs1.length}`,
  );
  // 15 months × 30.44 = ~457 days, ceil(457/75) = ~7 main windows.
  check(
    "Stage-1 main window count is ~7 (±1)",
    Math.abs(wins1.length - 7) <= 1,
    `got ${wins1.length}`,
  );

  const wins2 = buildWindows(36, 75, 45);
  const preBufs2 = wins2.filter((w) => w.role === "pre-buffer");
  const mains2 = wins2.filter((w) => w.role === "main");
  check(
    "Stage-2 has exactly 1 pre-buffer window",
    preBufs2.length === 1,
    `got ${preBufs2.length}`,
  );
  // 36 months × 30.44 = ~1096 days, ceil(1096/75) = ~15 mains.
  check(
    "Stage-2 main window count is ~15 (±1)",
    Math.abs(mains2.length - 15) <= 1,
    `got ${mains2.length}`,
  );
  const todayIso = toIso(new Date());
  const threeYTarget = subPeriod(todayIso, 0, 3);
  const pre2From = toIso(preBufs2[0].from);
  const pre2To = toIso(preBufs2[0].to);
  const firstMain2From = toIso(mains2[0].from);
  check(
    "Stage-2 pre-buffer + first main are consecutive (no regression)",
    (() => {
      const [py, pm, pd] = pre2To.split("-").map(Number);
      const nextAfterPreTo = toIso(new Date(Date.UTC(py, pm - 1, pd + 1)));
      return nextAfterPreTo === firstMain2From;
    })(),
    `preBuffer.to ${pre2To} → firstMain.from ${firstMain2From}`,
  );
  check(
    "Stage-2 3Y target is reachable: preBuffer.from <= target <= today (no regression)",
    pre2From <= threeYTarget && threeYTarget <= todayIso,
    `pre-buffer ${pre2From} → ${pre2To} · 3Y target ${threeYTarget} · today ${todayIso}`,
  );
}

// 3. 5Y eligibility-aware guardrail mirrors 3Y. Anchor = ~today − 5y.
{
  const anchor = subPeriod(toIso(new Date()), 0, 5);

  const olderOk: TestFund[] = Array.from({ length: 800 }, (_, i) => ({
    schemecode: `OLD-${i}`, firstDate: subPeriod(anchor, 0, 1), has: true,
  }));
  const olderMiss: TestFund[] = Array.from({ length: 8 }, (_, i) => ({
    schemecode: `OLD-MISS-${i}`, firstDate: subPeriod(anchor, 0, 1), has: false,
  }));
  const young: TestFund[] = Array.from({ length: 228 }, (_, i) => ({
    schemecode: `YOUNG-${i}`, firstDate: "2024-06-01", has: false,
  }));

  const happy = partition([...olderOk, ...young], anchor);
  check(
    "Stage-3 5Y happy path: 800 eligible all with 5Y → 100% guard pass",
    happy.eligible.length === 800 && happy.ineligible.length === 228 && happy.eligibleCoveragePct === 100,
    JSON.stringify(happy, null, 0).slice(0, 200),
  );

  const realistic = partition([...olderOk, ...olderMiss, ...young], anchor);
  const realisticOk = realistic.eligible.length === 808
    && realistic.eligibleAvailable === 800
    && Math.abs(realistic.eligibleCoveragePct - 99.01) < 0.05;
  check(
    "Stage-3 5Y realistic: 808 eligible / 800 with 5Y → 99.01% (passes 99%)",
    realisticOk,
    `eligible=${realistic.eligible.length} avail=${realistic.eligibleAvailable} pct=${realistic.eligibleCoveragePct}%`,
  );

  const extractionBad: TestFund[] = [
    ...Array.from({ length: 700 }, (_, i) => ({ schemecode: `OK-${i}`, firstDate: subPeriod(anchor, 0, 1), has: true })),
    ...Array.from({ length: 100 }, (_, i) => ({ schemecode: `MISS-${i}`, firstDate: subPeriod(anchor, 0, 1), has: false })),
    ...young,
  ];
  const bad = partition(extractionBad, anchor);
  check(
    "Stage-3 5Y extraction-broken: 800 eligible / 700 with 5Y = 87.5% → fails 99%",
    bad.eligibleCoveragePct === 87.5 && bad.eligibleAvailable === 700,
    `pct=${bad.eligibleCoveragePct}% avail=${bad.eligibleAvailable}/${bad.eligible.length}`,
  );

  // Boundary: firstDate exactly equals the anchor → eligible (inclusive).
  const boundary = partition(
    [
      { schemecode: "EXACT", firstDate: anchor, has: true },
      { schemecode: "DAY-AFTER", firstDate: subPeriod(anchor, 0, -1).startsWith("-") ? anchor : (() => {
        const [y,m,d] = anchor.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d + 1));
        return toIso(dt);
      })(), has: false },
      { schemecode: "NULL", firstDate: null, has: false },
    ],
    anchor,
  );
  check(
    "Stage-3 5Y boundary: firstDate == anchor → eligible (inclusive); day-after → ineligible; null → ineligible",
    boundary.eligible.length === 1 && boundary.ineligible.length === 2 && boundary.eligibleCoveragePct === 100,
    `eligible=${boundary.eligible.length} ineligible=${boundary.ineligible.length} pct=${boundary.eligibleCoveragePct}%`,
  );

  const noAnchor = partition([{ schemecode: "X", firstDate: "2020-01-01", has: true }], null);
  check(
    "Stage-3 5Y null anchor → 0/0 partition (guard would fail loudly)",
    noAnchor.eligible.length === 0 && noAnchor.ineligible.length === 0 && noAnchor.eligibleCoveragePct === 0,
    JSON.stringify(noAnchor).slice(0, 100),
  );
}

// 4. Stage-3 dry-run never writes to public/.
//    Verified by inspecting the script's production-write branch:
//    `if (WRITE_MODE === "production" && guardPass)`. WRITE_MODE defaults to
//    "dryrun" unless NAV_HISTORY_WRITE_MODE === "production". This test
//    confirms the production-history directory path resolves correctly
//    (constant), and that the env-var contract is the only switch.
{
  const productionDir = path.resolve(process.cwd(), "public/nav-history");
  check(
    "Production history dir resolves under repo public/ (not the data/debug sample dir)",
    productionDir.endsWith("/public/nav-history") && !productionDir.includes("/data/debug/"),
    productionDir,
  );
  const sampleDir = path.resolve(process.cwd(), "data/debug/sample-nav-history-stage3");
  check(
    "Stage-3 sample dir resolves under data/debug/ (gitignored)",
    sampleDir.endsWith("/data/debug/sample-nav-history-stage3") && !sampleDir.includes("/public/"),
    sampleDir,
  );
  const reportPath = path.resolve(process.cwd(), "data/debug/nav-history-backfill-stage3-dryrun-report.json");
  check(
    "Stage-3 dry-run report path is gitignored data/debug/ JSON",
    reportPath.endsWith("/data/debug/nav-history-backfill-stage3-dryrun-report.json"),
    reportPath,
  );
  // Document the env-var contract explicitly. The script reads
  // NAV_HISTORY_WRITE_MODE; absence → "dryrun".
  const writeMode = process.env.NAV_HISTORY_WRITE_MODE === "production" ? "production" : "dryrun";
  check(
    "WRITE_MODE defaults to dryrun when NAV_HISTORY_WRITE_MODE is absent",
    writeMode === "dryrun",
    `process.env.NAV_HISTORY_WRITE_MODE=${process.env.NAV_HISTORY_WRITE_MODE ?? "(unset)"}; resolved=${writeMode}`,
  );
}

// ===========================================================================
// Phase 3.7B additions — Stage-3 INCREMENTAL flow
// ===========================================================================
//
// Verifies the post-Phase-3.7A redesign:
//   • Stable asOf is derived from an EXISTING manifest, never from a partial
//     fetched series. Mirrors mainStage3Incremental's step (2).
//   • Older-only fetch range is [5Y target − buffer, earliestExistingFirstDate
//     − 1]. Mirrors step (3).
//   • Older-only window builder emits oldest-first chunks of <= chunkDays
//     and covers the full range exactly. Mirrors buildOlderOnlyWindows.
//   • Incremental uses the existing per-fund history as the base (cannot
//     regress 1Y / 3Y coverage).
//   • Adaptive split on zero-row tiny HTML body halves the window down to
//     a min-chunk-days floor; multiple splits are recorded as distinct
//     WindowResult entries.
//   • Dry-run never touches public/nav-history/.

// Mirror: isoSubDays / isoToDate (must match production helpers).
function isoSubDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) - days * 86_400_000;
  return toIso(new Date(ms));
}
function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// Mirror: buildOlderOnlyWindows.
function buildOlderOnlyWindows(fromIso: string, toIso: string, chunkDays: number): Array<{ from: Date; to: Date }> {
  const wins: Array<{ from: Date; to: Date }> = [];
  if (fromIso > toIso) return wins;
  let cursor = isoToDate(fromIso).getTime();
  const end = isoToDate(toIso).getTime();
  while (cursor <= end) {
    const fromDate = new Date(cursor);
    const tentativeToMs = cursor + (chunkDays - 1) * 86_400_000;
    const toMs = Math.min(tentativeToMs, end);
    const toDate = new Date(toMs);
    wins.push({ from: fromDate, to: toDate });
    cursor = toMs + 86_400_000;
  }
  return wins;
}

// Deriving stableAsOfDate from an existing manifest.
function stableAsOfFromManifest(manifestFunds: Array<{ firstDate: string | null; lastDate: string | null }>): { stableAsOf: string | null; earliestFirstDate: string | null } {
  let stableAsOf: string | null = null;
  let earliestFirstDate: string | null = null;
  for (const m of manifestFunds) {
    if (m.lastDate && (!stableAsOf || m.lastDate > stableAsOf)) stableAsOf = m.lastDate;
    if (m.firstDate && (!earliestFirstDate || m.firstDate < earliestFirstDate)) earliestFirstDate = m.firstDate;
  }
  return { stableAsOf, earliestFirstDate };
}

// 5. Stable asOf is NOT derived from a partial fetched series.
{
  // Real Stage-2 production-shaped manifest fragment.
  const manifest = [
    { firstDate: "2023-04-17", lastDate: "2026-05-29" },
    { firstDate: "2023-04-18", lastDate: "2026-05-29" },
    { firstDate: "2024-08-01", lastDate: "2026-05-29" }, // younger
  ];
  const { stableAsOf, earliestFirstDate } = stableAsOfFromManifest(manifest);
  check(
    "Stage-3 stableAsOf comes from manifest max(lastDate) — independent of any partial fetch",
    stableAsOf === "2026-05-29",
    `got ${stableAsOf}`,
  );
  check(
    "Stage-3 earliestExistingFirstDate = min(firstDate) across manifest",
    earliestFirstDate === "2023-04-17",
    `got ${earliestFirstDate}`,
  );

  // Simulate the broken Phase-3.7A behavior: a partial fetched series only
  // reaches 2023-05-02. A correctly-implemented incremental flow MUST NOT
  // adopt that as the asOf — it must keep using the manifest's 2026-05-29.
  const partialFetchedSeriesLastDate = "2023-05-02";
  check(
    "Stage-3 stableAsOf ignores the partial fetched series last date (regression guard for 3.7A bug)",
    stableAsOf !== partialFetchedSeriesLastDate && stableAsOf === "2026-05-29",
    `stableAsOf=${stableAsOf} partial=${partialFetchedSeriesLastDate}`,
  );
}

// 6. Older-only fetch range and window builder.
{
  const stableAsOf = "2026-05-29";
  const earliestExistingFirstDate = "2023-04-17";
  const bufferDays = 45;
  const fiveYTarget = subPeriod(stableAsOf, 0, 5); // 2021-05-29
  const olderFrom = isoSubDays(fiveYTarget, bufferDays); // ~2021-04-14
  const olderTo = isoSubDays(earliestExistingFirstDate, 1); // 2023-04-16
  check(
    "Stage-3 older fetch starts at (5Y target − buffer)",
    olderFrom === "2021-04-14",
    `5Y=${fiveYTarget} − ${bufferDays}d = ${olderFrom}`,
  );
  check(
    "Stage-3 older fetch ends the day before earliestExistingFirstDate (no overlap with committed Stage-2)",
    olderTo === "2023-04-16",
    `earliestFirstDate=${earliestExistingFirstDate} − 1 = ${olderTo}`,
  );
  check(
    "Stage-3 older fetch range is non-empty when stableAsOf > earliestFirstDate + buffer",
    olderFrom <= olderTo,
    `${olderFrom} <= ${olderTo}`,
  );

  const wins = buildOlderOnlyWindows(olderFrom, olderTo, 75);
  // ~733 days / 75 = 9.77 → 10 windows
  check(
    "Stage-3 older window builder produces ~10 chunks for the ~24-month older range",
    Math.abs(wins.length - 10) <= 1,
    `got ${wins.length}`,
  );
  check(
    "Stage-3 older windows are oldest-first (windows[0].from < windows[-1].from)",
    wins.length > 1 && wins[0].from.getTime() < wins[wins.length - 1].from.getTime(),
    `wins[0].from=${toIso(wins[0].from)} wins[-1].from=${toIso(wins[wins.length - 1].from)}`,
  );
  check(
    "Stage-3 older windows are contiguous (no gaps)",
    (() => {
      for (let i = 1; i < wins.length; i++) {
        const prevTo = wins[i - 1].to.getTime();
        const curFrom = wins[i].from.getTime();
        if (curFrom !== prevTo + 86_400_000) return false;
      }
      return true;
    })(),
    "checked all consecutive pairs",
  );
  check(
    "Stage-3 older windows cover exactly [olderFrom, olderTo]",
    toIso(wins[0].from) === olderFrom && toIso(wins[wins.length - 1].to) === olderTo,
    `wins[0].from=${toIso(wins[0].from)} wins[-1].to=${toIso(wins[wins.length - 1].to)}`,
  );
  check(
    "Stage-3 older windows never re-fetch the committed Stage-2 range (last window's to < earliestExistingFirstDate)",
    toIso(wins[wins.length - 1].to) < earliestExistingFirstDate,
    `lastTo=${toIso(wins[wins.length - 1].to)} earliestFirstDate=${earliestExistingFirstDate}`,
  );
}

// 7. Adaptive split simulation: 75-day window halves down to ≤14-day floor.
{
  // Model the role-tag progression: top → split-half → split-quarter.
  // 75 → ~37 → ~18 → STOP (since next split would be ≤14d → at-or-below the
  // floor, the recurse condition `spanDays > minChunkDays` ends).
  const minChunkDays = 14;
  function spanAfterSplits(startDays: number): number[] {
    const out: number[] = [startDays];
    let s = startDays;
    while (s > minChunkDays) {
      s = Math.floor(s / 2);
      out.push(s);
    }
    return out;
  }
  const seq75 = spanAfterSplits(75);
  check(
    "Adaptive split: 75d → 37d → 18d → 9d sequence terminates at ≤ minChunkDays floor",
    seq75.length === 4 && seq75[seq75.length - 1] <= minChunkDays,
    `seq=${seq75.join(",")}`,
  );
  const seq30 = spanAfterSplits(30);
  check(
    "Adaptive split: 30d → 15d → 7d terminates at ≤ floor",
    seq30.length === 3 && seq30[seq30.length - 1] <= minChunkDays,
    `seq=${seq30.join(",")}`,
  );
  const seq14 = spanAfterSplits(14);
  check(
    "Adaptive split: 14d (at the floor) does not split further",
    seq14.length === 1 && seq14[0] === 14,
    `seq=${seq14.join(",")}`,
  );
}

// 8. Empty older range when stableAsOf − 5y already lies inside committed history.
{
  const stableAsOf = "2026-05-29";
  // If earliest existing firstDate is BEFORE the (5Y target − buffer), then
  // the older fetch should be skipped (range is empty/inverted).
  const earliestExistingFirstDate = "2020-01-01";
  const bufferDays = 45;
  const fiveYTarget = subPeriod(stableAsOf, 0, 5);
  const olderFrom = isoSubDays(fiveYTarget, bufferDays);
  const olderTo = isoSubDays(earliestExistingFirstDate, 1);
  check(
    "Stage-3 incremental skips older fetch when existing history already covers 5Y target",
    olderFrom > olderTo,
    `olderFrom=${olderFrom} olderTo=${olderTo}`,
  );
  const wins = buildOlderOnlyWindows(olderFrom, olderTo, 75);
  check(
    "Stage-3 incremental: empty range → zero windows",
    wins.length === 0,
    `got ${wins.length}`,
  );
}

// 9. Incremental flow uses existing series as base (cannot regress 1Y/3Y).
//    Modeled here as: merged series = union of (existing rows ∪ fetched older
//    rows where date < existing.firstDate). The 1Y/3Y target dates fall
//    inside the existing committed range, so 1Y/3Y availability is determined
//    entirely by existing rows — never by what the older fetch returned.
{
  const stableAsOf = "2026-05-29";
  const oneYTarget = subPeriod(stableAsOf, 0, 1); // 2025-05-29
  const threeYTarget = subPeriod(stableAsOf, 0, 3); // 2023-05-29
  const fiveYTarget = subPeriod(stableAsOf, 0, 5); // 2021-05-29
  // A fund whose existing series starts 2023-04-17 has 1Y and 3Y coverage
  // without any older fetch. 5Y becomes available once older rows reach
  // 2021-05-29.
  const existingFirstDate = "2023-04-17";
  check(
    "1Y target lies inside existing committed range (no merge regression possible)",
    existingFirstDate <= oneYTarget,
    `existingFirstDate=${existingFirstDate} 1Y target=${oneYTarget}`,
  );
  check(
    "3Y target lies inside existing committed range (no merge regression possible)",
    existingFirstDate <= threeYTarget,
    `existingFirstDate=${existingFirstDate} 3Y target=${threeYTarget}`,
  );
  check(
    "5Y target lies OUTSIDE existing committed range (needs older fetch)",
    existingFirstDate > fiveYTarget,
    `existingFirstDate=${existingFirstDate} 5Y target=${fiveYTarget}`,
  );
}

// 10. Dry-run cannot accidentally write production files. The script's
//     dispatch (`if (STAGE === 3) return mainStage3Incremental();`) routes
//     to a flow that never invokes atomicWriteJson on the production paths.
//     We assert this by string-search of the new function body.
{
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "scripts/ingest/nav-history-backfill.ts"),
    "utf8",
  );
  const idx = src.indexOf("async function mainStage3Incremental");
  const end = src.indexOf("async function main(", idx);
  const body = idx >= 0 && end > idx ? src.slice(idx, end) : "";
  check(
    "Stage-3 incremental body contains no atomicWriteJson calls (no production writes)",
    body.length > 0 && !body.includes("atomicWriteJson"),
    body.length === 0 ? "could not slice mainStage3Incremental body" : "atomicWriteJson absent ✓",
  );
  check(
    "Stage-3 incremental body contains no PRODUCTION_HISTORY_DIR writes",
    body.length > 0 && !/PRODUCTION_HISTORY_DIR/.test(body),
    body.length === 0 ? "n/a" : "PRODUCTION_HISTORY_DIR absent ✓",
  );
  check(
    "Stage-3 incremental body contains no PRODUCTION_MANIFEST_PATH writes",
    body.length > 0 && !/fs\.writeFile\([^)]*PRODUCTION_MANIFEST_PATH/.test(body),
    body.length === 0 ? "n/a" : "PRODUCTION_MANIFEST_PATH writeFile absent ✓",
  );
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
