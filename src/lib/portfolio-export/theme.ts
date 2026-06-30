/**
 * Shared palette + number formats for the Portfolio Tracker Excel/PDF exports.
 * Hex values mirror the dashboard's light-theme tokens (globals.css) so a
 * downloaded workbook or PDF reads like the on-screen tables: dark-navy header
 * bands, green gains, red losses, light zebra fills.
 */

export const HEX = {
  ink: "1B2230", // --foreground (dark navy text)
  mutedText: "6B7280", // --muted-foreground
  positive: "1F9D57", // --positive (green)
  negative: "DB2424", // --negative (red)
  headerBg: "1B2230", // dark band (mirrors the active dark tab)
  headerText: "FFFFFF",
  band: "F2F5F9", // zebra / muted fill (--muted)
  border: "DFE3E9", // --border
  accent: "EAF0FF", // selected-row highlight
  accentInk: "1E3A8A", // accent text (indigo-900)
  brand: "4F46E5", // indigo accent for the cover banner
  brandDark: "3730A3",
  white: "FFFFFF",
  subInk: "30527A",
};

/** "1B2230" → [27, 34, 48] for jsPDF's RGB setters. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

// Excel number formats. Percent values are stored as the literal percent number
// (2.0 = "2.0%"), so we append a literal % rather than Excel's ×100 percent
// format. Signed formats render green/red is applied separately via font color.
export const FMT = {
  pct1: '0.0"%"',
  pct1Signed: '+0.0"%";−0.0"%"',
  pct2: '0.00"%"',
  pct2Signed: '+0.00"%";−0.00"%"',
  num2: "0.00",
  num2Signed: "+0.00;−0.00",
  bps: '#,##0" bps"',
  bpsSigned: '+#,##0" bps";−#,##0" bps"',
  intGrouped: "#,##0",
  rupeeCr: '"₹"#,##0',
  nav: '"₹"#,##0.0000',
  rank: "0",
} as const;

/** Sign → dashboard tone colour (hex, no #). null when neutral/zero. */
export function toneHex(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return HEX.ink;
  return n > 0 ? HEX.positive : HEX.negative;
}
