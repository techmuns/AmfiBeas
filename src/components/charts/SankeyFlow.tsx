import { cn } from "@/lib/cn";

interface SankeyNode {
  id: string;
  label: string;
  /** Tone hint for the node block colour. */
  tone?: "positive" | "negative" | "neutral";
}

interface SankeyLink {
  source: string;
  target: string;
  /** Absolute value of the flow — node + link widths scale with this. */
  value: number;
  /** Optional override for the link tone. Defaults to neutral. */
  tone?: "positive" | "negative" | "neutral";
}

interface SankeyFlowProps {
  /** Source-side nodes (rendered on the left). */
  sources: SankeyNode[];
  /** Target-side nodes (rendered on the right). */
  targets: SankeyNode[];
  /** Links connecting sources to targets. */
  links: SankeyLink[];
  height?: number;
  className?: string;
  /** Caller-provided value formatter (e.g. ₹ Cr). */
  formatValue?: (v: number) => string;
}

const TONE_FILL: Record<NonNullable<SankeyNode["tone"]>, string> = {
  positive: "hsl(var(--positive))",
  negative: "hsl(var(--negative))",
  neutral: "hsl(var(--chart-1))",
};

const TONE_LINK: Record<NonNullable<SankeyLink["tone"]>, string> = {
  positive: "hsl(var(--positive))",
  negative: "hsl(var(--negative))",
  neutral: "hsl(var(--chart-1))",
};

/**
 * A two-column Sankey-style flow diagram. Sources on the left,
 * targets on the right, links drawn as smoothed bezier ribbons whose
 * thickness scales with the flow value. Designed to render the
 * single image that summarises "where the money moved" — the kind
 * of diagram broker reports never have.
 *
 * Pure SVG, no external chart library.
 */
