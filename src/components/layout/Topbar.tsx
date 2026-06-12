import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import { DataModeBadge } from "./DataModeBadge";
import { TopNav } from "./TopNav";

export function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background/80 px-6 backdrop-blur lg:px-8">
      <Link
        href="/"
        className="shrink-0 text-base font-semibold tracking-tight"
      >
        AmfiBeas
      </Link>
      <TopNav className="flex-1" />
      <div className="flex shrink-0 items-center gap-3">
        <DataModeBadge />
        <ThemeToggle />
      </div>
    </header>
  );
}
