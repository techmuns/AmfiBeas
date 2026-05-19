import Link from "next/link";
import { cn } from "@/lib/cn";

interface LensOption {
  value: string;
  label: string;
}

interface LensToggleProps {
  /** The pathname the toggle links back to (e.g. "/monthly"). */
  basePath: string;
  /** URL query-param key for this toggle (e.g. "flowsLens"). */
  paramName: string;
  /** Possible lens options to render. */
  lenses: LensOption[];
  /** Currently active lens value (matches one of `lenses[].value`). */
  active: string;
  /** Optional default lens — when the active matches, that link
   *  drops the query param so the URL stays clean. */
  defaultValue?: string;
  /** Extra query params to preserve on the link (e.g. `{ month: "2026-04" }`). */
  preserveParams?: Record<string, string | undefined>;
  className?: string;
}

/**
 * URL-param segmented toggle — pure server component. Renders a row
 * of `<Link>`s, each pointing to the same page with a different value
 * for `paramName`. Mirrors the pattern used by the heatmap lens
 * (?heatmap=share|zscore) so adding a new lens to any chart is a one-
 * liner. Active state is computed from the parent's parsed value.
 */
export function LensToggle({
  basePath,
  paramName,
  lenses,
  active,
  defaultValue,
  preserveParams,
  className,
}: LensToggleProps) {
  const baseClass =
    "rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-tight transition-colors";
  const activeClass = "border-foreground/40 bg-foreground/5 text-foreground";
  const inactiveClass =
    "border-border text-muted-foreground hover:bg-accent hover:text-foreground";
  // Preserve the rest of the URL so the user keeps any other lens
  // toggles + selected month/quarter. Empty values get dropped so
  // the resulting URL stays tidy. The toggle's OWN paramName is
  // skipped here — we set it explicitly below — so the link to the
  // default lens drops the param entirely (otherwise preserveParams
  // would re-add the current value and the toggle would refuse to
  // switch back).
  const buildQuery = (value: string) => {
    const out: Record<string, string> = {};
    if (preserveParams) {
      for (const [k, v] of Object.entries(preserveParams)) {
        if (k === paramName) continue;
        if (typeof v === "string" && v.length > 0) out[k] = v;
      }
    }
    if (value !== defaultValue) {
      out[paramName] = value;
    }
    return out;
  };
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-md border bg-card p-0.5 shadow-sm",
        className
      )}
    >
      {lenses.map((l) => (
        <Link
          key={l.value}
          href={{ pathname: basePath, query: buildQuery(l.value) }}
          scroll={false}
          className={cn(baseClass, active === l.value ? activeClass : inactiveClass)}
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
