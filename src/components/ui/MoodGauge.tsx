import { cn } from "@/lib/cn";

interface MoodGaugeProps {
  /** 0-100 mood index. */
  index: number;
  /** Plain-English label (Extreme Fear / Fear / Neutral / Greed / Extreme Greed). */
  label: string;
  /** Size in pixels — width of the gauge. Height auto-derives. */
  size?: number;
  className?: string;
}

/**
 * Semicircular mood gauge à la CNN's Fear & Greed Index.
 * Pure SVG — no chart library, no client state. The arc is split
 * into five tone-coloured segments (Extreme Fear → Extreme Greed)
 * and a needle points to the current index.
 */
export function MoodGauge({
  index,
  label,
  size = 220,
  className,
}: MoodGaugeProps) {
  const padding = 12;
  const labelGap = 18;
  const width = size;
  const height = size / 2 + padding * 2 + labelGap;
  const cx = width / 2;
  const cy = size / 2 + padding;
  const radius = (size / 2) - padding;

  // Five segments × 36° each = 180°.
  const segments = [
    { color: "hsl(var(--negative))", opacity: 0.85 },
    { color: "hsl(var(--negative))", opacity: 0.5 },
    { color: "hsl(var(--muted-foreground))", opacity: 0.3 },
    { color: "hsl(var(--positive))", opacity: 0.5 },
    { color: "hsl(var(--positive))", opacity: 0.85 },
  ];

  // SVG arc helper — generate a path for an annular sector.
  const arcPath = (
    startDeg: number,
    endDeg: number,
    innerR: number,
    outerR: number
  ) => {
    const polarToCart = (deg: number, r: number) => {
      const rad = ((deg - 180) * Math.PI) / 180;
      return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
    };
    const start = polarToCart(startDeg, outerR);
    const end = polarToCart(endDeg, outerR);
    const innerStart = polarToCart(endDeg, innerR);
    const innerEnd = polarToCart(startDeg, innerR);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    return [
      `M ${start.x} ${start.y}`,
      `A ${outerR} ${outerR} 0 ${largeArc} 1 ${end.x} ${end.y}`,
      `L ${innerStart.x} ${innerStart.y}`,
      `A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
      "Z",
    ].join(" ");
  };

  const innerR = radius * 0.7;
  const segmentWidth = 36; // degrees per segment

  // Needle position
  const clamped = Math.max(0, Math.min(100, index));
  const needleAngle = (clamped / 100) * 180; // 0 → left, 180 → right
  const needleRad = ((needleAngle - 180) * Math.PI) / 180;
  const needleLength = radius * 0.85;
  const needleX = cx + needleLength * Math.cos(needleRad);
  const needleY = cy + needleLength * Math.sin(needleRad);

  return (
    <div className={cn("inline-flex flex-col items-center", className)}>
      <svg width={width} height={height} role="img" aria-label={`Investor Mood: ${label}`}>
        {segments.map((s, i) => (
          <path
            key={i}
            d={arcPath(i * segmentWidth, (i + 1) * segmentWidth, innerR, radius)}
            fill={s.color}
            fillOpacity={s.opacity}
          />
        ))}
        {/* Centre cap */}
        <circle cx={cx} cy={cy} r={6} fill="hsl(var(--foreground))" />
        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={needleX}
          y2={needleY}
          stroke="hsl(var(--foreground))"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        {/* End cap */}
        <circle
          cx={needleX}
          cy={needleY}
          r={4}
          fill="hsl(var(--foreground))"
        />
        {/* Endpoint labels */}
        <text
          x={cx - radius + 2}
          y={cy + 16}
          textAnchor="start"
          fontSize="12"
          fill="hsl(var(--foreground))"
          className="tabular font-medium"
        >
          Fear
        </text>
        <text
          x={cx + radius - 2}
          y={cy + 16}
          textAnchor="end"
          fontSize="12"
          fill="hsl(var(--foreground))"
          className="tabular font-medium"
        >
          Greed
        </text>
      </svg>
      <div className="-mt-3 text-center">
        <div className="text-3xl font-semibold tabular tracking-tight">
          {clamped}
        </div>
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}
