/**
 * Styled .xlsx workbooks for the Portfolio Tracker master export, built with
 * xlsx-js-style (a SheetJS fork that honours per-cell `.s` styling). Dark-navy
 * header bands, green/red signed values, zebra striping and number formats make
 * the download read like the dashboard. The library is dynamically imported so
 * it never lands in the initial page bundle.
 */

import { HEX, FMT, toneHex } from "./theme";
import type {
  FundHouseExport,
  HoldingExportRow,
  RatioRow,
  ReturnRow,
  SchemeExport,
} from "./types";

// xlsx-js-style shares SheetJS's API surface; reuse the typed `xlsx` shape for
// utils/write and reach for `.s` (styling) via a loose cell type.
type XlsxModule = typeof import("xlsx");
type Style = Record<string, unknown>;
interface SCell {
  v: string | number | boolean | null;
  s?: Style;
}
type Merge = { s: { r: number; c: number }; e: { r: number; c: number } };

const FONT = { name: "Calibri", sz: 10 };

function border(color = HEX.border) {
  const side = { style: "thin", color: { rgb: color } };
  return { top: side, bottom: side, left: side, right: side };
}
const fill = (rgb: string) => ({ patternType: "solid", fgColor: { rgb } });

/** Column header — bold white on the dark navy band. */
function hCell(v: string, align: "left" | "center" | "right" = "left"): SCell {
  return {
    v,
    s: {
      font: { ...FONT, bold: true, color: { rgb: HEX.headerText } },
      fill: fill(HEX.headerBg),
      alignment: { horizontal: align, vertical: "center", wrapText: true },
      border: border(HEX.headerBg),
    },
  };
}
/** Row label — bold ink on a light band. */
function labelCell(v: string): SCell {
  return {
    v,
    s: {
      font: { ...FONT, bold: true, color: { rgb: HEX.ink } },
      fill: fill(HEX.band),
      alignment: { horizontal: "left", vertical: "center" },
      border: border(),
    },
  };
}
function textCell(v: string, align: "left" | "center" | "right" = "left", zebra = false): SCell {
  return {
    v,
    s: {
      font: { ...FONT, color: { rgb: HEX.ink } },
      alignment: { horizontal: align, vertical: "center", wrapText: align === "left" },
      border: border(),
      ...(zebra ? { fill: fill(HEX.band) } : {}),
    },
  };
}
function dash(zebra = false): SCell {
  return {
    v: "—",
    s: {
      font: { ...FONT, color: { rgb: HEX.mutedText } },
      alignment: { horizontal: "right", vertical: "center" },
      border: border(),
      ...(zebra ? { fill: fill(HEX.band) } : {}),
    },
  };
}
function numCell(
  v: number | null,
  numFmt: string,
  opts: { tone?: number | null; bold?: boolean; zebra?: boolean } = {}
): SCell {
  if (v === null || v === undefined || !Number.isFinite(v)) return dash(opts.zebra);
  const color = opts.tone !== undefined ? toneHex(opts.tone) : HEX.ink;
  return {
    v,
    s: {
      font: { ...FONT, color: { rgb: color }, bold: !!opts.bold },
      numFmt,
      alignment: { horizontal: "right", vertical: "center" },
      border: border(),
      ...(opts.zebra ? { fill: fill(HEX.band) } : {}),
    },
  };
}
function titleCell(v: string, sz: number, color = HEX.ink, bold = true): SCell {
  return { v, s: { font: { name: "Calibri", sz, bold, color: { rgb: color } } } };
}
/** Full-width section heading (light indigo band). */
function sectionCell(v: string): SCell {
  return {
    v,
    s: {
      font: { name: "Calibri", sz: 11, bold: true, color: { rgb: HEX.brandDark } },
      fill: fill(HEX.accent),
      alignment: { horizontal: "left", vertical: "center" },
      border: border(HEX.accent),
    },
  };
}
/** A quartile pill cell, tinted by Q1…Q4. */
function quartileCell(q: string | null, zebra = false): SCell {
  if (!q) return dash(zebra);
  const map: Record<string, [string, string]> = {
    Q1: [HEX.positive, "FFFFFF"],
    Q2: [HEX.band, HEX.ink],
    Q3: [HEX.band, HEX.mutedText],
    Q4: [HEX.negative, "FFFFFF"],
  };
  const [bg, fg] = map[q] ?? [HEX.band, HEX.ink];
  return {
    v: q,
    s: {
      font: { ...FONT, bold: true, color: { rgb: fg } },
      fill: fill(bg),
      alignment: { horizontal: "center", vertical: "center" },
      border: border(),
    },
  };
}

