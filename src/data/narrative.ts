/**
 * Rule-based "what changed this month / quarter" narrative engine.
 *
 * No LLM, no synthesis: every fact below is derived deterministically
 * from existing AMFI snapshots so it is reproducible across runs and
 * obviously safe to render to a client-facing dashboard.
 *
 * Each fact carries:
 *   - tone        ("positive" | "neutral" | "negative")
 *   - significance (number; higher = more important — used for sort
 *     order, not displayed)
 *   - title        (short headline)
 *   - detail       (one-line explanation)
 *
 * Callers render the top N facts and hide the rest.
 */

import { fmtBps } from "../lib/units";
import { amfiMonthlyRows } from "./amfi-monthly";
import { amfiQuarterlyIndustryRows } from "./amfi-quarterly";
import {
  allAmcAaumRowsForQuarter,
  latestAaumQuarter,
} from "./amc-peer-universe";
import { amcAaumQuarterlySnapshot } from "./source";

export type NarrativeTone = "positive" | "neutral" | "negative";

export interface NarrativeFact {
  id: string;
  tone: NarrativeTone;
  significance: number;
  title: string;
  detail: string;
}

function pctChange(now: number, prev: number): number {
  if (prev === 0) return 0;
  return ((now - prev) / prev) * 100;
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L Cr`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K Cr`;
  return `${sign}₹${Math.round(abs)} Cr`;
}

function formatCrLong(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  // 1 trillion rupees = 1 lakh crore = 1e5 ₹ Cr. Above ₹100 trn (1e7 Cr)
  // switch the label to "trn" to avoid an unwieldy "100.00L Cr"; both
  // branches scale by 1e5 (the old "trn" branch divided by 1e7, rendering
  // ₹100 trn as a wrong "1.00 trn").
  if (abs >= 1e7) {
    return `${sign}₹${(abs / 1e5).toFixed(2)} trn`;
  }
  if (abs >= 1e5) {
    return `${sign}₹${(abs / 1e5).toFixed(2)}L Cr`;
  }
  return formatCompact(value);
}

