import amcMasterRaw from "./snapshots/amc-master.json";
import schemeNavsRaw from "./snapshots/scheme-navs.json";
import industryMonthlyRaw from "./snapshots/industry-monthly.json";
import amcMonthlyRaw from "./snapshots/amc-monthly.json";
import amcQuarterlyRaw from "./snapshots/amc-quarterly.json";
import type {
  AmcMasterSnapshot,
  AmcMonthlySnapshot,
  AmcQuarterlySnapshot,
  IndustryMonthlySnapshot,
  SchemeNavsSnapshot,
} from "./snapshots/types";

export const amcMasterSnapshot = amcMasterRaw as AmcMasterSnapshot;
export const schemeNavsSnapshot = schemeNavsRaw as SchemeNavsSnapshot;
export const industryMonthlySnapshot =
  industryMonthlyRaw as IndustryMonthlySnapshot;
export const amcMonthlySnapshot = amcMonthlyRaw as AmcMonthlySnapshot;
export const amcQuarterlySnapshot = amcQuarterlyRaw as AmcQuarterlySnapshot;

export interface DataMode {
  industryMonthly: "live" | "demo";
  amcMonthly: "live" | "demo";
  amcQuarterly: "live" | "demo";
  amcMaster: "live" | "demo";
}

export function dataMode(): DataMode {
  return {
    industryMonthly:
      industryMonthlySnapshot.rows.length > 0 ? "live" : "demo",
    amcMonthly: amcMonthlySnapshot.rows.length > 0 ? "live" : "demo",
    amcQuarterly: amcQuarterlySnapshot.rows.length > 0 ? "live" : "demo",
    amcMaster: amcMasterSnapshot.amcs.length > 0 ? "live" : "demo",
  };
}

export function isAnyLive(): boolean {
  const m = dataMode();
  return Object.values(m).some((v) => v === "live");
}
