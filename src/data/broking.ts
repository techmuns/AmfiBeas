import data from "./snapshots/broking.json";

/** One broker's row in the latest month of the Broking snapshot. */
export interface BrokerRow {
  broker: string;
  activeClients: number;
  sharePct: number;
  prevActiveClients: number | null;
  momChange: number | null;
  momPct: number | null;
  turnoverCr: number | null;
}
export interface BrokingSnapshot {
  generatedAt: string;
  source: string;
  /** True while the newest committed month is still an approximate sample. */
  isSample: boolean;
  note: string;
  latestMonth: string;
  priorMonth: string | null;
  /** Sum of the listed brokers' active clients. */
  totalActiveClients: number;
  /** Whole-NSE active-client total (all members), when supplied — the share base. */
  marketTotalActiveClients: number | null;
  hasTurnover: boolean;
  brokerCount: number;
  months: string[];
  brokers: BrokerRow[];
}

export const broking = data as BrokingSnapshot;
