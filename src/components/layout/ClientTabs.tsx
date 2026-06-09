"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface ClientTabDef {
  id: string;
  label: string;
}

/**
 * Client-side tab switcher for statically-rendered pages.
 *
 * The page renders every tab's panel at BUILD time and hands the panels to this
 * component, which shows/hides them in the browser. Because switching tabs is a
 * pure client state change (no `?tab=` round-trip to the Worker), a static page
 * using this never spends server CPU on a tab switch — which is what keeps the
 * Cloudflare Worker under its per-request CPU budget (Error 1102) on the Free
 * plan. The active tab is mirrored to the URL hash (e.g. `#compare`) so links
 * and refreshes land on the right tab without making the route dynamic.
 */
export function ClientTabs({
  tabs,
  panels,
  defaultId,
}: {
  tabs: readonly ClientTabDef[];
  panels: Record<string, ReactNode>;
  defaultId: string;
}) {
  const [active, setActive] = useState(defaultId);

  const select = (id: string) => {
    setActive(id);
    if (typeof window !== "undefined") {
      history.replaceState(null, "", `#${id}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => select(t.id)}
            aria-current={t.id === active ? "page" : undefined}
            className={cn(
              "-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              t.id === active
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} hidden={t.id !== active} className="space-y-6">
          {panels[t.id]}
        </div>
      ))}
    </div>
  );
}
