"use client";

import { Card } from "@/components/ui/Card";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import {
  AmcAllocationStack,
  type AllocationSegment,
} from "@/components/charts/AmcAllocationStack";
import {
  amcAllocationsMeta,
  amcCapAllocations,
  amcSectorAllocations,
} from "@/data/amc-allocations";

type Row = Record<string, number | string>;

// Cap tiers — a blue→teal→amber ramp, all dark enough for white in-bar labels.
const CAP_SEGMENTS: AllocationSegment[] = [
  { key: "large", label: "Large Cap", color: "hsl(222 64% 44%)" },
  { key: "mid", label: "Mid Cap", color: "hsl(200 72% 46%)" },
  { key: "small", label: "Small Cap", color: "hsl(28 80% 52%)" },
];

// One distinct colour per sector bucket; Others is a mid-grey so its (large)
// label still reads in white. Keys must match `sectorOrder` in the snapshot.
// Banks + Finance share a blue family — the two halves of the old Financials.
const SECTOR_SEGMENTS: AllocationSegment[] = [
  { key: "Banks", label: "Banks", color: "hsl(222 64% 44%)" },
  { key: "Finance", label: "Finance", color: "hsl(210 60% 62%)" },
  { key: "IT", label: "IT", color: "hsl(265 48% 54%)" },
  { key: "Oil & Energy", label: "Oil & Energy", color: "hsl(28 80% 50%)" },
  { key: "Auto", label: "Auto", color: "hsl(152 52% 38%)" },
  { key: "Healthcare", label: "Healthcare", color: "hsl(338 62% 52%)" },
  { key: "FMCG", label: "FMCG", color: "hsl(48 80% 44%)" },
  { key: "Capital Goods", label: "Capital Goods", color: "hsl(190 64% 38%)" },
  { key: "Chemicals", label: "Chemicals", color: "hsl(12 64% 50%)" },
  { key: "Metals", label: "Metals", color: "hsl(220 14% 46%)" },
  { key: "Realty", label: "Realty", color: "hsl(95 42% 42%)" },
  { key: "Others", label: "Others", color: "hsl(220 9% 56%)" },
];

const sourceCaption = `Top ${amcAllocationsMeta.amcsShown} fund houses by equity AUM + a blended Industry column · ${amcAllocationsMeta.month} · ${amcAllocationsMeta.funds} schemes · ${amcAllocationsMeta.universe}. Source: RupeeVest holdings, AmfiBeas classification.`;

/**
 * Two IIFL-style fund-house allocation cards (Cap and Sector), rendered on the
 * MFs Portfolio Tracker's "AMC Mix" tab. Industry-wide — independent of the
 * fund picker. Data is precomputed in src/data/portfolio-tracker/amc-allocations.json.
 */
export function AmcAllocationCharts() {
  return (
    <div className="space-y-6">
      <Card
        title="Cap Allocation by AMC"
        stackHeader
        action={
          <InfoTooltip
            size="sm"
            label="Each AMC's actively-managed equity book split into Large / Mid / Small cap, weighted by holding value across all its equity & hybrid schemes (ex arbitrage), normalised to 100%. Stocks are bucketed with AMFI-style Large (top 100) / Mid (next 250) / Small (rest) lists. The Industry column blends every scheme in the universe."
          />
        }
      >
        <AmcAllocationStack data={amcCapAllocations as unknown as Row[]} segments={CAP_SEGMENTS} />
        <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
          {sourceCaption}
        </p>
      </Card>

      <Card
        title="Sector Allocation by AMC"
        stackHeader
        action={
          <InfoTooltip
            size="sm"
            label="Each AMC's equity book split by sector, weighted by holding value and normalised to 100%. Sectors not in the named set fold into Others. Banks (incl. small-finance banks) are shown separately from non-bank Finance — NBFCs, insurers, AMCs and exchanges."
          />
        }
      >
        <AmcAllocationStack
          data={amcSectorAllocations as unknown as Row[]}
          segments={SECTOR_SEGMENTS}
          height={420}
        />
        <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
          {sourceCaption} {amcAllocationsMeta.sectorCoveragePct}% of equity value
          maps to a named sector; the rest sits in Others. Banks are split from
          non-bank Finance by company name.
        </p>
      </Card>
    </div>
  );
}
