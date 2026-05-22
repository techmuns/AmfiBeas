import { notFound } from "next/navigation";
import { DesignLanguageCard } from "@/components/ui/DesignLanguageCard";
import { KpiChipStrip } from "@/components/charts/KpiChipStrip";
import { StackedBarCombo } from "@/components/charts/StackedBarCombo";

export const dynamic = "force-static";

const TOP10_AMC_SHARE_DATA = [
  { label: "Mar-20", bottom: 16.6, top: 5.5 },
  { label: "Mar-21", bottom: 17.2, top: 5.8 },
  { label: "Mar-22", bottom: 18.5, top: 6.4 },
  { label: "Mar-23", bottom: 19.6, top: 6.9 },
  { label: "Mar-24", bottom: 21.4, top: 7.6 },
  { label: "Mar-25", bottom: 22.8, top: 8.1 },
  { label: "Mar-26", bottom: 23.7, top: 8.6 },
];

const INDUSTRY_AUM_CR = [
  { label: "Mar-20", bottom: 17_30_000, top: 5_30_000 },
  { label: "Mar-21", bottom: 22_80_000, top: 6_90_000 },
  { label: "Mar-22", bottom: 28_40_000, top: 9_10_000 },
  { label: "Mar-23", bottom: 32_70_000, top: 9_80_000 },
  { label: "Mar-24", bottom: 41_30_000, top: 12_60_000 },
  { label: "Mar-25", bottom: 51_90_000, top: 15_60_000 },
  { label: "Mar-26", bottom: 60_40_000, top: 17_50_000 },
];

export default function DevArchetypePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          Design language — archetype validation
        </h1>
        <p className="text-sm text-muted-foreground">
          Dev-only route for verifying the benchmark-style exhibit
          components against synthetic data before page rollout.
        </p>
      </header>

      <DesignLanguageCard
        title="Top 10 AMC market share basis QAAUM"
        chartId="dev-top10-share"
        guide={{
          title: "Top 10 AMC market share",
          body: "Stacked bars: the navy segment is the Top-5 AMCs' share of industry QAAUM; the orange segment is AMCs ranked 6–10. The diagonal arrow (when present) carries the period-end CAGR. Numbers are share-of-industry percentages — not absolute AUM.",
        }}
        chipStrip={
          <KpiChipStrip
            chips={TOP10_AMC_SHARE_DATA.map((d) => ({
              label: d.label,
              value: `${(d.bottom + d.top).toFixed(1)}%`,
            }))}
          />
        }
        source="Source: AMFI QAAUM disclosures · Synthetic data (dev only)"
      >
        <StackedBarCombo
          variant="A"
          data={TOP10_AMC_SHARE_DATA}
          bottomName="Top 5"
          topName="6–10"
          showSegmentLabels={true}
        />
      </DesignLanguageCard>

      <DesignLanguageCard
        title="Industry AAUM by lens (₹ Lakh Cr)"
        chartId="dev-industry-aum"
        guide={{
          title: "Industry AAUM mix",
          body: "Stacked bars: the navy segment is active assets; the orange segment is passive (ETF + Index). Values render in ₹ Lakh Cr because the axis max sits above 1,00,000 Cr; hover any bar for the precise ₹ Cr figure.",
        }}
        source="Source: AMFI monthly press release · Synthetic data (dev only)"
      >
        <StackedBarCombo
          variant="A"
          data={INDUSTRY_AUM_CR}
          bottomName="Active"
          topName="Passive"
          showSegmentLabels={true}
        />
      </DesignLanguageCard>
    </main>
  );
}
