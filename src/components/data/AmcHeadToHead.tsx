import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import { AmcComparePicker } from "@/components/data/AmcComparePicker";
import type { CsvColumn } from "@/lib/csv";
import { cn } from "@/lib/cn";
import { formatCompactCr } from "@/lib/format";
import type { AmcCompareMetrics } from "@/data/amc-compare";

const fmtCr = (v: number | null) => (v == null ? "—" : formatCompactCr(v));
const fmtPct = (v: number | null, d = 1) =>
  v == null ? "—" : `${v.toFixed(d)}%`;
const fmtSigned = (v: number | null) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const fmtBps = (v: number | null) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${Math.round(v)} bps`;
const fmtBpsAbs = (v: number | null) =>
  v == null ? "—" : `${v.toFixed(1)} bps`;
const fmtRank = (v: number | null) => (v == null ? "—" : `#${v}`);

interface Spec {
  group: string;
  label: string;
  pick: (m: AmcCompareMetrics) => number | null;
  fmt: (v: number | null) => string;
  /** When true, the SMALLER value is the leader (e.g. rank). */
  invert?: boolean;
}

const SPECS: Spec[] = [
  { group: "AUM & Market Share", label: "Total AAUM", pick: (m) => m.aaumCr, fmt: fmtCr },
  { group: "AUM & Market Share", label: "Market share", pick: (m) => m.marketSharePct, fmt: (v) => fmtPct(v, 2) },
  { group: "AUM & Market Share", label: "Share Δ QoQ", pick: (m) => m.shareDeltaBps, fmt: fmtBps },
  { group: "AUM & Market Share", label: "Rank by AAUM", pick: (m) => m.rank, fmt: fmtRank, invert: true },
  { group: "Growth", label: "QoQ AAUM growth", pick: (m) => m.qoqGrowthPct, fmt: fmtSigned },
  { group: "Growth", label: "YoY AAUM growth", pick: (m) => m.yoyGrowthPct, fmt: fmtSigned },
  { group: "Listed financials", label: "Operating revenue", pick: (m) => m.revenueCr, fmt: fmtCr },
  { group: "Listed financials", label: "Revenue yield", pick: (m) => m.revenueYieldBps, fmt: fmtBpsAbs },
  { group: "Listed financials", label: "Operating margin", pick: (m) => m.opMarginPct, fmt: (v) => fmtPct(v, 1) },
  { group: "Listed financials", label: "PAT margin", pick: (m) => m.patMarginPct, fmt: (v) => fmtPct(v, 1) },
  { group: "Derived equity book (equity only)", label: "Active equity AUM", pick: (m) => m.activeEquityCr, fmt: fmtCr },
  { group: "Derived equity book (equity only)", label: "Passive equity AUM", pick: (m) => m.passiveEquityCr, fmt: fmtCr },
  { group: "Derived equity book (equity only)", label: "Active share of equity", pick: (m) => m.activePct, fmt: (v) => fmtPct(v, 0) },
  { group: "Derived equity book (equity only)", label: "Passive share of equity", pick: (m) => m.passivePct, fmt: (v) => fmtPct(v, 0) },
];

interface ExportRow {
  metric: string;
  a: string;
  b: string;
  industry: string;
}

/**
 * AMC head-to-head comparison table — A vs B vs Industry on AAUM, market share
 * (+ QoQ Δ bps), growth, listed-AMC fee yield & margins (where available), and
 * the derived active/passive equity mix. The larger of A vs B is bolded per
 * row. Table-first with an Excel export; caveats flag listed-only and derived
 * fields. Server component (the picker is the only client island).
 */
