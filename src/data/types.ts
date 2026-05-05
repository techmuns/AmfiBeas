export interface AMC {
  slug: string;
  name: string;
  ticker?: string;
  listed: boolean;
}

export interface MonthlyOperating {
  amcSlug: string;
  month: string;
  aum: number;
  equityAum: number;
  sipFlow: number;
  newInvestors: number;
  nfoCount: number;
  schemePerformance?: number;
}

export interface QuarterlyFinancial {
  amcSlug: string;
  quarter: string;
  revenue: number;
  operatingProfit: number;
  pat: number;
  avgAum: number;
}

export interface IndustryMonthly {
  month: string;
  totalAum: number;
  totalEquityAum: number;
  totalSipFlow: number;
  totalNewInvestors: number;
}
