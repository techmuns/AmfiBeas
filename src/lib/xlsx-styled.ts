/**
 * Styled .xlsx builder — a thin, typed layer over `xlsx-js-style` (a SheetJS
 * fork that honours per-cell `.s` style objects, which the community `xlsx`
 * build silently drops).
 *
 * The whole library is loaded with a dynamic import() inside
 * downloadStyledWorkbook (invoked from a click handler) so it is code-split out
 * of the initial page bundle, exactly like lib/xlsx.ts.
 *
 * Authoring model: a sheet is a 2-D array of `Cell` objects ({ v, t, s, z }).
 * `aoa_to_sheet` preserves the style + number-format on each, so a sheet reads
 * top-to-bottom like the markup it mirrors. The factory helpers below
 * (`title`, `th`, `pct`, `delta`, `bar`, …) stamp the dashboard palette onto a
 * value so call sites stay declarative.
 */
import {
  BAND,
  BORDER,
  FMT_PCT,
  FMT_PP,
  FMT_SHARES,
  HEADER_BG,
  HEADER_FG,
  INK,
  MUTED,
  NEG,
  NEG_SOFT,
  POS,
  POS_SOFT,
} from "@/lib/xlsx-theme";

type CellType = "s" | "n" | "b";
type Align = "left" | "center" | "right";

export interface CellStyle {
  font?: {
    name?: string;
    sz?: number;
    bold?: boolean;
    italic?: boolean;
    color?: { rgb: string };
  };
  fill?: { patternType?: string; fgColor: { rgb: string } };
  alignment?: { horizontal?: Align; vertical?: "top" | "center" | "bottom"; wrapText?: boolean };
  border?: Partial<
    Record<"top" | "bottom" | "left" | "right", { style: string; color: { rgb: string } }>
  >;
}

export interface Cell {
  v: string | number | boolean | null;
  t?: CellType;
  s?: CellStyle;
  z?: string;
}

export interface StyledSheet {
  name: string;
  rows: Cell[][];
  /** Column widths in character units. */
  cols?: number[];
  /** Merged ranges, 0-indexed { s:{r,c}, e:{r,c} }. */
  merges?: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>;
}

const thin = { style: "thin", color: { rgb: BORDER } };
const gridBorder = { top: thin, bottom: thin, left: thin, right: thin };

export type Tone = "positive" | "negative" | "muted" | "ink";

function toneColor(tone: Tone): string {
  switch (tone) {
    case "positive":
      return POS;
    case "negative":
      return NEG;
    case "muted":
      return MUTED;
    default:
      return INK;
  }
}

/** Big sheet title. */
export function title(text: string): Cell {
  return { v: text, t: "s", s: { font: { bold: true, sz: 15, color: { rgb: INK } } } };
}

/** Muted descriptive line under a title. */
export function subtitle(text: string): Cell {
  return { v: text, t: "s", s: { font: { sz: 10, color: { rgb: MUTED } } } };
}

/** Bold section heading inside a sheet. */
export function sectionTitle(text: string): Cell {
  return { v: text, t: "s", s: { font: { bold: true, sz: 12, color: { rgb: INK } } } };
}

/** A labelled key-takeaway line: bold label + value, optional tone on value. */
export function labelled(label: string, value: string, tone: Tone = "ink"): Cell {
  return {
    v: `${label}${value}`,
    t: "s",
    s: { font: { sz: 10, color: { rgb: toneColor(tone) } } },
  };
}

/** Table header cell — white on navy, bordered. */
export function th(text: string, align: Align = "left"): Cell {
  return {
    v: text,
    t: "s",
    s: {
      font: { bold: true, sz: 10, color: { rgb: HEADER_FG } },
      fill: { patternType: "solid", fgColor: { rgb: HEADER_BG } },
      alignment: { horizontal: align, vertical: "center", wrapText: true },
      border: gridBorder,
    },
  };
}

