/**
 * Returns & Ranking API — the dashboard's "Peer ranking" table, for EVERY scheme.
 *
 * This serves the same per-period returns and same-cohort ranking that the
 * Returns & Ranking → Peer ranking table renders (TrendsPeerTable), but across
 * the whole universe of tracked plan-series instead of one fund's cohort. It is
 * backed by the daily mf-category-returns snapshot
 * (public/nav-data/mf-category-returns.json), so it always reflects the latest
 * committed daily NAV refresh.
 *
 * Ranking is cohort-relative, exactly as the dashboard computes it: for each
 * period a fund is rank R of peerCount N within its own cohort
 * (classification | plan | option). Returns are the same point-to-point figures
 * the table shows — simple for 1M/3M/6M/1Y, CAGR for 3Y/5Y/10Y — returned at
 * full precision (the UI rounds to one decimal; callers format as they wish).
 *
 * GET /api/returns-ranking
 *   ?classification=Equity : ETFs   exact classification filter (case-insensitive)
 *   &plan=regular|direct|unknown    plan filter
 *   &option=growth|idcw|unknown     option filter
 *   &cohort=Equity : ETFs | regular | unknown
 *                                   exact cohort-key filter (classification | plan | option)
 *   &q=nifty 50                     case-insensitive substring on fund name (alias: search)
 *   &period=1M,3M,1Y                restrict which periods are returned (default: all seven)
 *   &fields=compact|standard|full   per-period detail level (default: standard)
 *   &format=json|csv                response format (default: json)
 *   &limit=500&offset=0             pagination (default: all funds)
 *
 * fields levels (per period):
 *   compact  → return, rank, peerCount
 *   standard → + percentile, quartile, statsAvailable (default)
 *   full     → + categoryAverage, categoryMedian, excessVsAverage, excessVsMedian
 *
 * `rank`, `percentile`, `quartile` are null when the cohort was too small to rank
 * (fewer than the snapshot's minPeerCount peers with that period); `return` is
 * still provided whenever the fund has one. A period a fund has no return for is
 * all-null.
 *
 * CORS is open (Access-Control-Allow-Origin: *): this is public, read-only market
 * data — already downloadable as a static asset — so a client dashboard on
 * another origin can call it directly from the browser.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ASSET_PATH = "/nav-data/mf-category-returns.json";
const PERIODS = ["1M", "3M", "6M", "1Y", "3Y", "5Y", "10Y"] as const;
type PeriodKey = (typeof PERIODS)[number];

const FIELD_LEVELS = ["compact", "standard", "full"] as const;
type FieldLevel = (typeof FIELD_LEVELS)[number];

const MAX_LIMIT = 10000;
/** Warm-isolate cache: the snapshot changes at most once a day, so re-parsing a
 *  ~10 MB file on every request is pure waste. Kept small and time-boxed. */
const CACHE_TTL_MS = 10 * 60 * 1000;

interface RawRankStats {
  return?: number;
  rank?: number;
  peerCount?: number;
  percentile?: number;
  quartile?: "Q1" | "Q2" | "Q3" | "Q4";
  categoryAverage?: number;
  categoryMedian?: number;
  excessVsAverage?: number;
  excessVsMedian?: number;
  cohortKey?: string;
  statsAvailable?: boolean;
  reason?: string;
}
interface RawFundRank {
  schemecode: string;
  fundName: string;
  classification: string | null;
  plan: "direct" | "regular" | "unknown";
  option: "growth" | "idcw" | "unknown";
  periodRanks: Partial<Record<PeriodKey, RawRankStats>>;
}
interface CategorySnapshot {
  generatedAt: string;
  asOfDate: string | null;
  cohortKey: string;
  periods?: PeriodKey[];
  minPeerCount?: number;
  fundRanks: RawFundRank[];
}

const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-max-age": "86400",
};
// The underlying snapshot refreshes once a day; cache generously at the edge and
// let stale-while-revalidate hide the refresh from callers.
const CACHE_HEADER = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

