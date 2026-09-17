import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import type { CsvColumn } from "@/lib/csv";
import { cn } from "@/lib/cn";
import {
  sipLongTerm,
  equityAumLongTerm,
  nfoCycleInsight,
  categoryStreaks,
  streakBreaks,
  topOwnershipMoves,
  sectorRotation,
  holdingsInsights,
  fmtINR,
  fmtPct1,
  fmtX,
  fmtBps,
  monthLong,
} from "@/data/insights";
import { fmtBps as fmtBpsFromPp } from "@/lib/units";
import { shortenCompany } from "@/lib/stock-name";
import { monthlyTrend } from "@/data/amfi-monthly";
import { cyclePhaseHistory } from "@/data/market-indices";
import {
  insightsPlus,
  TIER_LABEL,
  type CapTier,
  type LedgerQuadrant,
} from "@/data/insights-plus";

// Static: every insight is computed at build time from the bundled snapshots,
// so the Worker serves a prerendered page (no per-request CPU; Error 1102).
export const dynamic = "force-static";

export const metadata = {
  title: "Insights — AmfiBeas",
};

const TIERS: CapTier[] = ["large", "mid", "small"];

// ===========================================================================
//  Visual primitives — small, dependency-free SVG/CSS marks so the page reads
//  as charts, not tables. All colour comes from the dashboard's ink tokens
//  (positive / negative / muted / foreground), so it works in both themes.
// ===========================================================================

type Tone = "pos" | "neg" | "muted" | "accent" | "indigo";
const TONE_TEXT: Record<Tone, string> = {
  pos: "text-positive",
  neg: "text-negative",
  muted: "text-muted-foreground",
  accent: "text-foreground",
  indigo: "text-indigo-400",
};
const TONE_BAR: Record<Tone, string> = {
  pos: "bg-positive",
  neg: "bg-negative",
  muted: "bg-muted-foreground",
  accent: "bg-foreground",
  indigo: "bg-indigo-500",
};

// Unique-id counter for each sparkline's gradient (safe: this page is
// force-static, so it renders once at build time).
let sparkSeq = 0;

/** Tiny area+line sparkline. Pure SVG; colour rides `currentColor`.
 *  `className` overrides the default height so a hero chart can fill its tile
 *  while the compact tiles stay short. */
function Spark({
  values,
  tone = "pos",
  className,
}: {
  values: number[];
  tone?: Tone;
  className?: string;
}) {
  if (values.length < 2) return null;
  const w = 160;
  const h = 40;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((v - min) / span) * (h - 2 * pad);
    return [x, y] as const;
  });
  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h - pad} L${pts[0][0].toFixed(1)},${h - pad} Z`;
  const gid = `sparkgrad-${sparkSeq++}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn(className ?? "h-10 w-full", TONE_TEXT[tone])}
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity={0.35} />
          <stop offset="1" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Semicircular market-cycle gauge with a needle pointing at the current phase. */
const GAUGE_ZONES = [
  { label: "Base", color: "#3b82f6" },
  { label: "Recovery", color: "#f59e0b" },
  { label: "Expansion", color: "#22c55e" },
  { label: "Peak", color: "#ef4444" },
];
function Gauge({ phase }: { phase: string }) {
  const idx = GAUGE_ZONES.findIndex((z) => z.label.toLowerCase() === phase.toLowerCase());
  const centreAngle = idx >= 0 ? 180 - (idx * 45 + 22.5) : 90;
  const rad = (centreAngle * Math.PI) / 180;
  const nx = 100 + 58 * Math.cos(rad);
  const ny = 100 - 58 * Math.sin(rad);
  const arcs = [
    "M20,100 A80,80 0 0 1 43.4,43.4",
    "M45.4,41.6 A80,80 0 0 1 100,20",
    "M100,20 A80,80 0 0 1 154.6,41.6",
    "M156.6,43.4 A80,80 0 0 1 180,100",
  ];
  return (
    <svg viewBox="0 0 200 116" className="w-full max-w-[210px] text-foreground" aria-hidden>
      {arcs.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={GAUGE_ZONES[i].color} strokeWidth={13}
          strokeLinecap="round" opacity={idx === i ? 1 : 0.4} />
      ))}
      <line x1="100" y1="100" x2={nx.toFixed(1)} y2={ny.toFixed(1)} stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" />
      <circle cx="100" cy="100" r="5.5" fill="currentColor" />
    </svg>
  );
}

/** SVG donut for a small composition (e.g. the conviction split). */
function Donut({
  segments,
  centerTop,
  centerBottom,
}: {
  segments: { value: number; color: string }[];
  centerTop: string;
  centerBottom: string;
}) {
  const total = segments.reduce((s, x) => s + Math.abs(x.value), 0) || 1;
  const r = 40;
  const circ = 2 * Math.PI * r;
  const dashes = segments.map((s) => (Math.abs(s.value) / total) * circ);
  const offsets = dashes.map((_, i) => dashes.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <svg viewBox="0 0 120 120" className="h-[132px] w-[132px] shrink-0 text-foreground" aria-hidden>
      <g transform="rotate(-90 60 60)" fill="none" strokeWidth={16}>
        {segments.map((s, i) => (
          <circle
            key={i}
            cx="60"
            cy="60"
            r={r}
            stroke={s.color}
            strokeDasharray={`${dashes[i].toFixed(2)} ${(circ - dashes[i]).toFixed(2)}`}
            strokeDashoffset={`${(-offsets[i]).toFixed(2)}`}
          />
        ))}
      </g>
      <text x="60" y="57" textAnchor="middle" fill="currentColor" fontSize="14" fontWeight="700">{centerTop}</text>
      <text x="60" y="72" textAnchor="middle" fill="currentColor" fillOpacity="0.6" fontSize="9">{centerBottom}</text>
    </svg>
  );
}

/** Big-number tile: a kicker, a headline value, an optional delta pill and an
 *  optional sparkline underneath. The glanceable unit of the hero strip. */
