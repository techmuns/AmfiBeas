"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  // CalendarRange, // hidden along with the /quarterly nav item
  FileBarChart,
  Building2,
  Briefcase,
} from "lucide-react";
import { cn } from "@/lib/cn";

// Main nav — five analytical pages a client actually scrolls through.
// /premium is a "what licensed data could enable" pitch and not part
// of the client narrative; we leave the page live but pull it out of
// the main nav so the sidebar stays focused. /data-sources and
// /other-schemes remain reachable via deep links and footer copy.
const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/monthly", label: "Monthly", icon: CalendarDays },
  // Quarterly hidden from the nav for now (route still live at /quarterly).
  // To unhide: restore this line and the CalendarRange import above.
  // { href: "/quarterly", label: "Quarterly", icon: CalendarRange },
  { href: "/amc", label: "AMCs", icon: Building2 },
  { href: "/financials", label: "Financials", icon: FileBarChart },
  { href: "/mfs-portfolio-tracker", label: "MFs Portfolio Tracker", icon: Briefcase },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card lg:sticky lg:top-0 lg:block lg:h-screen lg:self-start lg:overflow-y-auto">
      <div className="flex h-14 items-center px-5 text-base font-semibold tracking-tight">
        AmfiBeas
      </div>
      <nav className="px-3 py-2">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
