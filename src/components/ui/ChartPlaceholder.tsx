interface ChartPlaceholderProps {
  height?: number;
  label?: string;
}

export function ChartPlaceholder({
  height = 256,
  label = "Chart",
}: ChartPlaceholderProps) {
  return (
    <div
      className="flex items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground"
      style={{ height }}
    >
      {label}
    </div>
  );
}
