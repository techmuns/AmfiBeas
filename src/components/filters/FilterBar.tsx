"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import { Check, RotateCcw } from "lucide-react";
import { AMCS, type AMCProfile } from "@/data/amcs";
import { cn } from "@/lib/cn";
import type { DateRange } from "@/lib/filter";

export type AmcStatus = "live" | "pending" | "unavailable";

interface FilterBarProps {
  showRange?: "monthly" | "quarterly" | false;
  /**
   * "multi" — toggle pills, any subset selectable (default).
   * "single" — radio behaviour, exactly one slug selected at a time, no
   *    "All" option. Selecting a different slug deselects the previous.
   */
  amcMode?: "multi" | "single";
  /** Per-slug selectability + badge label. Defaults to all live. */
  amcStatus?: Record<string, AmcStatus>;
  /** Single-mode default slug used when the URL has no valid selection. */
  defaultSlug?: string;
  /**
   * Optional subset of AMC slugs to display. When set, the bar shows
   * only AMCs whose slug appears in this list (in AMCS order). When
   * omitted the full AMCS list renders. Used by /financials to narrow
   * the bar to listed AMCs only.
   */
  amcs?: readonly string[];
  /**
   * When false the AMC peer chips are hidden entirely; the bar then
   * collapses to the Range selector + Reset. Used on /monthly and
   * /quarterly so the industry pages don't show per-AMC selection.
   * Defaults to true.
   */
  showPeers?: boolean;
}

export function FilterBar({
  showRange = "monthly",
  amcMode = "multi",
  amcStatus,
  defaultSlug,
  amcs,
  showPeers = true,
}: FilterBarProps) {
  const baseAmcs: AMCProfile[] = useMemo(() => {
    if (!amcs) return AMCS;
    const allow = new Set(amcs);
    return AMCS.filter((a) => allow.has(a.slug));
  }, [amcs]);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const selected = useMemo(() => {
    const raw = params.get("amcs") ?? "";
    return new Set(raw ? raw.split(",").filter(Boolean) : []);
  }, [params]);

  const range = (params.get("range") ?? "all") as DateRange;

  const setParams = useCallback(
    (mut: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(params.toString());
      mut(next);
      const qs = next.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [params, pathname, router]
  );

  const setSingleAmc = (slug: string) => {
    setParams((next) => {
      next.set("amcs", slug);
    });
  };

  const toggleAmc = (slug: string) => {
    setParams((next) => {
      const cur = new Set(
        (next.get("amcs") ?? "").split(",").filter(Boolean)
      );
      if (cur.has(slug)) cur.delete(slug);
      else cur.add(slug);
      if (cur.size === 0) next.delete("amcs");
      else next.set("amcs", Array.from(cur).join(","));
    });
  };

  const setRange = (r: DateRange) => {
    setParams((next) => {
      if (r === "all") next.delete("range");
      else next.set("range", r);
    });
  };

  const reset = () => {
    setParams((next) => {
      next.delete("amcs");
      next.delete("range");
    });
  };

  const rangeOptions: { value: DateRange; label: string }[] =
    showRange === "quarterly"
      ? [
          { value: "4q", label: "Last 4Q" },
          { value: "8q", label: "Last 8Q" },
          { value: "all", label: "All" },
        ]
      : [
          { value: "12m", label: "Last 12M" },
          { value: "24m", label: "Last 24M" },
          { value: "all", label: "All" },
        ];

  // Single-mode active slug = first valid selection or the configured default.
  const singleActive = useMemo(() => {
    if (amcMode !== "single") return null;
    for (const s of selected) {
      if (!amcStatus || amcStatus[s] === "live") return s;
    }
    return defaultSlug ?? null;
  }, [amcMode, selected, amcStatus, defaultSlug]);

  // Single-mode rendering order: live first, then pending, then unavailable.
  // Multi-mode keeps the original (filtered) AMCS order untouched.
  const orderedAmcs = useMemo(() => {
    if (amcMode !== "single") return baseAmcs;
    const rank: Record<AmcStatus, number> = {
      live: 0,
      pending: 1,
      unavailable: 2,
    };
    return [...baseAmcs].sort((a, b) => {
      const sa: AmcStatus = amcStatus?.[a.slug] ?? "live";
      const sb: AmcStatus = amcStatus?.[b.slug] ?? "live";
      return rank[sa] - rank[sb];
    });
  }, [amcMode, amcStatus, baseAmcs]);

  const allSelected = selected.size === 0;
  const peerDirty =
    amcMode === "single"
      ? (singleActive ?? "") !== (defaultSlug ?? "")
      : selected.size > 0;
  const isDirty = showPeers ? peerDirty || range !== "all" : range !== "all";

  const peersLabel = amcMode === "single" ? "AMC" : "Peers";

  // showRange === false (no range selector) AND showPeers === false leaves
  // nothing to render. Return null so we don't ship an empty bordered bar.
  if (!showPeers && !showRange) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-xs",
        pending && "opacity-70"
      )}
    >
      {showPeers && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-muted-foreground">{peersLabel}</span>
          {amcMode === "multi" && (
            <button
              type="button"
              onClick={() =>
                setParams((next) => {
                  next.delete("amcs");
                })
              }
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                allSelected
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              All
            </button>
          )}
          {orderedAmcs.map((a) => {
            const status: AmcStatus = amcStatus?.[a.slug] ?? "live";
            const disabled = amcMode === "single" && status !== "live";
            const active =
              amcMode === "single"
                ? singleActive === a.slug
                : selected.has(a.slug);
            const titleSuffix =
              status === "pending"
                ? " — listed · financials pending source"
                : status === "unavailable"
                  ? " — no sourced quarterly financials"
                  : "";
            return (
              <button
                key={a.slug}
                type="button"
                disabled={disabled}
                onClick={() =>
                  amcMode === "single"
                    ? setSingleAmc(a.slug)
                    : toggleAmc(a.slug)
                }
                aria-pressed={active}
                title={(a.ticker ?? a.name) + titleSuffix}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : disabled
                      ? "cursor-not-allowed border-dashed border-border text-muted-foreground/60"
                      : "border-border text-muted-foreground hover:bg-accent"
                )}
              >
                {active && <Check className="h-3 w-3" />}
                {a.ticker ?? a.name.split(" ")[0]}
                {status === "pending" && (
                  <span className="ml-0.5 text-[9px] uppercase tracking-wide text-muted-foreground/70">
                    pending
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {showRange && (
        <div className="ml-auto flex items-center gap-1.5">
          <span className="mr-1 text-muted-foreground">Range</span>
          <div className="inline-flex overflow-hidden rounded-full border">
            {rangeOptions.map((o) => {
              const active = (range || "all") === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setRange(o.value)}
                  className={cn(
                    "px-2.5 py-1 text-xs transition-colors",
                    active
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-accent"
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isDirty && (
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          aria-label="Reset filters"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      )}
    </div>
  );
}
