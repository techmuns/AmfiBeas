import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Shared tab strip used by /monthly, /quarterly, /amc, /other-schemes.
 * URL-driven — each tab is a plain `<Link>` to `?tab=<key>` on the
 * page's basePath. No client component, no router hook. The default
 * (first) tab drops the `?tab=` param so vanilla URLs stay clean.
 */
export function TabNav<T extends string>({
  basePath,
  tabs,
  active,
  ariaLabel,
}: {
  basePath: string;
  tabs: Array<{ key: T; label: string; description: string }>;
  active: T;
  ariaLabel: string;
}) {
  const defaultKey = tabs[0]?.key;
  return (
    <nav
      aria-label={ariaLabel}
      className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-2"
    >
      <ul className="flex flex-wrap items-center gap-1">
        {tabs.map((t) => {
          const isActive = t.key === active;
          const href = t.key === defaultKey ? basePath : `${basePath}?tab=${t.key}`;
          return (
            <li key={t.key}>
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex items-center rounded-md px-3 py-1.5 text-sm font-medium tracking-tight transition-colors",
                  isActive
                    ? "bg-brand-navy/10 text-brand-navy"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] italic text-muted-foreground">
        {tabs.find((t) => t.key === active)?.description}
      </p>
    </nav>
  );
}
