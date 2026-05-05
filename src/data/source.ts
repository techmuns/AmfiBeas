import amcMasterRaw from "./snapshots/amc-master.json";
import schemeNavsRaw from "./snapshots/scheme-navs.json";
import industryMonthlyRaw from "./snapshots/industry-monthly.json";
import amcMonthlyRaw from "./snapshots/amc-monthly.json";
import amcQuarterlyRaw from "./snapshots/amc-quarterly.json";
import otherSchemesRaw from "./snapshots/other-schemes-monthly.json";
import type {
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

export interface DataMode {
  industryMonthly: "live" | "demo";
  amcMonthly: "live" | "demo";
  amcQuarterly: "live" | "demo";
  amcMaster: "live" | "demo";
  otherSchemes: "live" | "demo";
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
  };
}

export function isAnyLive(): boolean {
  const m = dataMode();
  return Object.values(m).some((v) => v === "live");
}

export function latestOtherSchemesByAmc(): Map<
  string,
  { totalAum: number; schemes: number; month: string }
> {
  const map = new Map<
    string,
    { totalAum: number; schemes: number; month: string }
  >();
  for (const r of otherSchemesMonthlySnapshot.rows) {
    const existing = map.get(r.amcName);
    if (!existing || r.month > existing.month) {
      map.set(r.amcName, {
        totalAum: r.totalAum,
        schemes: r.schemes,
        month: r.month,
      });
    }
  }
  return map;
}
