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

// NOTE: worksheets are built WITHOUT any merged cells — every value lives in its
// own cell so the download stays fully addressable by Excel formulas. Titles and
// section headings simply overflow into the empty cells to their right.
function buildWorksheet(
  XLSX: XlsxModule,
  rows: (SCell | null)[][],
  colWidths: number[],
  opts: { rowHeights?: Record<number, number> } = {}
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
  const nCols = 1 + monthLabels.length * 2;

  grid.push([titleCell("Equity Holdings", 14), ...Array(nCols - 1).fill(null)]);
  // Book-per-month caption (single cell, overflows to the right).
  const bookParts = monthLabels
    .map((l, i) => (monthBooksCr[i] !== null ? `${l} ₹${Math.round(monthBooksCr[i]!).toLocaleString("en-IN")} Cr` : null))
    .filter(Boolean);
  if (bookParts.length) {
    grid.push([titleCell(`Book: ${bookParts.join("   ·   ")}`, 9, HEX.mutedText, false), ...Array(nCols - 1).fill(null)]);
  }
  grid.push(Array(nCols).fill(null));

  // Single header row — one explicit column per month/metric (no merges).
  const headerTop = grid.length;
  const head: SCell[] = [hCell("Company", "left")];
  monthLabels.forEach((label) => {
    head.push(hCell(`${label} ${pctHeader}`, "right"), hCell(`${label} Shares`, "right"));
  });
  grid.push(head);

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

  const widths = [34, ...monthLabels.flatMap(() => [14, 14])];
  return buildWorksheet(XLSX, grid, widths, {
    rowHeights: { 0: 20, [headerTop]: 26 },
  });
}

// ---- Scheme holdings sheet (AMC-direct, all asset classes) -----------------
// Mirrors the dashboard Holdings tab: Instrument · Class · Industry/Rating, then
// per month (% to NAV, Value ₹Cr), preceded by the latest-month asset mix.

function schemeHoldingsSheet(XLSX: XlsxModule, data: SchemeExport) {
  const { monthLabels, monthBooksCr, holdings, assetMix } = data;
  const grid: (SCell | null)[][] = [];
  const nCols = 3 + monthLabels.length * 2;

  grid.push([titleCell("Full portfolio — direct from AMC", 14), ...Array(nCols - 1).fill(null)]);

  if (assetMix.length) {
    const mix = `Asset mix${monthLabels[0] ? ` · ${monthLabels[0]}` : ""}:  ${assetMix
      .map((a) => `${a.class} ${a.pct.toFixed(1)}%`)
      .join("   ·   ")}`;
    grid.push([titleCell(mix, 10, HEX.mutedText, false), ...Array(nCols - 1).fill(null)]);
  }
  // AUM-per-month caption (single cell, overflows right).
  const bookParts = monthLabels
    .map((l, i) => (monthBooksCr[i] !== null ? `${l} ₹${Math.round(monthBooksCr[i]!).toLocaleString("en-IN")} Cr` : null))
    .filter(Boolean);
  if (bookParts.length) {
    grid.push([titleCell(`AUM: ${bookParts.join("   ·   ")}`, 9, HEX.mutedText, false), ...Array(nCols - 1).fill(null)]);
  }
  grid.push(Array(nCols).fill(null));

  // Single header row — explicit "<month> % to NAV" / "<month> Value ₹Cr" per
  // month, plus Instrument / Class / Industry (no merged cells).
  const headerTop = grid.length;
  const head: SCell[] = [hCell("Instrument", "left"), hCell("Class", "left"), hCell("Industry / Rating", "left")];
  monthLabels.forEach((label) => {
    head.push(hCell(`${label} % to NAV`, "right"), hCell(`${label} Value ₹Cr`, "right"));
  });
  grid.push(head);

  holdings.forEach((row, ri) => {
    const zebra = ri % 2 === 1;
    const line: SCell[] = [
      textCell(row.company, "left", zebra),
      textCell(row.assetClass ?? "—", "left", zebra),
      textCell(row.industry || "—", "left", zebra),
    ];
    row.months.forEach((m) => {
      const tone = m.arrow === "up" ? 1 : m.arrow === "down" ? -1 : 0;
      line.push(numCell(m.aumPct, FMT.pct1, { zebra, tone }));
      line.push(numCell(m.valueCr ?? null, FMT.intGrouped, { zebra }));
    });
    grid.push(line);
  });

  const widths = [34, 12, 22, ...monthLabels.flatMap(() => [13, 13])];
  return buildWorksheet(XLSX, grid, widths, {
    rowHeights: { 0: 20, [headerTop]: 26 },
  });
}

// ---- Scheme workbook ------------------------------------------------------

