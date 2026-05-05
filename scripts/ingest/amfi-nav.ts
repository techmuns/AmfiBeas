import type {
  AmcMasterSnapshot,
  AmfiAmcEntry,
  SchemeNav,
} from "../../src/data/snapshots/types";
import { fetchText, info, nowIso, warn, writeSnapshot } from "./utils";

const NAV_URL = "https://www.amfiindia.com/spages/NAVAll.txt";

const SECTION_RE = /^(Open|Close|Interval) Ended Schemes/i;

export function parseNavAll(text: string): SchemeNav[] {
  const lines = text.split(/\r?\n/);
  const out: SchemeNav[] = [];
  let category = "";
  let amcName = "";
  const codeMap = new Map<string, number>();
  let nextCode = 1;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (SECTION_RE.test(line)) {
      category = line;
      continue;
    }

    if (line.startsWith("Scheme Code")) continue;

    if (!line.includes(";")) {
      amcName = line;
      if (!codeMap.has(amcName)) {
        codeMap.set(amcName, nextCode++);
      }
      continue;
    }

    const parts = line.split(";").map((s) => s.trim());
    if (parts.length < 6) continue;
    const [code, isinG, isinR, schemeName, navStr, date] = parts;
    const schemeCode = Number(code);
    const nav = Number(navStr);
    if (!Number.isFinite(schemeCode) || !Number.isFinite(nav)) continue;
    const amcCode = codeMap.get(amcName) ?? 0;
    const isin =
      isinG && isinG !== "-"
        ? isinG
        : isinR && isinR !== "-"
        ? isinR
        : undefined;

    out.push({
      schemeCode,
      amcCode,
      amcName,
      category,
      schemeName,
      isin,
      nav,
      date,
    });
  }

  return out;
}

export function deriveAmcMaster(navs: SchemeNav[]): AmfiAmcEntry[] {
  const counts = new Map<string, { code: number; count: number }>();
  for (const n of navs) {
    if (!n.amcName) continue;
    const existing = counts.get(n.amcName);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(n.amcName, { code: n.amcCode, count: 1 });
    }
  }
  return Array.from(counts.entries())
    .map(([name, { code, count }]) => ({
      amcCode: code,
      name,
      schemeCount: count,
    }))
    .sort((a, b) => b.schemeCount - a.schemeCount);
}

export async function ingestAmfiAmcMaster(): Promise<void> {
  info(`fetching ${NAV_URL}`);
  const text = await fetchText(NAV_URL);
  const navs = parseNavAll(text);
  info(`parsed ${navs.length} schemes`);
  if (navs.length === 0) {
    warn("zero schemes parsed — keeping previous snapshot");
    return;
  }
  const amcs = deriveAmcMaster(navs);
  info(`derived ${amcs.length} AMCs`);

  const snapshot: AmcMasterSnapshot = {
    meta: {
      generatedAt: nowIso(),
      source: NAV_URL,
      notes:
        "Derived from AMFI NAVAll.txt. Counts are open scheme counts (all categories).",
    },
    amcs,
  };
  await writeSnapshot("amc-master.json", snapshot);
  info("wrote amc-master.json");
}
