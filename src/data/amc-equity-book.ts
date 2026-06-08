import indexJson from "@/data/portfolio-tracker/index.json";
import { amcOf } from "@/data/amc-name-map";
import { memoize } from "@/lib/memoize";

/**
 * Derived per-AMC EQUITY active/passive book.
 *
 * CAVEAT — this is a derived proxy, NOT an official AMFI per-AMC disclosure.
 * It is built from the RupeeVest scheme index (equity schemes > ~₹500 Cr, a
 * single month-end snapshot), covers EQUITY ONLY (no debt / liquid / hybrid),
 * and maps schemes to fund houses by name prefix (amcOf), so a few
 * AMFI-mandated ETFs whose names aren't the AMC brand can be mis-attributed.
 * Use it for relative structure (who is active- vs passive-heavy), not as a
 * precise AUM ledger.
 *
 * Passive = "Equity : ETFs" + "Equity : Index Funds". Active = every other
 * "Equity :" classification.
 */

interface RawFund {
  schemecode: string;
  name: string;
  fundName: string | null;
  classification: string | null;
  aumTotalCr: number | null;
  aumAsOf?: string;
}

const PASSIVE_EQUITY = new Set(["Equity : ETFs", "Equity : Index Funds"]);

function nameOf(f: RawFund): string {
  return f.fundName ?? f.name;
}

/** Normalise a scheme name to a strategy key so Direct / Regular / Growth /
 *  IDCW plan variants of one strategy collapse together. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(direct|regular|growth|idcw|dividend|payout|reinvestment|plan|option)\b/g,
      " "
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function equityFunds(): RawFund[] {
  return (indexJson.funds as RawFund[]).filter(
    (f) =>
      (f.classification ?? "").startsWith("Equity :") &&
      typeof f.aumTotalCr === "number"
  );
}

interface DedupResult {
  kept: RawFund[];
  duplicateGroups: number;
  schemesDropped: number;
  aumDroppedCr: number;
}

/**
 * Defensive dedup: group by (AMC + normalised strategy name) and keep the
 * higher-AUM row per group. On the current RupeeVest snapshot this drops
 * nothing (the index is already scheme-consolidated), but it guards against a
 * future feed that lists Direct / Regular plans as separate rows that would
 * otherwise double-count one strategy.
 */
function dedupEquityFunds(funds: RawFund[]): DedupResult {
  const groups = new Map<string, RawFund[]>();
  for (const f of funds) {
    const key = `${amcOf(nameOf(f))}|${normalizeName(nameOf(f))}`;
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }
  const kept: RawFund[] = [];
  let duplicateGroups = 0;
  let schemesDropped = 0;
  let aumDroppedCr = 0;
  for (const g of groups.values()) {
    if (g.length > 1) {
      duplicateGroups++;
      const max = g.reduce((b, x) =>
        (x.aumTotalCr ?? 0) > (b.aumTotalCr ?? 0) ? x : b
      );
      schemesDropped += g.length - 1;
      aumDroppedCr +=
        g.reduce((s, x) => s + (x.aumTotalCr ?? 0), 0) - (max.aumTotalCr ?? 0);
      kept.push(max);
    } else {
      kept.push(g[0]);
    }
  }
  return { kept, duplicateGroups, schemesDropped, aumDroppedCr };
}

export interface AmcEquityBookRow {
  amc: string;
  activeEquityCr: number;
  passiveEquityCr: number;
  totalEquityCr: number;
  activePct: number;
  passivePct: number;
  /** This AMC's equity AUM as a % of the derived industry equity total. */
  equitySharePct: number;
  schemes: number;
}

