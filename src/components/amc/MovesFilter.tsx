"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";

interface Option {
  value: string;
  label: string;
}

interface MovesFilterProps {
  amcOptions: Option[];
  periodOptions: Option[];
  selectedAmc: string;
  selectedPeriod: string;
}

/**
 * Client-only dropdown pair for the Strategic Moves Cohort filter on
 * `/amcs?tab=insights`. Writes the chosen values to URL params
 * `?moveAmc=...&movePeriod=...` so the selection is shareable + the
 * surrounding server component re-renders with the new filter.
 *
 * Uses native `<select>` for accessibility and zero design overhead —
 * the surrounding card frame is plenty of chrome.
 */
export function MovesFilter({
  amcOptions,
  periodOptions,
  selectedAmc,
  selectedPeriod,
}: MovesFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const selectCls =
    "rounded-md border border-border bg-card px-3 py-1.5 text-[12.5px] font-medium text-foreground shadow-sm hover:bg-accent focus:outline-none focus:ring-2 focus:ring-foreground/20";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        AMC
        <select
          value={selectedAmc}
          onChange={(e) => update("moveAmc", e.target.value)}
          className={selectCls}
        >
          {amcOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        Quarter
        <select
          value={selectedPeriod}
          onChange={(e) => update("movePeriod", e.target.value)}
          className={selectCls}
        >
          {periodOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
