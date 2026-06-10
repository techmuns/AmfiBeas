import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { buildTabHref } from "@/lib/tabs";

export interface DashboardTabDef {
  id: string;
  label: string;
}

interface DashboardTabsProps {
  /** The page's own route, e.g. `"/monthly"` or `"/quarterly"`. Used
   *  to build absolute internal hrefs so each tab Link navigates via
   *  the client-side router. */
  basePath: string;
  tabs: readonly DashboardTabDef[];
  activeId: string;
  /** The page's raw `searchParams` after `await searchParams`. Every
   *  key except `tab` is preserved on each tab link so per-card lens
   *  toggles, month pickers, and other deep links survive tab
   *  switches. */
  searchParams: Record<string, string | string[] | undefined>;
  /** Optional right-aligned node rendered on the same row as the tab
   *  links (e.g. a status pill or weather-style badge). Sticks with
   *  the tabs while scrolling. */
  action?: ReactNode;
}

/**
 * Sticky horizontal tab strip rendered as plain `<Link>` elements — no
 * client component, no router hooks. Each tab rewrites the page URL
 * with `<basePath>?tab=<id>` while preserving every other query param
 * so the URL is always shareable AND every click stays inside the
 * same browser tab via the client-side router.
 */
export function DashboardTabs({
  basePath,
  tabs,
  activeId,
  searchParams,
  action,
}: DashboardTabsProps) {
  return (
    <div
      className="sticky top-14 z-20 -mx-6 mb-6 border-b border-border bg-background/85 backdrop-blur lg:-mx-8"
      data-component="dashboard-tabs"
    >
      <div className="flex items-center gap-3 px-6 py-2 lg:px-8">
        <nav
          role="tablist"
          aria-label="Dashboard sections"
          className="flex flex-1 gap-1 overflow-x-auto"
        >
          {tabs.map((t) => {
            const active = t.id === activeId;
            const href = buildTabHref(basePath, t.id, searchParams);
            return (
              <Link
                key={t.id}
                href={href}
                role="tab"
                aria-selected={active}
                scroll={false}
                className={cn(
                  "whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-primary/10 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  );
}