function buildWorksheet(
  XLSX: XlsxModule,
  rows: (SCell | null)[][],
  colWidths: number[],
  opts: { merges?: Merge[]; rowHeights?: Record<number, number> } = {}
) {
  const aoa = rows.map((r) => r.map((c) => (c ? c.v : null)));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  rows.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (!cell) return;
      const ref = XLSX.utils.encode_cell({ r, c });
      const existing = ws[ref] as { t?: string; v?: unknown; s?: Style } | undefined;
      if (!existing) {
        (ws as Record<string, unknown>)[ref] = {
          t: typeof cell.v === "number" ? "n" : "s",
          v: cell.v ?? "",
          s: cell.s,
        };
      } else if (cell.s) {
        existing.s = cell.s;
      }
    })
  );
  ws["!cols"] = colWidths.map((wch) => ({ wch }));
  if (opts.merges) ws["!merges"] = opts.merges;
  const rowProps: { hpt: number }[] = [];
  if (opts.rowHeights) {
    const max = Math.max(...Object.keys(opts.rowHeights).map(Number));
    for (let i = 0; i <= max; i++) rowProps[i] = { hpt: opts.rowHeights[i] ?? 15 };
    ws["!rows"] = rowProps;
  }
  return ws;
}

function safeName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- Holdings sheet (shared by both export kinds) -------------------------

function holdingsSheet(
  XLSX: XlsxModule,
  monthLabels: string[],
  monthBooksCr: (number | null)[],
  rows: HoldingExportRow[],
  pctHeader: string
) {
  const grid: (SCell | null)[][] = [];
  const merges: Merge[] = [];
  const nCols = 1 + monthLabels.length * 2;

  // Title
  grid.push([titleCell("Equity Holdings", 14), ...Array(nCols - 1).fill(null)]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: nCols - 1 } });
  grid.push(Array(nCols).fill(null));

  // Header row 1: Company (merged down 2) + per-month label (merged across 2).
  const h1: SCell[] = [hCell("Company", "left")];
  const headerTop = grid.length;
  monthLabels.forEach((label, i) => {
    const book = monthBooksCr[i];
    const cap = book !== null ? `  (Book ₹${Math.round(book).toLocaleString("en-IN")} Cr)` : "";
    h1.push(hCell(`${label}${cap}`, "center"), hCell("", "center"));
  });
  grid.push(h1);
  // Header row 2: blank under company + % / Shares.
  const h2: SCell[] = [hCell("", "left")];
  monthLabels.forEach(() => {
    h2.push(hCell(pctHeader, "right"), hCell("Shares", "right"));
  });
  grid.push(h2);
  // Merges: company across the two header rows; each month across its 2 cols.
  merges.push({ s: { r: headerTop, c: 0 }, e: { r: headerTop + 1, c: 0 } });
  monthLabels.forEach((_, i) => {
    const c = 1 + i * 2;
    merges.push({ s: { r: headerTop, c }, e: { r: headerTop, c: c + 1 } });
  });

  rows.forEach((row, ri) => {
    const zebra = ri % 2 === 1;
    const line: SCell[] = [textCell(row.company, "left", zebra)];
    row.months.forEach((m) => {
      line.push(numCell(m.aumPct, FMT.pct1, { zebra }));
      const tone = m.arrow === "up" ? 1 : m.arrow === "down" ? -1 : 0;
      line.push(numCell(m.shares, FMT.intGrouped, { zebra, tone }));
    });
    grid.push(line);
  });

  const widths = [34, ...monthLabels.flatMap(() => [12, 14])];
  return buildWorksheet(XLSX, grid, widths, {
    merges,
    rowHeights: { 0: 20, [headerTop]: 18, [headerTop + 1]: 16 },
  });
}

// ---- Scheme workbook ------------------------------------------------------