let cache: { at: number; snap: CategorySnapshot } | null = null;

/**
 * Read the snapshot. On Cloudflare the file is a static asset served by the
 * ASSETS binding, so we fetch it in-process through that binding; under
 * `next dev` (plain Node) that binding is absent and we fall back to a
 * same-origin fetch, which the dev server serves from public/.
 */
async function loadSnapshot(request: Request): Promise<CategorySnapshot> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.snap;

  const assetUrl = new URL(ASSET_PATH, request.url);
  let res: Response | null = null;
  try {
    const mod = await import("@opennextjs/cloudflare");
    const env = (await mod.getCloudflareContext({ async: true }))?.env as
      | { ASSETS?: { fetch: (req: Request) => Promise<Response> } }
      | undefined;
    if (env?.ASSETS?.fetch) res = await env.ASSETS.fetch(new Request(assetUrl));
  } catch {
    /* not running on Cloudflare — fall through to a plain fetch */
  }
  if (!res || !res.ok) res = await fetch(assetUrl);
  if (!res.ok) throw new Error(`snapshot fetch failed: ${res.status}`);

  const snap = (await res.json()) as CategorySnapshot;
  cache = { at: now, snap };
  return snap;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Shape one period's stats for the API at the requested detail level. */
function shapeStats(s: RawRankStats | undefined, level: FieldLevel) {
  if (!s) return { return: null, rank: null, peerCount: null };
  const available = s.statsAvailable === true;
  const compact = {
    return: num(s.return),
    rank: available ? num(s.rank) : null,
    peerCount: num(s.peerCount),
  };
  if (level === "compact") return compact;

  const standard = {
    ...compact,
    percentile: available ? num(s.percentile) : null,
    quartile: available ? s.quartile ?? null : null,
    statsAvailable: available,
    ...(available ? {} : { reason: s.reason ?? null }),
  };
  if (level === "standard") return standard;

  return {
    ...standard,
    categoryAverage: num(s.categoryAverage),
    categoryMedian: num(s.categoryMedian),
    excessVsAverage: num(s.excessVsAverage),
    excessVsMedian: num(s.excessVsMedian),
  };
}

function cohortKeyOf(f: RawFundRank): string {
  return `${f.classification ?? "(unclassified)"} | ${f.plan} | ${f.option}`;
}

