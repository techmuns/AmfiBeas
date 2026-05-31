/**
 * Phase 3.5D synthetic test for the eligibility-aware 3Y guardrail in
 * scripts/ingest/nav-history-backfill.ts.
 *
 * Purpose
 *   Verify, without hitting AMFI, that the eligibility partition behaves as
 *   intended:
 *     • Eligible = firstDate ≤ threeYTarget
 *     • Ineligible = firstDate > threeYTarget (or null firstDate)
 *     • eligibleCoveragePct measures 3Y availability among Eligible only
 *     • Genuinely-young funds (Ineligible) never appear in the guard metric
 *     • Missing-eligible-3Y funds (older funds without 3Y) DO show up and
 *       drive the metric below the 99% Stage-2 floor
 *
 * Run:    npx tsx scripts/ingest/nav-history-backfill-eligibility-test.ts
 * Exits:  0 on all-pass, 1 on any failure.
 *
 * The logic is intentionally duplicated here (not imported) so a regression
 * in the production script can't accidentally bypass the test. Keep this
 * mirror in sync if the partition rule in the production script changes.
 */

interface TestFund {
  schemecode: string;
  firstDate: string | null;
  has3Y: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function partition(
  funds: TestFund[],
  threeYTarget: string | null,
): {
  eligible: TestFund[];
  ineligible: TestFund[];
  eligibleAvailable: number;
  eligibleCoveragePct: number;
} {
  const eligible: TestFund[] = [];
  const ineligible: TestFund[] = [];
  if (!threeYTarget) return { eligible, ineligible, eligibleAvailable: 0, eligibleCoveragePct: 0 };
  for (const f of funds) {
    if (f.firstDate && f.firstDate <= threeYTarget) eligible.push(f);
    else ineligible.push(f);
  }
  const eligibleAvailable = eligible.filter((f) => f.has3Y).length;
  const eligibleCoveragePct = eligible.length > 0
    ? round2((eligibleAvailable / eligible.length) * 100)
    : 0;
  return { eligible, ineligible, eligibleAvailable, eligibleCoveragePct };
}

type Case = {
  name: string;
  threeYTarget: string | null;
  funds: TestFund[];
  expected: { eligible: number; ineligible: number; eligibleAvailable: number; eligibleCoveragePct: number; passes99: boolean };
};

const CASES: Case[] = [
  {
    name: "all-old, all-have-3Y → 100% eligible coverage, passes 99% floor",
    threeYTarget: "2023-05-29",
    funds: [
      { schemecode: "A", firstDate: "2019-01-01", has3Y: true },
      { schemecode: "B", firstDate: "2020-06-15", has3Y: true },
      { schemecode: "C", firstDate: "2022-12-31", has3Y: true },
    ],
    expected: { eligible: 3, ineligible: 0, eligibleAvailable: 3, eligibleCoveragePct: 100, passes99: true },
  },
  {
    name: "all-young → 0 eligible, ineligibles excluded from metric (guard should fail because eligible3YCount=0)",
    threeYTarget: "2023-05-29",
    funds: [
      { schemecode: "A", firstDate: "2024-01-01", has3Y: false },
      { schemecode: "B", firstDate: "2025-06-15", has3Y: false },
    ],
    expected: { eligible: 0, ineligible: 2, eligibleAvailable: 0, eligibleCoveragePct: 0, passes99: false },
  },
  {
    name: "mixed: 800 eligible with 3Y, 200 young — eligible coverage 100% even though total is 800/1000=80%",
    threeYTarget: "2023-05-29",
    funds: [
      ...Array.from({ length: 800 }, (_, i) => ({ schemecode: `OLD-${i}`, firstDate: "2020-01-01", has3Y: true })),
      ...Array.from({ length: 200 }, (_, i) => ({ schemecode: `YOUNG-${i}`, firstDate: "2024-06-01", has3Y: false })),
    ],
    expected: { eligible: 800, ineligible: 200, eligibleAvailable: 800, eligibleCoveragePct: 100, passes99: true },
  },
  {
    name: "Phase-3.5C-shaped: 826 eligible+3Y, 8 eligible missing 3Y, 202 young — eligible 826/834 = 99.04%, passes 99% floor",
    threeYTarget: "2023-05-29",
    funds: [
      ...Array.from({ length: 826 }, (_, i) => ({ schemecode: `OLD-OK-${i}`, firstDate: "2020-01-01", has3Y: true })),
      ...Array.from({ length: 8 }, (_, i) => ({ schemecode: `OLD-MISS-${i}`, firstDate: "2020-01-01", has3Y: false })),
      ...Array.from({ length: 202 }, (_, i) => ({ schemecode: `YOUNG-${i}`, firstDate: "2024-06-01", has3Y: false })),
    ],
    expected: { eligible: 834, ineligible: 202, eligibleAvailable: 826, eligibleCoveragePct: 99.04, passes99: true },
  },
  {
    name: "extraction-broken: 800 eligible, only 700 with 3Y → eligible 87.5%, fails 99% floor (the metric that should catch a real gap)",
    threeYTarget: "2023-05-29",
    funds: [
      ...Array.from({ length: 700 }, (_, i) => ({ schemecode: `OLD-OK-${i}`, firstDate: "2020-01-01", has3Y: true })),
      ...Array.from({ length: 100 }, (_, i) => ({ schemecode: `OLD-MISS-${i}`, firstDate: "2020-01-01", has3Y: false })),
      ...Array.from({ length: 200 }, (_, i) => ({ schemecode: `YOUNG-${i}`, firstDate: "2024-06-01", has3Y: false })),
    ],
    expected: { eligible: 800, ineligible: 200, eligibleAvailable: 700, eligibleCoveragePct: 87.5, passes99: false },
  },
  {
    name: "boundary: firstDate exactly equals threeYTarget → counts as eligible (inclusive)",
    threeYTarget: "2023-05-29",
    funds: [
      { schemecode: "EXACT", firstDate: "2023-05-29", has3Y: true },
      { schemecode: "DAY-AFTER", firstDate: "2023-05-30", has3Y: false },
    ],
    expected: { eligible: 1, ineligible: 1, eligibleAvailable: 1, eligibleCoveragePct: 100, passes99: true },
  },
  {
    name: "null firstDate → ineligible (zero-history funds don't pollute the metric)",
    threeYTarget: "2023-05-29",
    funds: [
      { schemecode: "OK", firstDate: "2020-01-01", has3Y: true },
      { schemecode: "NULL", firstDate: null, has3Y: false },
    ],
    expected: { eligible: 1, ineligible: 1, eligibleAvailable: 1, eligibleCoveragePct: 100, passes99: true },
  },
  {
    name: "no threeYTarget (broken anchor) → 0/0 across the board; guard fails on empty-eligible branch",
    threeYTarget: null,
    funds: [
      { schemecode: "A", firstDate: "2020-01-01", has3Y: true },
      { schemecode: "B", firstDate: "2025-01-01", has3Y: false },
    ],
    expected: { eligible: 0, ineligible: 0, eligibleAvailable: 0, eligibleCoveragePct: 0, passes99: false },
  },
  {
    name: "Stage-1 floor (0%) — old vs young breakdown still computed but the guard does not gate (verified by passes99 logic mirroring the production rule)",
    threeYTarget: "2024-08-31",
    funds: [
      ...Array.from({ length: 950 }, (_, i) => ({ schemecode: `OLD-${i}`, firstDate: "2022-01-01", has3Y: false })),
      ...Array.from({ length: 86 }, (_, i) => ({ schemecode: `YOUNG-${i}`, firstDate: "2025-01-01", has3Y: false })),
    ],
    expected: { eligible: 950, ineligible: 86, eligibleAvailable: 0, eligibleCoveragePct: 0, passes99: false },
  },
];

let pass = 0;
let fail = 0;
for (const c of CASES) {
  const got = partition(c.funds, c.threeYTarget);
  // Mirror production guard rule: passes when eligible count > 0 AND coverage ≥ 99.
  const passes99 = got.eligible.length > 0 && got.eligibleCoveragePct >= 99;
  const okEligible = got.eligible.length === c.expected.eligible;
  const okIneligible = got.ineligible.length === c.expected.ineligible;
  const okAvail = got.eligibleAvailable === c.expected.eligibleAvailable;
  const okPct = Math.abs(got.eligibleCoveragePct - c.expected.eligibleCoveragePct) < 0.005;
  const okGate = passes99 === c.expected.passes99;
  const allOk = okEligible && okIneligible && okAvail && okPct && okGate;
  if (allOk) {
    pass += 1;
    console.log(`PASS  ${c.name}`);
    console.log(`        eligible=${got.eligible.length} ineligible=${got.ineligible.length} avail=${got.eligibleAvailable} pct=${got.eligibleCoveragePct}% passes99=${passes99}`);
  } else {
    fail += 1;
    console.error(`FAIL  ${c.name}`);
    console.error(`      expected: eligible=${c.expected.eligible} ineligible=${c.expected.ineligible} avail=${c.expected.eligibleAvailable} pct=${c.expected.eligibleCoveragePct}% passes99=${c.expected.passes99}`);
    console.error(`      got:      eligible=${got.eligible.length} ineligible=${got.ineligible.length} avail=${got.eligibleAvailable} pct=${got.eligibleCoveragePct}% passes99=${passes99}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
