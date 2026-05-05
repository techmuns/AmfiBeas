"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import { Check, RotateCcw } from "lucide-react";
import { AMCS } from "@/data/amcs";
import { cn } from "@/lib/cn";
import type { DateRange } from "@/lib/filter";

interface FilterBarProps {
  showRange?: "monthly" | "quarterly" | false;
}

export function FilterBar({ showRange = "monthly" }: FilterBarProps) {
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
          { value: "4q", label: "4Q" },
          { value: "8q", label: "8Q" },
          { value: "all", label: "All" },
        ]
      : [
          { value: "12m", label: "12M" },
          { value: "24m", label: "24M" },
          { value: "all", label: "All" },
        ];

  const allSelected = selected.size === 0;
  const isDirty = selected.size > 0 || range !== "all";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-xs",
        pending && "opacity-70"
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-muted-foreground">Peers</span>
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
        {AMCS.map((a) => {
          const active = selected.has(a.slug);
          return (
            <button
              key={a.slug}
              type="button"
              onClick={() => toggleAmc(a.slug)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {active && <Check className="h-3 w-3" />}
              {a.ticker ?? a.name.split(" ")[0]}
            </button>
          );
        })}
      </div>

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
