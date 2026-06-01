import { PageHeader } from "@/components/layout/PageHeader";
import { CapFlowsView } from "@/components/data/CapFlowsView";
import { SectorFlowHeatmap } from "@/components/data/SectorFlowHeatmap";
import { capFlows } from "@/data/cap-flows";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Overview" subtitle="Industry snapshot" />

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium tracking-tight">
            What mutual funds are buying &amp; selling
          </h2>
        </div>
        <CapFlowsView flows={capFlows} />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium tracking-tight">
            Monthly sector flows
          </h2>
        </div>
        <SectorFlowHeatmap />
      </section>
    </div>
  );
}
