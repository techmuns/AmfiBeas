import { BRAND } from "@/lib/brand-palette";
import { formatCagr } from "@/lib/cagr";

interface CagrArrowSpec {
  /** X-axis label of the start of the CAGR window (must match the
   *  `dataKey` value of the leftmost bar in the window). */
  startLabel: string;
  /** X-axis label of the end of the CAGR window. */
  endLabel: string;
  /** Computed CAGR % over the window — pass NaN to suppress the
   *  arrow (the renderer guards on Number.isFinite). */
  cagrPct: number;
  /** Bar-top y-axis values at the two endpoints. For stacked bars
   *  this is `bottom + top`. */
  startValue: number;
  endValue: number;
}

interface ChartInternals {
  xAxisMap?: Record<string, { scale?: (v: number | string) => number; bandwidth?: () => number }>;
  yAxisMap?: Record<string, { scale?: (v: number) => number }>;
  offset?: { top?: number; left?: number; bottom?: number; right?: number };
  width?: number;
  height?: number;
}

/**
 * Returns a Recharts `<Customized component={...}>` render-function
 * that draws a diagonal arrow from the start bar top to the end bar
 * top with the CAGR label floating above the arrow midpoint.
 *
 * The function reads the chart's internal axis scales from the props
 * Recharts hands `<Customized>` children — there's no DOM ref or
 * post-render geometry lookup, so it stays in sync with bar widths
 * and axis domains automatically.
 */
export function cagrArrowOverlay(spec: CagrArrowSpec) {
  return function CagrArrow(props: ChartInternals) {
    if (!Number.isFinite(spec.cagrPct)) return null;
    const xAxis = pickFirst(props.xAxisMap);
    const yAxis = pickFirst(props.yAxisMap);
    if (!xAxis?.scale || !yAxis?.scale) return null;

    const x1Center = barCenter(xAxis, spec.startLabel);
    const x2Center = barCenter(xAxis, spec.endLabel);
    if (x1Center === null || x2Center === null) return null;

    const y1 = yAxis.scale(spec.startValue);
    const y2 = yAxis.scale(spec.endValue);
    if (!Number.isFinite(y1) || !Number.isFinite(y2)) return null;

    const liftPx = 14;
    const ax1 = x1Center;
    const ay1 = y1 - liftPx;
    const ax2 = x2Center;
    const ay2 = y2 - liftPx;
    const mx = (ax1 + ax2) / 2;
    const my = (ay1 + ay2) / 2;
    const labelOffsetY = -10;

    const markerId = `cagr-arrowhead-${spec.startLabel}-${spec.endLabel}`.replace(
      /[^a-zA-Z0-9_-]/g,
      "_"
    );

    return (
      <g pointerEvents="none">
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 Z" fill={BRAND.navy} />
          </marker>
        </defs>
        <line
          x1={ax1}
          y1={ay1}
          x2={ax2}
          y2={ay2}
          stroke={BRAND.navy}
          strokeWidth={1.6}
          markerEnd={`url(#${markerId})`}
        />
        <rect
          x={mx - 38}
          y={my + labelOffsetY - 8}
          width={76}
          height={16}
          rx={3}
          ry={3}
          fill={BRAND.labelOnFill}
          fillOpacity={0.92}
        />
        <text
          x={mx}
          y={my + labelOffsetY + 3}
          textAnchor="middle"
          fontSize={11}
          fontWeight={600}
          fill={BRAND.navy}
        >
          {formatCagr(spec.cagrPct)}
        </text>
      </g>
    );
  };
}

function pickFirst<T>(map: Record<string, T> | undefined): T | undefined {
  if (!map) return undefined;
  const key = Object.keys(map)[0];
  return key ? map[key] : undefined;
}

function barCenter(
  xAxis: { scale?: (v: number | string) => number; bandwidth?: () => number },
  label: string
): number | null {
  if (!xAxis.scale) return null;
  const raw = xAxis.scale(label);
  if (!Number.isFinite(raw)) return null;
  const band =
    typeof xAxis.bandwidth === "function" ? xAxis.bandwidth() : 0;
  return raw + band / 2;
}
