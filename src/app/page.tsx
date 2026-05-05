import { KpiCard } from "@/components/ui/KpiCard";
import { Card } from "@/components/ui/Card";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Industry snapshot — placeholder data, charts wire up next.
          </p>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Industry AUM" value="₹68.4 L Cr" delta="+1.2%" trend="up" />
        <KpiCard label="Equity AUM" value="₹32.1 L Cr" delta="+1.8%" trend="up" />
        <KpiCard label="Monthly SIP" value="₹26,459 Cr" delta="+0.6%" trend="up" />
        <KpiCard label="Investor Folios" value="22.4 Cr" delta="+0.4%" trend="up" />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="AUM Trend" subtitle="Industry, last 24 months">
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            Chart placeholder
          </div>
        </Card>
        <Card title="SIP Flows" subtitle="Monthly inflows">
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            Chart placeholder
          </div>
        </Card>
      </section>
    </div>
  );
}
