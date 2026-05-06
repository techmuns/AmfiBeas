"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  CalendarDays,
  FileBarChart,
  Building2,
  Database,
} from "lucide-react";
import { cn } from "@/lib/cn";

const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/monthly", label: "Monthly", icon: CalendarDays },
  { href: "/quarterly", label: "Quarterly", icon: FileBarChart },
  { href: "/amc", label: "AMCs", icon: Building2 },
  { href: "/data-sources", label: "Sources", icon: Database },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card lg:block">
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
