import Link from "next/link";
import { LayoutDashboard, CalendarDays, FileBarChart, Building2 } from "lucide-react";

const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/monthly", label: "Monthly", icon: CalendarDays },
  { href: "/quarterly", label: "Quarterly", icon: FileBarChart },
  { href: "/amc", label: "AMCs", icon: Building2 },
];

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card lg:block">
      <div className="flex h-14 items-center px-5 text-base font-semibold tracking-tight">
        AmfiBeas
      </div>
      <nav className="px-3 py-2">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
