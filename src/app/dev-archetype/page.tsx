import { notFound } from "next/navigation";
import { DesignLanguageCard } from "@/components/ui/DesignLanguageCard";
import { StackedBarCombo } from "@/components/charts/StackedBarCombo";
import {
  passiveShareExhibit,
  sipFlowsVsNiftyExhibit,
  sipAumStickinessExhibit,
  topNAmcConcentrationExhibit,
  nfoMobilisationExhibit,
  activeEquityFlowVsNiftyExhibit,
} from "@/data/hero-exhibits";
import { cagrPct } from "@/lib/cagr";

export const dynamic = "force-static";

export default function DevArchetypePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const passive = passiveShareExhibit();
  const sipFlows = sipFlowsVsNiftyExhibit();
  const sipAum = sipAumStickinessExhibit();
  const topAmc = topNAmcConcentrationExhibit();
  const nfo = nfoMobilisationExhibit();
  const activeFlow = activeEquityFlowVsNiftyExhibit();

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          Hero exhibits — real data validation
        </h1>
        <p className="text-sm text-muted-foreground">
          Dev-only route. Each card below is wired to a live snapshot
          accessor — no synthetic data. Missing periods are skipped,
          never interpolated.
        </p>
      </header>

      <PassiveShareCard />
      <SipFlowsCard />
      <SipAumCard />
      <TopAmcCard />
      <NfoCard />
      <ActiveEquityFlowCard />
    </main>
  );

  function PassiveShareCard() {
    if (!passive.availability.hasData) {
      return <UnavailableCard title="Share of passive funds in equity envelope" note={passive.availability.note} />;
    }
    const first = passive.data[0];
    const last = passive.data[passive.data.length - 1];
    const years = last.fy - first.fy;
    const totalsFirst = first.bottom + first.top;
    const totalsLast = last.bottom + last.top;
    return (
      <DesignLanguageCard
        title="Share of passive funds in equity envelope"
        chartId="hero-passive-share"
        source={`Source: AMFI monthly disclosures (AAUM, IIFL Figure 19 methodology) · ${passive.availability.note}`}
      >
        <StackedBarCombo
          variant="B"
          data={passive.data}
          bottomName="Active equity AAUM"
          topName="Passive (Index + ETF) AAUM"
          lineName="Passive share %"
          rightUnitLabel="%"
          cagr={{
            startLabel: first.label,
            endLabel: last.label,
            cagrPct: cagrPct(totalsFirst, totalsLast, years),
            startValue: totalsFirst,
            endValue: totalsLast,
          }}
        />
      </DesignLanguageCard>
    );
  }

  function SipFlowsCard() {
    if (!sipFlows.availability.hasData) {
      return <UnavailableCard title="SIP flows vs NIFTY 500" note={sipFlows.availability.note} />;
    }
    return (
      <DesignLanguageCard
        title="SIP flows vs NIFTY 500"
        chartId="hero-sip-flows-vs-nifty"
        source={`Source: AMFI press release · NSE NIFTY 500 month-end · ${sipFlows.availability.note}`}
      >
        <StackedBarCombo
          variant="D"
          data={sipFlows.data}
          barName="SIP contribution"
          lineName="NIFTY 500 (indexed)"
          rightUnitLabel="Index (base 100)"
        />
      </DesignLanguageCard>
    );
  }

  function SipAumCard() {
    if (!sipAum.availability.hasData) {
      return <UnavailableCard title="SIP AUM and stickiness" note={sipAum.availability.note} />;
    }
    const first = sipAum.data[0];
    const last = sipAum.data[sipAum.data.length - 1];
    const years = last.fy - first.fy;
    return (
      <DesignLanguageCard
        title="SIP AUM and stickiness"
        chartId="hero-sip-aum-stickiness"
        source={`Source: AMFI press release · ${sipAum.availability.note}`}
      >
        <StackedBarCombo
          variant="C"
          data={sipAum.data}
          barName="SIP AUM"
          lineName="SIP share of equity AUM"
          rightUnitLabel="%"
          cagr={{
            startLabel: first.label,
            endLabel: last.label,
            cagrPct: cagrPct(first.bottom, last.bottom, years),
            startValue: first.bottom,
            endValue: last.bottom,
          }}
        />
      </DesignLanguageCard>
    );
  }

  function TopAmcCard() {
    if (!topAmc.availability.hasData) {
      return <UnavailableCard title="Top AMC concentration basis QAAUM" note={topAmc.availability.note} />;
    }
    const title =
      topAmc.n === 10
        ? "Top 10 AMC concentration basis QAAUM"
        : `Top ${topAmc.n} AMC concentration basis QAAUM`;
    const first = topAmc.data[0];
    const last = topAmc.data[topAmc.data.length - 1];
    const years = (topAmc.data.length - 1) / 4;
    const firstTotal = first.bottom + first.top;
    const lastTotal = last.bottom + last.top;
    return (
      <DesignLanguageCard
        title={title}
        chartId="hero-topn-amc-concentration"
        source={`Source: AMFI Fundwise AAUM disclosure (MF-only) · ${topAmc.availability.note}`}
      >
        <StackedBarCombo
          variant="A"
          data={topAmc.data}
          bottomName="Top 5"
          topName={topAmc.n === 10 ? "Ranks 6–10" : `Ranks 6–${topAmc.n}`}
          showSegmentLabels={true}
          showTotalLabel={true}
          leftUnitLabel="%"
          percentMode={true}
          cagr={
            topAmc.data.length >= 3
              ? {
                  startLabel: first.label,
                  endLabel: last.label,
                  cagrPct: cagrPct(firstTotal, lastTotal, Math.max(years, 0.25)),
                  startValue: firstTotal,
                  endValue: lastTotal,
                }
              : undefined
          }
        />
      </DesignLanguageCard>
    );
  }

  function NfoCard() {
    if (!nfo.availability.hasData) {
      return <UnavailableCard title="NFO mobilisation vs industry flows" note={nfo.availability.note} />;
    }
    const first = nfo.data[0];
    const last = nfo.data[nfo.data.length - 1];
    const years = last.fy - first.fy;
    return (
      <DesignLanguageCard
        title="NFO mobilisation vs industry net flows"
        chartId="hero-nfo-mobilisation"
        source={`Source: AMFI Monthly Report (New Schemes page) · ${nfo.availability.note}`}
      >
        <StackedBarCombo
          variant="C"
          data={nfo.data}
          barName="NFO funds mobilised"
          lineName="NFO share of net inflow"
          rightUnitLabel="%"
          cagr={
            years >= 1
              ? {
                  startLabel: first.label,
                  endLabel: last.label,
                  cagrPct: cagrPct(first.bottom, last.bottom, years),
                  startValue: first.bottom,
                  endValue: last.bottom,
                }
              : undefined
          }
        />
      </DesignLanguageCard>
    );
  }

  function ActiveEquityFlowCard() {
    if (!activeFlow.availability.hasData) {
      return (
        <UnavailableCard title="Active equity net flow vs NIFTY 500" note={activeFlow.availability.note} />
      );
    }
    return (
      <DesignLanguageCard
        title="Active equity net flow vs NIFTY 500"
        chartId="hero-active-equity-flow-vs-nifty"
        source={`Source: AMFI Monthly Report (active-equity envelope) · NSE NIFTY 500 · ${activeFlow.availability.note}`}
      >
        <StackedBarCombo
          variant="D"
          data={activeFlow.data}
          barName="Active equity net flow"
          lineName="NIFTY 500 (indexed)"
          rightUnitLabel="Index (base 100)"
        />
      </DesignLanguageCard>
    );
  }
}

function UnavailableCard({ title, note }: { title: string; note: string }) {
  return (
    <div className="rounded-lg border border-dashed border-muted-foreground/40 bg-card p-6 text-card-foreground">
      <h3 className="text-sm font-semibold tracking-tight text-brand-navy">{title}</h3>
      <p className="mt-3 text-[12px] italic text-muted-foreground">
        Data unavailable — {note}
      </p>
    </div>
  );
}
