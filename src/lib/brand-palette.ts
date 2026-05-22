export const BRAND = {
  navy: "#1F4E78",
  orange: "#ED7D31",
  green: "#548235",
  burgundy: "#993366",
  grid: "#E5E5E5",
  labelOnFill: "#FFFFFF",
  axis: "#4A4A4A",
  source: "#7A7A7A",
} as const;

export type BrandToken = keyof typeof BRAND;