function schemeSummarySheet(XLSX: XlsxModule, data: SchemeExport) {
  const grid: (SCell | null)[][] = [];
  const merges: Merge[] = [];
  const W = 7; // working width

  const span = (r: number) => merges.push({ s: { r, c: 0 }, e: { r, c: W - 1 } });
  const pushSpan = (cell: SCell) => {
    grid.push([cell, ...Array(W - 1).fill(null)]);
    span(grid.length - 1);
  };

  pushSpan(titleCell(data.fundName, 16));
  const sub = [data.category, data.amc ? `AMC: ${data.amc}` : null]
    .filter(Boolean)
    .join("   ·   ");
  pushSpan(titleCell(sub, 11, HEX.mutedText, false));
  const facts = [
    data.aumCr != null ? `AUM ₹${Math.round(data.aumCr).toLocaleString("en-IN")} Cr` : null,
    data.navAsOf ? `NAV as of ${data.navAsOf}` : null,
    data.asOfMonth ? `Holdings ${data.asOfMonth}` : null,
    `Generated ${data.generatedAt}`,
  ]
    .filter(Boolean)
    .join("   ·   ");
  pushSpan(titleCell(facts, 9, HEX.mutedText, false));
  grid.push(Array(W).fill(null));

  // ---- Returns & Ranking (one block per plan) ----
  for (const plan of data.plans) {
    pushSpan(sectionCell(`Returns & Ranking — ${plan.plan} plan`));
    grid.push([
      hCell("Period", "left"),
      hCell("Fund", "right"),
      hCell("Category avg", "right"),
      hCell("Rank", "right"),
      hCell("Peers", "right"),
      hCell("Quartile", "center"),
      hCell("Percentile", "right"),
    ]);
    plan.returns.forEach((r: ReturnRow, i) => {
      const zebra = i % 2 === 1;
      grid.push([
        labelCell(`${r.period}${r.cagr ? " CAGR" : ""}`),
        numCell(r.fundPct, FMT.pct1Signed, { tone: r.fundPct, zebra, bold: true }),
        numCell(r.categoryAvgPct, FMT.pct1Signed, { tone: r.categoryAvgPct, zebra }),
        r.rank != null ? numCell(r.rank, FMT.rank, { zebra }) : dash(zebra),
        r.peerCount != null ? numCell(r.peerCount, FMT.rank, { zebra }) : dash(zebra),
        quartileCell(r.quartile, zebra),
        r.percentile != null ? numCell(r.percentile, FMT.rank, { zebra }) : dash(zebra),
      ]);
    });
    grid.push(Array(W).fill(null));
  }

  // ---- Risk ratios (transposed, one block per plan) ----
  const ratioPlans = data.plans.filter((p) => p.ratios && p.ratios.length);
  for (const plan of ratioPlans) {
    const ratios = plan.ratios as RatioRow[];
    pushSpan(sectionCell(`Risk ratios — ${plan.plan} plan (trailing ${data.ratiosMeta?.windowMonths ?? 36}m)`));
    grid.push([hCell("", "left"), ...ratios.map((r) => hCell(r.label, "right")), null].slice(0, W));
    const fmtFor = (r: RatioRow) =>
      r.unit === "%" ? (r.signed ? FMT.pct2Signed : FMT.pct2) : r.signed ? FMT.num2Signed : FMT.num2;
    // Fund row — tone vs category average by direction.
    grid.push([
      labelCell("Fund"),
      ...ratios.map((r) => {
        const better = r.higherBetter ? r.fund > r.categoryAvg : r.fund < r.categoryAvg;
        const worse = r.higherBetter ? r.fund < r.categoryAvg : r.fund > r.categoryAvg;
        return numCell(r.fund, fmtFor(r), { tone: better ? 1 : worse ? -1 : 0, bold: true });
      }),
    ]);
    grid.push([
      labelCell("Category average"),
      ...ratios.map((r) => numCell(r.categoryAvg, fmtFor(r))),
    ]);
    grid.push([
      labelCell("Rank in category"),
      ...ratios.map((r) => numCell(r.rank, FMT.rank)),
    ]);
    grid.push([
      labelCell("Funds in category"),
      ...ratios.map((r) => numCell(r.count, FMT.rank)),
    ]);
    grid.push(Array(W).fill(null));
  }

  if (data.ratiosMeta) {
    pushSpan(
      titleCell(
        `Ratios: trailing ${data.ratiosMeta.windowMonths} monthly returns vs ${prettyBench(
          data.ratiosMeta.benchmark
        )}; risk-free ${(data.ratiosMeta.riskFreeRate * 100).toFixed(1)}% (India 1Y T-bill), assumed market ${(
          data.ratiosMeta.marketReturn * 100
        ).toFixed(0)}%.`,
        8,
        HEX.mutedText,
        false
      )
    );
  }

  const widths = [20, 12, 14, 9, 9, 11, 11];
  return buildWorksheet(XLSX, grid, widths, { merges, rowHeights: { 0: 22 } });
}

function prettyBench(id: string): string {
  return id === "NIFTY_500" ? "Nifty 500" : id;
}

