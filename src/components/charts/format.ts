import {
  formatCompactCr,
  formatAxisCr,
  formatMonthLabel,
  formatQuarterLabel,
} from "@/lib/format";

export type ValueFormat = "cr" | "pct" | "bps" | "lakh" | "count" | "crore-count";
export type AxisFormat = "cr" | "pct" | "bps" | "lakh" | "count" | "crore-count";
export type LabelFormat = "month" | "quarter" | "none";

export function valueFormatter(fmt: ValueFormat): (n: number) => string {
  switch (fmt) {
    case "cr":
      return (n) => formatCompactCr(n);
    case "pct":
      return (n) => `${n.toFixed(1)}%`;
    case "bps":
      return (n) => `${n.toFixed(1)} bps`;
    case "lakh":
      return (n) => `${(n / 1e5).toFixed(1)} L`;
    case "count":
      return (n) => n.toLocaleString("en-IN");
    // Raw count → divided by 1e7 for an Indian-numbering "Cr" suffix
    // (e.g. 97,200,000 → "9.72 Cr"). Used for SIP-account counts.
    case "crore-count":
      return (n) => `${(n / 1e7).toFixed(2)} Cr`;
  }
}

export function axisFormatter(fmt: AxisFormat): (n: number) => string {
  switch (fmt) {
    case "cr":
      return (n) => formatAxisCr(n);
    case "pct":
      return (n) => `${n.toFixed(0)}%`;
    case "bps":
      return (n) => `${n.toFixed(0)}`;
    case "lakh":
      return (n) => `${(n / 1e5).toFixed(0)}L`;
    case "count":
      return (n) => String(n);
    case "crore-count":
      return (n) => `${(n / 1e7).toFixed(1)}`;
  }
}

export function labelFormatter(fmt: LabelFormat): (s: string) => string {
  switch (fmt) {
    case "month":
      return formatMonthLabel;
    case "quarter":
      return formatQuarterLabel;
    case "none":
      return (s) => s;
  }
}
