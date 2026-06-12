"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sparkles,
  LayoutDashboard,
  CalendarDays,
  // CalendarRange, // hidden along with the /quarterly nav item
  FileBarChart,
  Building2,
  Briefcase,
} from "lucide-react";
import { cn } from "@/lib/cn";

// Main nav — the analytical pages a client actually scrolls through.
// Insights leads (the client's "so what?" tab). /premium is a "what licensed
// data could enable" pitch and not part of the client narrative; the page
// stays live but is pulled out of the main nav. /data-sources and
// /other-schemes remain reachable via deep links / footer. /quarterly is
// hidden per client request (route still live at /quarterly).
const nav = [
  { href: "/insights", label: "Insights", icon: Sparkles },
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/monthly", label: "Monthly", icon: CalendarDays },
  // { href: "/quarterly", label: "Quarterly", icon: CalendarRange },
  { href: "/amc", label: "AMCs", icon: Building2 },
  { href: "/financials", label: "Financials", icon: FileBarChart },
  { href: "/mfs-portfolio-tracker", label: "MFs Portfolio Tracker", icon: Briefcase },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/** Horizontal primary navigation, rendered inside the Topbar. */
export function TopNav({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className={cn("flex items-center gap-1 overflow-x-auto", className)}
    >
      {nav.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="whitespace-nowrap">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
