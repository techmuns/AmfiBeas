"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Building2 } from "lucide-react";
import { cn } from "@/lib/cn";

// AMC-centric nav — two destinations. "Total Market" (/) is the industry
// hub (snapshot, flow table, AUM mix, attribution, fee mix, category shifts,
// market phases); "AMCs" (/amc) is the fund-house lens with the AMC detail
// pages (/amc/[slug]) reached by drilling into a row. The monthly /
// quarterly / financials / summary routes now redirect into these two; the
// scheme-level tracker, other-schemes, premium and data-sources pages stay
// live as deep-link / drill-down targets, out of the primary nav.
const nav = [
  { href: "/", label: "Total Market", icon: LayoutDashboard },
  { href: "/amc", label: "AMCs", icon: Building2 },
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
