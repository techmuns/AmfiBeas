"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import {
  FundwiseTable,
  type FundwiseMetric,
} from "@/components/data/FundwiseTable";
import { DownloadXlsxButton } from "@/components/data/DownloadXlsxButton";
import { KeyTakeaway } from "@/components/ui/KeyTakeaway";
import type { FundwiseMatrix } from "@/data/amc-peer-universe";
import type { CsvColumn } from "@/lib/csv";
import { cn } from "@/lib/cn";

const LENSES: { value: FundwiseMetric; label: string }[] = [
  { value: "share", label: "Market share" },
  { value: "aaum", label: "AAUM" },
  { value: "growth", label: "QoQ growth" },
];

type FundwiseCsvRow = Record<string, string | number>;

/**
 * Fund-by-Fund Market Share card. The metric lens (share / AAUM / QoQ growth)
 * and the Excel export are handled entirely client-side from the prebuilt
 * matrix, so the page can be statically rendered — switching the lens never
 * hits the Worker (keeps it under the Free-plan CPU budget; Error 1102).
 */
export function FundwiseCard({ matrix }: { matrix: FundwiseMatrix }) {
  const [metric, setMetric] = useState<FundwiseMetric>("share");
  const latestIdx = matrix.quarterLabels.length - 1;

  const leaders = useMemo(() => {
    if (matrix.rows.length < 4 || latestIdx < 1) return null;
    const withDelta = matrix.rows
      .map((r) => ({ row: r, cell: r.cells[latestIdx] }))
      .filter(
        (x): x is { row: (typeof matrix.rows)[number]; cell: NonNullable<typeof x.cell> } =>
          x.cell !== null && x.cell.shareDeltaBps !== null
      )
      .sort((a, b) => (b.cell.shareDeltaBps ?? 0) - (a.cell.shareDeltaBps ?? 0));
    if (withDelta.length === 0) return null;
    const top5 = [...matrix.rows]
      .map((r) => r.cells[latestIdx]?.sharePct ?? 0)
      .sort((a, b) => b - a)
      .slice(0, 5)
      .reduce((s, v) => s + v, 0);
    return {
      gainer: withDelta[0],
      loser: withDelta[withDelta.length - 1],
      top5,
      prevLabel: matrix.quarterLabels[latestIdx - 1],
      latestLabel: matrix.quarterLabels[latestIdx],
    };
  }, [matrix, latestIdx]);

  const csvRows: FundwiseCsvRow[] = useMemo(
    () =>
      matrix.rows.map((r) => {
        const obj: FundwiseCsvRow = { AMC: r.displayName };
        matrix.quarterLabels.forEach((label, i) => {
          const c = r.cells[i];
          obj[label] =
            c === null
              ? ""
              : metric === "aaum"
                ? Math.round(c.aaum)
                : metric === "growth"
                  ? c.growthPct === null
                    ? ""
                    : Number(c.growthPct.toFixed(2))
                  : Number(c.sharePct.toFixed(2));
        });
        return obj;
      }),
    [matrix, metric]
  );
  const csvColumns: CsvColumn<FundwiseCsvRow>[] = [
    { key: "AMC", header: "AMC" },
    ...matrix.quarterLabels.map((label) => ({ key: label, header: label })),
  ];

  if (matrix.rows.length === 0) return null;

  return (
    <Card
      title="Fund-by-Fund Market Share"
      subtitleNode={
        <div className="space-y-0.5">
          <p className="text-xs text-muted-foreground">
            Each AMC&rsquo;s share of cohort AAUM by quarter, with the QoQ move
            in basis points — read down a column for the pecking order, across a
            row for momentum.
          </p>
          <p className="text-[11px] text-muted-foreground/80">
            {`Top ${matrix.rows.length} AMCs by AAUM · ${matrix.quarterLabels[0]} → ${matrix.quarterLabels[latestIdx]}`}
          </p>
        </div>
      }
      action={
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap gap-1 rounded-md border bg-card p-0.5">
            {LENSES.map((l) => (
              <button
                key={l.value}
                type="button"
                onClick={() => setMetric(l.value)}
                aria-pressed={metric === l.value}
                className={cn(
                  "rounded px-2 py-1 text-xs font-medium transition-colors",
                  metric === l.value
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
          <DownloadXlsxButton
            rows={csvRows}
            columns={csvColumns}
            filename={`fundwise-${metric}.xlsx`}
            sheetName={`Fundwise ${metric}`}
            label="Excel"
          />
        </div>
      }
    >
      {leaders && (
        <KeyTakeaway
          className="mb-3"
          headline={
            <>
              Over {leaders.prevLabel} → {leaders.latestLabel},{" "}
              <strong>{leaders.gainer.row.displayName}</strong> gained the most
              share (
              <span className="text-positive">
                {(leaders.gainer.cell.shareDeltaBps ?? 0) >= 0 ? "+" : "−"}
                {Math.abs(Math.round(leaders.gainer.cell.shareDeltaBps ?? 0))} bps
              </span>{" "}
              to {leaders.gainer.cell.sharePct.toFixed(2)}%), while{" "}
              <strong>{leaders.loser.row.displayName}</strong> gave up the most (
              <span className="text-negative">
                {(leaders.loser.cell.shareDeltaBps ?? 0) >= 0 ? "+" : "−"}
                {Math.abs(Math.round(leaders.loser.cell.shareDeltaBps ?? 0))} bps
              </span>{" "}
              to {leaders.loser.cell.sharePct.toFixed(2)}%).
            </>
          }
          detail={
            <>
              Top-5 AMCs hold {leaders.top5.toFixed(1)}% of cohort AAUM.{" "}
              {metric === "share"
                ? "Cells are tinted green where share was gained over the prior quarter, red where it was given up."
                : "Cells are tinted green where AAUM grew over the prior quarter, red where it shrank."}
            </>
          }
        />
      )}
      <FundwiseTable matrix={matrix} metric={metric} />
      <p className="mt-3 text-[11px] text-muted-foreground">
        Share % = each AMC&rsquo;s AAUM as a fraction of the cohort total that
        quarter; the small figure beneath is the QoQ change in basis points (100
        bps = 1pp). Toggle to <strong>AAUM</strong> for the rupee base (₹ Cr) or{" "}
        <strong>QoQ growth</strong> for the period-on-period change; both are
        tinted by momentum. Export sends the active view to Excel.
      </p>
    </Card>
  );
}