export function SankeyFlow({
  sources,
  targets,
  links,
  height = 360,
  className,
  formatValue,
}: SankeyFlowProps) {
  const padding = { top: 16, bottom: 16, x: 4 };
  const innerHeight = height - padding.top - padding.bottom;
  const nodeWidth = 14;
  const nodeGap = 12;

  // Compute total volume per source / target to size node blocks.
  const sourceTotals = new Map<string, number>();
  const targetTotals = new Map<string, number>();
  for (const l of links) {
    sourceTotals.set(l.source, (sourceTotals.get(l.source) ?? 0) + Math.abs(l.value));
    targetTotals.set(l.target, (targetTotals.get(l.target) ?? 0) + Math.abs(l.value));
  }
  const grandTotal = links.reduce((s, l) => s + Math.abs(l.value), 0);
  if (grandTotal === 0) return null;

  // Per-node available pixel-height (proportional to its total). A ribbon
  // has ONE thickness, so source block heights, target block heights, and
  // link thickness must all share a single pixel scale — otherwise the
  // stacked ribbons under/overflow the target blocks whenever the two
  // columns have different node counts (hence different gap totals). Use the
  // smaller usable height so both columns fit within innerHeight.
  const totalNodeGapsLeft = nodeGap * (sources.length - 1);
  const totalNodeGapsRight = nodeGap * (targets.length - 1);
  const usable = Math.min(
    innerHeight - totalNodeGapsLeft,
    innerHeight - totalNodeGapsRight
  );
  const sourceHeight = (id: string) =>
    ((sourceTotals.get(id) ?? 0) / grandTotal) * usable;
  const targetHeight = (id: string) =>
    ((targetTotals.get(id) ?? 0) / grandTotal) * usable;

  // Compute y-anchor for each node (top of its block).
  const sourceYByIndex: number[] = [];
  let cursor = padding.top;
  for (let i = 0; i < sources.length; i++) {
    sourceYByIndex[i] = cursor;
    cursor += sourceHeight(sources[i].id) + (i < sources.length - 1 ? nodeGap : 0);
  }
  const targetYByIndex: number[] = [];
  cursor = padding.top;
  for (let i = 0; i < targets.length; i++) {
    targetYByIndex[i] = cursor;
    cursor += targetHeight(targets[i].id) + (i < targets.length - 1 ? nodeGap : 0);
  }

  // Per-link thickness in pixels — same scale as the node blocks above so
  // ribbons exactly fill both their source and target blocks.
  const linkThickness = (v: number) => Math.max(1, (Math.abs(v) / grandTotal) * usable);
  // For each link, we need the y-offset within its source / target block.
  const sourceCursor = new Map<string, number>();
  const targetCursor = new Map<string, number>();
  for (const s of sources) sourceCursor.set(s.id, 0);
  for (const t of targets) targetCursor.set(t.id, 0);

  // Layout & render
  // viewBox width is fixed; SVG scales to container via max-width.
  const vw = 720;
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <svg
        viewBox={`0 0 ${vw} ${height}`}
        className="block w-full"
        style={{ minWidth: 480 }}
      >
        {/* Source nodes + labels */}
        {sources.map((s, i) => {
          const y = sourceYByIndex[i];
          const h = sourceHeight(s.id);
          const fill = TONE_FILL[s.tone ?? "neutral"];
          return (
            <g key={s.id}>
              <rect
                x={padding.x}
                y={y}
                width={nodeWidth}
                height={Math.max(2, h)}
                fill={fill}
                rx={2}
              />
              <text
                x={padding.x + nodeWidth + 6}
                y={y + h / 2}
                dominantBaseline="middle"
                fontSize="11"
                fill="hsl(var(--foreground))"
                className="font-medium"
              >
                {s.label}
              </text>
              <text
                x={padding.x + nodeWidth + 6}
                y={y + h / 2 + 12}
                dominantBaseline="middle"
                fontSize="9"
                fill="hsl(var(--muted-foreground))"
                className="tabular"
              >
                {formatValue
                  ? formatValue(sourceTotals.get(s.id) ?? 0)
                  : (sourceTotals.get(s.id) ?? 0).toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* Target nodes + labels */}
        {targets.map((t, i) => {
          const y = targetYByIndex[i];
          const h = targetHeight(t.id);
          const fill = TONE_FILL[t.tone ?? "neutral"];
          return (
            <g key={t.id}>
              <rect
                x={vw - padding.x - nodeWidth}
                y={y}
                width={nodeWidth}
                height={Math.max(2, h)}
                fill={fill}
                rx={2}
              />
              <text
                x={vw - padding.x - nodeWidth - 6}
                y={y + h / 2}
                dominantBaseline="middle"
                textAnchor="end"
                fontSize="11"
                fill="hsl(var(--foreground))"
                className="font-medium"
              >
                {t.label}
              </text>
              <text
                x={vw - padding.x - nodeWidth - 6}
                y={y + h / 2 + 12}
                dominantBaseline="middle"
                textAnchor="end"
                fontSize="9"
                fill="hsl(var(--muted-foreground))"
                className="tabular"
              >
                {formatValue
                  ? formatValue(targetTotals.get(t.id) ?? 0)
                  : (targetTotals.get(t.id) ?? 0).toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* Links — bezier ribbons */}
        {links.map((l, i) => {
          const srcIdx = sources.findIndex((s) => s.id === l.source);
          const tgtIdx = targets.findIndex((t) => t.id === l.target);
          if (srcIdx === -1 || tgtIdx === -1) return null;
          const thickness = linkThickness(l.value);
          const srcOffset = sourceCursor.get(l.source) ?? 0;
          const tgtOffset = targetCursor.get(l.target) ?? 0;
          sourceCursor.set(l.source, srcOffset + thickness);
          targetCursor.set(l.target, tgtOffset + thickness);
          const sy = sourceYByIndex[srcIdx] + srcOffset + thickness / 2;
          const ty = targetYByIndex[tgtIdx] + tgtOffset + thickness / 2;
          const sx = padding.x + nodeWidth;
          const tx = vw - padding.x - nodeWidth;
          // Smoothed bezier: control points at horizontal midpoint.
          const cx1 = sx + (tx - sx) * 0.5;
          const cx2 = tx - (tx - sx) * 0.5;
          const stroke = TONE_LINK[l.tone ?? "neutral"];
          return (
            <path
              key={i}
              d={`M ${sx} ${sy} C ${cx1} ${sy} ${cx2} ${ty} ${tx} ${ty}`}
              fill="none"
              stroke={stroke}
              strokeWidth={thickness}
              strokeOpacity={0.35}
            >
              <title>
                {`${l.source} → ${l.target}: ${formatValue ? formatValue(l.value) : l.value.toFixed(0)}`}
              </title>
            </path>
          );
        })}
      </svg>
    </div>
  );
}
