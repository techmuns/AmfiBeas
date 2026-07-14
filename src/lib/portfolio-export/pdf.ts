/**
 * Styled PDF reports for the Portfolio Tracker master export, built with jsPDF
 * + jspdf-autotable. A coloured cover banner, dark-navy table headers, zebra
 * rows, green/red signed values and tinted quartile pills mirror the dashboard.
 * Both libraries are dynamically imported so they stay out of the initial bundle.
 */

import type { jsPDF, jsPDFOptions } from "jspdf";
import type { UserOptions, CellDef, RowInput, Styles } from "jspdf-autotable";
import { HEX, hexToRgb } from "./theme";
import type { FundHouseExport, RatioRow, SchemeExport } from "./types";

type RGB = [number, number, number];
const rgb = (hex: string): RGB => hexToRgb(hex);
const M = 34; // page margin (pt)
const GAP = 16;

// ---- value formatters (PDF cells are strings) ----
const fp1 = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(1)}%`);
const fp1s = (v: number | null) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const fp2 = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}%`);
const fp2s = (v: number | null) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
const fn2 = (v: number | null) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(2));
const fbps = (v: number | null) =>
  v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${Math.round(v).toLocaleString("en-IN")} bps`;
const fint = (v: number | null) =>
  v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("en-IN");

/** Tone colour for a signed value (green up / red down / ink flat). */
function tone(v: number | null | undefined): RGB {
  if (v == null || !Number.isFinite(v) || v === 0) return rgb(HEX.ink);
  return v > 0 ? rgb(HEX.positive) : rgb(HEX.negative);
}
/** A coloured cell. */
function c(content: string, color: RGB, styles: Partial<Styles> = {}): CellDef {
  return { content, styles: { textColor: color, ...styles } };
}
function signedPctCell(v: number | null, two = false): CellDef {
  return c(two ? fp2s(v) : fp1s(v), tone(v));
}
function bpsCell(v: number | null): CellDef {
  return c(fbps(v), tone(v));
}
const QUARTILE_TINT: Record<string, [string, string]> = {
  Q1: [HEX.positive, "FFFFFF"],
  Q2: [HEX.band, HEX.ink],
  Q3: [HEX.band, HEX.mutedText],
  Q4: [HEX.negative, "FFFFFF"],
};
function quartileCell(q: string | null): CellDef {
  if (!q) return { content: "—", styles: { textColor: rgb(HEX.mutedText), halign: "center" } };
  const [bg, fg] = QUARTILE_TINT[q] ?? [HEX.band, HEX.ink];
  return { content: q, styles: { fillColor: rgb(bg), textColor: rgb(fg), fontStyle: "bold", halign: "center" } };
}

type Doc = jsPDF & { lastAutoTable?: { finalY: number } };

function prettyBench(id: string): string {
  return id === "NIFTY_500" ? "Nifty 500" : id;
}

function savePdf(doc: jsPDF, filename: string): void {
  const blob = doc.output("blob");
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

export async function downloadSchemePdf(data: SchemeExport, filename: string): Promise<void> {
  if (typeof window === "undefined") return;
  const jspdfMod = (await import("jspdf")) as Record<string, unknown>;
  const JsPDFCtor = (jspdfMod.jsPDF ?? jspdfMod.default) as unknown as new (o?: jsPDFOptions) => Doc;
  const atMod = (await import("jspdf-autotable")) as Record<string, unknown>;
  const autoTable = (atMod.default ?? atMod) as unknown as AutoTableFn;
  const doc = new JsPDFCtor({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
  });
  const pageW = doc.internal.pageSize.getWidth();

  banner(doc, pageW, data.fundName, [data.category, data.amc ? `AMC ${data.amc}` : null]
    .filter(Boolean)
    .join("   ·   "), facts([
    data.aumCr != null ? `AUM ₹${Math.round(data.aumCr).toLocaleString("en-IN")} Cr` : null,
    data.navAsOf ? `NAV as of ${data.navAsOf}` : null,
    data.asOfMonth ? `Holdings ${data.asOfMonth}` : null,
  ]));
  let y = 86;

  const base = tableBase(pageW);

  // Returns & Ranking, one table per plan.
  for (const plan of data.plans) {
    y = heading(doc, `Returns & Ranking — ${plan.plan} plan`, y, pageW);
    autoTable(doc, {
      ...base,
      startY: y,
      head: [["Period", "Fund", "Category avg", "Rank", "Peers", "Quartile"]],
      body: plan.returns.map((r): RowInput => [
        { content: `${r.period}${r.cagr ? " CAGR" : ""}`, styles: { fontStyle: "bold", halign: "left" } },
        { ...signedPctCell(r.fundPct), styles: { ...signedPctCell(r.fundPct).styles, fontStyle: "bold" } },
        signedPctCell(r.categoryAvgPct),
        r.rank != null ? `${r.rank}` : "—",
        r.peerCount != null ? `${r.peerCount}` : "—",
        quartileCell(r.quartile),
      ]),
      columnStyles: { 0: { halign: "left" }, 1: { halign: "right" }, 2: { halign: "right" } },
    });
    y = afterTable(doc);
  }

  // Risk ratios (transposed) per plan.
  for (const plan of data.plans) {
    if (!plan.ratios?.length) continue;
    const ratios = plan.ratios;
    y = ensure(doc, y, 90);
    y = heading(doc, `Risk ratios — ${plan.plan} plan`, y, pageW);
    const fundRow: RowInput = [
      { content: "Fund", styles: { fontStyle: "bold", halign: "left" } },
      ...ratios.map((r: RatioRow): CellDef => {
        const better = r.higherBetter ? r.fund > r.categoryAvg : r.fund < r.categoryAvg;
        const worse = r.higherBetter ? r.fund < r.categoryAvg : r.fund > r.categoryAvg;
        const txt = r.unit === "%" ? (r.signed ? fp2s(r.fund) : fp2(r.fund)) : fn2(r.fund);
        return c(txt, better ? rgb(HEX.positive) : worse ? rgb(HEX.negative) : rgb(HEX.ink), {
          fontStyle: "bold",
        });
      }),
    ];
    const avgRow: RowInput = [
      { content: "Category average", styles: { halign: "left" } },
      ...ratios.map((r) => (r.unit === "%" ? (r.signed ? fp2s(r.categoryAvg) : fp2(r.categoryAvg)) : fn2(r.categoryAvg))),
    ];
    const rankRow: RowInput = [
      { content: "Rank in category", styles: { halign: "left" } },
      ...ratios.map((r) => `${r.rank}`),
    ];
    const countRow: RowInput = [
      { content: "Funds in category", styles: { halign: "left" } },
      ...ratios.map((r) => `${r.count}`),
    ];
    autoTable(doc, {
      ...base,
      startY: y,
      head: [["", ...ratios.map((r) => r.label)]],
      body: [fundRow, avgRow, rankRow, countRow],
      columnStyles: { 0: { halign: "left", fontStyle: "bold" } },
    });
    y = afterTable(doc);
  }
  if (data.ratiosMeta) {
    y = note(
      doc,
      `Ratios annualised from ${data.ratiosMeta.windowMonths} monthly returns vs ${prettyBench(
        data.ratiosMeta.benchmark
      )}; risk-free ${(data.ratiosMeta.riskFreeRate * 100).toFixed(1)}% (India 1Y T-bill).`,
      y,
      pageW
    );
  }

  // Sector allocation.
  if (data.sectors.length) {
    y = ensure(doc, y, 80);
    y = heading(doc, "Sector Allocation v/s Category Average", y, pageW);
    autoTable(doc, {
      ...base,
      startY: y,
      head: [["Sector", "Fund", "Category avg"]],
      body: data.sectors.map((s): RowInput => {
        const t = s.categoryAvgPct != null ? s.fundPct - s.categoryAvgPct : 0;
        return [
          { content: s.sector, styles: { halign: "left" } },
          c(fp1(s.fundPct), tone(t), { fontStyle: "bold" }),
          fp1(s.categoryAvgPct),
        ];
      }),
      columnStyles: { 0: { halign: "left" } },
    });
    y = afterTable(doc);
  }

  // Peer ranking — trailing returns for every peer across all periods, ranked by
  // the primary period (Rank / Quartile / vs-median refer to that period).
  if (data.peers.length) {
    y = ensure(doc, y, 90);
    y = heading(doc, `Peer Ranking — trailing returns  ·  ranked by ${data.peerPeriod}`, y, pageW);
    const periodHeader = (p: string) => (/^(3Y|5Y|10Y)$/.test(p) ? `${p} CAGR` : p);
    autoTable(doc, {
      ...base,
      startY: y,
      styles: { ...base.styles, fontSize: 7 },
      headStyles: { ...base.headStyles, fontSize: 7 },
      head: [["Fund", ...data.peerPeriods.map(periodHeader), "Rank", "Quartile", "vs median"]],
      body: data.peers.map((p): RowInput => {
        const name: CellDef = p.selected
          ? { content: `★ ${p.fund}`, styles: { fontStyle: "bold", fillColor: rgb(HEX.accent), textColor: rgb(HEX.accentInk), halign: "left" } }
          : { content: p.fund, styles: { halign: "left" } };
        return [
          name,
          ...p.returns.map((r) => signedPctCell(r)),
          p.rank != null && p.peerCount != null ? `${p.rank} / ${p.peerCount}` : "—",
          quartileCell(p.quartile),
          bpsCell(p.vsMedianBps),
        ];
      }),
      columnStyles: { 0: { halign: "left", cellWidth: 118 } },
    });
    y = afterTable(doc);
  }

  // Holdings (own page for breathing room).
  if (data.holdings.length) {
    doc.addPage();
    y = heading(doc, "Equity Holdings", 44, pageW);
    holdingsTable(doc, autoTable, base, y, data.monthLabels, data.monthBooksCr, data.holdings, "% of AUM");
  }

  footer(doc, pageW, `${data.fundName} · Source: ${data.holdingsSource} · Generated ${data.generatedAt}`);
  savePdf(doc, filename);
}

export async function downloadFundHousePdf(data: FundHouseExport, filename: string): Promise<void> {
  if (typeof window === "undefined") return;
  const jspdfMod = (await import("jspdf")) as Record<string, unknown>;
  const JsPDFCtor = (jspdfMod.jsPDF ?? jspdfMod.default) as unknown as new (o?: jsPDFOptions) => Doc;
  const atMod = (await import("jspdf-autotable")) as Record<string, unknown>;
  const autoTable = (atMod.default ?? atMod) as unknown as AutoTableFn;
  const doc = new JsPDFCtor({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
  });
  const pageW = doc.internal.pageSize.getWidth();
  const base = tableBase(pageW);

  banner(
    doc,
    pageW,
    data.amc,
    `${data.schemeCount} schemes  ·  ${data.holdingsCount} distinct holdings`,
    facts([
      `Equity book ₹${Math.round(data.equityValueCr).toLocaleString("en-IN")} Cr`,
      `Latest ${data.latestMonth}`,
    ])
  );
  let y = 86;

  if (data.capMix) {
    y = heading(doc, "Market-cap mix (latest month)", y, pageW);
    autoTable(doc, {
      ...base,
      startY: y,
      head: [["Bucket", "% of book"]],
      body: [
        [{ content: "Large cap", styles: { halign: "left" } }, fp1(data.capMix.large)],
        [{ content: "Mid cap", styles: { halign: "left" } }, fp1(data.capMix.mid)],
        [{ content: "Small cap", styles: { halign: "left" } }, fp1(data.capMix.small)],
      ],
      columnStyles: { 0: { halign: "left" }, 1: { halign: "right" } },
      tableWidth: 220,
    });
    y = afterTable(doc);
  }

  if (data.sectorMix.length) {
    y = ensure(doc, y, 80);
    y = heading(doc, "Sector mix (latest month)", y, pageW);
    autoTable(doc, {
      ...base,
      startY: y,
      head: [["Sector", "% of book"]],
      body: data.sectorMix.map((s): RowInput => [
        { content: s.sector, styles: { halign: "left" } },
        fp1(s.pct),
      ]),
      columnStyles: { 0: { halign: "left" }, 1: { halign: "right" } },
      tableWidth: 280,
    });
    y = afterTable(doc);
  }

  if (data.peers.length) {
    y = ensure(doc, y, 90);
    y = heading(doc, "Peer fund houses", y, pageW);
    autoTable(doc, {
      ...base,
      startY: y,
      head: [["Fund house", "Schemes", "Equity book ₹Cr", "Top-10", "Biggest buy", "Biggest sell"]],
      body: data.peers.map((p): RowInput => {
        const name: CellDef = p.selected
          ? { content: `★ ${p.amc}`, styles: { fontStyle: "bold", fillColor: rgb(HEX.accent), textColor: rgb(HEX.accentInk), halign: "left" } }
          : { content: p.amc, styles: { halign: "left" } };
        return [
          name,
          `${p.schemes}`,
          fint(p.equityBookCr),
          fp1(p.top10Pct),
          c(p.biggestBuyBps != null ? `+${p.biggestBuyBps} bps · ${p.biggestBuyName}` : "—", p.biggestBuyBps != null ? rgb(HEX.positive) : rgb(HEX.mutedText), { halign: "left" }),
          c(p.biggestSellBps != null ? `${p.biggestSellBps} bps · ${p.biggestSellName}` : "—", p.biggestSellBps != null ? rgb(HEX.negative) : rgb(HEX.mutedText), { halign: "left" }),
        ];
      }),
      columnStyles: { 0: { halign: "left" }, 4: { halign: "left", cellWidth: 110 }, 5: { halign: "left", cellWidth: 110 } },
    });
    y = afterTable(doc);
  }

  if (data.holdings.length) {
    doc.addPage();
    y = heading(doc, "Equity Holdings — all schemes combined", 44, pageW);
    holdingsTable(doc, autoTable, base, y, data.monthLabels, data.monthBooksCr, data.holdings, "% of book");
  }

  footer(doc, pageW, `${data.amc} · Source: ${data.holdingsSource} · Generated ${data.generatedAt}`);
  savePdf(doc, filename);
}

// ---- shared building blocks ----------------------------------------------

type AutoTableFn = (doc: jsPDF, options: UserOptions) => void;

function tableBase(pageW: number): UserOptions {
  return {
    theme: "grid",
    margin: { left: M, right: M },
    tableWidth: pageW - M * 2,
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 3,
      lineColor: rgb(HEX.border),
      lineWidth: 0.5,
      textColor: rgb(HEX.ink),
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: rgb(HEX.headerBg),
      textColor: [255, 255, 255],
      fontStyle: "bold",
      halign: "right",
    },
    alternateRowStyles: { fillColor: rgb(HEX.band) },
    columnStyles: { 0: { halign: "left" } },
  };
}

function banner(doc: jsPDF, pageW: number, title: string, subtitle: string, factsLine: string) {
  doc.setFillColor(...rgb(HEX.brand));
  doc.rect(0, 0, pageW, 64, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, M, 26);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  if (subtitle) doc.text(subtitle, M, 42);
  doc.setFontSize(8);
  doc.setTextColor(226, 232, 255);
  if (factsLine) doc.text(factsLine, M, 55);
}
function facts(parts: (string | null)[]): string {
  return parts.filter(Boolean).join("   ·   ");
}

function heading(doc: jsPDF, text: string, y: number, pageW: number): number {
  const top = ensure(doc, y, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...rgb(HEX.brandDark));
  doc.text(text, M, top, { maxWidth: pageW - M * 2 });
  return top + 8;
}
function note(doc: jsPDF, text: string, y: number, pageW: number): number {
  const top = ensure(doc, y, 24);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(...rgb(HEX.mutedText));
  const lines = doc.splitTextToSize(text, pageW - M * 2);
  doc.text(lines, M, top);
  return top + lines.length * 9 + GAP;
}
function afterTable(doc: Doc): number {
  return (doc.lastAutoTable?.finalY ?? 0) + GAP;
}
function ensure(doc: jsPDF, y: number, needed: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - 36) {
    doc.addPage();
    return 44;
  }
  return y;
}

function holdingsTable(
  doc: jsPDF,
  autoTable: AutoTableFn,
  base: UserOptions,
  y: number,
  monthLabels: string[],
  monthBooksCr: (number | null)[],
  rows: SchemeExport["holdings"],
  pctHeader: string
) {
  const head: string[] = ["Company"];
  monthLabels.forEach((label, i) => {
    const book = monthBooksCr[i];
    head.push(`${label} ${pctHeader}`);
    head.push(`${label} shares${book != null ? ` (₹${Math.round(book).toLocaleString("en-IN")} Cr)` : ""}`);
  });
  const body: RowInput[] = rows.map((row) => {
    const line: CellDef[] = [{ content: row.company, styles: { halign: "left" } }];
    row.months.forEach((m) => {
      line.push({ content: fp1(m.aumPct), styles: { halign: "right" } });
      const tcol = m.arrow === "up" ? rgb(HEX.positive) : m.arrow === "down" ? rgb(HEX.negative) : rgb(HEX.ink);
      line.push({ content: fint(m.shares), styles: { halign: "right", textColor: tcol } });
    });
    return line;
  });
  autoTable(doc, {
    ...base,
    startY: y,
    head: [head],
    body,
    styles: { ...base.styles, fontSize: 7 },
    headStyles: { ...base.headStyles, fontSize: 7, halign: "right" },
    columnStyles: { 0: { halign: "left", cellWidth: 150 } },
  });
}

function footer(doc: Doc, pageW: number, line: string) {
  const pages = doc.getNumberOfPages();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...rgb(HEX.mutedText));
    doc.text(line, M, pageH - 18, { maxWidth: pageW - M * 2 - 60 });
    doc.text(`${i} / ${pages}`, pageW - M, pageH - 18, { align: "right" });
  }
}
