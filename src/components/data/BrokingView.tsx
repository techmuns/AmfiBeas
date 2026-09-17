import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { formatMonthLong } from "@/lib/format";
import { broking, type BrokerRow } from "@/data/broking";

/**
 * Broking / Capital Markets tab — NSE active clients per broker: who leads, who
 * is gaining or losing share month over month. The boss's "capital markets"
 * companion to the AMC view.
 *
 * Data comes from monthly NSE uploads (manual-data/broking/, see its README) —
 * NSE's active-clients report is behind a bot-wall, so it can't be fetched
 * automatically. Until the newest committed month is an official file, the
 * snapshot is flagged `isSample` and a banner says so, so approximate seed
 * numbers are never mistaken for authoritative NSE data.
 */

/** Indian-unit client count: ≥1 crore → "1.30 Cr", else "79.5 L". */
function fmtClients(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  return `${(n / 1e5).toFixed(1)} L`;
}
function fmtMomPct(p: number | null): string {
  if (p == null) return "—";
  return `${p >= 0 ? "+" : ""}${p.toFixed(1)}%`;
}

function MomPill({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span className={cn("text-[11px] font-medium tabular", up ? "text-positive" : "text-negative")}>
      {fmtMomPct(pct)}
    </span>
  );
}

export function BrokingView() {
  const { brokers, latestMonth, priorMonth, totalActiveClients, isSample, hasTurnover } = broking;
  const max = Math.max(...brokers.map((b) => b.activeClients), 1);
  const leader = brokers[0];
  const withMom = brokers.filter((b) => b.momPct != null);
  const gainers = [...withMom].sort((a, b) => (b.momPct ?? 0) - (a.momPct ?? 0)).slice(0, 3);
  const losers = [...withMom].sort((a, b) => (a.momPct ?? 0) - (b.momPct ?? 0)).slice(0, 3);

  return (
    <div className="space-y-6">
      {isSample && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[13px] leading-snug text-foreground">
          <span className="font-semibold text-amber-600 dark:text-amber-400">Sample data.</span>{" "}
          These are approximate top-broker figures from public reporting (mid-2026), so
          the tab is fully built and testable. NSE&rsquo;s active-clients report is
          behind a bot-wall and can&rsquo;t be fetched automatically — drop the official
          monthly file into <code className="rounded bg-muted px-1 py-0.5 text-[11px]">manual-data/broking/</code>{" "}
          and this banner disappears. The layout, market share and month-over-month
          movers below are all live off whatever data is committed.
        </div>
      )}

      {/* ---- KPI row -------------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Market leader" value={leader?.broker ?? "—"} sub={`${leader?.sharePct ?? 0}% of tracked`} />
        <Kpi label="Tracked active clients" value={fmtClients(totalActiveClients)} sub={`${brokers.length} brokers`} />
        <Kpi
          label="Biggest gainer (MoM)"
          value={gainers[0]?.broker ?? "—"}
          sub={fmtMomPct(gainers[0]?.momPct ?? null)}
          tone="pos"
        />
        <Kpi
          label="Biggest faller (MoM)"
          value={losers[0]?.broker ?? "—"}
          sub={fmtMomPct(losers[0]?.momPct ?? null)}
          tone="neg"
        />
      </div>

      {/* ---- Active clients by broker -------------------------------------- */}
      <Card title={`Active clients by broker — ${formatMonthLong(latestMonth)}`}>
        <div className="space-y-1.5">
          {brokers.map((b) => (
            <div key={b.broker} className="flex items-center gap-3">
              <div className="w-32 shrink-0 truncate text-xs font-medium" title={b.broker}>
                {b.broker}
              </div>
              <div className="relative h-6 flex-1 overflow-hidden rounded bg-muted/40">
                <div
                  className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-indigo-500 to-violet-400 shadow-sm"
                  style={{ width: `${(b.activeClients / max) * 100}%` }}
                />
              </div>
              <div className="w-20 shrink-0 text-right text-xs font-medium tabular">
                {fmtClients(b.activeClients)}
              </div>
              <div className="w-12 shrink-0 text-right text-[11px] tabular text-muted-foreground">
                {b.sharePct}%
              </div>
              <div className="w-14 shrink-0 text-right">
                <MomPill pct={b.momPct} />
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[10px] leading-snug text-muted-foreground/70">
          Share = % of the tracked brokers&rsquo; total active clients. MoM vs{" "}
          {priorMonth ? formatMonthLong(priorMonth) : "the prior month"}. Source:{" "}
          {broking.source}.
        </p>
      </Card>

      {/* ---- MoM movers ----------------------------------------------------- */}
      {withMom.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <MoverCard title="Adding clients fastest" rows={gainers} tone="pos" />
          <MoverCard title="Losing clients fastest" rows={losers} tone="neg" />
        </div>
      )}

      {/* ---- Turnover (ADTO) ----------------------------------------------- */}
      {hasTurnover ? (
        <Card title={`Average daily turnover by broker — ${formatMonthLong(latestMonth)}`}>
          <TurnoverTable rows={brokers.filter((b) => b.turnoverCr != null)} />
        </Card>
      ) : (
        <Card title="Average daily turnover (ADTO)">
          <p className="text-[13px] leading-snug text-muted-foreground">
            Add a <code className="rounded bg-muted px-1 py-0.5 text-[11px]">turnoverCr</code>{" "}
            column to the monthly broking CSV and per-broker average daily turnover
            appears here automatically — the other half of the capital-markets read.
          </p>
        </Card>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[17px] font-semibold tracking-tight">{value}</div>
      {sub && (
        <div
          className={cn(
            "text-[12px] tabular",
            tone === "pos" ? "text-positive" : tone === "neg" ? "text-negative" : "text-muted-foreground"
          )}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function MoverCard({ title, rows, tone }: { title: string; rows: BrokerRow[]; tone: "pos" | "neg" }) {
  return (
    <Card title={title}>
      <ul className="space-y-1.5">
        {rows.map((b) => (
          <li key={b.broker} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{b.broker}</span>
            <span className="flex items-baseline gap-3">
              <span className="text-[12px] tabular text-muted-foreground">
                {fmtClients(b.activeClients)}
              </span>
              <span className={cn("w-16 text-right font-medium tabular", tone === "pos" ? "text-positive" : "text-negative")}>
                {fmtMomPct(b.momPct)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TurnoverTable({ rows }: { rows: BrokerRow[] }) {
  const sorted = [...rows].sort((a, b) => (b.turnoverCr ?? 0) - (a.turnoverCr ?? 0));
  const max = Math.max(...sorted.map((b) => b.turnoverCr ?? 0), 1);
  return (
    <div className="space-y-1.5">
      {sorted.map((b) => (
        <div key={b.broker} className="flex items-center gap-3">
          <div className="w-32 shrink-0 truncate text-xs font-medium">{b.broker}</div>
          <div className="relative h-6 flex-1 overflow-hidden rounded bg-muted/40">
            <div
              className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-cyan-500 to-teal-400 shadow-sm"
              style={{ width: `${((b.turnoverCr ?? 0) / max) * 100}%` }}
            />
          </div>
          <div className="w-24 shrink-0 text-right text-xs font-medium tabular">
            ₹{(b.turnoverCr ?? 0).toLocaleString("en-IN")} Cr
          </div>
        </div>
      ))}
    </div>
  );
}
