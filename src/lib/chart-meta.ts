import { AMCS } from "@/data/amcs";

// 12 distinct hues so peer cohorts of up to a dozen AMCs each get their own
// colour instead of recycling after six (which made pairs like SBI/Axis and
// HDFC/Mirae render identically). Theme-aware via the --chart-* vars.
const PALETTE = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "hsl(var(--chart-6))",
  "hsl(var(--chart-7))",
  "hsl(var(--chart-8))",
  "hsl(var(--chart-9))",
  "hsl(var(--chart-10))",
  "hsl(var(--chart-11))",
  "hsl(var(--chart-12))",
];

export const AMC_COLORS: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  AMCS.forEach((a, i) => {
    map[a.slug] = PALETTE[i % PALETTE.length];
  });
  map["others"] = "hsl(var(--muted-foreground))";
  return map;
})();

export function amcLabel(slug: string): string {
  if (slug === "others") return "Others";
  return AMCS.find((a) => a.slug === slug)?.name ?? slug;
}

export function amcShortLabel(slug: string): string {
  if (slug === "others") return "Others";
  const profile = AMCS.find((a) => a.slug === slug);
  if (!profile) return slug;
  return profile.ticker ?? profile.name.split(" ")[0];
}
