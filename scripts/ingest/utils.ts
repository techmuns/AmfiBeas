import fs from "node:fs/promises";
import path from "node:path";

export const SNAPSHOT_DIR = path.resolve(
  process.cwd(),
  "src/data/snapshots"
);

export async function fetchText(url: string, timeoutMs = 60_000): Promise<string> {
  return (await fetchResponse(url, timeoutMs)).text();
}

export async function fetchBuffer(
  url: string,
  timeoutMs = 60_000
): Promise<ArrayBuffer> {
  return (await fetchResponse(url, timeoutMs)).arrayBuffer();
}

async function fetchResponse(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res;
  } finally {
    clearTimeout(t);
  }
}

export async function writeSnapshot(name: string, data: unknown): Promise<void> {
  const file = path.join(SNAPSHOT_DIR, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function readSnapshot<T>(name: string): Promise<T | null> {
  const file = path.join(SNAPSHOT_DIR, name);
  try {
    const text = await fs.readFile(file, "utf8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export interface MergeStats {
  added: number; // (slug, quarter) pairs new in this fetch
  updated: number; // (slug, quarter) pairs that existed and got refreshed
  preserved: number; // (slug, quarter) pairs untouched from prior snapshot
  total: number; // final row count
}

/**
 * Merge new rows into prior rows by (amcSlug, quarter). New rows replace
 * existing ones with the same key; rows not present in `next` are kept.
 * Result is sorted by (quarter ascending, amcSlug ascending) for stable diffs.
 *
 * Use for snapshots that should grow forward and never lose history when
 * a fetch returns a smaller window than the last successful run.
 */
export function mergeBySlugQuarter<
  T extends { amcSlug: string; quarter: string },
>(prev: T[], next: T[]): { rows: T[]; stats: MergeStats } {
  const key = (r: T) => `${r.amcSlug}::${r.quarter}`;
  const map = new Map<string, T>();
  for (const r of prev) map.set(key(r), r);
  let added = 0;
  let updated = 0;
  for (const r of next) {
    const k = key(r);
    if (map.has(k)) updated += 1;
    else added += 1;
    map.set(k, r);
  }
  const rows = Array.from(map.values()).sort((a, b) => {
    if (a.quarter !== b.quarter) return a.quarter.localeCompare(b.quarter);
    return a.amcSlug.localeCompare(b.amcSlug);
  });
  const stats: MergeStats = {
    added,
    updated,
    preserved: prev.length - updated,
    total: rows.length,
  };
  return { rows, stats };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function info(msg: string) {
  process.stdout.write(`[ingest] ${msg}\n`);
}

export function warn(msg: string) {
  process.stderr.write(`[ingest][warn] ${msg}\n`);
}

const MONTHS_LOOKUP: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export function parseMonth(s: string): string | null {
  if (!s) return null;
  const cleaned = s.replace(/\s+/g, " ").trim().toLowerCase();
  let m = cleaned.match(/^([a-z]{3,9})[\s\-,]+'?(\d{2,4})$/);
  if (!m) m = cleaned.match(/^([a-z]{3,9})\s*(\d{2,4})$/);
  if (!m) m = cleaned.match(/(\d{4})-(\d{2})/);
  if (m && /^\d{4}$/.test(m[1])) {
    return `${m[1]}-${m[2].padStart(2, "0")}`;
  }
  if (m) {
    const monthName = m[1];
    const yearRaw = m[2];
    const monthNum = MONTHS_LOOKUP[monthName];
    if (!monthNum) return null;
    let year = Number(yearRaw);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    return `${year}-${String(monthNum).padStart(2, "0")}`;
  }
  return null;
}

export function parseNumberLoose(s: unknown): number | null {
  if (typeof s === "number" && Number.isFinite(s)) return s;
  if (typeof s !== "string") return null;
  const cleaned = s.replace(/[,₹\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
