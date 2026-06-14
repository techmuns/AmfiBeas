import capData from "./portfolio-tracker/cap-classification.json";

/**
 * Market-cap classification (Large / Mid / Small) for Indian listed stocks,
 * used to bucket mutual-fund equity holdings. Large = the 100 names in the
 * Large Cap list, Mid = the 250 names in the Mid Cap list, Small = everything
 * else. See cap-classification.json for provenance and the alias map.
 */

export type CapTier = "large" | "mid" | "small";

const aliases: Record<string, string> = capData.aliases;

// Token expansions that collapse the abbreviation variants seen in holdings
// (e.g. "Corpn"/"Corp" -> "corporation") so they match the canonical names.
const EXPAND: Record<string, string> = {
  corp: "corporation",
  corpn: "corporation",
  inds: "industries",
  intl: "international",
  internat: "international",
  ser: "services",
  co: "company",
};

const DROP = new Set(["ltd", "limited", "the"]);

/** Canonical key for a company name; tolerant of the many holdings variants. */
export function normalizeCompany(name: string): string {
  const cleaned = String(name)
    .toLowerCase()
    .replace(/^eq\s*-\s*/, "") // segment prefix used by some funds
    .replace(/\([^)]*\)/g, " ") // drop parentheticals e.g. "(India)", "(BSE)"
    .replace(/['’]/g, "") // drop apostrophes: "Divi's" -> "divis"
    .replace(/&/g, " and ")
    .replace(/[.,/\-"]+/g, " ")
    .replace(/^[\s^*#~]+/, "")
    .replace(/[£@*#~]+$/, "");
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !DROP.has(w))
    .map((w) => EXPAND[w] ?? w)
    .join(" ")
    .trim();
}

const tierByKey = new Map<string, CapTier>();
const seed = (names: string[], tier: CapTier) => {
  for (const n of names) {
    const key = normalizeCompany(aliases[n] ?? n);
    if (key && !tierByKey.has(key)) tierByKey.set(key, tier);
  }
};
// Seed large first, then mid: the seed() guard is first-writer-wins
// (`!tierByKey.has(key)`), so seeding large first is what actually makes
// large win on any (unexpected) large/mid collision. (Seeding mid first
// did the opposite of the intended priority.)
seed(capData.large, "large");
seed(capData.mid, "mid");

/** Classify a single company name. Unknown / unlisted names fall back to small. */
export function classifyCap(companyName: string): CapTier {
  return tierByKey.get(normalizeCompany(companyName)) ?? "small";
}

const RANK: Record<CapTier, number> = { large: 3, mid: 2, small: 1 };

/**
 * Classify a company from all the name variants reported for its fincode,
 * taking the strongest match. Holdings spell the same company many ways, so a
 * fincode should be classified from every variant, not just one.
 */
export function classifyCapFromNames(names: Iterable<string>): CapTier {
  let best: CapTier = "small";
  for (const n of names) {
    const t = classifyCap(n);
    if (RANK[t] > RANK[best]) best = t;
  }
  return best;
}

export const largeCapNames: string[] = capData.large;
export const midCapNames: string[] = capData.mid;
