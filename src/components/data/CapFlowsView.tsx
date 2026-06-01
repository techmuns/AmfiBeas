import { cn } from "@/lib/cn";
import { KeyTakeaway, DeltaCr } from "@/components/ui/KeyTakeaway";
import type { CapFlowCard, CapFlowRow, CapFlows } from "@/data/cap-flows";

function displayName(name: string): string {
  return name.replace(/\s+(Ltd\.?|Limited)$/i, "").trim();
}

/** Ambit-style one-liner for a cap tier: most-bought and most-sold name. */
function tierHeadline(month: string, card: CapFlowCard) {
  const b = card.bought[0];
  const s = card.sold[0];
  if (!b && !s) return null;
  return (
    <KeyTakeaway
      headline={
        <>
          In {month}, active MFs{" "}
          {b && (
            <>
              net bought <strong>{displayName(b.company)}</strong> the most (
              <DeltaCr cr={b.netCr} />
              {b.amcs.length ? `; ${b.amcs.join(", ")} leading` : ""})
            </>
          )}
          {b && s && " and "}
          {s && (
            <>
              {!b && "net "}reduced <strong>{displayName(s.company)}</strong> (
              <DeltaCr cr={-s.netCr} />)
            </>
          )}
          .
        </>
      }
    />
  );
}

function FlowCard({
  title,
  rows,
  kind,
}: {
  title: string;
  rows: CapFlowRow[];
  kind: "bought" | "sold";
}) {
  const movers = kind === "bought" ? "Top MF Buyers" : "Top MF Sellers";
  const valHead = kind === "bought" ? "Net bought (₹ Cr)" : "Net sold (₹ Cr)";
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b bg-muted/60 px-4 py-2.5 text-sm font-semibold">
        {title}
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-sm font-semibold text-foreground">
            <th className="px-4 py-2 text-left font-semibold">Company</th>
            <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">
              {valHead}
            </th>
            <th className="px-4 py-2 text-left font-semibold">{movers}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={3}
                className="px-4 py-6 text-center text-muted-foreground"
              >
                No qualifying names this month.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.company} className="border-t last:border-b-0">
                <td className="px-4 py-2.5 font-medium">
                  {displayName(r.company)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2.5 text-right tabular font-medium",
                    kind === "bought" ? "text-positive" : "text-negative"
                  )}
                >
                  {kind === "bought" ? "+" : "−"}
                  {r.netCr.toLocaleString("en-IN")}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {r.amcs.length ? r.amcs.join(", ") : "—"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function CapFlowsView({ flows }: { flows: CapFlows }) {
  const { meta } = flows;
  const tiers: { key: "large" | "mid" | "small"; label: string }[] = [
    { key: "large", label: "Large-cap" },
    { key: "mid", label: "Mid-cap" },
    { key: "small", label: "Small-cap" },
  ];
  return (
    <div className="space-y-6">
      {tiers.map((t) => (
        <div key={t.key} className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight">{t.label}</h2>
          {tierHeadline(meta.monthCur, flows[t.key])}
          <div className="grid gap-4 lg:grid-cols-2">
            <FlowCard
              title={`Top ${t.label} names bought by MFs (${meta.monthCur})`}
              rows={flows[t.key].bought}
              kind="bought"
            />
            <FlowCard
              title={`Top ${t.label} names sold by MFs (${meta.monthCur})`}
              rows={flows[t.key].sold}
              kind="sold"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
