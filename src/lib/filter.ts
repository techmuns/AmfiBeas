import { AMCS } from "@/data/amcs";

export type DateRange = "all" | "12m" | "24m" | "4q" | "8q";

export interface FilterState {
  amcs: string[];
  range: DateRange;
}

const VALID_RANGES: DateRange[] = ["all", "12m", "24m", "4q", "8q"];

export function parseFilters(
  searchParams: Record<string, string | string[] | undefined>
): FilterState {
  const raw = searchParams.amcs;
  const amcsParam = typeof raw === "string" ? raw : "";
  const valid = new Set(AMCS.map((a) => a.slug));
  const amcs = amcsParam
    ? amcsParam.split(",").filter((s) => valid.has(s))
    : [];

  const rangeRaw =
    typeof searchParams.range === "string" ? searchParams.range : "all";
  const range = (VALID_RANGES.includes(rangeRaw as DateRange)
    ? rangeRaw
    : "all") as DateRange;

  return { amcs, range };
}

export function selectedSlugs(state: FilterState): string[] | null {
  return state.amcs.length === 0 ? null : state.amcs;
}

export function trimMonths(months: string[], range: DateRange): string[] {
  if (range === "12m") return months.slice(-12);
  if (range === "24m") return months.slice(-24);
  return months;
}

export function trimQuarters(quarters: string[], range: DateRange): string[] {
  if (range === "4q") return quarters.slice(-4);
  if (range === "8q") return quarters.slice(-8);
  return quarters;
}
