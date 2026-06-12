"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface ClientTabDef {
  id: string;
  label: string;
}

/**
 * Client-side tab switcher that mounts ONLY the active tab.
 *
 * Unlike a show/hide tab strip, the inactive panels are not rendered into the
 * DOM at all — their live component instances (charts, tables, event handlers)
 * never exist, so they hold no browser memory, and `key={active}` forces a
 * clean unmount/remount on every switch so nothing from the previous tab
 * lingers. (The panels arrive as already-serialized React nodes from the
 * statically-rendered server page, so this is purely a client mount/unmount
 * optimisation.)
 *
 * Switching is a pure client state change (mirrored to the URL hash), so it
 * never spends Cloudflare Worker CPU (Error 1102).
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
      {/* Sticky sub-tab strip: stays pinned just under the 56px Topbar
       *  (top-14) so tabs are reachable from anywhere on a long page. The
       *  negative margins + padding bleed the backdrop to the content edges. */}
      <div className="sticky top-14 z-20 -mx-6 flex flex-wrap gap-1 border-b bg-background/95 px-6 pt-1 backdrop-blur lg:-mx-8 lg:px-8">
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
      {/* Only the active panel is mounted; key forces a fresh mount so the
       *  previous tab's component tree is fully released. */}
      <div key={active} className="space-y-6">
        {panels[active] ?? null}
      </div>
    </div>
  );
}
