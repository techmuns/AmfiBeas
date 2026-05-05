export interface SnapshotMeta {
  generatedAt: string;
  source: string;
  notes?: string;
}

export interface AmfiAmcEntry {
  amcCode: number;
  name: string;
  schemeCount: number;
}

export interface AmcMasterSnapshot {
  meta: SnapshotMeta;
  amcs: AmfiAmcEntry[];
}

export interface SchemeNav {
  schemeCode: number;
  amcCode: number;
  amcName: string;
  category: string;
  schemeName: string;
  isin?: string;
  nav: number;
  date: string;
}

export interface SchemeNavsSnapshot {
  meta: SnapshotMeta;
  navs: SchemeNav[];
}

export interface IndustryMonthlyRow {
  month: string;
  totalAum: number;
  equityAum: number;
  sipFlow: number;
  folios: number;
  nfoCount?: number;
}

export interface IndustryMonthlySnapshot {
  meta: SnapshotMeta;
  rows: IndustryMonthlyRow[];
}

export interface AmcMonthlyRow {
  amcSlug: string;
  month: string;
  aum: number;
  equityAum: number;
  sipFlow: number;
  newInvestors: number;
  nfoCount: number;
}

export interface AmcMonthlySnapshot {
  meta: SnapshotMeta;
  rows: AmcMonthlyRow[];
}

export interface AmcQuarterlyRow {
  amcSlug: string;
  quarter: string;
  revenue: number;
  operatingProfit: number;
  pat: number;
  avgAum: number;
}

export interface AmcQuarterlySnapshot {
  meta: SnapshotMeta;
  rows: AmcQuarterlyRow[];
}

export const EMPTY_AMC_MASTER: AmcMasterSnapshot = {
  meta: { generatedAt: "", source: "" },
  amcs: [],
};

export const EMPTY_SCHEME_NAVS: SchemeNavsSnapshot = {
  meta: { generatedAt: "", source: "" },
  navs: [],
};

export const EMPTY_INDUSTRY_MONTHLY: IndustryMonthlySnapshot = {
  meta: { generatedAt: "", source: "" },
  rows: [],
};

export const EMPTY_AMC_MONTHLY: AmcMonthlySnapshot = {
  meta: { generatedAt: "", source: "" },
  rows: [],
};

export const EMPTY_AMC_QUARTERLY: AmcQuarterlySnapshot = {
  meta: { generatedAt: "", source: "" },
  rows: [],
};

export interface OtherSchemesMonthlyRow {
  month: string;
  category: string;
  schemes: number;
  folios: number;
  fundsMobilized: number;
  redemption: number;
  netFlow: number;
  aum: number;
}

export interface OtherSchemesMonthlySnapshot {
  meta: SnapshotMeta;
  rows: OtherSchemesMonthlyRow[];
}

export const EMPTY_OTHER_SCHEMES_MONTHLY: OtherSchemesMonthlySnapshot = {
  meta: { generatedAt: "", source: "" },
  rows: [],
};