// Memoized per isolate: buildBook walks the full RupeeVest scheme index and is
// called by both amcEquityBook() and amcEquityBookDiagnostics() on every Market
// Share / Compare render, so caching keeps the Worker under its CPU budget
// (Cloudflare Error 1102). See src/lib/memoize.ts.
const buildBook = memoize(function buildBook_impl(): {
  rows: AmcEquityBookRow[];
  dedup: DedupResult;
  industryTotal: number;
} {
  const dedup = dedupEquityFunds(equityFunds());
  const byAmc = new Map<string, { active: number; passive: number; n: number }>();
  for (const f of dedup.kept) {
    const amc = amcOf(nameOf(f));
    const aum = f.aumTotalCr ?? 0;
    const e = byAmc.get(amc) ?? { active: 0, passive: 0, n: 0 };
    if (PASSIVE_EQUITY.has(f.classification ?? "")) e.passive += aum;
    else e.active += aum;
    e.n += 1;
    byAmc.set(amc, e);
  }
  const industryTotal = [...byAmc.values()].reduce(
    (s, e) => s + e.active + e.passive,
    0
  );
  const rows: AmcEquityBookRow[] = [...byAmc.entries()]
    .map(([amc, e]) => {
      const total = e.active + e.passive;
      return {
        amc,
        activeEquityCr: e.active,
        passiveEquityCr: e.passive,
        totalEquityCr: total,
        activePct: total > 0 ? (e.active / total) * 100 : 0,
        passivePct: total > 0 ? (e.passive / total) * 100 : 0,
        equitySharePct: industryTotal > 0 ? (total / industryTotal) * 100 : 0,
        schemes: e.n,
      };
    })
    .sort((a, b) => b.totalEquityCr - a.totalEquityCr);
  return { rows, dedup, industryTotal };
});

/** Per-AMC derived equity book, largest total equity first. */
export function amcEquityBook(): AmcEquityBookRow[] {
  return buildBook().rows;
}

export interface EquityBookDiagnostics {
  snapshotMonth: string;
  snapshotAsOf: string | null;
  equitySchemesConsidered: number;
  duplicateGroups: number;
  schemesDropped: number;
  aumDroppedCr: number;
  industryEquityCr: number;
  amcCount: number;
}

function formatAsOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function amcEquityBookDiagnostics(): EquityBookDiagnostics {
  const all = equityFunds();
  const { rows, dedup, industryTotal } = buildBook();
  const asOf = (indexJson.funds as RawFund[]).find((f) => f.aumAsOf)?.aumAsOf ?? null;
  return {
    snapshotMonth: asOf ? formatAsOf(asOf) : "—",
    snapshotAsOf: asOf,
    equitySchemesConsidered: all.length,
    duplicateGroups: dedup.duplicateGroups,
    schemesDropped: dedup.schemesDropped,
    aumDroppedCr: dedup.aumDroppedCr,
    industryEquityCr: industryTotal,
    amcCount: rows.length,
  };
}

export interface SanityCheck {
  label: string;
  pass: boolean;
  detail: string;
}

/**
 * Sanity helper — verifies the derived book against known market structure:
 * SBI/UTI passive dominance, SBI Nifty 50 ETF as the largest single passive
 * scheme, a plausible industry equity total, and that dedup isn't nuking data.
 */
export function amcEquityBookSanity(): { ok: boolean; checks: SanityCheck[] } {
  const diag = amcEquityBookDiagnostics();
  const byPassive = [...amcEquityBook()].sort(
    (a, b) => b.passiveEquityCr - a.passiveEquityCr
  );
  const top3Passive = byPassive.slice(0, 3).map((r) => r.amc);
  const largestPassive = equityFunds()
    .filter((f) => PASSIVE_EQUITY.has(f.classification ?? ""))
    .sort((a, b) => (b.aumTotalCr ?? 0) - (a.aumTotalCr ?? 0))[0];
  const checks: SanityCheck[] = [
    {
      label: "SBI is the #1 passive-equity AMC",
      pass: byPassive[0]?.amc === "SBI",
      detail: `top passive: ${byPassive[0]?.amc}`,
    },
    {
      label: "UTI is a top-3 passive-equity AMC",
      pass: top3Passive.includes("UTI"),
      detail: `top-3 passive: ${top3Passive.join(", ")}`,
    },
    {
      label: "Largest passive scheme is an SBI ETF",
      pass: largestPassive ? nameOf(largestPassive).startsWith("SBI") : false,
      detail: `largest passive scheme: ${largestPassive ? nameOf(largestPassive) : "—"}`,
    },
    {
      label: "Industry equity total is plausible (₹20–80L Cr)",
      pass:
        diag.industryEquityCr > 2_000_000 && diag.industryEquityCr < 8_000_000,
      detail: `₹${Math.round(diag.industryEquityCr).toLocaleString("en-IN")} Cr`,
    },
    {
      label: "Dedup drops < 5% of schemes",
      pass: diag.schemesDropped < diag.equitySchemesConsidered * 0.05,
      detail: `dropped ${diag.schemesDropped}/${diag.equitySchemesConsidered}`,
    },
  ];
  return { ok: checks.every((c) => c.pass), checks };
}
