import { notFound } from "next/navigation";
import { DesignLanguageCard } from "@/components/ui/DesignLanguageCard";
import { KpiChipStrip } from "@/components/charts/KpiChipStrip";
import { StackedBarCombo } from "@/components/charts/StackedBarCombo";
import { cagrPct } from "@/lib/cagr";

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

const PASSIVE_SHARE_DATA = [
  { label: "Mar-20", bottom: 19_40_000, top: 2_10_000, line: 9.5 },
  { label: "Mar-21", bottom: 24_70_000, top: 3_50_000, line: 10.8 },
  { label: "Mar-22", bottom: 30_10_000, top: 5_30_000, line: 12.6 },
  { label: "Mar-23", bottom: 34_30_000, top: 6_30_000, line: 13.4 },
  { label: "Mar-24", bottom: 42_70_000, top: 8_60_000, line: 14.6 },
  { label: "Mar-25", bottom: 51_20_000, top: 11_30_000, line: 15.4 },
  { label: "Mar-26", bottom: 57_60_000, top: 14_10_000, line: 16.0 },
];

const SIP_AUM_DATA = [
  { label: "Mar-22", bottom: 5_70_000, line: 23.1 },
  { label: "Mar-23", bottom: 7_30_000, line: 24.8 },
  { label: "Mar-24", bottom: 9_90_000, line: 26.6 },
  { label: "Mar-25", bottom: 13_70_000, line: 28.4 },
  { label: "Mar-26", bottom: 17_80_000, line: 29.1 },
];

const SIP_FLOWS_VS_NIFTY = [
  { label: "Apr-25", bar: 21250, index: 100 },
  { label: "May-25", bar: 21470, index: 103 },
  { label: "Jun-25", bar: 22230, index: 107 },
  { label: "Jul-25", bar: 22550, index: 110 },
  { label: "Aug-25", bar: 22980, index: 108 },
  { label: "Sep-25", bar: 23440, index: 112 },
  { label: "Oct-25", bar: 23910, index: 115 },
  { label: "Nov-25", bar: 24220, index: 118 },
  { label: "Dec-25", bar: 24680, index: 120 },
  { label: "Jan-26", bar: 25100, index: 122 },
  { label: "Feb-26", bar: 25460, index: 119 },
  { label: "Mar-26", bar: 25960, index: 124 },
];

export default function DevArchetypePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const top10First = TOP10_AMC_SHARE_DATA[0];
  const top10Last = TOP10_AMC_SHARE_DATA[TOP10_AMC_SHARE_DATA.length - 1];
  const top10Years = TOP10_AMC_SHARE_DATA.length - 1;

  const aumFirst = INDUSTRY_AUM_CR[0];
  const aumLast = INDUSTRY_AUM_CR[INDUSTRY_AUM_CR.length - 1];
  const aumYears = INDUSTRY_AUM_CR.length - 1;

  const sipFirst = SIP_AUM_DATA[0];
  const sipLast = SIP_AUM_DATA[SIP_AUM_DATA.length - 1];
  const sipYears = SIP_AUM_DATA.length - 1;

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
          body: "Stacked bars: the navy segment is the Top-5 AMCs' share of industry QAAUM; the orange segment is AMCs ranked 6–10. The arrow carries the period-end CAGR. Numbers are share-of-industry percentages.",
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
          cagr={{
            startLabel: top10First.label,
            endLabel: top10Last.label,
            cagrPct: cagrPct(
              top10First.bottom + top10First.top,
              top10Last.bottom + top10Last.top,
              top10Years
            ),
            startValue: top10First.bottom + top10First.top,
            endValue: top10Last.bottom + top10Last.top,
          }}
        />
      </DesignLanguageCard>

      <DesignLanguageCard
        title="Industry AAUM by lens"
        chartId="dev-industry-aum"
        guide={{
          title: "Industry AAUM mix",
          body: "Stacked bars: navy is active assets; orange is passive (ETF + Index). Values render in ₹ Lakh Cr because the axis max sits above 1,00,000 Cr; hover for the precise ₹ Cr figure.",
        }}
        source="Source: AMFI monthly press release · Synthetic data (dev only)"
      >
        <StackedBarCombo
          variant="A"
          data={INDUSTRY_AUM_CR}
          bottomName="Active"
          topName="Passive"
          cagr={{
            startLabel: aumFirst.label,
            endLabel: aumLast.label,
            cagrPct: cagrPct(
              aumFirst.bottom + aumFirst.top,
              aumLast.bottom + aumLast.top,
              aumYears
            ),
            startValue: aumFirst.bottom + aumFirst.top,
            endValue: aumLast.bottom + aumLast.top,
          }}
        />
      </DesignLanguageCard>

      <DesignLanguageCard
        title="Share of passive funds in AAUM"
        chartId="dev-passive-share"
        guide={{
          title: "Active vs passive trajectory",
          body: "Navy bars: active AAUM. Orange bars: passive (ETF + Index) AAUM. Green line on the right axis: passive share of total AAUM (%). Line labels show first, last, peak, trough; tooltip carries the rest.",
        }}
        source="Source: AMFI monthly disclosures · Synthetic data (dev only)"
      >
        <StackedBarCombo
          variant="B"
          data={PASSIVE_SHARE_DATA}
          bottomName="Active"
          topName="Passive"
          lineName="Passive share %"
          rightUnitLabel="%"
        />
      </DesignLanguageCard>

      <DesignLanguageCard
        title="SIP AUM and stickiness"
        chartId="dev-sip-aum"
        guide={{
          title: "SIP AUM trajectory",
          body: "Navy bars: SIP AUM in ₹ Cr (rebased to ₹ Lakh Cr on the axis as the values cross the threshold). Orange line: SIP AUM as a share of total equity AUM (%).",
        }}
        source="Source: AMFI monthly press release · Synthetic data (dev only)"
      >
        <StackedBarCombo
          variant="C"
          data={SIP_AUM_DATA}
          barName="SIP AUM"
          lineName="SIP share of equity AUM"
          rightUnitLabel="%"
          cagr={{
            startLabel: sipFirst.label,
            endLabel: sipLast.label,
            cagrPct: cagrPct(sipFirst.bottom, sipLast.bottom, sipYears),
            startValue: sipFirst.bottom,
            endValue: sipLast.bottom,
          }}
        />
      </DesignLanguageCard>

      <DesignLanguageCard
        title="SIP flows vs NIFTY 500"
        chartId="dev-sip-flows-nifty"
        guide={{
          title: "Monthly SIP contribution and NIFTY 500",
          body: "Burgundy bars: monthly SIP contribution (₹ Cr). Dark line on the right axis: NIFTY 500 month-end close, rebased to 100 at series start. Use tooltip for precise monthly figures.",
        }}
        source="Source: AMFI · NIFTY indices · Synthetic data (dev only)"
      >
        <StackedBarCombo
          variant="D"
          data={SIP_FLOWS_VS_NIFTY}
          barName="SIP contribution"
          lineName="NIFTY 500 (indexed)"
          rightUnitLabel="Index (base 100)"
        />
      </DesignLanguageCard>
    </main>
  );
}
