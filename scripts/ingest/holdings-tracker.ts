/**
 * Scheme-wise equity-holdings refresh from the RupeeVest Mutual Fund Portfolio
 * Tracker (https://www.rupeevest.com/Mutual-Fund-Portfolio-Tracker).
 *
 * Each scheme's holdings come from
 *   https://www.rupeevest.com/home/get_mf_portfolio_tracker?schemecode=<code>
 * which returns a per-scheme grid of "No. of Shares" + "% of AUM" per company
 * across the last few months. We refresh it monthly so a new month (e.g. May)
 * appends to the public/holdings/<code>-<slug>.json snapshots the dashboard
 * already serves.
 *
 * UNIVERSE — "based on the previous benchmark (> ₹500 Cr AUM)". We do NOT
 * re-derive the universe from scratch; we iterate the funds already recorded in
 *   src/data/portfolio-tracker/index.json
 * which is exactly the cohort that passed the > ₹500 Cr filter on the last full
 * build (meta.minAumCr = 500, meta.keptAboveThreshold = 1112). That keeps the
 * monthly job tightly scoped to the ~1.1k funds that matter instead of the full
 * ~2.1k scheme list.
 *
 * MERGE, never clobber — the tracker only exposes a short rolling window, so we
 * MERGE the freshly fetched months into each existing snapshot (fresh data wins
 * for overlapping months; older months already on disk are preserved) and
 * recompute the change arrows across the full merged window. History grows
 * forward, matching the repo's nav-history-forward / index-history-forward
 * convention. Cap with HOLDINGS_MAX_MONTHS (default 18).
 *
 * SAFETY — per fund, a fetch/parse failure or an empty parse keeps the
 * last-good snapshot untouched (never wiped). The parser THROWS on an
 * unrecognised response rather than writing blanks, so a wrong assumption
 * surfaces as a loud "kept (failed)" count instead of silent corruption. If
 * EVERY attempted fund fails, the script exits non-zero without rewriting the
 * index, so the workflow's commit step is skipped (keep-last-good, globally).
 *
 * MODES (env or argv):
 *   HOLDINGS_PROBE=1 | --probe   Fetch a few schemes, dump the raw response to
 *                                data/debug/ and print its shape. No writes.
 *                                Use this FIRST to confirm the response format.
 *   HOLDINGS_LIMIT=N | --limit N Only process the first N funds (test runs).
 *   HOLDINGS_CONCURRENCY=N       Parallel in-flight requests (default 4).
 *   HOLDINGS_DELAY_MS=N          Polite per-request jitter ceiling (default 350).
 *   HOLDINGS_MAX_MONTHS=N        Cap merged window length (default 18).
 *
 * Run:  npx tsx scripts/ingest/holdings-tracker.ts
 */
import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { fetchText, info, warn, nowIso } from "./utils";

const ROOT = process.cwd();
const INDEX_PATH = path.join(ROOT, "src", "data", "portfolio-tracker", "index.json");
const DEBUG_DIR = path.join(ROOT, "data", "debug");

const SOURCE_URL = "https://www.rupeevest.com/Mutual-Fund-Portfolio-Tracker";
const ENDPOINT = "https://www.rupeevest.com/home/get_mf_portfolio_tracker";
const ARROW_LOGIC =
  "Per the tracker UI: arrow compares a month's share count to the next-older " +
  "month (up=increase, down=decrease, flat/none=no change). Oldest column shows " +
  "no arrow (flat/none). 'missing' = no holding reported that month.";

// ---- knobs ---------------------------------------------------------------
const argv = process.argv.slice(2);
function flag(name: string): boolean {
  return argv.includes(`--${name}`);
}
function argVal(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  return undefined;
}
const PROBE = flag("probe") || process.env.HOLDINGS_PROBE === "1";
const LIMIT = Number(argVal("limit") ?? process.env.HOLDINGS_LIMIT ?? "0") || 0;
const CONCURRENCY = Math.max(
  1,
  Number(process.env.HOLDINGS_CONCURRENCY ?? "4") || 4
);
const DELAY_MS = Math.max(0, Number(process.env.HOLDINGS_DELAY_MS ?? "350") || 0);
const MAX_MONTHS = Math.max(
  1,
  Number(process.env.HOLDINGS_MAX_MONTHS ?? "18") || 18
);
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---- shapes (mirror src/data/portfolio-tracker.ts) -----------------------
export interface IndexEntry {
  schemecode: string;
  name: string;
  fundName: string | null;
  classification: string | null;
  aumTotalCr: number | null;
  aumAsOf: string | null;
  rowCount: number;
  file: string | null;
}
interface IndexFile {
  meta: Record<string, unknown>;
  funds: IndexEntry[];
  errors?: unknown[];
}

