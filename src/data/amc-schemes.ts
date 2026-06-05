import indexJson from "@/data/portfolio-tracker/index.json";
import { amcOf } from "@/data/amc-name-map";

/**
 * AMC → scheme drill-down off the RupeeVest scheme index.
 *
 * CAVEAT — derived, not an official AMC scheme master. The index tracks schemes
 * with equity holdings (> ~₹500 Cr, a month-end snapshot); schemes are mapped
 * to fund houses by name (amcOf). "Style" is Passive for ETF / Index Fund
 * classes, Active otherwise. A scheme links to its tracked holdings only when
 * the tracker carries them (equity sleeves).
 */
export interface AmcScheme {
  schemecode: string;
  name: string;
  classification: string | null;
  aumTotalCr: number | null;
  isPassive: boolean;
  isEquity: boolean;
  /** Schemecode for a tracker deep-link, when holdings are tracked. */
  holdingsCode: string | null;
  aumAsOf: string | null;
}

interface RawFund {
  schemecode: string;
  name: string;
  fundName: string | null;
  classification: string | null;
  aumTotalCr: number | null;
  aumAsOf?: string;
  file?: string | null;
}

function nameOf(f: RawFund): string {
  return f.fundName ?? f.name;
}

let labelsCache: string[] | null = null;
function indexAmcLabels(): string[] {
  if (labelsCache) return labelsCache;
  const set = new Set<string>();
  for (const f of indexJson.funds as RawFund[]) set.add(amcOf(nameOf(f)));
  labelsCache = [...set];
  return labelsCache;
}

/** The amcOf label that best matches an AAUM displayName (longest prefix wins,
 *  so "Aditya Birla Sun Life AMC" → "Aditya Birla", not a shorter token). */
export function amcLabelForDisplayName(displayName: string): string | null {
  const dn = displayName.toLowerCase();
  const labels = [...indexAmcLabels()].sort((a, b) => b.length - a.length);
  for (const l of labels) if (dn.startsWith(l.toLowerCase())) return l;
  return null;
}

/** All tracked schemes for the AMC behind `displayName`, largest AUM first. */
export function schemesForDisplayName(displayName: string): AmcScheme[] {
  const label = amcLabelForDisplayName(displayName);
  if (!label) return [];
  const out: AmcScheme[] = [];
  for (const f of indexJson.funds as RawFund[]) {
    if (amcOf(nameOf(f)) !== label) continue;
    const cls = f.classification ?? "";
    out.push({
      schemecode: f.schemecode,
      name: nameOf(f),
      classification: f.classification,
      aumTotalCr: typeof f.aumTotalCr === "number" ? f.aumTotalCr : null,
      isPassive: /ETF|Index Fund/i.test(cls),
      isEquity: cls.startsWith("Equity :"),
      holdingsCode: f.file ? f.schemecode : null,
      aumAsOf: f.aumAsOf ?? null,
    });
  }
  return out.sort((a, b) => (b.aumTotalCr ?? 0) - (a.aumTotalCr ?? 0));
}