function parseIntParam(v: string | null, fallback: number): number {
  if (v === null) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Flatten to one CSV row per fund: identity columns, then per-period columns. */
function toCsv(
  funds: Array<{
    schemecode: string;
    fundName: string;
    classification: string | null;
    plan: string;
    option: string;
    cohortKey: string;
    returns: Record<string, ReturnType<typeof shapeStats>>;
  }>,
  periods: PeriodKey[],
  level: FieldLevel
): string {
  const perPeriodCols =
    level === "compact"
      ? (["return", "rank", "peerCount"] as const)
      : level === "standard"
        ? (["return", "rank", "peerCount", "percentile", "quartile"] as const)
        : ([
            "return",
            "rank",
            "peerCount",
            "percentile",
            "quartile",
            "categoryAverage",
            "categoryMedian",
            "excessVsAverage",
            "excessVsMedian",
          ] as const);

  const header = [
    "schemecode",
    "fundName",
    "classification",
    "plan",
    "option",
    "cohortKey",
    ...periods.flatMap((p) => perPeriodCols.map((c) => `${p}_${c}`)),
  ];

  const lines = [header.map(csvCell).join(",")];
  for (const f of funds) {
    const row: unknown[] = [
      f.schemecode,
      f.fundName,
      f.classification,
      f.plan,
      f.option,
      f.cohortKey,
    ];
    for (const p of periods) {
      const cell = f.returns[p] as Record<string, unknown> | undefined;
      for (const c of perPeriodCols) row.push(cell ? cell[c] ?? null : null);
    }
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const p = url.searchParams;

  let snap: CategorySnapshot;
  try {
    snap = await loadSnapshot(request);
  } catch {
    return NextResponse.json(
      { error: "Returns & ranking snapshot is unavailable.", funds: [] },
      { status: 502, headers: CORS_HEADERS }
    );
  }

  // ---- parse + validate params ----------------------------------------------
  const levelParam = (p.get("fields") ?? "standard").toLowerCase();
  const level: FieldLevel = (FIELD_LEVELS as readonly string[]).includes(levelParam)
    ? (levelParam as FieldLevel)
    : "standard";

  const format = (p.get("format") ?? "json").toLowerCase() === "csv" ? "csv" : "json";

  const periodParam = p.get("period") ?? p.get("periods");
  let periods: PeriodKey[] = [...PERIODS];
  if (periodParam) {
    const wanted = periodParam
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s): s is PeriodKey => (PERIODS as readonly string[]).includes(s));
    // Preserve canonical order; ignore unknown tokens. Empty → all.
    if (wanted.length > 0) periods = PERIODS.filter((pk) => wanted.includes(pk));
  }

  const classification = p.get("classification")?.trim().toLowerCase() || null;
  const plan = p.get("plan")?.trim().toLowerCase() || null;
  const option = p.get("option")?.trim().toLowerCase() || null;
  const cohort = p.get("cohort")?.trim().toLowerCase() || null;
  const q = (p.get("q") ?? p.get("search") ?? "").trim().toLowerCase();

  // ---- filter ----------------------------------------------------------------
  const all = Array.isArray(snap.fundRanks) ? snap.fundRanks : [];
  const filtered = all.filter((f) => {
    if (classification && (f.classification ?? "").toLowerCase() !== classification) return false;
    if (plan && f.plan.toLowerCase() !== plan) return false;
    if (option && f.option.toLowerCase() !== option) return false;
    if (cohort && cohortKeyOf(f).toLowerCase() !== cohort) return false;
    if (q && !f.fundName.toLowerCase().includes(q)) return false;
    return true;
  });

  // ---- paginate --------------------------------------------------------------
  const total = filtered.length;
  const offset = Math.min(parseIntParam(p.get("offset"), 0), total);
  const limitRaw = p.get("limit");
  const limit =
    limitRaw === null ? total : Math.min(parseIntParam(limitRaw, total), MAX_LIMIT);
  const page = filtered.slice(offset, offset + limit);

  // ---- shape -----------------------------------------------------------------
  const funds = page.map((f) => {
    const returns: Record<string, ReturnType<typeof shapeStats>> = {};
    for (const pk of periods) returns[pk] = shapeStats(f.periodRanks[pk], level);
    return {
      schemecode: f.schemecode,
      fundName: f.fundName,
      classification: f.classification,
      plan: f.plan,
      option: f.option,
      cohortKey: cohortKeyOf(f),
      returns,
    };
  });

  if (format === "csv") {
    const csv = toCsv(funds, periods, level);
    const stamp = snap.asOfDate ?? "latest";
    return new Response(csv, {
      headers: {
        ...CORS_HEADERS,
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="returns-ranking-${stamp}.csv"`,
        "cache-control": CACHE_HEADER,
      },
    });
  }

  return NextResponse.json(
    {
      asOfDate: snap.asOfDate,
      generatedAt: snap.generatedAt,
      source: "AmfiBeas daily NAV snapshot (AMFI)",
      cohortKey: snap.cohortKey ?? "classification | plan | option",
      rankingBasis:
        "point-to-point return, ranked within cohort (classification | plan | option); 1M/3M/6M/1Y simple, 3Y/5Y/10Y CAGR",
      minPeerCount: snap.minPeerCount ?? null,
      periods,
      fields: level,
      total,
      count: funds.length,
      offset,
      limit: limit >= total ? null : limit,
      funds,
    },
    { headers: { ...CORS_HEADERS, "cache-control": CACHE_HEADER } }
  );
}
