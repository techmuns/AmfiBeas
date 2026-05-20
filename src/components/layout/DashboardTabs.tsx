import Link from "next/link";
import { cn } from "@/lib/cn";
import { buildTabHref } from "@/lib/tabs";

export interface DashboardTabDef {
  id: string;
  label: string;
}

interface DashboardTabsProps {
  tabs: readonly DashboardTabDef[];
  activeId: string;
  /** The page's raw `searchParams` after `await searchParams`. Every
   *  key except `tab` is preserved on each tab link so per-card lens
   *  toggles, month pickers, and other deep links survive tab
   *  switches. */
  searchParams: Record<string, string | string[] | undefined>;
}

/**
 * Sticky horizontal tab strip rendered as plain `<Link>` elements — no
 * client component, no router hooks. Each tab rewrites the page URL
 * with `?tab=<id>` while preserving every other query param so the
 * URL is always shareable.
 */
export function DashboardTabs({
  tabs,
  activeId,
  searchParams,
}: DashboardTabsProps) {
  return (
    <div
      className="sticky top-14 z-10 -mx-6 mb-6 border-b border-border bg-background/85 backdrop-blur lg:-mx-8"
      data-component="dashboard-tabs"
    >
      <nav
        role="tablist"
        aria-label="Dashboard sections"
        className="flex gap-1 overflow-x-auto px-6 py-2 lg:px-8"
      >
        {tabs.map((t) => {
          const active = t.id === activeId;
          const href = buildTabHref(t.id, searchParams);
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
    </div>
  );
}
