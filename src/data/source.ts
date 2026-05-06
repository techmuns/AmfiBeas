import amcMasterRaw from "./snapshots/amc-master.json";
import schemeNavsRaw from "./snapshots/scheme-navs.json";
import industryMonthlyRaw from "./snapshots/industry-monthly.json";
import amcMonthlyRaw from "./snapshots/amc-monthly.json";
import amcQuarterlyRaw from "./snapshots/amc-quarterly.json";
import otherSchemesRaw from "./snapshots/other-schemes-monthly.json";
import amcAaumRaw from "./snapshots/amc-aaum-quarterly.json";
import type {
  AmcAaumQuarterlyRow,
  AmcAaumQuarterlySnapshot,
  AmcMasterSnapshot,
  AmcMonthlySnapshot,
  AmcQuarterlySnapshot,
  IndustryMonthlySnapshot,
  OtherSchemesMonthlySnapshot,
  SchemeNavsSnapshot,
} from "./snapshots/types";

export const amcMasterSnapshot = amcMasterRaw as AmcMasterSnapshot;
export const schemeNavsSnapshot = schemeNavsRaw as SchemeNavsSnapshot;
export const industryMonthlySnapshot =
  industryMonthlyRaw as IndustryMonthlySnapshot;
export const amcMonthlySnapshot = amcMonthlyRaw as AmcMonthlySnapshot;
export const amcQuarterlySnapshot = amcQuarterlyRaw as AmcQuarterlySnapshot;
export const otherSchemesMonthlySnapshot =
  otherSchemesRaw as OtherSchemesMonthlySnapshot;
export const amcAaumQuarterlySnapshot =
  amcAaumRaw as AmcAaumQuarterlySnapshot;

export interface DataMode {
  industryMonthly: "live" | "demo";
  amcMonthly: "live" | "demo";
  amcQuarterly: "live" | "demo";
  amcMaster: "live" | "demo";
  otherSchemes: "live" | "demo";
  amcAaum: "live" | "demo";
}

export function dataMode(): DataMode {
  return {
    industryMonthly:
      industryMonthlySnapshot.rows.length > 0 ? "live" : "demo",
    amcMonthly: amcMonthlySnapshot.rows.length > 0 ? "live" : "demo",
    amcQuarterly: amcQuarterlySnapshot.rows.length > 0 ? "live" : "demo",
    amcMaster: amcMasterSnapshot.amcs.length > 0 ? "live" : "demo",
    otherSchemes:
      otherSchemesMonthlySnapshot.rows.length > 0 ? "live" : "demo",
    amcAaum:
      amcAaumQuarterlySnapshot.rows.length > 0 ? "live" : "demo",
  };
}

/**
 * Look up a live AAUM value (₹ Cr) for a single AMC + calendar quarter.
 * Returns null if the value is not in the snapshot, or if it fails the
 * deterministic validation (must be a positive finite number with status === "ok").
 */
export function aaumFor(slug: string, quarter: string): number | null {
  const row = amcAaumQuarterlySnapshot.rows.find(
    (r) => r.amcSlug === slug && r.quarter === quarter
  );
  if (!row) return null;
  if (row.status !== "ok") return null;
  if (!Number.isFinite(row.avgAum) || row.avgAum <= 0) return null;
  return row.avgAum;
}

export function aaumProvenance(
  slug: string,
  quarter: string
): AmcAaumQuarterlyRow | null {
  return (
    amcAaumQuarterlySnapshot.rows.find(
      (r) => r.amcSlug === slug && r.quarter === quarter
    ) ?? null
  );
}

export function isAnyLive(): boolean {
  const m = dataMode();
  return Object.values(m).some((v) => v === "live");
}

export interface OtherSchemesMonthTotal {
  month: string;
  totalAum: number;
  totalFolios: number;
  netFlow: number;
  fundsMobilized: number;
  redemption: number;
  categories: number;
}

export function otherSchemesByMonth(): OtherSchemesMonthTotal[] {
  const byMonth = new Map<string, OtherSchemesMonthTotal>();
  for (const r of otherSchemesMonthlySnapshot.rows) {
    const existing = byMonth.get(r.month) ?? {
      month: r.month,
      totalAum: 0,
      totalFolios: 0,
      netFlow: 0,
      fundsMobilized: 0,
      redemption: 0,
      categories: 0,
    };
    existing.totalAum += r.aum;
    existing.totalFolios += r.folios;
    existing.netFlow += r.netFlow;
    existing.fundsMobilized += r.fundsMobilized;
    existing.redemption += r.redemption;
    existing.categories += 1;
    byMonth.set(r.month, existing);
  }
  return Array.from(byMonth.values()).sort((a, b) =>
    a.month.localeCompare(b.month)
  );
}

export function latestOtherSchemesCategoryBreakdown(): {
  month: string;
  rows: { category: string; aum: number; netFlow: number; folios: number }[];
} | null {
  if (otherSchemesMonthlySnapshot.rows.length === 0) return null;
  const months = Array.from(
    new Set(otherSchemesMonthlySnapshot.rows.map((r) => r.month))
  ).sort();
  const latest = months[months.length - 1];
  const rows = otherSchemesMonthlySnapshot.rows
    .filter((r) => r.month === latest)
    .map((r) => ({
      category: r.category,
      aum: r.aum,
      netFlow: r.netFlow,
      folios: r.folios,
    }))
    .sort((a, b) => b.aum - a.aum);
  return { month: latest, rows };
}