function KpiTile({
  kicker,
  value,
  delta,
  deltaTone,
  spark,
  sparkTone,
  footnote,
  wash,
}: {
  kicker: string;
  value: React.ReactNode;
  delta?: string;
  deltaTone?: Tone;
  spark?: number[];
  sparkTone?: Tone;
  footnote?: string;
  /** Colour-washed corner glow: "pos" = green, "neg" = red. */
  wash?: "pos" | "neg";
}) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-lg border bg-card px-4 py-3.5 shadow-sm">
      {wash && (
        <>
          {/* Broad colour wash across the tile + a brighter focused bloom in the
              corner, so the green / red reads as vividly as the design mock. */}
          <div
            className={cn(
              "pointer-events-none absolute inset-0",
              wash === "pos"
                ? "bg-gradient-to-tl from-green-500/45 via-green-500/10 to-transparent"
                : "bg-gradient-to-tl from-red-500/45 via-red-500/10 to-transparent"
            )}
            aria-hidden
          />
          <div
            className={cn(
              "pointer-events-none absolute -bottom-14 -right-10 h-52 w-80 rounded-full opacity-70 blur-[55px]",
              wash === "pos" ? "bg-green-500" : "bg-red-500"
            )}
            aria-hidden
          />
        </>
      )}
      <div className="relative flex flex-1 flex-col">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {kicker}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span
            className={cn(
              "text-[22px] font-semibold leading-none tabular tracking-tight",
              wash === "neg" && "text-negative"
            )}
          >
            {value}
          </span>
          {delta && (
            <span className={cn("text-xs font-medium tabular", TONE_TEXT[deltaTone ?? "pos"])}>
              {delta}
            </span>
          )}
        </div>
        {spark && spark.length > 1 && (
          <div className="mt-2">
            <Spark values={spark} tone={sparkTone ?? "pos"} />
          </div>
        )}
        {footnote && (
          <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            {footnote}
          </div>
        )}
      </div>
    </div>
  );
}

interface BarItem {
  label: React.ReactNode;
  value: number;
  valueLabel: string;
  sub?: React.ReactNode;
  highlight?: boolean;
}

/** Ranked horizontal magnitude bars (all one direction). For "who's biggest"
 *  rankings — streaks, turnover, cumulative flow. */
