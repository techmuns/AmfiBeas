import { Lock, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import {
  FREE_PUBLIC_KPIS,
  PAID_LOCKED_KPIS,
  type MorningstarKpi,
} from "@/config/morningstar-kpis";
import { cn } from "@/lib/cn";

function groupByCategory(items: readonly MorningstarKpi[]) {
  const map = new Map<string, MorningstarKpi[]>();
  for (const it of items) {
    const arr = map.get(it.category) ?? [];
    arr.push(it);
    map.set(it.category, arr);
  }
  return Array.from(map.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
}

export default function PremiumPage() {
  const freeGroups = groupByCategory(FREE_PUBLIC_KPIS);
  const paidGroups = groupByCategory(PAID_LOCKED_KPIS);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Premium Data"
        subtitle="Licensed datasets that can enhance AMC and scheme-level analysis"
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] tabular text-muted-foreground">
            <Lock className="h-3 w-3" />
            License required · Not connected
          </span>
        }
      />

      <Card>
        <div className="flex items-start gap-3 text-sm">
          <Sparkles className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <p className="text-muted-foreground">
            Premium data is shown as available with a Morningstar license;
            it is not currently active unless connected. The dashboard never
            renders synthetic premium values — sections only light up once
            a real licensed feed is wired in.
          </p>
        </div>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium tracking-tight">
            Free / public Morningstar data
          </h2>
          <p className="text-xs text-muted-foreground">
            Source: Morningstar (public). Available without a paid license
            once the optional ingestion lands rows.
          </p>
        </div>
        {freeGroups.map(([category, items]) => (
          <Card key={category} title={category} subtitle={`${items.length} dataset${items.length === 1 ? "" : "s"}`}>
            <ul className="divide-y">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                >
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">{it.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {it.description}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] tabular text-muted-foreground sm:min-w-[180px] sm:justify-end">
                    <span className="truncate">{it.dashboardUse}</span>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] tabular",
                        "border-border bg-muted text-muted-foreground"
                      )}
                    >
                      Not connected
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium tracking-tight">
            Licensed Morningstar datasets
          </h2>
          <p className="text-xs text-muted-foreground">
            Source: Morningstar, license required. These datasets unlock
            additional KPIs across AMCs, schemes, and the overview.
          </p>
        </div>
        {paidGroups.map(([category, items]) => (
          <Card key={category} title={category} subtitle={`${items.length} dataset${items.length === 1 ? "" : "s"}`}>
            <ul className="divide-y">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                >
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">{it.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {it.description}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] tabular text-muted-foreground sm:min-w-[180px] sm:justify-end">
                    <span className="truncate">{it.dashboardUse}</span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] tabular text-muted-foreground">
                      <Lock className="h-3 w-3" />
                      Locked
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </section>
    </div>
  );
}