function schemeSectorSheet(XLSX: XlsxModule, data: SchemeExport) {
  const grid: (SCell | null)[][] = [];
  const merges: Merge[] = [];
  grid.push([titleCell("Sector Allocation v/s Category Average", 14), null, null]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } });
  grid.push([null, null, null]);
  grid.push([hCell("Sector", "left"), hCell("Fund", "right"), hCell("Category avg", "right")]);
  data.sectors.forEach((s, i) => {
    const zebra = i % 2 === 1;
    const tone =
      s.categoryAvgPct != null ? s.fundPct - s.categoryAvgPct : 0;
    grid.push([
      textCell(s.sector, "left", zebra),
      numCell(s.fundPct, FMT.pct1, { zebra, tone, bold: true }),
      numCell(s.categoryAvgPct, FMT.pct1, { zebra }),
    ]);
  });
  return buildWorksheet(XLSX, grid, [28, 12, 14], { merges, rowHeights: { 0: 20 } });
}

function schemePeerSheet(XLSX: XlsxModule, data: SchemeExport) {
  const grid: (SCell | null)[][] = [];
  const merges: Merge[] = [];
  const W = 6;
  grid.push([titleCell(`Peer Ranking — ${data.peerPeriod}`, 14), ...Array(W - 1).fill(null)]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: W - 1 } });
  grid.push([titleCell(data.peerCohortLabel, 9, HEX.mutedText, false), ...Array(W - 1).fill(null)]);
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: W - 1 } });
  grid.push(Array(W).fill(null));
  grid.push([
    hCell("Fund", "left"),
    hCell(`${data.peerPeriod} return`, "right"),
    hCell("Rank", "right"),
    hCell("Percentile", "right"),
    hCell("Quartile", "center"),
    hCell("vs median", "right"),
  ]);
  data.peers.forEach((p, i) => {
    const zebra = i % 2 === 1;
    const nameCell: SCell = p.selected
      ? {
          v: `★ ${p.fund}`,
          s: {
            font: { ...FONT, bold: true, color: { rgb: HEX.accentInk } },
            fill: fill(HEX.accent),
            alignment: { horizontal: "left", vertical: "center", wrapText: true },
            border: border(),
          },
        }
      : textCell(p.fund, "left", zebra);
    grid.push([
      nameCell,
      numCell(p.ret, FMT.pct1Signed, { tone: p.ret, zebra }),
      p.rank != null && p.peerCount != null
        ? textCell(`${p.rank} / ${p.peerCount}`, "right", zebra)
        : dash(zebra),
      p.percentile != null ? numCell(p.percentile, FMT.rank, { zebra }) : dash(zebra),
      quartileCell(p.quartile, zebra),
      numCell(p.vsMedianBps, FMT.bpsSigned, { tone: p.vsMedianBps, zebra }),
    ]);
  });
  return buildWorksheet(XLSX, grid, [34, 13, 11, 11, 10, 13], { merges, rowHeights: { 0: 20 } });
}

export async function downloadSchemeXlsx(data: SchemeExport, filename: string): Promise<void> {
  if (typeof window === "undefined") return;
  const mod = (await import("xlsx-js-style")) as Record<string, unknown>;
  // CJS/ESM interop: utils may sit on the namespace or under `default`.
  const XLSX = (mod.utils ? mod : (mod.default as Record<string, unknown>)) as unknown as XlsxModule;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, schemeSummarySheet(XLSX, data), safeName("Summary"));
  if (data.holdings.length)
    XLSX.utils.book_append_sheet(
      wb,
      holdingsSheet(XLSX, data.monthLabels, data.monthBooksCr, data.holdings, "% of AUM"),
      safeName("Holdings")
    );
  if (data.sectors.length)
    XLSX.utils.book_append_sheet(wb, schemeSectorSheet(XLSX, data), safeName("Sector Allocation"));
  if (data.peers.length)
    XLSX.utils.book_append_sheet(wb, schemePeerSheet(XLSX, data), safeName("Peer Ranking"));
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  triggerDownload(
    new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename
  );
}

// ---- Fund-house workbook --------------------------------------------------