interface Cell {
  aum_pct_raw: string;
  aum_pct_num: number | null;
  shares_raw: string;
  shares_num: number | null;
  arrow: "up" | "down" | "flat/none" | "missing" | "unknown";
  arrow_raw: string | null;
}
interface Row {
  company_name: string;
  fincode: string;
  months: Record<string, Cell>;
}
interface MonthMeta {
  label: string;
  aumCr: string | number | null;
}
export interface FundPortfolio {
  meta: {
    source: string;
    endpoint: string;
    fund: string;
    schemecode: string;
    classification: string | null;
    aumTotalCr: number | null;
    aumAsOf: string | null;
    scrapedAt: string;
    months: MonthMeta[];
    section: string;
    extractionMethod: string;
    arrowLogic: string;
  };
  rows: Row[];
}

// Parser output (arrows are derived later, over the merged window).
interface ParsedCell {
  aum_pct_raw: string;
  aum_pct_num: number | null;
  shares_raw: string;
  shares_num: number | null;
}
interface ParsedRow {
  company_name: string;
  fincode: string;
  cells: Record<string, ParsedCell>;
}
export interface ParsedTracker {
  fund: string | null;
  classification: string | null;
  aumTotalCr: number | null;
  months: MonthMeta[];
  rows: ParsedRow[];
  method: string;
}

