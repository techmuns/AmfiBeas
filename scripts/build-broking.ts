/**
 * Broking / Capital Markets snapshot builder.
 *
 * Reads monthly NSE "active clients per broker" CSVs from manual-data/broking/
 * (see that folder's README) and writes src/data/snapshots/broking.json — the
 * static feed the Broking tab renders at build time.
 *
 * NSE publishes active-client counts on nseindia.com behind a bot-wall, so the
 * data can't be fetched automatically here; it's refreshed by dropping the
 * monthly file in, exactly like manual-data/market/. Files named
 * `active-clients-YYYY-MM.sample.csv` are flagged as sample (the tab shows a
 * "sample data" banner until the newest month is an official, non-sample file).
 *
 * CSV shape:  broker,activeClients[,turnoverCr]
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

function parseCsv(text: string): MonthData {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: MonthData = new Map();
  if (lines.length < 2) return out;
  const header = lines[0].split(",").map((c) => c.trim().toLowerCase());
  const bIdx = header.findIndex((c) => c === "broker");
  const cIdx = header.findIndex((c) => c === "activeclients");
  const tIdx = header.findIndex((c) => c === "turnovercr");
  if (bIdx < 0 || cIdx < 0) return out;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const broker = cols[bIdx];
    const clients = Number(cols[cIdx]);
    if (!broker || !Number.isFinite(clients) || clients <= 0) continue;
    const turnover = tIdx >= 0 ? Number(cols[tIdx]) : NaN;
    out.set(broker, {
      activeClients: clients,
      turnoverCr: Number.isFinite(turnover) ? turnover : null,
    });
  }
  return out;
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

  // month -> { data, isSample }
  const byMonth = new Map<string, { data: MonthData; isSample: boolean }>();
  for (const f of files) {
    const m = f.match(FILE_RE)!;
    const month = m[1];
    const isSample = Boolean(m[2]);
    const text = await fs.readFile(path.join(SRC_DIR, f), "utf8");
    const data = parseCsv(text);
    if (data.size > 0) byMonth.set(month, { data, isSample });
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

  const total = [...latest.data.values()].reduce((s, r) => s + r.activeClients, 0);
  const hasTurnover = [...latest.data.values()].some((r) => r.turnoverCr != null);

  const brokers = [...latest.data.entries()]
    .map(([broker, row]) => {
      const prev = prior?.data.get(broker)?.activeClients ?? null;
      const momChange = prev != null ? row.activeClients - prev : null;
      const momPct = prev != null && prev > 0 ? (momChange! / prev) * 100 : null;
      return {
        broker,
        activeClients: row.activeClients,
        sharePct: total > 0 ? Math.round((row.activeClients / total) * 1000) / 10 : 0,
        prevActiveClients: prev,
        momChange,
        momPct: momPct != null ? Math.round(momPct * 10) / 10 : null,
        turnoverCr: row.turnoverCr,
      };
    })
    .sort((a, b) => b.activeClients - a.activeClients);

  const snapshot = {
    generatedAt: nowIso(),
    source: "NSE monthly active-clients-per-member report (manual upload)",
    isSample: latest.isSample,
    note: latest.isSample
      ? "Approximate sample from public reporting (mid-2026), pending the official NSE monthly upload."
      : "Official NSE monthly active-clients data.",
    latestMonth,
    priorMonth,
    totalActiveClients: total,
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
