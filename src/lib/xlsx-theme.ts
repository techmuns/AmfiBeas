/**
 * Dashboard → Excel colour bridge.
 *
 * ARGB hex equivalents of the dashboard's CSS custom properties (globals.css,
 * light theme) so a downloaded workbook reads with the SAME palette as the
 * on-screen tracker: navy headers, green for "up / overweight", red for
 * "down / underweight", muted grey for secondary text, and the chart ramp for
 * sector bars. Keeping these in one place means the spreadsheet tracks the
 * dashboard if the brand palette ever shifts.
 */

// Text + surfaces
export const INK = "FF181C25"; // --foreground
export const MUTED = "FF656C7B"; // --muted-foreground
export const BORDER = "FFE2E4E9"; // --border
export const BAND = "FFF3F4F6"; // --muted (sub-header band)
export const ROW_ALT = "FFF9FAFB"; // zebra stripe
export const WHITE = "FFFFFFFF";

// Header chrome — dark navy with white text (the dashboard's table-header feel)
export const HEADER_BG = "FF182543";
export const HEADER_FG = "FFFFFFFF";

// Semantic tones
export const POS = "FF25935F"; // --positive
export const NEG = "FFDB2424"; // --negative
export const POS_SOFT = "FFDFF6EB"; // soft green tint
export const NEG_SOFT = "FFFBE5E5"; // soft red tint

// Market-cap mix (matches the fund-wise cap bar)
export const CAP_LARGE = "FF2853B8";
export const CAP_MID = "FF2191CA";
export const CAP_SMALL = "FFE77E23";

// Sector / categorical ramp (--chart-1 … --chart-12)
export const CHART_RAMP = [
  "FF3361CC",
  "FF29A36A",
  "FFF59F0A",
  "FFA347D1",
  "FF1791CF",
  "FFD74242",
  "FFDA2F85",
  "FF599130",
  "FF7A5CD6",
  "FF1F9384",
  "FFD1661A",
  "FF677583",
] as const;

/** Excel number formats. The stored value stays numeric (sortable) while the
 *  display string mirrors the dashboard ("6.0%", "+3.8pp", "−4.2pp"). */
export const FMT_PCT = '0.0"%"';
export const FMT_PCT2 = '0.00"%"';
export const FMT_PP = '+0.0"pp";-0.0"pp";0.0"pp"';
export const FMT_SHARES = "#,##0";
export const FMT_CR = '#,##0" Cr"';
export const FMT_RUPEE = '"₹"#,##0.00';
