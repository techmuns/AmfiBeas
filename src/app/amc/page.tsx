import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Heatmap } from "@/components/charts/Heatmap";
import { AmcSearchTable } from "@/components/data/AmcSearchTable";
import { amcIndexRows } from "@/data/amc-detail";
import { amcHealthGrowthMatrix } from "@/data/amc-peer-universe";

export default function AmcListPage() {
  const data = amcIndexRows();

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader title="AMCs" subtitle="No AAUM data available." />
      </div>
    );
  }

  const subtitle = `${data.rows.length} AMCs · ${data.fiscalLabel}`;
  const health = amcHealthGrowthMatrix(8);
  const healthRows = health.rows.map((r) => ({
    label: r.displayName,
    values: r.values,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="AMCs"
        subtitle={subtitle}
        action={
          <Link
            href="/compare"
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeftRight className="h-3 w-3" />
            Compare two AMCs
          </Link>
        }
      />

      {health.rows.length > 0 && (
        <Card
          title="AMC Health Heatmap"
          subtitle={`QoQ AAUM growth · ${health.quarterLabels[0]} → ${health.quarterLabels[health.quarterLabels.length - 1]} · Source: AMFI Fundwise AAUM`}
        >
          <Heatmap
            rows={healthRows}
            columns={health.quarterLabels}
            min={-6}
            max={12}
            cellMinWidth={44}
            showAllColumnLabels
          />
          <p className="mt-3 text-[11px] text-muted-foreground">
            Each cell = QoQ AAUM growth for that AMC (in %). Cells are{" "}
            <span className="text-positive">green</span> for growth and{" "}
            <span className="text-negative">red</span> for contraction; muted
            cells indicate the AMC didn&apos;t have a prior-quarter AAUM row.
            AMCs sorted by latest-quarter AAUM (largest at top).
          </p>
        </Card>
      )}

      <AmcSearchTable rows={data.rows} />

      <Card>
        <div className="space-y-1 text-xs text-muted-foreground">
          <div>
            <strong className="text-foreground">Source:</strong> AMFI
            Fundwise AAUM.
          </div>
          <div>
            <strong className="text-foreground">Universe:</strong> all AMCs
            with at least one quarter of <code>status=&quot;ok&quot;</code> AAUM
            data in the snapshot. PMS / AIF / offshore / advisory / alternates
            are not included.
          </div>
          <div>
            <strong className="text-foreground">Snapshot quarter:</strong>{" "}
            {data.fiscalLabel} ({data.quarter}).
          </div>
        </div>
      </Card>
    </div>
  );
}