function schemeSummarySheet(XLSX: XlsxModule, data: SchemeExport) {
  const grid: (SCell | null)[][] = [];
  const W = 6; // working width

  // Full-width lines are single cells that overflow to the right (no merges).
  const pushSpan = (cell: SCell) => {
    grid.push([cell, ...Array(W - 1).fill(null)]);
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
        )}; risk-free ${(data.ratiosMeta.riskFreeRate * 100).toFixed(1)}% (India 1Y T-bill).`,
        8,
        HEX.mutedText,
        false
      )
    );
  }

  const widths = [20, 12, 14, 9, 9, 11];
  return buildWorksheet(XLSX, grid, widths, { rowHeights: { 0: 22 } });
}

function prettyBench(id: string): string {
  return id === "NIFTY_500" ? "Nifty 500" : id;
}

function schemeSectorSheet(XLSX: XlsxModule, data: SchemeExport) {
  const grid: (SCell | null)[][] = [];
  grid.push([titleCell("Sector Allocation v/s Category Average", 14), null, null]);
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
  return buildWorksheet(XLSX, grid, [28, 12, 14], { rowHeights: { 0: 20 } });
}

/** Highlighted name cell for the user's selected fund (no fill merges). */
function selectedNameCell(name: string): SCell {
  return {
    v: `★ ${name}`,
    s: {
      font: { ...FONT, bold: true, color: { rgb: HEX.accentInk } },
      fill: fill(HEX.accent),
      alignment: { horizontal: "left", vertical: "center", wrapText: true },
      border: border(),
    },
  };
}

function schemePeerSheet(XLSX: XlsxModule, data: SchemeExport) {
  const grid: (SCell | null)[][] = [];
  const periods = data.peerPeriods;
  const periodHeader = (p: string) => (/^(3Y|5Y|10Y)$/.test(p) ? `${p} CAGR` : p);
  // Matrix layout: one ROW per fund, and a Returns + Ranking pair per period.
  // Fund rows stay fixed, so a single row reads as that fund's whole track
  // record across every horizon. The two header rows are UNMERGED (the period
  // label simply sits in the first cell of its pair) so every cell stays
  // individually addressable by formulas.
  const W = 1 + periods.length * 2;

  grid.push([titleCell("Peer Ranking — returns & rank by period", 14), ...Array(W - 1).fill(null)]);
  grid.push([
    titleCell(`${data.peerCohortLabel}  ·  listed alphabetically`, 9, HEX.mutedText, false),
    ...Array(W - 1).fill(null),
  ]);
  grid.push(Array(W).fill(null));

  // Header row 1: period label over each pair (label in the Returns cell).
  const h1: SCell[] = [hCell("", "left")];
  periods.forEach((p) => {
    h1.push(hCell(periodHeader(p), "center"), hCell("", "center"));
  });
  grid.push(h1);
  // Header row 2: Returns / Ranking under each period.
  const h2: SCell[] = [hCell("Fund", "left")];
  periods.forEach(() => {
    h2.push(hCell("Returns", "right"), hCell("Ranking", "right"));
  });
  grid.push(h2);

  data.peers.forEach((p, i) => {
    const zebra = i % 2 === 1;
    const line: SCell[] = [p.selected ? selectedNameCell(p.fund) : textCell(p.fund, "left", zebra)];
    periods.forEach((_, pi) => {
      const ret = p.returns[pi] ?? null;
      const rk = p.ranks?.[pi] ?? null;
      line.push(numCell(ret, FMT.pct1Signed, { tone: ret, zebra, bold: p.selected }));
      // Rank as a plain number so it sorts/filters; the peer count is in the
      // header note rather than glued in as "3/25" text.
      line.push(rk ? numCell(rk.rank, FMT.rank, { zebra }) : dash(zebra));
    });
    grid.push(line);
  });

  const peerCount = data.peers.find((p) => p.peerCount != null)?.peerCount ?? null;
  grid.push(Array(W).fill(null));
  grid.push([
    titleCell(
      `Returns are trailing (3Y/5Y/10Y annualised). Ranking is the fund's position within its cohort for that period${peerCount ? ` (out of ${peerCount} funds in the ${data.peerPeriod} cohort)` : ""}; 1 = best. Blank where the snapshot has no rank for that period.`,
      8,
      HEX.mutedText,
      false
    ),
    ...Array(W - 1).fill(null),
  ]);

  const widths = [34, ...periods.flatMap(() => [10, 9])];
  return buildWorksheet(XLSX, grid, widths, { rowHeights: { 0: 20, 3: 16, 4: 16 } });
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
      schemeHoldingsSheet(XLSX, data),
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
  const W = 3;
  const pushSpan = (cell: SCell) => {
    grid.push([cell, ...Array(W - 1).fill(null)]);
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

  return buildWorksheet(XLSX, grid, [26, 12, 4], { rowHeights: { 0: 22 } });
}

function fundHousePeerSheet(XLSX: XlsxModule, data: FundHouseExport) {
  const grid: (SCell | null)[][] = [];
  const W = 6;
  grid.push([titleCell("Peer fund houses", 14), ...Array(W - 1).fill(null)]);
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
  return buildWorksheet(XLSX, grid, [20, 9, 16, 12, 26, 26], { rowHeights: { 0: 20 } });
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
