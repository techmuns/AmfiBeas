import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";

const PLACEHOLDER_KPIS = [
  {
    title: "Quarterly AUM KPIs",
    subtitle: "AAUM by category and AMC · per quarter",
  },
  {
    title: "Quarterly SIP KPIs",
    subtitle: "SIP book, gross/net flows · per quarter",
  },
  {
    title: "Quarterly investor / folio KPIs",
    subtitle: "Folio counts, unique investors · per quarter",
  },
  {
    title: "Quarterly scheme performance KPIs",
    subtitle: "Scheme-level returns and benchmarks · per quarter",
  },
];

export default function QuarterlyPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Quarterly KPIs"
        subtitle="Quarterly operating KPIs will be added here."
        action={
          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Coming soon · Not connected
          </span>
        }
      />

      <section className="grid gap-4 md:grid-cols-2">
        {PLACEHOLDER_KPIS.map((k) => (
          <Card key={k.title} title={k.title} subtitle={k.subtitle}>
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              —
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}