function RankBars({
  items,
  tone = "accent",
  labelWidth = "10rem",
}: {
  items: BarItem[];
  tone?: Tone;
  labelWidth?: string;
}) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <div className="space-y-1.5">
      {items.map((it, idx) => (
        <div key={idx} className="flex items-center gap-3">
          <div
            className="shrink-0 truncate text-xs"
            style={{ width: labelWidth }}
            title={typeof it.label === "string" ? it.label : undefined}
          >
            <span className={cn(it.highlight && "font-semibold")}>{it.label}</span>
            {it.sub && (
              <span className="ml-1.5 text-[10px] text-muted-foreground">{it.sub}</span>
            )}
          </div>
          <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted/40">
            <div
              className={cn("absolute inset-y-0 left-0 rounded", TONE_BAR[tone], "opacity-80")}
              style={{ width: `${(Math.abs(it.value) / max) * 100}%` }}
            />
          </div>
          <div className="w-20 shrink-0 text-right text-xs font-medium tabular">
            {it.valueLabel}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Diverging bars around a centre baseline. Positive grows right (green),
 *  negative grows left (red). For polarity — share shifts, sector rotation,
 *  ownership moves. */
function DivergingBars({
  items,
  labelWidth = "9rem",
}: {
  items: BarItem[];
  labelWidth?: string;
}) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <div className="space-y-1.5">
      {items.map((it, idx) => {
        const pos = it.value >= 0;
        const pctW = (Math.abs(it.value) / max) * 50;
        return (
          <div key={idx} className="flex items-center gap-3">
            <div
              className="shrink-0 truncate text-xs"
              style={{ width: labelWidth }}
              title={typeof it.label === "string" ? it.label : undefined}
            >
              <span className={cn(it.highlight && "font-semibold")}>{it.label}</span>
              {it.sub && (
                <span className="ml-1.5 text-[10px] text-muted-foreground">{it.sub}</span>
              )}
            </div>
            <div className="relative h-5 flex-1">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
              <div
                className={cn(
                  "absolute inset-y-0 shadow-sm",
                  pos
                    ? "left-1/2 rounded-r bg-gradient-to-r from-emerald-600 to-emerald-400"
                    : "right-1/2 rounded-l bg-gradient-to-l from-rose-600 to-rose-400"
                )}
                style={{ width: `${pctW}%` }}
              />
            </div>
            <div
              className={cn(
                "w-20 shrink-0 text-right text-xs font-medium tabular",
                pos ? "text-positive" : "text-negative"
              )}
            >
              {it.valueLabel}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Three-segment Large/Mid/Small split bar for the conviction ledger. */
function TierSplitBar({ byTier, tone }: { byTier: LedgerQuadrant["byTier"]; tone: "buy" | "sell" }) {
  const total = TIERS.reduce((s, t) => s + Math.abs(byTier[t].valueCr), 0) || 1;
  const shades =
    tone === "buy"
      ? ["bg-positive", "bg-positive/70", "bg-positive/40"]
      : ["bg-negative", "bg-negative/70", "bg-negative/40"];
  return (
    <div className="mt-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/40">
        {TIERS.map((t, i) => {
          const w = (Math.abs(byTier[t].valueCr) / total) * 100;
          return w > 0 ? (
            <div key={t} className={shades[i]} style={{ width: `${w}%` }} title={`${TIER_LABEL[t]}: ₹${fmtINR(byTier[t].valueCr)} Cr`} />
          ) : null;
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        {TIERS.map((t) => (
          <span key={t}>
            {TIER_LABEL[t].replace("-cap", "")} {Math.round((Math.abs(byTier[t].valueCr) / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

/** A conviction-ledger quadrant as a card: big ₹, breadth, tier split, names. */
function LedgerCard({
  label,
  blurb,
  quad,
  tone,
}: {
  label: string;
  blurb: string;
  quad: LedgerQuadrant;
  tone: "buy" | "sell";
}) {
  const toneCls = tone === "buy" ? "text-positive" : "text-negative";
  const sign = tone === "buy" ? "+" : "−";
  return (
    <div className="rounded-lg border bg-card px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold tracking-tight">{label}</span>
        <span className={cn("shrink-0 text-[16px] font-semibold tabular", toneCls)}>
          {sign}₹{fmtINR(quad.totalCr)} Cr
        </span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{blurb}</p>
      <p className="mt-1.5 text-[12px]">
        <span className="font-semibold tabular">{quad.companies}</span>{" "}
        <span className="text-muted-foreground">companies ·</span>{" "}
        <span className="font-semibold tabular">{quad.positions}</span>{" "}
        <span className="text-muted-foreground">positions</span>
      </p>
      <TierSplitBar byTier={quad.byTier} tone={tone} />
      {quad.top.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t pt-2">
          {quad.top.slice(0, 3).map((n) => (
            <li key={n.company} className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className="truncate">{shortenCompany(n.company)}</span>
              <span className={cn("shrink-0 tabular", toneCls)}>₹{fmtINR(n.valueCr)} Cr</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function InsightsPage() {
  const sip = sipLongTerm();
  const eqAum = equityAumLongTerm();
  const nfo = nfoCycleInsight();
  const streaks = categoryStreaks(3);
  const breaks = streakBreaks(4);
  const moves = topOwnershipMoves(8);
  const rotation = sectorRotation();
  const { uniques, amcShare, meta } = holdingsInsights;

  // Series for the hero sparklines (full history, tail for the mark).
  const sipSeries = monthlyTrend("sipContribution", 10_000).filter((p) => p.value > 0);
  const aumSeries = monthlyTrend("equityAum", 10_000).filter((p) => p.value > 0);
  const cycle = cyclePhaseHistory();
  const currentPhase = cycle[cycle.length - 1]?.phase ?? "—";

  const streak24 = streaks.filter((s) => s.streakMonths >= 24).length;

  const { convictionLedger: ledger, contested, churn, flowsVsPerf, persistence } =
    insightsPlus;
  const q = ledger.quadrants;

  // ---- share-shift movers (one diverging chart, gainers + losers) ----------
  const shareMovers = [...amcShare.rows]
    .filter((r) => typeof r.momBps === "number")
    .sort((a, b) => (b.momBps ?? 0) - (a.momBps ?? 0));
  const shareTop = shareMovers.slice(0, 5);
  const shareBottom = shareMovers.slice(-5).reverse();
  const shareDiverging = [...shareTop, ...shareBottom.filter((r) => !shareTop.includes(r))];

  // ============ Excel exports (unchanged column/row contracts) =============
  type StreakX = Record<string, string | number>;
  const streakColumns: CsvColumn<StreakX>[] = [
    { key: "category", header: "Category" },
    { key: "streak", header: "Consecutive positive months" },
    { key: "cumulative", header: "Cumulative net inflow (₹ Cr)" },
    { key: "latest", header: "Latest month inflow (₹ Cr)" },
  ];
  const streakRows: StreakX[] = streaks.map((s) => ({
    category: s.category,
    streak: s.cappedByHistory ? `${s.streakMonths}+` : s.streakMonths,
    cumulative: Math.round(s.cumulativeCr),
    latest: Math.round(s.latestInflowCr),
  }));

  type ShareX = Record<string, string | number>;
  const shareColumns: CsvColumn<ShareX>[] = [
    { key: "amc", header: "Fund house" },
    { key: "share", header: "Share of tracked equity book (%)" },
    { key: "mom", header: "MoM (bps)" },
    { key: "book", header: "Equity book (₹ Cr)" },
  ];
  const shareRows: ShareX[] = amcShare.rows.map((r) => ({
    amc: r.amc,
    share: Number(r.latestSharePct.toFixed(1)),
    mom: r.momBps ?? "",
    book: r.latestBookCr,
  }));

  type UniqueX = Record<string, string | number>;
  const uniqueColumns: CsvColumn<UniqueX>[] = [
    { key: "company", header: "Company" },
    { key: "fundHouse", header: "Only holder" },
    { key: "valueCr", header: "Position (₹ Cr)" },
    { key: "newThisMonth", header: "New this month" },
  ];
  const uniqueRows: UniqueX[] = uniques.rows.map((u) => ({
    company: u.company,
    fundHouse: u.fundHouse,
    valueCr: u.valueCr,
    newThisMonth: u.newThisMonth ? "Yes" : "No",
  }));

  type LedgerX = Record<string, string | number>;
  const ledgerColumns: CsvColumn<LedgerX>[] = [
    { key: "action", header: "Action" },
    { key: "tier", header: "Cap tier" },
    { key: "valueCr", header: "Value (₹ Cr)" },
    { key: "companies", header: "Companies" },
    { key: "positions", header: "Fund-house positions" },
  ];
  const LEDGER_ACTIONS: { key: keyof typeof q; label: string }[] = [
    { key: "new", label: "New position" },
    { key: "increased", label: "Added to" },
    { key: "decreased", label: "Trimmed" },
    { key: "exited", label: "Exited fully" },
  ];
  const ledgerRows: LedgerX[] = LEDGER_ACTIONS.flatMap((a) => [
    {
      action: a.label,
      tier: "All",
      valueCr: q[a.key].totalCr,
      companies: q[a.key].companies,
      positions: q[a.key].positions,
    },
    ...TIERS.map((t) => ({
      action: a.label,
      tier: TIER_LABEL[t],
      valueCr: q[a.key].byTier[t].valueCr,
      companies: q[a.key].byTier[t].companies,
      positions: q[a.key].byTier[t].positions,
    })),
  ]);

  type ContestedX = Record<string, string | number>;
  const contestedColumns: CsvColumn<ContestedX>[] = [
    { key: "company", header: "Company" },
    { key: "tier", header: "Cap tier" },
    { key: "buyers", header: "Fund houses buying" },
    { key: "sellers", header: "Fund houses selling" },
    { key: "buyCr", header: "Bought (₹ Cr)" },
    { key: "sellCr", header: "Sold (₹ Cr)" },
    { key: "netCr", header: "Net (₹ Cr, + bought)" },
    { key: "topBuyer", header: "Largest buyer" },
    { key: "topSeller", header: "Largest seller" },
  ];
  const contestedXRows: ContestedX[] = contested.rows.map((r) => ({
    company: r.company,
    tier: TIER_LABEL[r.tier],
    buyers: r.buyers,
    sellers: r.sellers,
    buyCr: r.buyCr,
    sellCr: r.sellCr,
    netCr: r.netCr,
    topBuyer: r.topBuyer,
    topSeller: r.topSeller,
  }));

  type ChurnX = Record<string, string | number>;
  const churnColumns: CsvColumn<ChurnX>[] = [
    { key: "amc", header: "Fund house" },
    { key: "turnoverPct", header: "Monthly turnover (%)" },
    { key: "buyCr", header: "Bought (₹ Cr)" },
    { key: "sellCr", header: "Sold (₹ Cr)" },
    { key: "bookCr", header: "Equity book (₹ Cr)" },
    { key: "holdings", header: "Holdings" },
    { key: "schemes", header: "Schemes" },
  ];
  const churnXRows: ChurnX[] = churn.rows.map((r) => ({
    amc: r.amc,
    turnoverPct: r.turnoverPct,
    buyCr: r.buyCr,
    sellCr: r.sellCr,
    bookCr: r.bookCr,
    holdings: r.holdings,
    schemes: r.schemes,
  }));
  const churnTop = churn.rows.slice(0, 8);

  const FLOW_QUADRANTS: {
    key: keyof typeof flowsVsPerf.quadrants;
    label: string;
    blurb: string;
    tone: "good" | "bad" | "warn" | "neutral";
  }[] = [
    { key: "undiscovered", label: "Undiscovered", blurb: "Top-half returns the money hasn't found yet.", tone: "neutral" },
    { key: "winning", label: "Winning on merit", blurb: "Top-half returns, gathering faster than the median fund.", tone: "good" },
    { key: "falling", label: "Falling behind", blurb: "Bottom-half returns and gathering slower than the median.", tone: "bad" },
    { key: "coasting", label: "Coasting on brand", blurb: "Bottom-half returns, yet still gathering faster than median.", tone: "warn" },
  ];
  type FlowX = Record<string, string | number>;
  const flowColumns: CsvColumn<FlowX>[] = [
    { key: "quadrant", header: "Quadrant" },
    { key: "fund", header: "Scheme" },
    { key: "amc", header: "Fund house" },
    { key: "classification", header: "Category" },
    { key: "percentile", header: `${flowsVsPerf.period} percentile in category` },
    { key: "perfReturn", header: `${flowsVsPerf.period} return (%)` },
    { key: "bookGrowthPct", header: "Book growth (%)" },
    { key: "navReturnPct", header: "NAV return (%)" },
    { key: "impliedFlowPct", header: "Implied net flow (%)" },
    { key: "bookCr", header: "Book (₹ Cr)" },
  ];
  const flowXRows: FlowX[] = FLOW_QUADRANTS.flatMap((qd) =>
    flowsVsPerf.quadrants[qd.key].rows.map((r) => ({
      quadrant: qd.label,
      fund: r.fund,
      amc: r.amc,
      classification: r.classification,
      percentile: r.percentile,
      perfReturn: r.perfReturn ?? "",
      bookGrowthPct: r.bookGrowthPct,
      navReturnPct: r.navReturnPct,
      impliedFlowPct: r.impliedFlowPct,
      bookCr: r.bookCr,
    }))
  );

  type PersistX = Record<string, string | number>;
  const persistColumns: CsvColumn<PersistX>[] = [
    { key: "prior", header: "Quartile in prior 3 years" },
    { key: "q1", header: "→ Q1 now" },
    { key: "q2", header: "→ Q2 now" },
    { key: "q3", header: "→ Q3 now" },
    { key: "q4", header: "→ Q4 now" },
    { key: "total", header: "Funds" },
  ];
  const persistXRows: PersistX[] = persistence.matrix.map((row, i) => ({
    prior: `Q${i + 1}`,
    q1: row[0],
    q2: row[1],
    q3: row[2],
    q4: row[3],
    total: persistence.rowTotals[i],
  }));

  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const isoMonth = (iso: string) => {
    const d = new Date(iso + "T00:00:00Z");
    return `${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Insights"
        subtitle="The signals read out of every dataset on this dashboard — each one leads with the picture, then the detail."
      />

      {/* ============ Bento hero =========================================== */}
      <section className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-2">
          {/* Insight of the month — SIP */}
          {sip && (
            <div className="relative flex flex-col overflow-hidden rounded-xl border bg-card p-5">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-500/15 via-transparent to-transparent" />
              <div className="relative flex flex-1 flex-col">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  ◆ Insight of the month
                </div>
                <p className="mt-2 text-[22px] font-bold leading-tight tracking-tight sm:text-[25px]">
                  Monthly SIP has{" "}
                  <span className="text-positive">doubled to ₹{fmtINR(sip.latestValue)} Cr</span>
                </p>
                <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">
                  The structural bid under Indian equities — {fmtX(sip.multiple)} in 10 years,
                  doubled in the last {sip.doubledInMonths ?? "—"} months.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full border border-positive/30 bg-positive/15 px-2.5 py-0.5 text-[11px] font-semibold text-positive">
                    ▲ {fmtX(sip.multiple)} · {sip.doubledInMonths ?? "—"} mo
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {monthLong(sip.firstMonth)} → {monthLong(sip.latestMonth)}
                  </span>
                </div>
                <div className="mt-3 min-h-[68px] flex-1">
                  <Spark
                    values={sipSeries.map((p) => p.value)}
                    tone="indigo"
                    className="h-full w-full"
                  />
                </div>
              </div>
            </div>
          )}
          {/* Market-cycle gauge */}
          <div className="relative flex flex-col rounded-xl border bg-card p-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Market-cycle phase
            </div>
            <div className="flex flex-1 flex-col items-center justify-center py-2">
              <Gauge phase={currentPhase} />
              <div className="mt-1 text-[22px] font-bold tracking-tight text-amber-500">{currentPhase}</div>
              <div className="mt-1 text-center text-[11px] text-muted-foreground">
                {nfo
                  ? `NFO mobilisation runs ${fmtX(nfo.multiple)} hotter in bull phases`
                  : "Active-equity flow z-score + Nifty 500 drawdown"}
              </div>
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {eqAum && (
            <KpiTile
              kicker="Industry equity AUM"
              value={`₹${fmtINR(eqAum.latestValue)} Cr`}
              delta={`${fmtX(eqAum.multiple)} in 7y`}
              spark={aumSeries.slice(-36).map((p) => p.value)}
              sparkTone="pos"
              wash="pos"
              footnote={`Doubled in ${eqAum.doubledInMonths ?? "—"} months on flows + markets compounding together.`}
            />
          )}
          <KpiTile
            kicker="Past performance persists?"
            value={`${persistence.q1StayPct}%`}
            wash="neg"
            footnote={`of past top-quartile funds stayed top-quartile (pure chance = 25%). ${streak24} active-equity categories are on 24+ month inflow streaks.`}
          />
        </div>
      </section>

      {/* ============ 1. Structural bid (SIP + AUM, full history) ========== */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium tracking-tight"><span className="h-2 w-2 shrink-0 rounded-sm bg-indigo-500" aria-hidden />The structural bid</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {sip && (
            <Card title="Monthly SIP contribution — full decade">
              <Spark values={sipSeries.map((p) => p.value)} tone="pos" />
              <p className="mt-3 text-[13px] leading-snug text-muted-foreground">
                ₹{fmtINR(sip.firstValue)} Cr in {monthLong(sip.firstMonth)} →{" "}
                <span className="font-medium text-foreground">₹{fmtINR(sip.latestValue)} Cr</span>{" "}
                in {monthLong(sip.latestMonth)} — up{" "}
                <span className="font-medium text-positive">{fmtX(sip.multiple)}</span>, and doubled in
                just the last {sip.doubledInMonths ?? "—"} months. Market-cycle-resistant.
              </p>
              <p className="mt-2 text-[10px] text-muted-foreground/70">Source: AMFI SIP contribution series since 2016.</p>
            </Card>
          )}
          {eqAum && (
            <Card title="Industry equity AUM — 7-year arc">
              <Spark values={aumSeries.map((p) => p.value)} tone="pos" />
              <p className="mt-3 text-[13px] leading-snug text-muted-foreground">
                ₹{fmtINR(eqAum.firstValue)} Cr → <span className="font-medium text-foreground">₹{fmtINR(eqAum.latestValue)} Cr</span>,{" "}
                <span className="font-medium text-positive">{fmtX(eqAum.multiple)}</span> in 7 years and
                doubled in {eqAum.doubledInMonths ?? "—"} months. Flows and markets compounding — the
                Quarterly page splits the two.
              </p>
              <p className="mt-2 text-[10px] text-muted-foreground/70">Source: AMFI equity AUM series since 2019.</p>
            </Card>
          )}
        </div>
      </section>

      {/* ============ 2. NFO × cycle ======================================= */}
      {nfo && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-medium tracking-tight"><span className="h-2 w-2 shrink-0 rounded-sm bg-indigo-500" aria-hidden />New funds chase the cycle</h2>
          <Card title={`Average monthly NFO mobilisation by market phase (${monthLong(nfo.firstMonth)} → ${monthLong(nfo.lastMonth)})`}>
            <RankBars
              tone="accent"
              labelWidth="12rem"
              items={[
                { label: "Bull phases (Expansion / Peak)", value: nfo.bullAvg, valueLabel: `₹${fmtINR(nfo.bullAvg)} Cr`, sub: `${nfo.bullMonths} mo`, highlight: true },
                { label: "Stress phases (Correction / Base)", value: nfo.stressAvg, valueLabel: `₹${fmtINR(nfo.stressAvg)} Cr`, sub: `${nfo.stressMonths} mo` },
                { label: "Last 3 months", value: nfo.latest3mAvg, valueLabel: `₹${fmtINR(nfo.latest3mAvg)} Cr` },
              ]}
            />
            <p className="mt-3 text-[13px] leading-snug text-muted-foreground">
              AMCs launch when sentiment pays: NFOs run{" "}
              <span className="font-medium text-positive">{fmtX(nfo.multiple)} hotter</span> in bull
              phases. A burst is a late-cycle tell, a drought marks washed-out sentiment. The last 3
              months averaged{" "}
              <span className={nfo.latest3mAvg < nfo.stressAvg ? "font-medium text-negative" : "font-medium text-positive"}>
                ₹{fmtINR(nfo.latest3mAvg)} Cr
              </span>{" "}
              while the cycle model reads &ldquo;{nfo.latestPhase}&rdquo;.
            </p>
          </Card>
        </section>
      )}

      {/* ============ 3. Flow streaks ===================================== */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium tracking-tight"><span className="h-2 w-2 shrink-0 rounded-sm bg-indigo-500" aria-hidden />Categories on unbroken inflow runs</h2>
        <Card
          title="Consecutive months of net inflow, by category"
          action={
            <DownloadXlsxButton rows={streakRows} columns={streakColumns} filename="category-flow-streaks.xlsx" sheetName="Flow Streaks" />
          }
        >
          <RankBars
            tone="pos"
            labelWidth="11rem"
            items={streaks.slice(0, 8).map((s) => ({
              label: s.category,
              value: s.streakMonths,
              valueLabel: `${s.streakMonths}${s.cappedByHistory ? "+" : ""} mo`,
              sub: `₹${fmtINR(s.cumulativeCr)} Cr`,
            }))}
          />
          <p className="mt-3 text-[13px] leading-snug text-muted-foreground">
            <span className="font-medium text-foreground">{streak24}</span> categories have taken in net
            money for <span className="font-medium text-foreground">24+ straight months</span> — the
            persistence pattern that historically precedes strong basket performance.
          </p>
          {breaks.length > 0 && (
            <p className="mt-2 text-[12px] text-negative">
              Streaks broken this month:{" "}
              {breaks.map((b) => `${b.category} (ended a ${b.priorStreakMonths}-mo run, ₹${fmtINR(b.latestInflowCr)} Cr)`).join("; ")}.
            </p>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground/70">
            &ldquo;24+&rdquo; means the run spans the full stored history. Source: AMFI category net inflows.
          </p>
        </Card>
      </section>

      {/* ============ 4. Fund-house share shifts ========================== */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium tracking-tight"><span className="h-2 w-2 shrink-0 rounded-sm bg-indigo-500" aria-hidden />Who is winning equity share this month</h2>
        <Card
          title={`Active-equity book share — month-over-month move (${amcShare.months[0] ?? ""})`}
          action={
            <DownloadXlsxButton rows={shareRows} columns={shareColumns} filename="fund-house-share-shifts.xlsx" sheetName="Share Shifts" />
          }
        >
          <DivergingBars
            labelWidth="10rem"
            items={shareDiverging.map((r) => ({
              label: r.amc,
              value: r.momBps ?? 0,
              valueLabel: fmtBps(r.momBps ?? 0),
              sub: fmtPct1(r.latestSharePct),
            }))}
          />
          <p className="mt-3 text-[10px] text-muted-foreground/70">
            Share of the tracked equity-holdings universe ({meta.universeSchemes} schemes rolled up by
            fund house), {amcShare.months[1] ?? ""} → {amcShare.months[0] ?? ""}. Bars show the MoM change
            in bps; the small number is current share. Source: aggregated scheme holdings.
          </p>
        </Card>
      </section>

      {/* ============ 5. Conviction ledger ================================ */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium tracking-tight"><span className="h-2 w-2 shrink-0 rounded-sm bg-indigo-500" aria-hidden />Conviction ledger</h2>
        <Card
          title={`Every position change, split four ways (${ledger.monthCur})`}
          action={
            <DownloadXlsxButton rows={ledgerRows} columns={ledgerColumns} filename="conviction-ledger.xlsx" sheetName="Conviction Ledger" />
          }
        >
          <p className="mb-3 text-[13px] leading-snug text-muted-foreground">
            Opening a brand-new position and exiting one completely are decisions; topping up is
            housekeeping. Across{" "}
            <span className="font-medium text-foreground">{ledger.funds}</span> schemes from{" "}
            <span className="font-medium text-foreground">{ledger.amcs}</span> fund houses, MFs opened{" "}
            <span className="text-positive">{q.new.companies}</span> new names (₹{fmtINR(q.new.totalCr)} Cr)
            and walked away from <span className="text-negative">{q.exited.companies}</span> (₹{fmtINR(q.exited.totalCr)} Cr).
          </p>
          <div className="mb-4 flex flex-wrap items-center gap-6 rounded-lg border bg-muted/20 px-4 py-3">
            <Donut
              segments={[
                { value: q.new.totalCr, color: "#22c55e" },
                { value: q.increased.totalCr, color: "#4d7c4f" },
                { value: q.decreased.totalCr, color: "#f59e0b" },
                { value: q.exited.totalCr, color: "#ef4444" },
              ]}
              centerTop={`₹${fmtINR(q.new.totalCr + q.increased.totalCr + q.decreased.totalCr + q.exited.totalCr)}`}
              centerBottom="Cr moved"
            />
            <div className="grid flex-1 grid-cols-1 gap-x-8 gap-y-2 text-[12px] sm:grid-cols-2">
              {[
                ["New positions", q.new.totalCr, "#22c55e"] as const,
                ["Added to", q.increased.totalCr, "#4d7c4f"] as const,
                ["Trimmed", q.decreased.totalCr, "#f59e0b"] as const,
                ["Exited fully", q.exited.totalCr, "#ef4444"] as const,
              ].map(([label, val, color]) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
                  <span className="text-muted-foreground">{label}</span>
                  <span className="ml-auto font-semibold tabular">₹{fmtINR(val)} Cr</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <LedgerCard label="New positions" blurb="Nothing held last month — a fresh idea." quad={q.new} tone="buy" />
            <LedgerCard label="Added to" blurb="Existing holding increased." quad={q.increased} tone="buy" />
            <LedgerCard label="Trimmed" blurb="Reduced, not closed." quad={q.decreased} tone="sell" />
            <LedgerCard label="Exited fully" blurb="Closed to zero — a verdict." quad={q.exited} tone="sell" />
          </div>
          <p className="mt-3 text-[10px] leading-snug text-muted-foreground/70">
            One position = one fund house in one stock. Value = shares moved × the month&rsquo;s implied
            trade price; positions under ₹1 Cr ignored. {ledger.monthPrev} → {ledger.monthCur}. Source: AMC monthly disclosures.
          </p>
        </Card>
      </section>

      {/* ============ 6. Contested stocks ================================= */}
      {contested.rows.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-medium tracking-tight"><span className="h-2 w-2 shrink-0 rounded-sm bg-indigo-500" aria-hidden />Where fund houses disagree</h2>
          <Card
            title={`Most contested stocks — bought and sold in the same month (${contested.month})`}
            action={
              <DownloadXlsxButton rows={contestedXRows} columns={contestedColumns} filename="contested-stocks.xlsx" sheetName="Contested Stocks" />
            }
          >
            <p className="mb-3 text-[13px] leading-snug text-muted-foreground">
              Names where professional managers read the same disclosure and reached opposite
              conclusions. Each bar splits the gross ₹ traded into buying (green) vs selling (red).
            </p>
            <div className="space-y-2.5">
              {contested.rows.map((r) => {
                const gross = r.buyCr + r.sellCr || 1;
                return (
                  <div key={r.company} className="flex items-center gap-3">
                    <div className="w-40 shrink-0 truncate text-xs" title={r.company}>
                      <span className="font-medium">{shortenCompany(r.company)}</span>
                      <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                        {TIER_LABEL[r.tier]}
                      </span>
                    </div>
                    <div className="flex h-5 flex-1 overflow-hidden rounded bg-muted/40">
                      <div className="flex items-center justify-end bg-positive/80 pr-1 text-[9px] font-medium text-background" style={{ width: `${(r.buyCr / gross) * 100}%` }} title={`${r.buyers} buying · ₹${fmtINR(r.buyCr)} Cr`}>
                        {r.buyers}
                      </div>
                      <div className="flex items-center bg-negative/80 pl-1 text-[9px] font-medium text-background" style={{ width: `${(r.sellCr / gross) * 100}%` }} title={`${r.sellers} selling · ₹${fmtINR(r.sellCr)} Cr`}>
                        {r.sellers}
                      </div>
                    </div>
                    <div className="w-24 shrink-0 text-right text-[11px] text-muted-foreground">
                      <span className="text-positive">{r.topBuyer}</span> / <span className="text-negative">{r.topSeller}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground/70">
              Number in each bar = fund houses on that side. Requires ≥2 houses each way and ₹50 Cr of
              gross two-way activity. Source: AMC monthly disclosures.
            </p>
          </Card>
        </section>
      )}

      {/* ============ 7. Churn league ===================================== */}
      {churn.rows.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-medium tracking-tight"><span className="h-2 w-2 shrink-0 rounded-sm bg-indigo-500" aria-hidden />Who actually trades</h2>
          <Card
            title={`Monthly portfolio turnover by fund house (${churn.month})`}
            action={
              <DownloadXlsxButton rows={churnXRows} columns={churnColumns} filename="portfolio-churn.xlsx" sheetName="Portfolio Churn" />
            }
          >
            <RankBars
              tone="neg"
              labelWidth="11rem"
              items={churnTop.map((r) => ({
                label: r.amc,
                value: r.turnoverPct,
                valueLabel: `${r.turnoverPct.toFixed(1)}%`,
                sub: `₹${fmtINR(r.bookCr)} Cr`,
              }))}
            />
            <p className="mt-3 text-[13px] leading-snug text-muted-foreground">
              Nearly every house calls itself long-term. This is the measurable version — the share of
              the equity book genuinely rotated in a month. The median house turned over{" "}
              <span className="font-medium text-foreground">{churn.medianTurnoverPct}%</span>; the most
              active is <span className="font-medium text-foreground">{churn.rows[0].amc}</span> at{" "}
              <span className="text-negative">{churn.rows[0].turnoverPct.toFixed(1)}%</span>. A difference
              in philosophy, not market conditions.
            </p>
            <p className="mt-2 text-[10px] text-muted-foreground/70">
              Turnover = min(buys, sells) ÷ average equity book. Houses with a book under ₹{fmtINR(churn.minBookCr)} Cr excluded. Source: AMC monthly disclosures.
            </p>
          </Card>
        </section>
      )}

      {/* ============ 8. Unique conviction bets =========================== */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium tracking-tight"><span className="h-2 w-2 shrink-0 rounded-sm bg-indigo-500" aria-hidden />Solo conviction bets</h2>
        <Card
          title={`Stocks held by exactly one fund house (${meta.monthCur})`}
          action={
            <DownloadXlsxButton rows={uniqueRows} columns={uniqueColumns} filename="unique-holdings.xlsx" sheetName="Unique Holdings" />
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1">
            <span className="text-[26px] font-semibold leading-none tabular">{uniques.total}</span>
            <span className="text-[13px] text-muted-foreground">
              companies owned by a <span className="font-medium text-foreground">single fund house</span> —{" "}
              {uniques.newThisMonth} opened this month. The clearest statement of differentiated conviction.
            </span>
          </div>
          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-muted/60 text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Company</th>
                  <th className="px-3 py-2 text-left font-medium">Only holder</th>
                  <th className="px-3 py-2 text-right font-medium">Position (₹ Cr)</th>
                </tr>
              </thead>
              <tbody>
                {uniques.rows.map((u) => (
                  <tr key={u.company} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">
                      {shortenCompany(u.company)}
                      {u.newThisMonth && (
                        <span className="ml-2 rounded-full border border-positive/40 bg-positive/10 px-1.5 py-0 text-[10px] uppercase tracking-wide text-positive">
                          New
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">{u.fundHouse}</td>
                    <td className="px-3 py-2 text-right tabular">{u.valueCr.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[10px] text-muted-foreground/70">
            Positions ≥ ₹25 Cr only; &ldquo;New&rdquo; = no shares held in {meta.monthPrev}. Source: aggregated scheme holdings.
          </p>
        </Card>
      </section>

      {/* ============ 9. Sector rotation ================================== */}
      {rotation.rows.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-medium tracking-tight"><span className="h-2 w-2 shrink-0 rounded-sm bg-indigo-500" aria-hidden />Sector rotation</h2>
          <Card title={`Active-equity AUM-share shift by sector (${rotation.monthPrev} → ${rotation.month})`}>
            <DivergingBars
              labelWidth="10rem"
              items={rotation.rows.map((r) => ({
                label: r.sector,
                value: r.changePp,
                valueLabel: fmtBpsFromPp(r.changePp),
                sub: `${r.pctCur.toFixed(1)}%`,
              }))}
            />
            <p className="mt-3 text-[13px] leading-snug text-muted-foreground">
              Each sector&rsquo;s share of total active-equity MF holdings, latest vs prior month —
              size-normalised, so a big sector only surfaces when its share actually moves. The names
              driving each move:
            </p>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {rotation.rows.map((r) => {
                const up = r.direction === "up";
                return (
                  <div key={r.sector} className="rounded-md border bg-card p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium">{r.sector}</span>
                      <span className={cn("text-xs font-medium tabular", up ? "text-positive" : "text-negative")}>
                        {fmtBpsFromPp(r.changePp)}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-0.5">
                      {r.stocks.length === 0 ? (
                        <li className="text-[11px] text-muted-foreground">
                          Share moved on price; no notable net {up ? "buys" : "sells"}.
                        </li>
                      ) : (
                        r.stocks.slice(0, 3).map((s) => (
                          <li key={s.company} className="flex items-baseline justify-between gap-2 text-[11px]">
                            <span className="truncate">{shortenCompany(s.company)}</span>
                            <span className={cn("shrink-0 tabular", up ? "text-positive" : "text-negative")}>
                              ₹{fmtINR(s.netCr)} Cr
                            </span>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground/70">
              Source: aggregated active-equity scheme holdings, {rotation.monthPrev} → {rotation.month}; sector map (Capitaline / RupeeVest taxonomy).
            </p>
          </Card>
        </section>
      )}

      {/* ============ 10. Ownership moves ================================= */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium tracking-tight"><span className="h-2 w-2 shrink-0 rounded-sm bg-indigo-500" aria-hidden />Biggest ownership moves</h2>
        <Card title={`MF stake changes as % of shares outstanding (${moves.month})`}>
          <DivergingBars
            labelWidth="11rem"
            items={moves.rows.map((r) => ({
              label: shortenCompany(r.company),
              value: r.pctOutstanding,
              valueLabel: fmtPct1(r.pctOutstanding),
              sub: r.sector,
            }))}
          />
          <p className="mt-3 text-[10px] text-muted-foreground/70">
            Ranked by the absolute share of the company traded, not ₹ value — immune to price-move
            distortion. Source: aggregated scheme holdings; shares outstanding from screener.in.
          </p>
        </Card>
      </section>

      {/* ============ 11. Flows vs performance (quadrant map) ============= */}
      {flowsVsPerf.universe > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-medium tracking-tight"><span className="h-2 w-2 shrink-0 rounded-sm bg-indigo-500" aria-hidden />Does money reward performance?</h2>
          <Card
            title={`${flowsVsPerf.period} performance vs asset gathering (${flowsVsPerf.windowLabel})`}
            action={
              <DownloadXlsxButton rows={flowXRows} columns={flowColumns} filename="flows-vs-performance.xlsx" sheetName="Flows vs Performance" />
            }
          >
            <p className="mb-3 text-[13px] leading-snug text-muted-foreground">
              Each scheme placed by its {flowsVsPerf.period} rank inside its category (→ better) against how
              fast it gathered assets (↑ faster than median).{" "}
              <span className="font-medium text-foreground">{flowsVsPerf.quadrants.coasting.count}</span> of{" "}
              {flowsVsPerf.universe} sit bottom-half on returns yet <em>still</em> grow faster than the median fund.
            </p>
            <div className="flex items-stretch gap-2">
              <div className="flex w-4 items-center justify-center">
                <span className="-rotate-90 whitespace-nowrap text-[10px] uppercase tracking-wide text-muted-foreground">
                  Gathering assets →
                </span>
              </div>
              <div className="grid flex-1 grid-cols-2 gap-2">
                {FLOW_QUADRANTS.map((qd) => {
                  const bucket = flowsVsPerf.quadrants[qd.key];
                  const border =
                    qd.tone === "good" ? "border-positive/40"
                    : qd.tone === "bad" ? "border-negative/40"
                    : qd.tone === "warn" ? "border-amber-500/40"
                    : "border-border";
                  const dot =
                    qd.tone === "good" ? "bg-positive"
                    : qd.tone === "bad" ? "bg-negative"
                    : qd.tone === "warn" ? "bg-amber-500"
                    : "bg-muted-foreground";
                  return (
                    <div key={qd.key} className={cn("rounded-lg border bg-card px-4 py-3.5", border)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold tracking-tight">
                          <span className={cn("h-2 w-2 rounded-full", dot)} />
                          {qd.label}
                        </span>
                        <span className="text-[18px] font-semibold tabular">{bucket.count}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{qd.blurb}</p>
                      {bucket.rows.length > 0 && (
                        <ul className="mt-2 space-y-0.5 border-t pt-2">
                          {bucket.rows.slice(0, 3).map((r) => (
                            <li key={r.fund} className="flex items-baseline justify-between gap-2 text-[11px]">
                              <span className="truncate">{r.fund}</span>
                              <span className={cn("shrink-0 tabular", r.impliedFlowPct >= flowsVsPerf.medianFlowPct ? "text-positive" : "text-negative")}>
                                {r.impliedFlowPct > 0 ? "+" : ""}{r.impliedFlowPct.toFixed(1)}%
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-1 pl-6 text-center text-[10px] uppercase tracking-wide text-muted-foreground">
              Better {flowsVsPerf.period} performance →
            </div>
            <p className="mt-3 text-[10px] leading-snug text-muted-foreground/70">
              Percentile = the scheme&rsquo;s {flowsVsPerf.period} return rank within its category (100 = best).
              Implied net flow = book growth less the fund&rsquo;s own NAV return, compared against the median
              fund ({flowsVsPerf.medianFlowPct > 0 ? "+" : ""}{flowsVsPerf.medianFlowPct}%). Source: AMC disclosures + AMFI NAV history.
            </p>
          </Card>
        </section>
      )}

      {/* ============ 12. Quartile persistence (heatmap) ================= */}
      {persistence.funds > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-medium tracking-tight"><span className="h-2 w-2 shrink-0 rounded-sm bg-indigo-500" aria-hidden />Does past performance persist?</h2>
          <Card
            title="Where the winners went — quartile transitions across two 3-year blocks"
            action={
              <DownloadXlsxButton rows={persistXRows} columns={persistColumns} filename="quartile-persistence.xlsx" sheetName="Quartile Persistence" />
            }
          >
            <p className="mb-3 text-[13px] leading-snug text-muted-foreground">
              Of the funds that were <span className="font-medium text-foreground">top quartile</span> over{" "}
              {isoMonth(persistence.priorWindow.from)}–{isoMonth(persistence.priorWindow.to)}, only{" "}
              <span className="font-medium text-foreground">{persistence.q1StayPct}%</span> stayed top
              quartile — and <span className="text-negative">{persistence.q1ToBottomHalfPct}%</span> fell into
              the bottom half. Pure chance would give 25% and 50%. The near-uniform heat below <em>is</em> the
              finding: past returns carry almost no signal about the next three years.
            </p>
            <div className="overflow-x-auto">
              <div className="inline-grid" style={{ gridTemplateColumns: "auto repeat(4, 3.5rem)" }}>
                <div />
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="pb-1 text-center text-[11px] font-medium text-muted-foreground">
                    → Q{n}
                  </div>
                ))}
                {persistence.matrix.map((row, i) => {
                  const total = persistence.rowTotals[i] || 1;
                  return (
                    <FragmentRow key={i} i={i} row={row} total={total} />
                  );
                })}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>Share of the prior-quartile row</span>
              <span className="inline-flex items-center gap-0.5">
                {[0.12, 0.28, 0.44, 0.6].map((o) => (
                  <span key={o} className="h-3 w-4 rounded-sm bg-foreground" style={{ opacity: o }} />
                ))}
              </span>
              <span>more funds → darker · outlined = stayed put</span>
            </div>
            {persistence.topStayers.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] font-medium text-foreground">Stayed top quartile in both blocks</p>
                <ul className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                  {persistence.topStayers.map((s) => (
                    <li key={s.fund} className="flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{s.fund}</span>
                      <span className="shrink-0 tabular text-positive">{s.recent.toFixed(1)}% CAGR</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-3 text-[10px] leading-snug text-muted-foreground/70">
              {persistence.funds} actively-managed equity schemes across {persistence.cohorts} categories with
              six years of NAV history. Quartiles assigned within each category, cohorts of ≥{persistence.minCohort} funds.
              Two non-overlapping 3-year CAGR windows. Source: AMFI NAV history.
            </p>
          </Card>
        </section>
      )}
    </div>
  );
}

/** One row of the persistence heatmap. Cells shade by row-share (single hue),
 *  the diagonal (stayed put) is outlined. */
function FragmentRow({ i, row, total }: { i: number; row: number[]; total: number }) {
  return (
    <>
      <div className="flex items-center pr-2 text-right text-[11px] font-medium text-muted-foreground">
        Q{i + 1}
        {i === 0 && <span className="ml-1 text-[9px] uppercase tracking-wide text-muted-foreground/70">best</span>}
      </div>
      {row.map((c, j) => {
        const share = c / total;
        const diag = i === j;
        return (
          <div key={j} className={cn("relative m-0.5 flex h-11 items-center justify-center rounded", diag && "ring-2 ring-foreground/50")}>
            <div className="absolute inset-0 rounded bg-foreground" style={{ opacity: 0.08 + share * 0.55 }} aria-hidden />
            <div className="relative text-center">
              <div className={cn("text-[12px] tabular", diag ? "font-semibold" : "font-medium")}>
                {Math.round(share * 100)}%
              </div>
              <div className="text-[9px] text-muted-foreground">{c}</div>
            </div>
          </div>
        );
      })}
    </>
  );
}
