/**
 * Financials Market Wrap — three-sentence headline read for the
 * /financials page. Built per-AMC (the page is single-AMC via the
 * FilterBar) and per-quarter (via the QuarterPicker), so the wrap
 * reflects exactly the slice the user is looking at.
 *
 *   1. Profitability sentence — PAT margin + rank among listed
 *      peers + gap vs peer median.
 *   2. Yield sentence — revenue yield in bps + gap vs peer median.
 *   3. Quarterly read sentence — biggest YoY mover among Revenue /
 *      Operating Profit / PAT, or an "Operating leverage" tag when
 *      margin expanded faster than revenue.
 */
import { quarterlyForAmc, SOURCED_FINANCIALS_SLUGS } from "./aggregate";
import { aaumProvenance } from "./source";
import { getAMC } from "./amcs";
import { fiscalLabelFromCalendarQuarter } from "./amc-peer-universe";
import { fmtBps } from "../lib/units";

export interface FinancialsMarketWrap {
  asOf: string;
  lines: string[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Profitability sentence — PAT margin + rank + gap vs peer median. */
function profitabilitySentence(
  slug: string,
  selectedQuarter: string
): string | null {
  const profile = getAMC(slug);
  const name = profile?.name ?? slug;
  const series = quarterlyForAmc(slug);
  const row = series.find((q) => q.quarter === selectedQuarter);
  if (!row || row.revenue === 0) return null;
  const margin = (row.pat / row.revenue) * 100;

  const peerMargins: { slug: string; margin: number }[] = [];
  for (const peerSlug of SOURCED_FINANCIALS_SLUGS) {
    const peerRow = quarterlyForAmc(peerSlug).find(
      (q) => q.quarter === selectedQuarter
    );
    if (!peerRow || peerRow.revenue <= 0) continue;
    peerMargins.push({
      slug: peerSlug,
      margin: (peerRow.pat / peerRow.revenue) * 100,
    });
  }
  if (peerMargins.length === 0) return null;
  peerMargins.sort((a, b) => b.margin - a.margin);
  const rank = peerMargins.findIndex((p) => p.slug === slug) + 1;
  const peerMedian = median(peerMargins.map((p) => p.margin));
  const gap = peerMedian !== null ? margin - peerMedian : null;
  const gapTag =
    gap === null
      ? ""
      : Math.abs(gap) < 0.5
        ? " · roughly in line with peer median"
        : gap > 0
          ? ` · ${fmtBps(gap, { sign: false })} above peer median`
          : ` · ${fmtBps(gap, { sign: false })} below peer median`;
  const rankTag =
    rank > 0
      ? ` (rank ${rank} of ${peerMargins.length} listed peers)`
      : "";
  return `${name} PAT margin ${margin.toFixed(1)}%${rankTag}${gapTag}.`;
}

/** Yield sentence — annualised revenue yield in bps vs peer median. */
function yieldSentence(
  slug: string,
  selectedQuarter: string
): string | null {
  const series = quarterlyForAmc(slug);
  const row = series.find((q) => q.quarter === selectedQuarter);
  if (!row) return null;
  const hasAaum =
    aaumProvenance(slug, selectedQuarter)?.status === "ok" &&
    row.avgAum > 0;
  if (!hasAaum) return null;
  const revYield = (row.revenue * 4 * 10_000) / row.avgAum;

  const peerYields: number[] = [];
  for (const peerSlug of SOURCED_FINANCIALS_SLUGS) {
    const peerRow = quarterlyForAmc(peerSlug).find(
      (q) => q.quarter === selectedQuarter
    );
    if (!peerRow) continue;
    const peerOk =
      aaumProvenance(peerSlug, selectedQuarter)?.status === "ok" &&
      peerRow.avgAum > 0;
    if (!peerOk) continue;
    peerYields.push((peerRow.revenue * 4 * 10_000) / peerRow.avgAum);
  }
  const peerMedian = median(peerYields);
  const gap = peerMedian !== null ? revYield - peerMedian : null;
  const gapTag =
    gap === null
      ? ""
      : Math.abs(gap) < 1
        ? " · roughly in line with peer median"
        : gap > 0
          ? ` · +${gap.toFixed(0)} bps above peer median`
          : ` · ${gap.toFixed(0)} bps below peer median`;
  return `Revenue yield ${revYield.toFixed(1)} bps of MF AAUM${gapTag}.`;
}

/** Quarterly read sentence — strongest YoY mover among the three
 *  P&L lines. Falls back to a margin expansion / contraction call
 *  if YoY isn't available. */
function quarterlyReadSentence(
  slug: string,
  selectedQuarter: string
): string | null {
  const series = quarterlyForAmc(slug);
  const row = series.find((q) => q.quarter === selectedQuarter);
  if (!row) return null;
  // YoY = same calendar Q one year earlier.
  const [yStr, qStr] = selectedQuarter.split("-");
  const yoyId = `${Number(yStr) - 1}-${qStr}`;
  const priorRow = series.find((q) => q.quarter === yoyId);
  if (!priorRow) return null;
  const fields: { name: string; cur: number; prior: number }[] = [
    { name: "Operating Revenue", cur: row.revenue, prior: priorRow.revenue },
    {
      name: "Operating Profit",
      cur: row.operatingProfit,
      prior: priorRow.operatingProfit,
    },
    { name: "PAT", cur: row.pat, prior: priorRow.pat },
  ];
  const yoys = fields
    .filter((f) => f.prior > 0)
    .map((f) => ({
      ...f,
      pct: ((f.cur - f.prior) / f.prior) * 100,
    }));
  if (yoys.length === 0) return null;
  // Pick the line with the largest absolute YoY move.
  yoys.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const top = yoys[0];
  // Operating leverage flag — PAT growing faster than Revenue.
  const pat = yoys.find((y) => y.name === "PAT");
  const rev = yoys.find((y) => y.name === "Operating Revenue");
  if (pat && rev && pat.pct - rev.pct >= 5) {
    return `Operating leverage at work — PAT +${pat.pct.toFixed(1)}% YoY vs Revenue +${rev.pct.toFixed(1)}%.`;
  }
  if (pat && rev && rev.pct - pat.pct >= 5) {
    return `Margin pressure — Revenue +${rev.pct.toFixed(1)}% YoY but PAT only ${pat.pct >= 0 ? "+" : ""}${pat.pct.toFixed(1)}%.`;
  }
  return `${top.name} ${top.pct >= 0 ? "+" : ""}${top.pct.toFixed(1)}% YoY in ${fiscalLabelFromCalendarQuarter(selectedQuarter)}.`;
}

export function financialsMarketWrap(
  slug: string,
  selectedQuarter: string
): FinancialsMarketWrap {
  const lines = [
    profitabilitySentence(slug, selectedQuarter),
    yieldSentence(slug, selectedQuarter),
    quarterlyReadSentence(slug, selectedQuarter),
  ].filter((s): s is string => typeof s === "string");
  return {
    asOf: fiscalLabelFromCalendarQuarter(selectedQuarter),
    lines,
  };
}