function fundHouseSummarySheet(XLSX: XlsxModule, data: FundHouseExport) {
  const grid: (SCell | null)[][] = [];
  const merges: Merge[] = [];
  const W = 3;
  const pushSpan = (cell: SCell) => {
    grid.push([cell, ...Array(W - 1).fill(null)]);
    merges.push({ s: { r: grid.length - 1, c: 0 }, e: { r: grid.length - 1, c: W - 1 } });
  };
  pushSpan(titleCell(data.amc, 16));
  pushSpan(
    titleCell(
      `${data.schemeCount} schemes  ·  ${data.holdingsCount} distinct holdings  ·  Equity book ₹${Math.round(
        data.equityValueCr
      ).toLocaleString("en-IN")} Cr`,
      11,
      HEX.mutedText,
      false
    )
  );
  pushSpan(titleCell(`Latest ${data.latestMonth}  ·  Generated ${data.generatedAt}`, 9, HEX.mutedText, false));
  grid.push([null, null, null]);

  if (data.capMix) {
    pushSpan(sectionCell("Market-cap mix (latest month)"));
    grid.push([hCell("Bucket", "left"), hCell("% of book", "right"), null].slice(0, W) as SCell[]);
    (["large", "mid", "small"] as const).forEach((k, i) => {
      grid.push([
        labelCell(k === "large" ? "Large cap" : k === "mid" ? "Mid cap" : "Small cap"),
        numCell(data.capMix![k], FMT.pct1, { zebra: i % 2 === 1 }),
        null,
      ] as (SCell | null)[]);
    });
    grid.push([null, null, null]);
  }

  if (data.sectorMix.length) {
    pushSpan(sectionCell("Sector mix (latest month)"));
    grid.push([hCell("Sector", "left"), hCell("% of book", "right"), null].slice(0, W) as SCell[]);
    data.sectorMix.forEach((s, i) => {
      grid.push([
        textCell(s.sector, "left", i % 2 === 1),
        numCell(s.pct, FMT.pct1, { zebra: i % 2 === 1 }),
        null,
      ] as (SCell | null)[]);
    });
  }

  return buildWorksheet(XLSX, grid, [26, 12, 4], { merges, rowHeights: { 0: 22 } });
}

function fundHousePeerSheet(XLSX: XlsxModule, data: FundHouseExport) {
  const grid: (SCell | null)[][] = [];
  const merges: Merge[] = [];
  const W = 6;
  grid.push([titleCell("Peer fund houses", 14), ...Array(W - 1).fill(null)]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: W - 1 } });
  grid.push(Array(W).fill(null));
  grid.push([
    hCell("Fund house", "left"),
    hCell("Schemes", "right"),
    hCell("Equity book (₹ Cr)", "right"),
    hCell("Top-10 conc.", "right"),
    hCell("Biggest buy", "right"),
    hCell("Biggest sell", "right"),
  ]);
  data.peers.forEach((p, i) => {
    const zebra = i % 2 === 1;
    const nameCell: SCell = p.selected
      ? {
          v: `★ ${p.amc}`,
          s: {
            font: { ...FONT, bold: true, color: { rgb: HEX.accentInk } },
            fill: fill(HEX.accent),
            alignment: { horizontal: "left", vertical: "center" },
            border: border(),
          },
        }
      : textCell(p.amc, "left", zebra);
    const buy = p.biggestBuyBps != null ? `${p.biggestBuyName}` : "";
    const sell = p.biggestSellBps != null ? `${p.biggestSellName}` : "";
    grid.push([
      nameCell,
      numCell(p.schemes, FMT.rank, { zebra }),
      numCell(p.equityBookCr, FMT.intGrouped, { zebra }),
      numCell(p.top10Pct, FMT.pct1, { zebra }),
      textCell(p.biggestBuyBps != null ? `+${p.biggestBuyBps} bps · ${buy}` : "—", "right", zebra),
      textCell(p.biggestSellBps != null ? `${p.biggestSellBps} bps · ${sell}` : "—", "right", zebra),
    ]);
  });
  return buildWorksheet(XLSX, grid, [20, 9, 16, 12, 26, 26], { merges, rowHeights: { 0: 20 } });
}

export async function downloadFundHouseXlsx(
  data: FundHouseExport,
  filename: string
): Promise<void> {
  if (typeof window === "undefined") return;
  const mod = (await import("xlsx-js-style")) as Record<string, unknown>;
  // CJS/ESM interop: utils may sit on the namespace or under `default`.
  const XLSX = (mod.utils ? mod : (mod.default as Record<string, unknown>)) as unknown as XlsxModule;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, fundHouseSummarySheet(XLSX, data), safeName("Summary"));
  if (data.holdings.length)
    XLSX.utils.book_append_sheet(
      wb,
      holdingsSheet(XLSX, data.monthLabels, data.monthBooksCr, data.holdings, "% of book"),
      safeName("Holdings")
    );
  if (data.peers.length)
    XLSX.utils.book_append_sheet(wb, fundHousePeerSheet(XLSX, data), safeName("Peers"));
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  triggerDownload(
    new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    filename
  );
}
