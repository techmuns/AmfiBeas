/**
 * Broking / Capital Markets snapshot builder.
 *
 * Reads monthly NSE "active clients per broker" CSVs from manual-data/broking/
 * (see that folder's README) and writes src/data/snapshots/broking.json — the
 * static feed the Broking tab renders at build time.
 *
 * NSE publishes active-client counts on nseindia.com behind a bot-wall. The
 * monthly CSVs are refreshed either by the broking-active-clients workflow
 * (scripts/ingest/broking-active-clients.ts — a headless-browser fetch) or by
 * dropping the file in manually, exactly like manual-data/market/. Files named
 * `active-clients-YYYY-MM.sample.csv` are flagged as sample (the tab shows a
 * "sample data" banner until the newest month is an official, non-sample file).
 *
 * CSV shape:  broker,activeClients[,turnoverCr]
 *
 * Optional sentinel row `__market_total__,<n>` sets the whole-market active-client
 * count (all NSE members, not just the listed brokers) so each broker's share is
 * a true market share rather than a share of the few brokers we list. Without it,
 * share falls back to the sum of the listed brokers.
 *
 * Run: npm run build:broking
 */

import fs from "node:fs/promises";
import path from "node:path";
import { info, warn, nowIso, writeSnapshot } from "./ingest/utils";

const SRC_DIR = path.resolve(process.cwd(), "manual-data/broking");
const FILE_RE = /^active-clients-(\d{4}-\d{2})(\.sample)?\.csv$/i;

interface BrokerMonth {
  activeClients: number;
  turnoverCr: number | null;
}
type MonthData = Map<string, BrokerMonth>; // broker -> row
interface ParsedMonth {
  data: MonthData;
  marketTotal: number | null; // whole-NSE total from a `__market_total__` row, if given
}

const MARKET_TOTAL_KEYS = new Set(["__market_total__", "market total", "total", "_total_"]);

function parseCsv(text: string): ParsedMonth {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: MonthData = new Map();
  let marketTotal: number | null = null;
  if (lines.length < 2) return { data: out, marketTotal };
  const header = lines[0].split(",").map((c) => c.trim().toLowerCase());
  const bIdx = header.findIndex((c) => c === "broker");
  const cIdx = header.findIndex((c) => c === "activeclients");
  const tIdx = header.findIndex((c) => c === "turnovercr");
  if (bIdx < 0 || cIdx < 0) return { data: out, marketTotal };
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const broker = cols[bIdx];
    const clients = Number(cols[cIdx]);
    if (!broker || !Number.isFinite(clients) || clients <= 0) continue;
    // Sentinel: the whole-market total, not a broker to be listed.
    if (MARKET_TOTAL_KEYS.has(broker.toLowerCase())) {
      marketTotal = clients;
      continue;
    }
    const turnover = tIdx >= 0 ? Number(cols[tIdx]) : NaN;
    out.set(broker, {
      activeClients: clients,
      turnoverCr: Number.isFinite(turnover) ? turnover : null,
    });
  }
  return { data: out, marketTotal };
}

async function main(): Promise<void> {
  let files: string[];
  try {
    files = (await fs.readdir(SRC_DIR)).filter((f) => FILE_RE.test(f));
  } catch {
    warn(`no ${SRC_DIR} directory; nothing to build.`);
    process.exit(1);
  }
  if (files.length === 0) {
    warn(`no active-clients CSVs in ${SRC_DIR}; nothing to build.`);
    process.exit(1);
  }

  // month -> { data, isSample, marketTotal }
  const byMonth = new Map<string, { data: MonthData; isSample: boolean; marketTotal: number | null }>();
  for (const f of files) {
    const m = f.match(FILE_RE)!;
    const month = m[1];
    const isSample = Boolean(m[2]);
    const text = await fs.readFile(path.join(SRC_DIR, f), "utf8");
    const { data, marketTotal } = parseCsv(text);
    if (data.size > 0) byMonth.set(month, { data, isSample, marketTotal });
  }

  const months = [...byMonth.keys()].sort();
  if (months.length === 0) {
    warn("no parseable rows found; nothing to build.");
    process.exit(1);
  }
  const latestMonth = months[months.length - 1];
  const priorMonth = months.length > 1 ? months[months.length - 2] : null;
  const latest = byMonth.get(latestMonth)!;
  const prior = priorMonth ? byMonth.get(priorMonth)! : null;

  const trackedTotal = [...latest.data.values()].reduce((s, r) => s + r.activeClients, 0);
  // Share denominator: the whole-NSE total when supplied, else the listed brokers.
  const shareBase = latest.marketTotal && latest.marketTotal > 0 ? latest.marketTotal : trackedTotal;
  const hasTurnover = [...latest.data.values()].some((r) => r.turnoverCr != null);

  const brokers = [...latest.data.entries()]
    .map(([broker, row]) => {
      const prev = prior?.data.get(broker)?.activeClients ?? null;
      const momChange = prev != null ? row.activeClients - prev : null;
      const momPct = prev != null && prev > 0 ? (momChange! / prev) * 100 : null;
      return {
        broker,
        activeClients: row.activeClients,
        // Two decimals: there is a long tail of brokers around ~0.2% share.
        sharePct: shareBase > 0 ? Math.round((row.activeClients / shareBase) * 10000) / 100 : 0,
        prevActiveClients: prev,
        momChange,
        momPct: momPct != null ? Math.round(momPct * 10) / 10 : null,
        turnoverCr: row.turnoverCr,
      };
    })
    .sort((a, b) => b.activeClients - a.activeClients);

  const snapshot = {
    generatedAt: nowIso(),
    source: "NSE monthly active clients per member (compiled from public reporting)",
    isSample: latest.isSample,
    note: latest.isSample
      ? "Approximate sample from public reporting, pending an official NSE monthly upload."
      : `NSE active-clients-per-member data as of ${latestMonth}, compiled from public reporting.`,
    latestMonth,
    priorMonth,
    totalActiveClients: trackedTotal,
    marketTotalActiveClients: latest.marketTotal ?? null,
    hasTurnover,
    brokerCount: brokers.length,
    months,
    brokers,
  };

  await writeSnapshot("broking.json", snapshot);
  info(`wrote src/data/snapshots/broking.json (${latestMonth}, ${brokers.length} brokers, sample=${latest.isSample})`);
  info("================ BROKING SUMMARY ================");
  for (const b of brokers) {
    info(
      `${b.broker.padEnd(20)} ${(b.activeClients / 1e5).toFixed(1).padStart(7)}L  ${String(b.sharePct).padStart(5)}%  MoM ${b.momPct != null ? `${b.momPct > 0 ? "+" : ""}${b.momPct}%` : "n/a"}`
    );
  }
  info("=================================================");
}

main().catch((e) => {
  warn(`build-broking failed: ${(e as Error).message}`);
  process.exit(1);
});
