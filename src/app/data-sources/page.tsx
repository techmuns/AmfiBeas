import { CircleCheck, MinusCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { LockedKpiList } from "@/components/data/LockedKpiList";
import { PublicKpiList } from "@/components/data/PublicKpiList";
import {
  FREE_PUBLIC_KPIS,
  PAID_LOCKED_KPIS,
  type KpiStatus,
  type MorningstarKpi,
} from "@/config/morningstar-kpis";
import {
  amcMasterSnapshot,
  amcAaumQuarterlySnapshot,
  amcQuarterlySnapshot,
  dataMode,
  morningstarAumSnapshot,
  otherSchemesMonthlySnapshot,
} from "@/data/source";
import { cn } from "@/lib/cn";

interface AmfiSource {
  label: string;
  rows: number;
  generatedAt: string;
  status: "live" | "demo";
}

function amfiSources(): AmfiSource[] {
  const mode = dataMode();
  return [
    {
      label: "AMC master",
      rows: amcMasterSnapshot.amcs.length,
      generatedAt: amcMasterSnapshot.meta.generatedAt,
      status: mode.amcMaster,
    },
    {
      label: "Other Schemes monthly",
      rows: otherSchemesMonthlySnapshot.rows.length,
      generatedAt: otherSchemesMonthlySnapshot.meta.generatedAt,
      status: mode.otherSchemes,
    },
    {
      label: "Listed AMC quarterly",
      rows: amcQuarterlySnapshot.rows.length,
      generatedAt: amcQuarterlySnapshot.meta.generatedAt,
      status: mode.amcQuarterly,
    },
    {
      label: "AMC AAUM (per-quarter)",
      rows: amcAaumQuarterlySnapshot.rows.length,
      generatedAt: amcAaumQuarterlySnapshot.meta.generatedAt,
      status: mode.amcAaum,
    },
  ];
}

interface PublicKpiItem extends MorningstarKpi {
  runtimeStatus: KpiStatus;
  rowCount?: number;
  fetchedAt?: string;
  sourceUrl?: string;
}

function publicKpisWithStatus(): PublicKpiItem[] {
  const ms = morningstarAumSnapshot;
  const amcAaumAvailable = ms.meta.status === "ok" && ms.rows.length > 0;
  return FREE_PUBLIC_KPIS.map((k): PublicKpiItem => {
    if (k.id === "amc-aaum") {
      return {
        ...k,
        runtimeStatus: amcAaumAvailable ? "available" : "not_connected",
        rowCount: ms.rows.length,
        fetchedAt: ms.meta.fetchedAt,
        sourceUrl: ms.meta.sourceUrl,
      };
    }
    return { ...k, runtimeStatus: "not_connected" };
  });
}

export default function DataSourcesPage() {
  const ms = morningstarAumSnapshot;
  const amfi = amfiSources();
  const publicKpis = publicKpisWithStatus();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Sources"
        subtitle="AMFI is primary · Morningstar public is fallback / comparison only"
      />

      <Card title="AMFI" subtitle="Primary source · authoritative Indian MF data">
        <ul className="grid gap-2 md:grid-cols-2">
          {amfi.map((s) => {
            const live = s.status === "live";
            const Icon = live ? CircleCheck : MinusCircle;
            return (
              <li
                key={s.label}
                className="flex items-start gap-3 rounded-md border px-3 py-2.5"
              >
                <Icon
                  className={cn(
                    "mt-0.5 h-4 w-4 shrink-0",
                    live ? "text-positive" : "text-muted-foreground"
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {s.label}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-1.5 py-0 text-[10px] uppercase tracking-wide",
                        live
                          ? "border-positive/40 bg-positive/10 text-positive"
                          : "border-border text-muted-foreground"
                      )}
                    >
                      {live ? "Live" : "Demo"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] tabular text-muted-foreground">
                    {s.rows} rows
                    {s.generatedAt
                      ? ` · ${new Date(s.generatedAt).toISOString().slice(0, 10)}`
                      : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card
        title="Public Morningstar Data"
        subtitle={
          ms.meta.status === "ok"
            ? `Live · ${ms.rows.length} rows · ${new Date(ms.meta.fetchedAt).toISOString().slice(0, 10)}`
            : `Disabled · MORNINGSTAR_FETCH_ENABLED=${process.env.MORNINGSTAR_FETCH_ENABLED ?? ""}`
        }
      >
        <PublicKpiList items={publicKpis} />
      </Card>

      <Card
        title="Locked Morningstar Premium KPIs"
        subtitle="Requires Morningstar License"
      >
        <LockedKpiList items={PAID_LOCKED_KPIS} />
      </Card>
    </div>
  );
}