/** Sub-header band cell (light grey) — for the second row of a two-row header. */
export function subTh(text: string, align: Align = "right"): Cell {
  return {
    v: text,
    t: "s",
    s: {
      font: { bold: true, sz: 9, color: { rgb: MUTED } },
      fill: { patternType: "solid", fgColor: { rgb: BAND } },
      alignment: { horizontal: align, vertical: "center" },
      border: gridBorder,
    },
  };
}

/** Plain text cell. */
export function td(
  text: string | null,
  opts: { align?: Align; tone?: Tone; bold?: boolean; fill?: string } = {}
): Cell {
  const { align = "left", tone = "ink", bold = false, fill } = opts;
  return {
    v: text ?? "",
    t: "s",
    s: {
      font: { sz: 10, bold, color: { rgb: toneColor(tone) } },
      alignment: { horizontal: align, vertical: "center" },
      ...(fill ? { fill: { patternType: "solid", fgColor: { rgb: fill } } } : {}),
      border: gridBorder,
    },
  };
}

/** Numeric cell with a number format; right-aligned, optional tone/fill. */
export function num(
  value: number | null,
  z: string,
  opts: { tone?: Tone; bold?: boolean; fill?: string } = {}
): Cell {
  const { tone = "ink", bold = false, fill } = opts;
  if (value === null || !Number.isFinite(value)) {
    return td("—", { align: "right", tone: "muted", fill });
  }
  return {
    v: value,
    t: "n",
    z,
    s: {
      font: { sz: 10, bold, color: { rgb: toneColor(tone) } },
      alignment: { horizontal: "right", vertical: "center" },
      ...(fill ? { fill: { patternType: "solid", fgColor: { rgb: fill } } } : {}),
      border: gridBorder,
    },
  };
}

/** "% of AUM" cell (value is the percentage, e.g. 6.0 → "6.0%"). */
export function pct(value: number | null, opts: { tone?: Tone; fill?: string } = {}): Cell {
  return num(value, FMT_PCT, { ...opts });
}

/** Signed "Δ … pp" cell, auto-toned green/red and softly tinted. */
export function delta(value: number | null): Cell {
  if (value === null || !Number.isFinite(value)) return td("—", { align: "right", tone: "muted" });
  const tone: Tone = value > 0.05 ? "positive" : value < -0.05 ? "negative" : "muted";
  const fill = value > 0.05 ? POS_SOFT : value < -0.05 ? NEG_SOFT : undefined;
  return num(value, FMT_PP, { tone, fill });
}

/** Share-count cell, font-toned by the up/down/flat arrow direction. */
export function shares(value: number | null, arrow: "up" | "down" | "flat/none" | "missing" | "unknown"): Cell {
  const tone: Tone = arrow === "up" ? "positive" : arrow === "down" ? "negative" : "ink";
  return num(value, FMT_SHARES, { tone });
}

/** In-cell horizontal bar built from block glyphs (a chart without a chart). */
export function bar(value: number | null, max: number, color: string, width = 12): Cell {
  if (value === null || !Number.isFinite(value) || max <= 0) {
    return td("", { align: "left" });
  }
  const n = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  const glyphs = "█".repeat(n) || "▏";
  return {
    v: glyphs,
    t: "s",
    s: {
      font: { sz: 10, color: { rgb: color } },
      alignment: { horizontal: "left", vertical: "center" },
      border: gridBorder,
    },
  };
}

/** A coloured signal label (overweight/underweight/only-X). */
export function signal(text: string, tone: Tone): Cell {
  return td(text, { tone, bold: tone !== "muted" });
}

/**
 * Build + download a multi-sheet styled workbook. No-op during SSR. The
 * `xlsx-js-style` engine is dynamically imported so it never enters the
 * initial bundle.
 */
export async function downloadStyledWorkbook(
  sheets: StyledSheet[],
  filename: string
): Promise<void> {
  if (typeof window === "undefined") return;
  const XLSX = await import("xlsx-js-style");
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows as unknown[][]);
    if (sheet.cols) ws["!cols"] = sheet.cols.map((wch) => ({ wch }));
    if (sheet.merges) ws["!merges"] = sheet.merges;
    const safe = sheet.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
    XLSX.utils.book_append_sheet(wb, ws, safe);
  }
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
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