function deltaPctLabel(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

/**
 * Generate the prioritized list of industry-level facts. Returns at
 * most `maxFacts` items sorted by significance descending.
 */
export function industryNarrative(maxFacts = 6): NarrativeFact[] {
  const facts: NarrativeFact[] = [];

  const monthly = amfiMonthlyRows();
  const last = monthly[monthly.length - 1];
  const prev = monthly[monthly.length - 2];
  const yearAgo = monthly[monthly.length - 13];

  // Industry AUM milestones + YoY growth
  if (last && yearAgo && typeof last.totalAum === "number" && typeof yearAgo.totalAum === "number") {
    const yoy = pctChange(last.totalAum, yearAgo.totalAum);
    facts.push({
      id: "industry-aum-yoy",
      tone: yoy >= 0 ? "positive" : "negative",
      significance: 90,
      title: `Industry AUM ${formatCrLong(last.totalAum)} (${deltaPctLabel(yoy)} YoY)`,
      detail: `Closing AUM at ${last.month}. A year ago: ${formatCrLong(yearAgo.totalAum)}.`,
    });

    // Round-trillion threshold crossing. totalAum is in ₹ Cr and 1 trillion
    // rupees = 1 lakh crore = 1e5 Cr (NOT 1e7 — that divisor is ₹100 trn per
    // unit, which kept lastInTrn pinned at 0 so this milestone never fired).
    const lastInTrn = Math.floor(last.totalAum / 1e5);
    const yearAgoInTrn = Math.floor(yearAgo.totalAum / 1e5);
    if (lastInTrn > yearAgoInTrn) {
      facts.push({
        id: "industry-aum-milestone",
        tone: "positive",
        significance: 95,
        title: `Industry AUM crossed ₹${lastInTrn} trn`,
        detail: `Industry AUM has crossed the ₹${lastInTrn} trillion mark since a year ago.`,
      });
    }
  }

  // SIP contribution / SIP AUM / SIP accounts (latest month vs same month last year)
  if (last && yearAgo) {
    if (typeof last.sipContribution === "number" && typeof yearAgo.sipContribution === "number") {
      const yoy = pctChange(last.sipContribution, yearAgo.sipContribution);
      facts.push({
        id: "sip-contribution-yoy",
        tone: yoy >= 0 ? "positive" : "negative",
        significance: 80,
        title: `Monthly SIP ${formatCompact(last.sipContribution)} (${deltaPctLabel(yoy)} YoY)`,
        detail: `${last.month} SIP contribution vs the same month a year earlier.`,
      });
    }
    if (
      typeof last.sipAccounts === "number" &&
      typeof yearAgo.sipAccounts === "number"
    ) {
      const yoy = pctChange(last.sipAccounts, yearAgo.sipAccounts);
      const accountsCr = last.sipAccounts / 1e7;
      facts.push({
        id: "sip-accounts-yoy",
        tone: yoy >= 0 ? "positive" : "negative",
        significance: 70,
        title: `${accountsCr.toFixed(2)} Cr live SIP accounts (${deltaPctLabel(yoy)} YoY)`,
        detail: `Active SIP account count at ${last.month}.`,
      });
    }
  }

  // Net inflow sign-flips + magnitude callout
  if (last && typeof last.netInflow === "number") {
    if (last.netInflow < 0) {
      facts.push({
        id: "negative-net-inflow",
        tone: "negative",
        significance: 95,
        title: `Net outflow month: ${formatCompact(last.netInflow)}`,
        detail: `${last.month} closed with industry net outflows. Sign-flip from inflow status.`,
      });
    } else if (prev && typeof prev.netInflow === "number") {
      const yoy =
        yearAgo && typeof yearAgo.netInflow === "number"
          ? pctChange(last.netInflow, yearAgo.netInflow)
          : null;
      if (yoy !== null) {
        facts.push({
          id: "net-inflow-yoy",
          tone: yoy >= 0 ? "positive" : "neutral",
          significance: 60,
          title: `Net inflow ${formatCompact(last.netInflow)} (${deltaPctLabel(yoy)} YoY)`,
          detail: `${last.month} total industry net inflow.`,
        });
      }
    }
  }

  // Active equity share trajectory (3-month slope)
  if (monthly.length >= 4) {
    const slice = monthly.slice(-3);
    const ratios = slice
      .filter(
        (r) =>
          typeof r.activeEquityAaum === "number" && typeof r.totalAaum === "number" && r.totalAaum > 0
      )
      .map((r) => ((r.activeEquityAaum as number) / (r.totalAaum as number)) * 100);
    if (ratios.length === 3) {
      const delta = ratios[2] - ratios[0];
      if (Math.abs(delta) >= 0.25) {
        facts.push({
          id: "active-equity-share-shift",
          tone: delta >= 0 ? "positive" : "negative",
          significance: 55,
          title: `Active equity share ${delta >= 0 ? "up" : "down"} ${fmtBps(delta, { sign: false })} over 3 months`,
          detail: `Latest ${ratios[2].toFixed(2)}% of total AAUM, vs ${ratios[0].toFixed(2)}% three months ago.`,
        });
      }
    }
  }

  // Industry folio count milestone
  if (last && yearAgo && typeof last.industryFolios === "number" && typeof yearAgo.industryFolios === "number") {
    const lastInCr = Math.floor(last.industryFolios / 1e7);
    const yearAgoInCr = Math.floor(yearAgo.industryFolios / 1e7);
    if (lastInCr > yearAgoInCr) {
      facts.push({
        id: "industry-folios-milestone",
        tone: "positive",
        significance: 75,
        title: `Industry folio count crossed ${lastInCr} crore`,
        detail: `From ~${yearAgoInCr} crore folios a year ago to ${(last.industryFolios / 1e7).toFixed(2)} crore today.`,
      });
    }
  }

  // Concentration shift — top-7 AAUM share at the latest quarter vs the year-earlier quarter
  const latestQ = latestAaumQuarter();
  if (latestQ) {
    const sorted = [...amcAaumQuarterlySnapshot.rows]
      .filter((r) => r.status === "ok")
      .sort((a, b) => a.quarter.localeCompare(b.quarter));
    const quarters = Array.from(new Set(sorted.map((r) => r.quarter)));
    const yearAgoQ = quarters[quarters.indexOf(latestQ) - 4];
    if (yearAgoQ) {
      const nowRows = allAmcAaumRowsForQuarter(latestQ);
      const yaRows = allAmcAaumRowsForQuarter(yearAgoQ);
      const nowTotal = nowRows.reduce((s, r) => s + r.avgAum, 0);
      const yaTotal = yaRows.reduce((s, r) => s + r.avgAum, 0);
      if (nowTotal > 0 && yaTotal > 0) {
        const nowTop7 = nowRows.slice(0, 7).reduce((s, r) => s + r.avgAum, 0);
        const yaTop7 = yaRows.slice(0, 7).reduce((s, r) => s + r.avgAum, 0);
        const nowShare = (nowTop7 / nowTotal) * 100;
        const yaShare = (yaTop7 / yaTotal) * 100;
        const delta = nowShare - yaShare;
        if (Math.abs(delta) >= 0.3) {
          facts.push({
            id: "top7-share-shift",
            tone: delta < 0 ? "positive" : "neutral",
            significance: 65,
            title: `Top-7 AMC share ${delta >= 0 ? "up" : "down"} ${fmtBps(delta, { sign: false })} YoY`,
            detail: `Top 7 AMCs hold ${nowShare.toFixed(2)}% of industry AAUM at ${latestQ}, vs ${yaShare.toFixed(2)}% at ${yearAgoQ}.`,
          });
        }
      }
    }
  }

  // Listed-AMC PAT trajectory
  const quarterlyIndustry = amfiQuarterlyIndustryRows();
  if (quarterlyIndustry.length >= 1) {
    // Use the listed-AMC P&L data, not the industry row — but the
    // industry row carries Funds Mobilized which we already surface
    // elsewhere. Here we surface the AAUM-comparable QAAUM headline.
    const lastQ = quarterlyIndustry[quarterlyIndustry.length - 1];
    if (
      lastQ.grandTotalLastMonthAaum &&
      quarterlyIndustry[quarterlyIndustry.length - 5]?.grandTotalLastMonthAaum
    ) {
      const yaQ = quarterlyIndustry[quarterlyIndustry.length - 5];
      const yoy = pctChange(
        lastQ.grandTotalLastMonthAaum,
        yaQ.grandTotalLastMonthAaum as number
      );
      facts.push({
        id: "qaum-yoy",
        tone: yoy >= 0 ? "positive" : "negative",
        significance: 50,
        title: `Industry QAAUM ${deltaPctLabel(yoy)} YoY`,
        detail: `${lastQ.quarter} last-month AAUM: ${formatCrLong(lastQ.grandTotalLastMonthAaum)}. A year earlier (${yaQ.quarter}): ${formatCrLong(yaQ.grandTotalLastMonthAaum as number)}.`,
      });
    }
  }

  return facts
    .sort((a, b) => b.significance - a.significance)
    .slice(0, maxFacts);
}