export function AmcHeadToHead({
  a,
  b,
  industry,
  universe,
  quarterLabel,
}: {
  a: AmcCompareMetrics;
  b: AmcCompareMetrics;
  industry: AmcCompareMetrics;
  universe: { slug: string; displayName: string }[];
  quarterLabel: string | null;
}) {
  const exportRows: ExportRow[] = SPECS.map((s) => ({
    metric: s.label,
    a: s.fmt(s.pick(a)),
    b: s.fmt(s.pick(b)),
    industry: s.fmt(s.pick(industry)),
  }));
  const exportColumns: CsvColumn<ExportRow>[] = [
    { key: "metric", header: "Metric" },
    { key: "a", header: a.displayName },
    { key: "b", header: b.displayName },
    { key: "industry", header: "Industry" },
  ];

  const finQuarter = a.finQuarter ?? b.finQuarter;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AmcComparePicker universe={universe} a={a.slug} b={b.slug} />
        <DownloadXlsxButton
          rows={exportRows}
          columns={exportColumns}
          filename={`amc-compare-${a.slug}-vs-${b.slug}.xlsx`}
          sheetName="Head to Head"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full border-collapse text-[13px] tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border bg-card px-2.5 py-2 text-left font-semibold">
                Metric
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold">
                {a.displayName}
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold">
                {b.displayName}
              </th>
              <th className="border px-2.5 py-2 text-right font-semibold text-muted-foreground">
                Industry
              </th>
            </tr>
          </thead>
          <tbody>
            {SPECS.map((s, i) => {
              const aNum = s.pick(a);
              const bNum = s.pick(b);
              const aLeads =
                aNum != null &&
                bNum != null &&
                (s.invert ? aNum < bNum : aNum > bNum);
              const bLeads =
                aNum != null &&
                bNum != null &&
                (s.invert ? bNum < aNum : bNum > aNum);
              const groupHeader =
                i === 0 || SPECS[i - 1].group !== s.group ? s.group : null;
              return (
                <ConfigRow
                  key={s.label}
                  groupHeader={groupHeader}
                  label={s.label}
                  aText={s.fmt(aNum)}
                  bText={s.fmt(bNum)}
                  indText={s.fmt(s.pick(industry))}
                  aLeads={aLeads}
                  bLeads={bLeads}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        AAUM, market share and growth are MF-only AMFI Fundwise AAUM
        {quarterLabel ? ` (${quarterLabel})` : ""}.{" "}
        <span className="font-medium text-foreground">Listed financials</span>{" "}
        (revenue, yield, margins{finQuarter ? `, ${finQuarter}` : ""}) exist
        only for the listed AMCs — &ldquo;—&rdquo; otherwise.{" "}
        <span className="font-medium text-foreground">
          Derived equity book
        </span>{" "}
        (active / passive) is equity-only, from the RupeeVest snapshot on Market
        Share Insights, matched to the AMC by name (&ldquo;—&rdquo; where
        unmatched), so its active/passive shares describe the equity sleeve, not
        total AAUM. The larger of A vs B is bolded per row.
      </p>
    </div>
  );
}

function ConfigRow({
  groupHeader,
  label,
  aText,
  bText,
  indText,
  aLeads,
  bLeads,
}: {
  groupHeader: string | null;
  label: string;
  aText: string;
  bText: string;
  indText: string;
  aLeads: boolean;
  bLeads: boolean;
}) {
  return (
    <>
      {groupHeader && (
        <tr>
          <th
            colSpan={4}
            className="border bg-muted/40 px-2.5 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {groupHeader}
          </th>
        </tr>
      )}
      <tr>
        <th
          scope="row"
          className="sticky left-0 z-10 whitespace-nowrap border bg-card px-2.5 py-1.5 text-left font-medium"
        >
          {label}
        </th>
        <td
          className={cn(
            "border px-2.5 py-1.5 text-right text-foreground",
            aLeads && "font-bold"
          )}
        >
          {aText}
        </td>
        <td
          className={cn(
            "border px-2.5 py-1.5 text-right text-foreground",
            bLeads && "font-bold"
          )}
        >
          {bText}
        </td>
        <td className="border px-2.5 py-1.5 text-right text-muted-foreground">
          {indText}
        </td>
      </tr>
    </>
  );
}