// ---- small helpers -------------------------------------------------------
function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** "Apr-26" -> "apr_26" (matches portfolio-tracker.ts monthSlug). */
function monthSlug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const MONTHS_LOOKUP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "Apr-26" -> 202604 (sortable; descending = newest first). */
export function monthSortKey(label: string): number {
  const m = label.trim().toLowerCase().match(/^([a-z]{3})[^0-9]*'?(\d{2,4})$/);
  if (!m) return 0;
  const mo = MONTHS_LOOKUP[m[1]] ?? 0;
  let y = Number(m[2]);
  if (y < 100) y += 2000;
  return y * 100 + mo;
}

/** "May-26" -> ISO of the month's last day at 00:00 UTC ("2026-05-31T…"). */
export function monthEndIso(label: string | undefined): string | null {
  if (!label) return null;
  const m = label.trim().toLowerCase().match(/^([a-z]{3})[^0-9]*'?(\d{2,4})$/);
  if (!m) return null;
  const mo = MONTHS_LOOKUP[m[1]];
  if (!mo) return null;
  let y = Number(m[2]);
  if (y < 100) y += 2000;
  // Day 0 of the *next* month (1-based mo) === last day of `mo`.
  return new Date(Date.UTC(y, mo, 0)).toISOString();
}

/** Indian-grouped numeric string -> number. "76,97,626" -> 7697626. */
export function parseIndianNumber(s: string): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[,₹%\s]/g, "");
  if (!cleaned || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Normalise "Apr-26", "April 2026", "Apr 26" -> canonical "Apr-26". */
export function canonMonthLabel(raw: string): string | null {
  const m = raw.trim().toLowerCase().match(/^([a-z]{3,9})[^0-9]*'?(\d{2,4})$/);
  if (!m) return null;
  const mo = MONTHS_LOOKUP[m[1].slice(0, 3)];
  if (!mo) return null;
  let y = Number(m[2]);
  if (y >= 100) y = y % 100;
  const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MON[mo]}-${String(y).padStart(2, "0")}`;
}

/** Stable identity for a holdings row across snapshots. */
function keyOf(r: { fincode?: string | null; company_name?: string | null }): string {
  const fc = String(r.fincode ?? "").trim();
  if (fc) return fc;
  return `name:${String(r.company_name ?? "").toLowerCase().trim()}`;
}

/** Filesystem-safe slug for a *new* holdings file ("DSP Flexi…(G)" → "dsp-flexi…-g"). */
function fundFileSlug(schemecode: string, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${schemecode}-${slug}.json`;
}

// ---- fetch ---------------------------------------------------------------
async function fetchTracker(schemecode: string): Promise<string> {
  const url = `${ENDPOINT}?schemecode=${encodeURIComponent(schemecode)}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    try {
      return await fetchText(url, FETCH_TIMEOUT_MS);
    } catch (e) {
      lastErr = e;
      if (attempt < FETCH_ATTEMPTS) await sleep(500 * attempt * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// ---- parse ---------------------------------------------------------------
// The tracker response is parsed here in isolation. RupeeVest's endpoint
// returns the holdings grid as an HTML table (optionally wrapped in a small
// JSON envelope); we handle both. The parser THROWS when it cannot find a
// month-bearing holdings table so the caller keeps the last-good snapshot
// instead of overwriting it with blanks. Confirm/adjust the selectors with
// `--probe` before trusting a full run.
export function parseTracker(raw: string, schemecode: string): ParsedTracker {
  const text = raw.trim();

  // JSON envelope? Pull out an embedded HTML payload or structured rows.
  let html: string | null = null;
  let envelope: Record<string, unknown> | null = null;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const j = JSON.parse(text) as unknown;
      if (typeof j === "string") {
        html = j;
      } else if (j && typeof j === "object") {
        envelope = j as Record<string, unknown>;
        for (const v of Object.values(envelope)) {
          if (typeof v === "string" && /<\s*(table|tr|td|th)\b/i.test(v)) {
            html = v;
            break;
          }
        }
      }
    } catch {
      /* not JSON after all — treat as raw HTML below */
    }
  }
  if (html === null && /<\s*(table|tr|td|th)\b/i.test(text)) html = text;

  if (html === null) {
    throw new Error(
      `scheme ${schemecode}: no HTML holdings table found in response ` +
        `(len=${text.length}, head=${JSON.stringify(text.slice(0, 120))})`
    );
  }

  const $ = cheerio.load(html);

  // Locate the holdings table: the one whose header row carries >= 1
  // month-like token (e.g. "Apr-26" / "April 2026").
  let table: ReturnType<typeof $>[number] | null = null;
  let headerCells: string[] = [];
  $("table").each((_i, el) => {
    if (table) return;
    const headRow = $(el).find("tr").first();
    const cells = headRow
      .find("th,td")
      .map((_j, c) => $(c).text().replace(/\s+/g, " ").trim())
      .get();
    const monthHits = cells.filter((c) => canonMonthLabel(c) !== null);
    if (monthHits.length >= 1) {
      table = el;
      headerCells = cells;
    }
  });

  if (!table) {
    throw new Error(
      `scheme ${schemecode}: holdings table present but no month columns ` +
        `recognised (tables=${$("table").length})`
    );
  }

  // Header cell index -> canonical month label.
  const monthCols: { idx: number; label: string }[] = [];
  headerCells.forEach((c, idx) => {
    const label = canonMonthLabel(c);
    if (label) monthCols.push({ idx, label });
  });

  const seenMonths = new Set<string>();
  const months: MonthMeta[] = [];
  for (const mc of monthCols) {
    if (seenMonths.has(mc.label)) continue;
    seenMonths.add(mc.label);
    months.push({ label: mc.label, aumCr: "-" });
  }

  const rows: ParsedRow[] = [];
  $(table)
    .find("tr")
    .slice(1)
    .each((_i, tr) => {
      const $tr = $(tr);
      const tds = $tr.find("td");
      if (tds.length === 0) return;
      const nameCell = $(tds.get(0));
      const company_name = nameCell.text().replace(/\s+/g, " ").trim();
      if (!company_name) return;

      // fincode: a data attribute or a numeric id in a link, if exposed.
      const fincode =
        ($tr.attr("data-fincode") ||
          nameCell.attr("data-fincode") ||
          (nameCell.find("a").attr("href") || "").match(/(\d{4,})/)?.[1] ||
          "").trim();

      const cells: Record<string, ParsedCell> = {};
      for (const mc of monthCols) {
        const cellText = $(tds.get(mc.idx)).text().replace(/\s+/g, " ").trim();
        if (!cellText || cellText === "-") continue;
        // A month cell carries a share count (large grouped int) and a % of AUM.
        const pctMatch = cellText.match(/(\d+(?:\.\d+)?)\s*%/) ||
          cellText.match(/(\d+\.\d+)/);
        const sharesMatch = cellText.match(/(\d[\d,]{2,})(?!\.\d)/);
        const aum_pct_raw = pctMatch ? pctMatch[1] : "";
        const shares_raw = sharesMatch ? sharesMatch[1] : "";
        if (!aum_pct_raw && !shares_raw) continue;
        cells[monthSlug(mc.label)] = {
          aum_pct_raw,
          aum_pct_num: parseIndianNumber(aum_pct_raw),
          shares_raw,
          shares_num: parseIndianNumber(shares_raw),
        };
      }
      if (Object.keys(cells).length === 0) return;
      rows.push({ company_name, fincode, cells });
    });

  // Fund-level fields, if the envelope/markup exposes them (best-effort).
  const pickStr = (...keys: string[]): string | null => {
    if (!envelope) return null;
    for (const k of keys) {
      const v = envelope[k];
      if (typeof v === "string" && v.trim()) return v.trim();
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
    }
    return null;
  };
  const fund = pickStr("scheme_name", "schemename", "fund", "name");
  const classification = pickStr("category", "classification", "subcategory");
  const aumRaw = pickStr("aum", "aum_cr", "fund_size", "total_aum");
  const aumTotalCr = aumRaw ? parseIndianNumber(aumRaw) : null;

  return {
    fund,
    classification,
    aumTotalCr,
    months,
    rows,
    method: envelope ? "json-endpoint" : "html-table",
  };
}

// ---- merge ---------------------------------------------------------------
export function mergeHoldings(
  existing: FundPortfolio | null,
  parsed: ParsedTracker,
  entry: IndexEntry
): FundPortfolio {
  // Union of month labels (existing + fresh), newest first, capped.
  const labelBySlug = new Map<string, string>();
  const aumByLabel = new Map<string, string | number | null>();
  for (const m of existing?.meta.months ?? []) {
    labelBySlug.set(monthSlug(m.label), m.label);
    aumByLabel.set(m.label, m.aumCr);
  }
  for (const m of parsed.months) {
    labelBySlug.set(monthSlug(m.label), m.label);
    if (m.aumCr !== "-" && m.aumCr != null) aumByLabel.set(m.label, m.aumCr);
    else if (!aumByLabel.has(m.label)) aumByLabel.set(m.label, "-");
  }
  const orderedSlugs = [...labelBySlug.keys()]
    .sort((a, b) => monthSortKey(labelBySlug.get(b)!) - monthSortKey(labelBySlug.get(a)!))
    .slice(0, MAX_MONTHS);
  const orderedLabels = orderedSlugs.map((s) => labelBySlug.get(s)!);

  // Merge rows by stable key; fresh month cells overwrite existing.
  interface Merged {
    company_name: string;
    fincode: string;
    months: Record<string, Cell>;
  }
  const byKey = new Map<string, Merged>();
  for (const r of existing?.rows ?? []) {
    byKey.set(keyOf(r), {
      company_name: r.company_name,
      fincode: r.fincode,
      months: { ...r.months },
    });
  }
  for (const r of parsed.rows) {
    const k = keyOf(r);
    let cur = byKey.get(k);
    if (!cur) {
      cur = { company_name: r.company_name, fincode: r.fincode, months: {} };
      byKey.set(k, cur);
    } else if (!cur.fincode && r.fincode) {
      cur.fincode = r.fincode;
    }
    for (const [slug, c] of Object.entries(r.cells)) {
      cur.months[slug] = {
        aum_pct_raw: c.aum_pct_raw,
        aum_pct_num: c.aum_pct_num,
        shares_raw: c.shares_raw,
        shares_num: c.shares_num,
        arrow: "flat/none",
        arrow_raw: null,
      };
    }
  }

  // Restrict to the window, recompute arrows, drop empty rows.
  const rows: Row[] = [];
  for (const cur of byKey.values()) {
    const months: Record<string, Cell> = {};
    for (const slug of orderedSlugs) {
      if (cur.months[slug] !== undefined) months[slug] = cur.months[slug];
    }
    const present = Object.keys(months);
    if (present.length === 0) continue;

    orderedSlugs.forEach((slug, i) => {
      const cell = months[slug];
      if (!cell) return;
      const olderSlug = orderedSlugs[i + 1];
      const olderSh = olderSlug ? months[olderSlug]?.shares_num : undefined;
      const sh = cell.shares_num;
      let arrow: Cell["arrow"];
      if (olderSlug === undefined || olderSh == null || sh == null) {
        arrow = i === orderedSlugs.length - 1 ? "flat/none" : "missing";
      } else if (sh > olderSh) arrow = "up";
      else if (sh < olderSh) arrow = "down";
      else arrow = "flat/none";
      cell.arrow = arrow;
      cell.arrow_raw = null;
    });

    rows.push({ company_name: cur.company_name, fincode: cur.fincode, months });
  }

  // Sort by latest-month % of AUM, descending (stable diffs + sensible order).
  const latestSlug = orderedSlugs[0];
  const latestPct = (r: Row) => r.months[latestSlug]?.aum_pct_num ?? -1;
  rows.sort((a, b) => latestPct(b) - latestPct(a));

  const newest = orderedLabels[0];
  return {
    meta: {
      source: existing?.meta.source ?? SOURCE_URL,
      endpoint: `${ENDPOINT}?schemecode=${entry.schemecode}`,
      fund: existing?.meta.fund ?? parsed.fund ?? entry.fundName ?? entry.name,
      schemecode: String(entry.schemecode),
      classification:
        parsed.classification ?? existing?.meta.classification ?? entry.classification ?? null,
      aumTotalCr: parsed.aumTotalCr ?? existing?.meta.aumTotalCr ?? entry.aumTotalCr ?? null,
      aumAsOf: monthEndIso(newest) ?? existing?.meta.aumAsOf ?? entry.aumAsOf ?? null,
      scrapedAt: nowIso(),
      months: orderedLabels.map((l) => ({ label: l, aumCr: aumByLabel.get(l) ?? "-" })),
      section: existing?.meta.section ?? "Equity Holdings",
      extractionMethod: parsed.method ?? existing?.meta.extractionMethod ?? "json-endpoint",
      arrowLogic: existing?.meta.arrowLogic ?? ARROW_LOGIC,
    },
    rows,
  };
}

// ---- probe ---------------------------------------------------------------
async function runProbe(universe: IndexEntry[]): Promise<void> {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  const n = Math.min(LIMIT || 3, universe.length);
  info(`PROBE mode — fetching ${n} scheme(s), dumping raw responses, no writes.`);
  for (let i = 0; i < n; i++) {
    const e = universe[i];
    try {
      const raw = await fetchTracker(e.schemecode);
      const out = path.join(DEBUG_DIR, `holdings-probe-${e.schemecode}.txt`);
      fs.writeFileSync(out, raw, "utf8");
      const looksJson = raw.trim().startsWith("{") || raw.trim().startsWith("[");
      const hasTable = /<\s*table\b/i.test(raw);
      info(
        `  ${e.schemecode} ${e.name} — ${raw.length} bytes, ` +
          `json=${looksJson} html-table=${hasTable} → ${path.relative(ROOT, out)}`
      );
      info(`    head: ${JSON.stringify(raw.slice(0, 200))}`);
      try {
        const p = parseTracker(raw, e.schemecode);
        info(
          `    parsed OK — method=${p.method} months=[${p.months
            .map((m) => m.label)
            .join(", ")}] rows=${p.rows.length}`
        );
      } catch (err) {
        warn(`    parse failed: ${(err as Error).message}`);
      }
    } catch (err) {
      warn(`  ${e.schemecode} fetch failed: ${(err as Error).message}`);
    }
    if (DELAY_MS) await sleep(DELAY_MS);
  }
}

// ---- orchestrator --------------------------------------------------------
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, i: number) => Promise<void>
): Promise<void> {
  let idx = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      for (;;) {
        const i = idx++;
        if (i >= items.length) break;
        await worker(items[i], i);
        if (DELAY_MS) await sleep(Math.random() * DELAY_MS);
      }
    }
  );
  await Promise.all(runners);
}

async function main(): Promise<void> {
  const index = readJson<IndexFile | null>(INDEX_PATH, null);
  if (!index || !Array.isArray(index.funds)) {
    warn(`could not read index at ${INDEX_PATH}; nothing to do.`);
    process.exit(1);
  }

  let universe = index.funds;
  if (LIMIT > 0) universe = universe.slice(0, LIMIT);
  info(
    `universe: ${universe.length} funds (previous > ₹500 Cr benchmark` +
      `${LIMIT ? `, limited to ${LIMIT}` : ""}); ` +
      `concurrency=${CONCURRENCY} maxMonths=${MAX_MONTHS}`
  );

  if (PROBE) {
    await runProbe(universe);
    return;
  }

  const stats = { refreshed: 0, created: 0, keptEmpty: 0, keptFailed: 0, skipped: 0 };
  const errors: { schemecode: string; reason: string }[] = [];

  await runPool(universe, CONCURRENCY, async (entry) => {
    let raw: string;
    try {
      raw = await fetchTracker(entry.schemecode);
    } catch (e) {
      stats.keptFailed++;
      errors.push({ schemecode: entry.schemecode, reason: `fetch: ${(e as Error).message}` });
      return;
    }

    let parsed: ParsedTracker;
    try {
      parsed = parseTracker(raw, entry.schemecode);
    } catch (e) {
      stats.keptFailed++;
      errors.push({ schemecode: entry.schemecode, reason: `parse: ${(e as Error).message}` });
      return;
    }

    if (parsed.rows.length === 0) {
      // No equity holdings reported. Never wipe an existing snapshot.
      stats[entry.file ? "keptEmpty" : "skipped"]++;
      return;
    }

    const existingPath = entry.file ? path.join(ROOT, "public", entry.file) : null;
    const existing =
      existingPath && fs.existsSync(existingPath)
        ? readJson<FundPortfolio | null>(existingPath, null)
        : null;

    const merged = mergeHoldings(existing, parsed, entry);

    const file = entry.file ?? `holdings/${fundFileSlug(entry.schemecode, merged.meta.fund)}`;
    const outPath = path.join(ROOT, "public", file);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + "\n", "utf8");

    // Reflect the refresh back into the index entry.
    entry.file = file;
    entry.rowCount = merged.rows.length;
    entry.aumTotalCr = merged.meta.aumTotalCr;
    entry.aumAsOf = merged.meta.aumAsOf;
    entry.classification = merged.meta.classification;

    stats[existing ? "refreshed" : "created"]++;
  });

  const attempted = universe.length;
  const succeeded = stats.refreshed + stats.created;
  info(
    `done — refreshed ${stats.refreshed}, created ${stats.created}, ` +
      `kept-empty ${stats.keptEmpty}, kept-failed ${stats.keptFailed}, skipped ${stats.skipped}`
  );
  if (errors.length) {
    warn(`${errors.length} fund(s) failed; first few:`);
    for (const e of errors.slice(0, 8)) warn(`  ${e.schemecode}: ${e.reason}`);
  }

  // Global keep-last-good: if nothing succeeded, do NOT rewrite the index and
  // signal failure so the workflow's commit step is skipped.
  if (succeeded === 0) {
    warn(`no funds refreshed (attempted ${attempted}); leaving index untouched.`);
    process.exit(1);
  }

  // Refresh index: newest month-end + provenance, re-sort by AUM desc.
  const newestAsOf = index.funds
    .map((f) => f.aumAsOf)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);
  index.funds.sort((a, b) => (b.aumTotalCr ?? -1) - (a.aumTotalCr ?? -1));
  index.meta.generatedAt = nowIso();
  if (newestAsOf) index.meta.holdingsAsOf = newestAsOf;
  index.meta.lastHoldingsRefresh = {
    at: nowIso(),
    attempted,
    refreshed: stats.refreshed,
    created: stats.created,
    keptEmpty: stats.keptEmpty,
    keptFailed: stats.keptFailed,
  };
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + "\n", "utf8");
  info(`index updated → ${path.relative(ROOT, INDEX_PATH)} (holdingsAsOf=${newestAsOf ?? "n/a"})`);
}

// Import-safe: the synthetic test imports parseTracker / mergeHoldings and the
// month helpers and must NOT trigger a real run. Only invoke main() when this
// file is executed directly (works for tsx / node ESM + CJS).
const _argv1 = process.argv[1] ?? "";
const _isEntry =
  _argv1.endsWith("/holdings-tracker.ts") ||
  _argv1.endsWith("\\holdings-tracker.ts") ||
  _argv1.endsWith("/holdings-tracker.js") ||
  _argv1.endsWith("\\holdings-tracker.js");
if (_isEntry) {
  main().catch((e) => {
    warn(`fatal: ${(e as Error).stack ?? (e as Error).message}`);
    process.exit(1);
  });
}
